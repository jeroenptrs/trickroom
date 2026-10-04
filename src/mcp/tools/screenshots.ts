import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { suffixOutputPath } from "../../screenshot/screenshot-service";
import {
	describeScreenshotViewport,
	type ScreenshotComponentTarget,
	type ScreenshotImage,
	type ScreenshotRequest,
	type ScreenshotResult,
	type ScreenshotTheme,
	type ScreenshotViewportInput,
} from "../../screenshot/types";
import { DesignFileServiceError } from "../../services/design-file-service";
import { DesignTransformError } from "../../services/design-transform-service";
import {
	describeMissingElementId,
	getDesignLookupEntities,
} from "../../services/element-lookup-hints";
import type { TrickroomDesign } from "../../types";
import { listDesignSystems } from "../../utils/design-system-store";
import { formatDidYouMean, suggestClosest } from "../../utils/suggestions";
import { readSystemComponentManifest } from "../../utils/system-component-manifest-service";
import type { SystemComponentVariantSchema } from "../../utils/system-components";
import {
	assertCanReadDesignFile,
	assertCanWriteProject,
	getMcpPolicy,
	type McpAuditEntry,
	McpPolicyError,
} from "../governance";
import { assertConfiguredSystem } from "../payloads/design-system";
import {
	findElementContext,
	getNodeName,
	readDesignFileForTool,
} from "../payloads/design-tree";
import type { TrickroomMcpServerContext } from "../server-types";
import { screenshotAnnotations } from "./annotations";
import type { McpToolContext } from "./context";
import { auditToolResult } from "./mutation-support";
import { createPolicyDeniedResult, createToolErrorResult } from "./results";
import { designFileIdSchema, withProjectScopedInput } from "./schemas";

/** Images per call, across targets, viewports and themes. */
export const MAX_SCREENSHOTS_PER_CALL = 12;
/** Targets (boards or nodes) captured at the same time. */
const CAPTURE_CONCURRENCY = 3;
/**
 * Boards default to half scale: a quarter of the image tokens, and layout,
 * spacing and body text stay readable. Nodes and components are small and
 * usually checked for detail, so they default to full scale.
 */
const DEFAULT_BOARD_SCALE = 0.5;
const DEFAULT_DETAIL_SCALE = 1;
/** Cells in one component variant matrix. */
const MAX_MATRIX_CELLS = 64;

const singleViewportSchema = z.union([
	z.enum(["mobile", "tablet", "desktop"]),
	z.number().int().min(1).max(3840),
	z.object({
		width: z.number().int().min(1).max(3840),
		height: z.number().int().min(1).max(2160),
	}),
]);
const themeSchema = z.enum(["light", "dark"]);

const toList = <T>(value: T | T[] | undefined): T[] | undefined =>
	value === undefined ? undefined : Array.isArray(value) ? value : [value];

type CaptureTarget = {
	label: string;
	request: ScreenshotRequest;
};

type CaptureFailure = { result: CallToolResult };

/** Runs `run` over `items` with at most `limit` in flight, keeping order. */
async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	run: (item: T) => Promise<R>,
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next;
			next += 1;
			results[index] = await run(items[index] as T);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	return results;
}

const estimateImageTokens = (image: { width: number; height: number }) =>
	Math.round((image.width * image.height) / 750);

function describeImage(image: ScreenshotImage, viewportLabel: string) {
	const parts = [
		`${viewportLabel === `${image.viewport.width}x${image.viewport.height}` ? viewportLabel : `${viewportLabel} ${image.viewport.width}x${image.viewport.height}`}`,
		image.theme,
		`${image.width}x${image.height}px`,
	];
	if (image.cropped) {
		parts.push(
			`cropped to top ${image.cropped.capturedCssHeight} of ${image.cropped.cssHeight} CSS px`,
		);
	}
	if (image.path) parts.push(`saved ${image.path}`);
	return parts.join(" · ");
}

