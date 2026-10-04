import { z } from "zod";
import { exportDesignBoards } from "../../export/export-design";
import {
	ExportDestinationError,
	writeExportArtifacts,
} from "../../export/write-export-artifacts";
import { DesignTransformError } from "../../services/design-transform-service";
import {
	readMemoryManifest,
	summarizeMemoryManifest,
} from "../../utils/memory-manifest-service";
import {
	assertCanReadDesignFile,
	assertCanWriteProject,
	getMcpPolicy,
} from "../governance";
import {
	listDesignFilesToolPayload,
	readDesignFilePayload,
	readDesignGraphPayload,
	readSubtreePayload,
} from "../payloads/design-reads";
import {
	getDesignHeader,
	getNodeName,
	readDesignFileForTool,
} from "../payloads/design-tree";
import { getProjectReference } from "../payloads/project";
import type { TrickroomMcpProjectRef } from "../project-resolver";
import { TOOL } from "../tool-names";
import {
	ALWAYS_LOAD_META_KEY,
	MAX_RESULT_SIZE_META_KEY,
	mutationAnnotations,
	readOnlyClosedWorldAnnotations,
	SEARCH_HINT_META_KEY,
} from "./annotations";
import type { McpToolContext } from "./context";
import { createJsonResult, createToolErrorResult } from "./results";
import type { registerScreenshotTools } from "./screenshots";

/** PNG exports keep the whole board, up to the capture height limit. */
const MAX_EXPORT_HEIGHT = 8000;

import {
	designFileIdSchema,
	projectScopedInputSchema,
	withProjectScopedInput,
} from "./schemas";

const elementIdSchema = z.string().min(1);

export const registerDesignReadTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		TOOL.designList,
		{
			title: "List Design Files",
			description: `List the project's design files: id, name, revision, systemId (omitted when it is the project's defaultSystemId), layer count, modifiedAt, board ids and names, and memoryNotes when the design has notes. \`systems\` describes each linked design system: name, CSS entry, token snapshot (syncedAt, reviewRequired) and memoryNotes. Unreadable files keep a \`diagnostic\`.`,
			inputSchema: projectScopedInputSchema,
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(await listDesignFilesToolPayload(context)),
			),
	);

	server.registerTool(
		TOOL.designRead,
		{
			title: "Read Design",
			description: `Read a design file. Without elementId: the header (id, name, revision for your next write), a board index (id, name, elementCount) and a bounded tree of compact nodes taken breadth first (depth 2, 50 nodes); boardId reads one board. With elementId: that element's subtree (depth 3, 100 nodes) and its placement (parentId, boardId, index, siblingCount); depth 0 reads the element alone with its childIds. view "outline": a flat structure index keyed by id with parentId and childCount and no classes, for ids at a glance. A node with \`more\` has unread descendants; \`read.next\` is the exact follow-up call.`,
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				boardId: elementIdSchema
					.optional()
					.describe("Board (root element) id: read one board."),
				elementId: elementIdSchema
					.optional()
					.describe(
						"Any element id, boards included: read its subtree and placement.",
					),
				view: z
					.enum(["tree", "outline"])
					.optional()
					.describe(
						'"tree" (default) nests compact nodes. "outline" lists elements flat by id with parentId and childCount, without classes (100 elements, no depth limit).',
					),
				depth: z
					.number()
					.int()
					.min(0)
					.max(20)
					.optional()
					.describe(
						"Descendant levels to include. Defaults to 2 for a design or board, 3 for an element.",
					),
				maxNodes: z
					.number()
					.int()
					.min(1)
					.max(5000)
					.optional()
					.describe(
						"Elements to include, breadth first. Defaults to 50 for a design or board, 100 otherwise; above 500 needs allowLarge.",
					),
				allowLarge: z
					.boolean()
					.optional()
					.describe(
						"Permit depth above 4, maxNodes above 500, or unbounded reads.",
					),
				detail: z
					.enum(["compact", "full"])
					.optional()
					.describe(
						'"compact" (default): id, name (when not the component default), component ("<library>/<component>", "trickroom/" omitted), className, text (cut at 160 chars, with textLength), non-default props, and systemComponent/recipe/slot summaries. "full": id, every stored prop including markers, and full text.',
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
			_meta: {
				[ALWAYS_LOAD_META_KEY]: true,
				[SEARCH_HINT_META_KEY]:
					"inspect tree layers elements board subtree outline element ids",
				// Default reads stay bounded (an outline of 100 elements is about
				// 20k characters); larger ones need allowLarge, asked for on purpose.
				[MAX_RESULT_SIZE_META_KEY]: 150_000,
			},
		},
		async ({
			designFileId,
			boardId,
			elementId,
			view,
			depth,
			maxNodes,
			allowLarge,
			detail,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				if (boardId !== undefined && elementId !== undefined) {
					throw new DesignTransformError(
						"INVALID_OPERATION_PARAMETERS",
						"Pass boardId or elementId, not both: elementId reads any element, boards included.",
					);
				}
				const bounds = { depth, maxNodes, allowLarge };
				if (view === "outline") {
					return createJsonResult(
						await readDesignGraphPayload(context, designFileId, {
							...bounds,
							boardId,
							rootElementId: elementId,
							includeProps: detail === "full",
						}),
					);
				}
				if (elementId !== undefined) {
					return createJsonResult(
						await readSubtreePayload(context, designFileId, elementId, {
							...bounds,
							detail,
						}),
					);
				}
				const payload = await readDesignFilePayload(context, designFileId, {
					...bounds,
					boardId,
					detail,
				});
				const designMemory = await readMemoryManifest(context.projectRoot, {
					kind: "design",
					designId: designFileId,
				});
				const memorySummary = summarizeMemoryManifest(designMemory.manifest);
				return createJsonResult(
					memorySummary.noteCount > 0
						? {
								...payload,
								memory: memorySummary,
								memoryHint: `This design has memory notes on its intent and rationale. Call ${TOOL.memoryRead}({ designFileId }) before editing or explaining it.`,
							}
						: payload,
				);
			}),
	);
};

