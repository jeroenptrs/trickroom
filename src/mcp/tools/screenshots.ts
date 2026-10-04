import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ScreenshotRequest } from "../../screenshot/types";
import { DesignFileServiceError } from "../../services/design-file-service";
import {
	describeMissingElementId,
	getDesignLookupEntities,
} from "../../services/element-lookup-hints";
import type { TrickroomDesign } from "../../types";
import {
	assertCanReadDesignFile,
	assertCanWriteProject,
	getMcpPolicy,
	type McpAuditEntry,
	McpPolicyError,
} from "../governance";
import {
	findElementContext,
	getDesignMetadata,
	getNodeName,
	readDesignFileForTool,
} from "../payloads/design-tree";
import { getProjectReference } from "../payloads/project";
import type { TrickroomMcpServerContext } from "../server-types";
import { screenshotAnnotations } from "./annotations";
import type { McpToolContext } from "./context";
import { auditToolResult } from "./mutation-support";
import { createPolicyDeniedResult, createToolErrorResult } from "./results";
import { designFileIdSchema, withProjectScopedInput } from "./schemas";

export const registerScreenshotTools = (ctx: McpToolContext) => {
	const { server, screenshotCapture, withProjectContext } = ctx;

	const screenshotViewportSchema = z
		.union([
			z.enum(["mobile", "tablet", "desktop"]),
			z.object({
				width: z.number().int().min(1).max(3840),
				height: z.number().int().min(1).max(2160),
			}),
		])
		.optional()
		.describe(
			"Viewport preset or explicit CSS-pixel dimensions. Defaults to desktop (1440x900).",
		);
	const screenshotCommonInput = {
		designFileId: designFileIdSchema,
		viewport: screenshotViewportSchema,
		theme: z.enum(["light", "dark"]).optional().describe("Defaults to light."),
		outputPath: z
			.string()
			.min(1)
			.optional()
			.describe(
				"Optional .png path. Relative paths resolve inside the project; absolute paths are explicit.",
			),
		executablePath: z
			.string()
			.min(1)
			.optional()
			.describe(
				"Optional explicit Chrome/Chromium executable. TRICKROOM_CHROME_PATH is used otherwise.",
			),
	} as const;

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

	const runScreenshotTool = async (
		context: TrickroomMcpServerContext,
		toolName: "screenshotBoard" | "screenshotNode",
		request: ScreenshotRequest,
	): Promise<CallToolResult> => {
		const auditBase = {
			toolName,
			operation: toolName,
			designFileId: request.designFileId,
			details: {
				boardId: request.boardId ?? null,
				nodeId: request.nodeId ?? null,
				viewport: request.viewport ?? "desktop",
				theme: request.theme ?? "light",
				outputPath: request.outputPath ?? null,
			},
		} satisfies Omit<McpAuditEntry, "success" | "status" | "projectRoot">;
		let result: CallToolResult;
		try {
			const policy = getMcpPolicy(context.config);
			assertCanReadDesignFile(policy, request.designFileId);
			if (request.outputPath) assertCanWriteProject(policy);
			const read = await readDesignFileForTool(context, request.designFileId);
			if (request.boardId) {
				const board = read.design.boards.find(
					(candidate) => candidate.id === request.boardId,
				);
				if (!board) {
					result = createBoardNotFoundResult(
						context,
						read.design,
						request.boardId,
						request.designFileId,
					);
					await auditToolResult(context, auditBase, result);
					return result;
				}
			}
			if (request.nodeId) {
				const element = findElementContext(read.design, request.nodeId);
				const containingBoard = read.design.boards.find((board) =>
					findElementContext(
						{ ...read.design, boards: [board] },
						request.nodeId ?? "",
					),
				);
				if (!element || !containingBoard) {
					const missing = describeMissingElementId(
						getDesignLookupEntities([read.design]),
						request.nodeId,
						read.design.boards.map((item) => item.id),
					);
					result = createToolErrorResult(
						context,
						"NODE_NOT_FOUND",
						`Node "${request.nodeId}" was not found in design "${request.designFileId}". ${missing.hint}`,
						missing.details,
					);
					await auditToolResult(context, auditBase, result);
					return result;
				}
				request.boardId = containingBoard.id;
			}

			const captured = await screenshotCapture(context, request);
			const { base64, ...metadata } = captured;
			const payload = {
				status: "success",
				project: getProjectReference(context),
				designFile: getDesignMetadata(request.designFileId, read),
				...metadata,
			};
			result = {
				content: [
					{ type: "text", text: JSON.stringify(payload) },
					{ type: "image", mimeType: "image/png", data: base64 },
				],
				structuredContent: payload,
			};
		} catch (error) {
			if (error instanceof McpPolicyError) {
				result = createPolicyDeniedResult(context, error);
			} else if (error instanceof DesignFileServiceError) {
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

	server.registerTool(
		"screenshotBoard",
		{
			title: "Screenshot Board",
			description:
				"Render one board through Trickroom's capture route and return a PNG image. Boards are responsive: capture the same board at viewport mobile, tablet, and desktop to review breakpoints instead of creating a board per breakpoint. Requires the optional playwright-core peer and a locatable Chrome/Chromium. Supplying outputPath also writes the PNG to disk.",
			inputSchema: withProjectScopedInput({
				...screenshotCommonInput,
				boardId: z.string().min(1).describe("Root board element ID."),
			}),
			annotations: screenshotAnnotations,
		},
		async ({ project, boardId, ...input }) =>
			withProjectContext(project, (context) =>
				runScreenshotTool(context, "screenshotBoard", {
					...input,
					boardId,
				}),
			),
	);

	server.registerTool(
		"screenshotNode",
		{
			title: "Screenshot Node",
			description:
				"Render and crop one design node through Trickroom's capture route, inferring its containing board, and return a PNG image. Requires the optional playwright-core peer and a locatable Chrome/Chromium. Supplying outputPath also writes the PNG to disk.",
			inputSchema: withProjectScopedInput({
				...screenshotCommonInput,
				nodeId: z.string().min(1).describe("Persistent design node ID."),
			}),
			annotations: screenshotAnnotations,
		},
		async ({ project, nodeId, ...input }) =>
			withProjectContext(project, (context) =>
				runScreenshotTool(context, "screenshotNode", {
					...input,
					nodeId,
				}),
			),
	);
};