export const registerScreenshotTools = (ctx: McpToolContext) => {
	const { server, screenshotCapture, withProjectContext } = ctx;

	const screenshotCommonInput = {
		viewport: z
			.union([
				singleViewportSchema,
				z.array(singleViewportSchema).min(1).max(6),
			])
			.optional()
			.describe(
				'Viewport preset (mobile 390x844, tablet 768x1024, desktop 1440x900), a width in CSS px (height 900), or { width, height }. Pass an array to capture each viewport in one call, e.g. ["mobile", "desktop"]. Defaults to desktop.',
			),
		theme: z
			.union([themeSchema, z.array(themeSchema).min(1).max(2)])
			.optional()
			.describe('"light" (default), "dark", or ["light", "dark"] for both.'),
		scale: z
			.number()
			.min(0.25)
			.max(2)
			.optional()
			.describe(
				"Output pixels per CSS pixel. Defaults to 0.5 for boards (a quarter of the image cost; layout, spacing and body text stay readable) and 1 for nodes and components. Use 1 or more to check small text, borders or icons.",
			),
		maxHeight: z
			.number()
			.int()
			.min(1)
			.max(8000)
			.optional()
			.describe(
				"Crop targets taller than this many CSS px, keeping the top. Defaults to two viewport heights.",
			),
		outputPath: z
			.string()
			.min(1)
			.optional()
			.describe(
				"Optional .png path. Relative paths resolve inside the project; absolute paths are explicit. With several captures, a board and viewport/theme suffix is added per image.",
			),
		executablePath: z
			.string()
			.min(1)
			.optional()
			.describe(
				"Optional Chrome/Chromium executable for this call. Prefer a persistent fix: `npx trickroom install-browser`, or `npx trickroom install-browser --executable-path <path>`.",
			),
	} as const;

	type CommonInput = {
		viewport?: ScreenshotViewportInput | ScreenshotViewportInput[];
		theme?: ScreenshotTheme | ScreenshotTheme[];
		scale?: number;
		maxHeight?: number;
		outputPath?: string;
		executablePath?: string;
	};

	// Unknown board ids always list the available boards (id + name), flag
	// truncated ids, and point at screenshotNode when the id is a nested node.
	const createBoardNotFoundResult = (
		context: TrickroomMcpServerContext,
		design: TrickroomDesign,
		boardId: string,
		designFileId: string,
	): CallToolResult => {
		const availableBoards = design.boards.map((board) => ({
			id: board.id,
			name: getNodeName(board) ?? null,
		}));
		const missing = describeMissingElementId(
			design.boards,
			boardId,
			design.boards.map((board) => board.id),
		);
		const nestedElement = findElementContext(design, boardId);
		const nestedHint = nestedElement
			? ` "${boardId}" is a nested element, not a board; use screenshotNode to capture it.`
			: "";
		const truncatedHint =
			missing.details.truncatedIdMatches || missing.details.nameMatches
				? ` ${missing.hint}`
				: "";
		return createToolErrorResult(
			context,
			"BOARD_NOT_FOUND",
			`Board "${boardId}" was not found in design "${designFileId}".${nestedHint}${truncatedHint}`,
			{
				availableBoardIds: availableBoards.map((board) => board.id),
				availableBoards,
				...(missing.details.truncatedIdMatches
					? { truncatedIdMatches: missing.details.truncatedIdMatches }
					: {}),
				...(missing.details.nameMatches
					? { nameMatches: missing.details.nameMatches }
					: {}),
			},
		);
	};

	const resolveBoardTargets = (
		context: TrickroomMcpServerContext,
		design: TrickroomDesign,
		designFileId: string,
		boardIds: string[] | "all",
	): CaptureTarget[] | CaptureFailure => {
		const boards =
			boardIds === "all"
				? design.boards
				: boardIds.map((boardId) =>
						design.boards.find((board) => board.id === boardId),
					);
		const missingIndex = boards.indexOf(undefined);
		if (missingIndex >= 0 && boardIds !== "all") {
			return {
				result: createBoardNotFoundResult(
					context,
					design,
					boardIds[missingIndex] ?? "",
					designFileId,
				),
			};
		}
		if (boards.length === 0) {
			return {
				result: createToolErrorResult(
					context,
					"NO_MATCHING_BOARDS",
					`Design "${designFileId}" has no boards.`,
					{ availableBoardIds: [], availableBoards: [] },
				),
			};
		}
		return boards.flatMap((board) =>
			board
				? [
						{
							label: getNodeName(board) ?? board.id,
							request: { designFileId, boardId: board.id },
						},
					]
				: [],
		);
	};

	const resolveNodeTargets = (
		context: TrickroomMcpServerContext,
		design: TrickroomDesign,
		designFileId: string,
		nodeIds: string[],
	): CaptureTarget[] | CaptureFailure => {
		const targets: CaptureTarget[] = [];
		for (const nodeId of nodeIds) {
			const element = findElementContext(design, nodeId);
			const containingBoard = design.boards.find((board) =>
				findElementContext({ ...design, boards: [board] }, nodeId),
			);
			if (!element || !containingBoard) {
				const missing = describeMissingElementId(
					getDesignLookupEntities([design]),
					nodeId,
					design.boards.map((item) => item.id),
				);
				return {
					result: createToolErrorResult(
						context,
						"NODE_NOT_FOUND",
						`Node "${nodeId}" was not found in design "${designFileId}". ${missing.hint}`,
						missing.details,
					),
				};
			}
			targets.push({
				label: `${getNodeName(element.element) ?? nodeId} in ${getNodeName(containingBoard) ?? containingBoard.id}`,
				request: { designFileId, boardId: containingBoard.id, nodeId },
			});
		}
		return targets;
	};

	const resolveComponentTarget = async (
		context: TrickroomMcpServerContext,
		input: ComponentInput,
	): Promise<CaptureTarget | CaptureFailure> => {
		let systemHandle = input.systemName;
		if (!systemHandle) {
			const systems = await listDesignSystems(context.projectRoot);
			const preferred =
				systems.find(
					(system) =>
						system.manifest.systemId === context.config.defaultSystemId,
				) ?? (systems.length === 1 ? systems[0] : undefined);
			if (!preferred) {
				return {
					result: createToolErrorResult(
						context,
						"SYSTEM_REQUIRED",
						"component.systemName is required: the project has several design systems and no default.",
						{
							availableSystems: systems.map((system) => ({
								systemId: system.manifest.systemId,
								systemName: system.manifest.systemName,
							})),
						},
					),
				};
			}
			systemHandle = preferred.manifest.systemId;
		}
		const system = await assertConfiguredSystem(context, systemHandle);
		const systemId = system.manifest.systemId;
		const manifest = (
			await readSystemComponentManifest(context.projectRoot, systemId)
		).manifest;
		const records = Object.values(manifest.components);
		const record =
			manifest.components[input.componentId] ??
			records.find((candidate) => candidate.slug === input.componentId);
		if (!record) {
			const slugs = records.map((candidate) => candidate.slug);
			const suggestions = suggestClosest(input.componentId, slugs);
			return {
				result: createToolErrorResult(
					context,
					"UNKNOWN_COMPONENT",
					`System component "${input.componentId}" was not found in system "${system.manifest.systemName}".${formatDidYouMean(suggestions)} Pass a component id or slug from listSystemComponents.`,
					{ suggestions, availableSlugs: slugs },
				),
			};
		}
		const source = input.source ?? (record.published ? "published" : "draft");
		const payload =
			source === "draft"
				? record.draft
				: record.published?.versions[record.published.currentVersion];
		if (!payload) {
			return {
				result: createToolErrorResult(
					context,
					source === "draft" ? "NO_DRAFT" : "NOT_PUBLISHED",
					source === "draft"
						? `System component "${record.slug}" has no draft.`
						: `System component "${record.slug}" is not published; pass component.source "draft".`,
				),
			};
		}
		const axes = payload.variants?.axes ?? {};
		const axisError = validateVariantInput(input, axes);
		if (axisError) {
			return {
				result: createToolErrorResult(
					context,
					axisError.code,
					axisError.message,
					{
						variantAxes: Object.fromEntries(
							Object.entries(axes).map(([axis, definition]) => [
								axis,
								Object.keys(definition.values),
							]),
						),
					},
				),
			};
		}
		const [rows, columns] = toList(input.matrix) ?? [];
		const component: ScreenshotComponentTarget = {
			systemId,
			componentId: record.componentId,
			...(input.source === "draft" || source === "draft"
				? { source: "draft" as const }
				: {}),
			...(input.variants ? { variants: input.variants } : {}),
			...(rows ? { rows } : {}),
			...(columns ? { columns } : {}),
		};
		const variantLabel = Object.entries(input.variants ?? {})
			.map(([axis, value]) => `${axis}=${value}`)
			.join(", ");
		const matrixLabel = rows
			? `${rows}${columns ? ` × ${columns}` : ""} matrix`
			: "";
		return {
			label: [
				`${record.name}${source === "draft" ? " (draft)" : ""}`,
				matrixLabel,
				variantLabel,
			]
				.filter(Boolean)
				.join(" · "),
			request: { component },
		};
	};

	const runScreenshotTool = async (
		context: TrickroomMcpServerContext,
		toolName: "screenshotBoard" | "screenshotNode",
		input: CommonInput & {
			designFileId?: string;
			boardIds?: string[] | "all";
			nodeIds?: string[];
			component?: ComponentInput;
		},
	): Promise<CallToolResult> => {
		const viewports = toList(input.viewport) ?? [undefined];
		const themes = toList(input.theme) ?? ["light" as const];
		const auditBase = {
			toolName,
			operation: toolName,
			designFileId: input.designFileId ?? null,
			details: {
				boardIds: input.boardIds ?? null,
				nodeIds: input.nodeIds ?? null,
				component: input.component ?? null,
				viewports: viewports.map(describeScreenshotViewport),
				themes,
				scale: input.scale ?? null,
				outputPath: input.outputPath ?? null,
			},
		} satisfies Omit<McpAuditEntry, "success" | "status" | "projectRoot">;
		let result: CallToolResult;
		try {
			const policy = getMcpPolicy(context.config);
			if (input.outputPath) assertCanWriteProject(policy);

			let targets: CaptureTarget[] | CaptureFailure;
			let designName: string | null = null;
			if (input.component) {
				const target = await resolveComponentTarget(context, input.component);
				targets = "result" in target ? target : [target];
			} else if (!input.designFileId) {
				targets = {
					result: createToolErrorResult(
						context,
						"INVALID_SCREENSHOT_REQUEST",
						"Pass designFileId with boardId, or component to capture a system component.",
					),
				};
			} else {
				assertCanReadDesignFile(policy, input.designFileId);
				const read = await readDesignFileForTool(context, input.designFileId);
				designName = read.design.name;
				targets = input.nodeIds
					? resolveNodeTargets(
							context,
							read.design,
							input.designFileId,
							input.nodeIds,
						)
					: input.boardIds
						? resolveBoardTargets(
								context,
								read.design,
								input.designFileId,
								input.boardIds,
							)
						: {
								result: createToolErrorResult(
									context,
									"INVALID_SCREENSHOT_REQUEST",
									'Pass boardId: a board id, several ids, or "all".',
								),
							};
			}
			if ("result" in targets) {
				await auditToolResult(context, auditBase, targets.result);
				return targets.result;
			}

			const total = targets.length * viewports.length * themes.length;
			if (total > MAX_SCREENSHOTS_PER_CALL) {
				result = createToolErrorResult(
					context,
					"TOO_MANY_SCREENSHOTS",
					`${targets.length} target(s) × ${viewports.length} viewport(s) × ${themes.length} theme(s) is ${total} images; one call returns at most ${MAX_SCREENSHOTS_PER_CALL}. Split the call, or capture fewer boards or viewports.`,
				);
				await auditToolResult(context, auditBase, result);
				return result;
			}

			const shots = themes.flatMap((theme) =>
				viewports.map((viewport) => ({
					...(viewport !== undefined ? { viewport } : {}),
					theme,
				})),
			);
			const captured = await mapWithConcurrency(
				targets,
				CAPTURE_CONCURRENCY,
				(target) =>
					screenshotCapture(context, {
						...target.request,
						shots,
						scale:
							input.scale ??
							(toolName === "screenshotBoard" && !input.component
								? DEFAULT_BOARD_SCALE
								: DEFAULT_DETAIL_SCALE),
						...(input.maxHeight !== undefined
							? { maxHeight: input.maxHeight }
							: {}),
						...(input.outputPath
							? {
									outputPath:
										targets.length === 1
											? input.outputPath
											: suffixOutputPath(input.outputPath, target.label),
								}
							: {}),
						...(input.executablePath
							? { executablePath: input.executablePath }
							: {}),
					}),
			);
			result = createScreenshotResult(designName, targets, captured, shots);
		} catch (error) {
			if (error instanceof McpPolicyError) {
				result = createPolicyDeniedResult(context, error);
			} else if (
				error instanceof DesignFileServiceError ||
				error instanceof DesignTransformError
			) {
				result = createToolErrorResult(context, error.code, error.message);
			} else {
				const code =
					typeof error === "object" &&
					error !== null &&
					"code" in error &&
					typeof error.code === "string"
						? error.code
						: "SCREENSHOT_FAILED";
				result = createToolErrorResult(
					context,
					code,
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		await auditToolResult(context, auditBase, result);
		return result;
	};

	const componentInputSchema = z
		.object({
			componentId: z
				.string()
				.min(1)
				.describe("System component id or slug (listSystemComponents)."),
			systemName: z
				.string()
				.min(1)
				.optional()
				.describe(
					"Design system name or id. Defaults to the project's default system.",
				),
			variants: z
				.record(z.string(), z.string())
				.optional()
				.describe(
					'Variant values, e.g. { "size": "lg" }. Unset axes use their defaults.',
				),
			matrix: z
				.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(2)])
				.optional()
				.describe(
					'One axis, or [rowAxis, columnAxis]: renders every value combination as one labelled grid image, e.g. ["intent", "size"]. Other axes come from variants.',
				),
			source: z
				.enum(["published", "draft"])
				.optional()
				.describe(
					"Current published version (default), or the draft. Unpublished components use the draft.",
				),
		})
		.describe(
			"Capture a system component on its own instead of a design board: designFileId and boardId are then not used.",
		);

	server.registerTool(
		"screenshotBoard",
		{
			title: "Screenshot Board",
			description:
				'Render boards through Trickroom\'s capture route and return one PNG image block per capture, after one short text block listing what each image is. Boards are responsive: review one board at several widths in one call (viewport: ["mobile", "desktop"]) instead of creating a board per breakpoint. boardId takes one id, several, or "all"; theme takes ["light", "dark"]. Up to 12 images per call. Boards default to scale 0.5 (pass scale: 1 to check fine detail). Pass component to capture a system component (one variant combination, or a matrix of axis values) without a design file. Requires the optional playwright-core peer and a Chrome/Chromium (`npx trickroom install-browser`). outputPath also writes the PNGs to disk.',
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema
					.optional()
					.describe("Design file UUID. Required unless component is set."),
				boardId: z
					.union([
						z.string().min(1),
						z.array(z.string().min(1)).min(1).max(MAX_SCREENSHOTS_PER_CALL),
					])
					.optional()
					.describe(
						'Root board id, an array of board ids, or "all" for every board in the design. Required unless component is set.',
					),
				component: componentInputSchema.optional(),
				...screenshotCommonInput,
			}),
			annotations: screenshotAnnotations,
		},
		async ({ project, boardId, ...input }) =>
			withProjectContext(project, (context) =>
				runScreenshotTool(context, "screenshotBoard", {
					...input,
					...(boardId !== undefined
						? { boardIds: boardId === "all" ? "all" : (toList(boardId) ?? []) }
						: {}),
				}),
			),
	);

	server.registerTool(
		"screenshotNode",
		{
			title: "Screenshot Node",
			description:
				"Render and crop design nodes through Trickroom's capture route, inferring each node's containing board, and return one PNG image block per capture. nodeId takes one id or several; viewport and theme take arrays like screenshotBoard. Requires the optional playwright-core peer and a Chrome/Chromium (`npx trickroom install-browser`). outputPath also writes the PNGs to disk.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				nodeId: z
					.union([
						z.string().min(1),
						z.array(z.string().min(1)).min(1).max(MAX_SCREENSHOTS_PER_CALL),
					])
					.describe("Persistent design node id, or an array of ids."),
				...screenshotCommonInput,
			}),
			annotations: screenshotAnnotations,
		},
		async ({ project, nodeId, ...input }) =>
			withProjectContext(project, (context) =>
				runScreenshotTool(context, "screenshotNode", {
					...input,
					nodeIds: toList(nodeId) ?? [],
				}),
			),
	);
};

