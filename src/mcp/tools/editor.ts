import { z } from "zod";
import type { EditorChannelStatus } from "../../services/editor-channel";
import type { EditorClientContext } from "../../services/editor-channel.types";
import { assertCanReadDesignFile, getMcpPolicy } from "../governance";
import {
	describeNode,
	findElementContext,
	getDesignHeader,
	getElementReadContext,
	getNodeName,
	getRecipeAttachmentSummaries,
	readDesignFileForTool,
} from "../payloads/design-tree";
import { getProjectReference } from "../payloads/project";
import type { TrickroomMcpServerContext } from "../server-types";
import { TOOL } from "../tool-names";
import {
	readOnlyClosedWorldAnnotations,
	SEARCH_HINT_META_KEY,
} from "./annotations";
import type { McpToolContext } from "./context";
import { createJsonResult, createToolErrorResult } from "./results";
import { designFileIdSchema, withProjectScopedInput } from "./schemas";

/**
 * What the human needs to do when the editor cannot answer. A normal result,
 * not an error: no open browser is an everyday state.
 */
const STATUS_HINTS: Record<Exclude<EditorChannelStatus, "ok">, string> = {
	no_server:
		"Trickroom is not running for this project: ask the human to start it (trickroom serve) and open the project in a browser.",
	no_browser:
		"No browser tab has this project open: ask the human to open it in Trickroom.",
	browser_on_other_project:
		"The browser shows another project: ask the human to switch to this one.",
	stale: "The Trickroom server did not answer in time: try again in a moment.",
	blocked_dirty:
		"The open design has unsaved changes, so the view was not moved: ask the human to save, then try again.",
};

const unavailable = (
	context: TrickroomMcpServerContext,
	status: Exclude<EditorChannelStatus, "ok">,
	extra: Record<string, unknown> = {},
) =>
	createJsonResult({
		status,
		project: getProjectReference(context),
		message: STATUS_HINTS[status],
		...extra,
	});

const elementIdSchema = z.string().min(1);

/**
 * The tab's design, board and selected layer, resolved against the design
 * on disk: the selection becomes a compact node with its placement, so
 * "this layer" is actionable without another read.
 */
const describeEditorView = async (
	context: TrickroomMcpServerContext,
	tab: EditorClientContext,
) => {
	const view = {
		stageMode: tab.stageMode,
		...(tab.stageMode === "responsive" && tab.responsiveWidth !== null
			? { responsiveWidth: tab.responsiveWidth }
			: {}),
		visible: tab.visible,
		ageMs: tab.ageMs,
	};
	if (tab.designFileId === null) {
		return { design: null, ...view };
	}
	const policy = getMcpPolicy(context.config);
	if (
		policy.allowedDesignFileIds !== null &&
		!policy.allowedDesignFileIds.has(tab.designFileId)
	) {
		return {
			design: { id: tab.designFileId, readable: false },
			...view,
		};
	}
	try {
		const read = await readDesignFileForTool(context, tab.designFileId);
		const board = tab.activeBoardId
			? read.design.boards.find((entry) => entry.id === tab.activeBoardId)
			: undefined;
		const selected = tab.selectedId
			? findElementContext(read.design, tab.selectedId)
			: null;
		return {
			design: getDesignHeader(tab.designFileId, read),
			board: board
				? { id: board.id, name: getNodeName(board) ?? null }
				: tab.activeBoardId
					? { id: tab.activeBoardId, missing: true }
					: null,
			selected: selected
				? {
						...describeNode(
							selected.element,
							"compact",
							getRecipeAttachmentSummaries(read.design),
						),
						...getElementReadContext(selected),
					}
				: tab.selectedId
					? { id: tab.selectedId, missing: true }
					: null,
			...view,
		};
	} catch {
		// Unsaved or deleted designs: report what the tab says.
		return {
			design: { id: tab.designFileId, missing: true },
			board: tab.activeBoardId ? { id: tab.activeBoardId } : null,
			selected: tab.selectedId ? { id: tab.selectedId } : null,
			...view,
		};
	}
};