export const registerDesignExportTools = (
	ctx: McpToolContext,
	screenshots: ReturnType<typeof registerScreenshotTools>,
) => {
	const { server, withPolicyErrorHandling, withProjectContext } = ctx;
	const { viewport, theme, scale } = screenshots.screenshotCommonInput;

	const exportHtml = async ({
		designFileId,
		destinationDir,
		boardIds,
		project,
	}: {
		designFileId: string;
		destinationDir: string;
		boardIds?: string[];
		project?: TrickroomMcpProjectRef;
	}) =>
		withPolicyErrorHandling(project, async (context) => {
			const policy = getMcpPolicy(context.config);
			assertCanWriteProject(policy);
			assertCanReadDesignFile(policy, designFileId);
			const read = await readDesignFileForTool(context, designFileId);
			const requested = new Set((boardIds ?? []).filter((id) => id.length > 0));
			const boards =
				requested.size > 0
					? read.design.boards.filter((board) => requested.has(board.id))
					: read.design.boards;

			if (boards.length === 0) {
				return createToolErrorResult(
					context,
					"NO_MATCHING_BOARDS",
					requested.size > 0
						? "None of the requested boardIds match a board in this design file."
						: "This design file has no boards to export.",
					{
						availableBoardIds: read.design.boards.map((board) => board.id),
						availableBoards: read.design.boards.map((board) => ({
							id: board.id,
							name: getNodeName(board) ?? null,
						})),
					},
				);
			}

			const result = await exportDesignBoards({
				projectRoot: context.projectRoot,
				config: context.config,
				boards,
				systemId: read.design.systemId ?? null,
				projectName: context.config.name,
				designName: read.design.name,
			});

			try {
				const written = await writeExportArtifacts(
					context.projectRoot,
					destinationDir,
					context.config.name,
					read.design.name,
					result,
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					designFile: getDesignHeader(designFileId, read),
					exportedAt: result.epoch,
					systemId: result.systemId,
					destinationDir: written.destinationDir,
					artifacts: written.artifacts,
				});
			} catch (error) {
				if (error instanceof ExportDestinationError) {
					return createToolErrorResult(context, error.code, error.message);
				}
				throw error;
			}
		});

	server.registerTool(
		TOOL.designExport,
		{
			title: "Export Design",
			description: `Write boards of a design to files on disk; omit boardIds for every board. format "html" (default): self-contained interactive HTML, one .html for one board or a .zip with one .html per board, as the in-app export; it inlines the design system's compiled Tailwind and loads React and Base UI from esm.sh, so it needs network access to render. format "png": one PNG per board, viewport and theme, at scale 1 and full height (up to 8000 CSS px), named <design>-<board>[-<viewport>-<theme>].png; it needs a Chrome or Chromium like ${TOOL.designScreenshot}. Absolute destinationDir paths are used as-is; relative ones resolve inside the project and must stay in it. Files of the same name are overwritten. Returns the written paths.`,
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				destinationDir: z
					.string()
					.min(1)
					.describe(
						"Folder to write to: absolute, or relative to the project root.",
					),
				boardIds: z
					.array(z.string().min(1))
					.optional()
					.describe("Boards to export. Omit or leave empty for every board."),
				format: z
					.enum(["html", "png"])
					.optional()
					.describe('"html" (default) or "png".'),
				viewport: viewport.describe(
					"png only: viewport preset, width, or { width, height }; an array writes one file each. Defaults to desktop.",
				),
				theme: theme.describe('png only: "light" (default), "dark", or both.'),
				scale: scale.describe(
					"png only: output pixels per CSS pixel. Defaults to 1.",
				),
			}),
			annotations: {
				...mutationAnnotations,
				// Files of the same name are overwritten; zips are named by time,
				// so exporting again writes another file.
				destructiveHint: true,
				idempotentHint: false,
				// HTML exports load React and Base UI from a CDN; PNG renders may
				// load remote fonts.
				openWorldHint: true,
			},
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"export html png save download file disk zip code handoff",
			},
		},
		async (input) => {
			if (input.format === "png") {
				return withProjectContext(input.project, (context) =>
					screenshots.exportBoardPngs(context, {
						designFileId: input.designFileId,
						destinationDir: input.destinationDir,
						boardIds: input.boardIds,
						viewport: input.viewport,
						theme: input.theme,
						scale: input.scale,
						maxHeight: MAX_EXPORT_HEIGHT,
					}),
				);
			}
			return exportHtml(input);
		},
	);
};