type ComponentInput = {
	componentId: string;
	systemName?: string;
	variants?: Record<string, string>;
	matrix?: string | string[];
	source?: "published" | "draft";
};

function validateVariantInput(
	input: ComponentInput,
	axes: SystemComponentVariantSchema["axes"],
): { code: string; message: string } | null {
	const axisNames = Object.keys(axes);
	const describeAxes = () =>
		axisNames.length > 0
			? `Axes: ${axisNames.map((axis) => `${axis} (${Object.keys(axes[axis]?.values ?? {}).join(", ")})`).join("; ")}.`
			: "This component has no variant axes.";
	for (const [axis, value] of Object.entries(input.variants ?? {})) {
		const definition = axes[axis];
		if (!definition) {
			return {
				code: "UNKNOWN_VARIANT_AXIS",
				message: `Unknown variant axis "${axis}". ${describeAxes()}`,
			};
		}
		if (!(value in definition.values)) {
			return {
				code: "UNKNOWN_VARIANT_VALUE",
				message: `Unknown value "${value}" for variant axis "${axis}". ${describeAxes()}`,
			};
		}
	}
	const matrix = toList(input.matrix) ?? [];
	for (const axis of matrix) {
		if (!axes[axis]) {
			return {
				code: "UNKNOWN_VARIANT_AXIS",
				message: `Unknown matrix axis "${axis}". ${describeAxes()}`,
			};
		}
	}
	if (matrix.length === 2 && matrix[0] === matrix[1]) {
		return {
			code: "INVALID_SCREENSHOT_REQUEST",
			message: "matrix needs two different axes.",
		};
	}
	const cells = matrix.reduce(
		(count, axis) => count * Object.keys(axes[axis]?.values ?? {}).length,
		1,
	);
	if (cells > MAX_MATRIX_CELLS) {
		return {
			code: "INVALID_SCREENSHOT_REQUEST",
			message: `The matrix has ${cells} cells; at most ${MAX_MATRIX_CELLS} fit in one image. Fix one axis with variants instead.`,
		};
	}
	return null;
}