export const registerEditorTools = (ctx: McpToolContext) => {
	const { server, trickroomHome, editorChannel, withPolicyErrorHandling } = ctx;
	const channelOptions = trickroomHome ? { home: trickroomHome } : {};

	server.registerTool(
		TOOL.editorContext,
		{
			title: "Editor Context",
			description: `What the human has open in Trickroom right now: the design (id, name, revision), the board, the selected layer as a compact node with its placement (parentId, boardId, index), the stage mode (canvas or responsive, with the responsive width) and how old the report is. Call it when the human says "this", "here" or "the selected layer". When no browser shows this project the result says so in status (no_server, no_browser, browser_on_other_project, stale) with what to ask the human; that is not an error.`,
			inputSchema: withProjectScopedInput({}),
			annotations: readOnlyClosedWorldAnnotations,
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"selection selected layer current open design browser human user this here",
			},
		},
		async ({ project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const projectId = context.config.projectId;
				if (!projectId) {
					return unavailable(context, "no_server");
				}
				const result = await editorChannel.getEditorContext(
					projectId,
					channelOptions,
				);
				if (result.status !== "ok") {
					return unavailable(
						context,
						result.status,
						result.status === "browser_on_other_project"
							? { otherProjects: result.otherProjects }
							: {},
					);
				}
				return createJsonResult({
					status: "ok",
					project: getProjectReference(context),
					...(await describeEditorView(context, result.focused)),
					...(result.clients.length > 1
						? { otherTabs: result.clients.length - 1 }
						: {}),
				});
			}),
	);

	server.registerTool(
		TOOL.editorFocus,
		{
			title: "Focus Editor",
			description: `Point the human's Trickroom editor at a design, a board in it, or a layer (selected and scrolled into view; its board is inferred). Use it after a write the human should look at, or to show what you are talking about. It moves only the human's view and never edits the design; outcome says whether the tab revealed it, navigated to it, or queued it until the hidden tab is shown, and a tab with unsaved changes refuses (blocked_dirty). Like ${TOOL.editorContext}, statuses other than ok say what to ask the human.`,
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				boardId: elementIdSchema.optional().describe("Board to show."),
				elementId: elementIdSchema
					.optional()
					.describe("Layer to select and reveal."),
			}),
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"show reveal navigate select highlight point human browser view",
			},
		},
		async ({ designFileId, boardId, elementId, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
				// Check the target first, so a typo fails here and not in the
				// human's browser.
				const read = await readDesignFileForTool(context, designFileId);
				let targetBoardId = boardId ?? null;
				if (elementId !== undefined) {
					const element = findElementContext(read.design, elementId);
					if (!element) {
						return createToolErrorResult(
							context,
							"ELEMENT_NOT_FOUND",
							`Element "${elementId}" was not found in design "${read.design.name}".`,
						);
					}
					targetBoardId = element.board.id;
				} else if (
					boardId !== undefined &&
					!read.design.boards.some((board) => board.id === boardId)
				) {
					return createToolErrorResult(
						context,
						"BOARD_NOT_FOUND",
						`Board "${boardId}" was not found in design "${read.design.name}".`,
						{
							availableBoards: read.design.boards.map((board) => ({
								id: board.id,
								name: getNodeName(board) ?? null,
							})),
						},
					);
				}
				const projectId = context.config.projectId;
				if (!projectId) {
					return unavailable(context, "no_server");
				}
				const result = await editorChannel.requestEditorFocus(
					{
						projectId,
						designFileId,
						boardId: targetBoardId,
						elementId: elementId ?? null,
					},
					channelOptions,
				);
				if (result.status !== "ok") {
					return unavailable(context, result.status);
				}
				return createJsonResult({
					status: "ok",
					project: getProjectReference(context),
					outcome: result.outcome,
					designFileId,
					...(targetBoardId ? { boardId: targetBoardId } : {}),
					...(elementId ? { elementId } : {}),
				});
			}),
	);
};