/**
 * One short text block (what each image is, plus warnings), then a label and
 * an image block per capture. No JSON payload: the images are the result.
 */
function createScreenshotResult(
	designName: string | null,
	targets: CaptureTarget[],
	captured: ScreenshotResult[],
	shots: Array<{ viewport?: ScreenshotViewportInput; theme: ScreenshotTheme }>,
): CallToolResult {
	const images = captured.flatMap((entry, targetIndex) =>
		entry.captures.map((image, shotIndex) => ({
			image,
			target: targets[targetIndex] as CaptureTarget,
			viewportLabel: describeScreenshotViewport(shots[shotIndex]?.viewport),
		})),
	);
	const scale = images[0]?.image.scale ?? 1;
	const tokens = images.reduce(
		(sum, { image }) => sum + estimateImageTokens(image),
		0,
	);
	const multiple = images.length > 1;
	const lines = [
		`${images.length} screenshot${multiple ? "s" : ""}${designName ? ` of "${designName}"` : ""} at scale ${scale} (~${tokens} image tokens).`,
	];
	const warnings: string[] = [];
	const labels = images.map(({ image, target, viewportLabel }, index) => {
		const prefix = multiple ? `[${index + 1}] ` : "";
		for (const warning of image.warnings ?? []) {
			warnings.push(`${prefix}${warning}`);
		}
		return `${prefix}${target.label} · ${describeImage(image, viewportLabel)}`;
	});
	if (images.some(({ image }) => image.cropped)) {
		warnings.push(
			"Cropped images keep the top of the target; pass maxHeight (up to 8000) or capture lower sections with screenshotNode.",
		);
	}
	// A single capture is described in the summary; several get a label
	// right before each image.
	if (!multiple && labels[0]) lines.push(labels[0]);
	if (warnings.length > 0) lines.push(`Warnings: ${warnings.join(" ")}`);

	const content: CallToolResult["content"] = [
		{ type: "text", text: lines.join("\n") },
	];
	for (const [index, { image }] of images.entries()) {
		if (multiple) content.push({ type: "text", text: labels[index] ?? "" });
		content.push({
			type: "image",
			mimeType: image.mimeType,
			data: image.base64,
		});
	}
	return { content };
}
