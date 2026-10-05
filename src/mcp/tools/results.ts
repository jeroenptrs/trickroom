import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import type { DesignTransformError } from "../../services/design-transform-service";
import type { TrickroomDesign } from "../../types";
import { systemComponentDraftInputDiagnosticsFromZodError } from "../../utils/system-component-draft-schemas";
import { getMcpPolicy, type McpPolicyError } from "../governance";
import { getGovernanceSummary, getProjectReference } from "../payloads/project";
import type { TrickroomMcpProjectResolverError } from "../project-resolver";
import type { TrickroomMcpServerContext } from "../server-types";
import { TOOL } from "../tool-names";

// One minified JSON text block. No tool declares an outputSchema, so the
// payload is not repeated in structuredContent.
export const createJsonResult = (
	payload: Record<string, unknown>,
): CallToolResult => ({
	content: [{ type: "text", text: JSON.stringify(payload) }],
});

/** The JSON payload of a createJsonResult result, or {} for other results. */
export const readJsonResultPayload = (
	result: CallToolResult,
): Record<string, unknown> => {
	const block = result.content.find((entry) => entry.type === "text");
	if (block?.type !== "text") {
		return {};
	}
	try {
		const payload = JSON.parse(block.text) as unknown;
		return typeof payload === "object" &&
			payload !== null &&
			!Array.isArray(payload)
			? (payload as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
};

const createErrorResult = (
	payload: Record<string, unknown>,
): CallToolResult => ({
	...createJsonResult(payload),
	isError: true,
});

export const createPolicyDeniedResult = (
	context: TrickroomMcpServerContext,
	error: McpPolicyError,
): CallToolResult => {
	const policy = getMcpPolicy(context.config);
	const payload = {
		status: "POLICY_DENIED",
		code: error.code,
		message: error.message,
		project: getProjectReference(context),
		governance: getGovernanceSummary(policy),
	};
	return createErrorResult(payload);
};

export const createToolErrorResult = (
	context: TrickroomMcpServerContext,
	code: string,
	message: string,
	details: Record<string, unknown> = {},
): CallToolResult => {
	const payload = {
		status: "INVALID_OPERATION",
		code,
		message,
		project: getProjectReference(context),
		...details,
	};
	return createErrorResult(payload);
};

export const createSystemComponentDraftInputErrorResult = (
	context: TrickroomMcpServerContext,
	error: z.ZodError,
): CallToolResult =>
	createToolErrorResult(
		context,
		"VALIDATION_FAILED",
		"System component draft input validation failed.",
		{
			diagnostics: systemComponentDraftInputDiagnosticsFromZodError(error),
		},
	);

export const createProjectResolverErrorResult = (
	error: TrickroomMcpProjectResolverError,
): CallToolResult => {
	const payload = {
		status: error.code,
		...error.details,
	};
	return createErrorResult(payload);
};

export type RevisionMismatch = {
	designFileId: string;
	currentRevision: string;
	expectedRevision: string;
	/** Boards that changed since the caller's revision and matter to its call. */
	staleBoardIds?: readonly string[];
	/** The design's name or settings changed (and the call changes them). */
	manifest?: boolean;
	/** The board order changed (and the call reorders boards). */
	order?: boolean;
	/** The current design, to name the stale boards. */
	design?: TrickroomDesign;
};

const describeMismatchParts = (
	staleBoards: { id: string; name: string | null }[],
	{ manifest, order }: Pick<RevisionMismatch, "manifest" | "order">,
) =>
	[
		...staleBoards.map((board) =>
			board.name ? `board "${board.name}" (${board.id})` : `board ${board.id}`,
		),
		...(manifest ? ["the design's name or settings"] : []),
		...(order ? ["the board order"] : []),
	].join(", ");

/**
 * The fields that explain a revision mismatch: the boards that changed since
 * the caller's revision, a message and the reads to recover (`next`). Only
 * those boards need a re-read; boards the caller did not touch never block.
 */
export const describeRevisionMismatch = (mismatch: RevisionMismatch) => {
	const { designFileId, design } = mismatch;
	const staleBoards = (mismatch.staleBoardIds ?? []).map((id) => {
		const board = design?.boards.find((entry) => entry.id === id);
		const name = board?.props["data-trickroom-name"];
		return {
			id,
			name: typeof name === "string" ? name : null,
			...(design && !board ? { deleted: true } : {}),
		};
	});
	const readable = staleBoards.filter((board) => !("deleted" in board));
	const parts = describeMismatchParts(staleBoards, mismatch);
	const boardsOnly =
		readable.length > 0 && !mismatch.manifest && !mismatch.order;
	return {
		currentRevision: mismatch.currentRevision,
		expectedRevision: mismatch.expectedRevision,
		...(staleBoards.length > 0 ? { staleBoards } : {}),
		...(mismatch.manifest ? { manifest: true } : {}),
		...(mismatch.order ? { order: true } : {}),
		message:
			parts.length > 0
				? `Since your revision another writer changed ${parts}. Re-read ${boardsOnly ? (readable.length === 1 ? "only that board" : "only those boards") : "the design"} (next), redo your steps there, and retry with currentRevision. Boards you did not change need no re-read.`
				: "The design changed since your revision. Re-read the area you are editing, then retry with currentRevision.",
		next: boardsOnly
			? readable.map((board) => ({
					tool: TOOL.designRead,
					args: { designFileId, boardId: board.id },
				}))
			: [{ tool: TOOL.designRead, args: { designFileId } }],
	};
};

/** A write based on a revision that is stale for what it changes. */
export const createRevisionMismatchResult = (
	context: TrickroomMcpServerContext,
	mismatch: RevisionMismatch,
): CallToolResult =>
	createErrorResult({
		status: "REVISION_MISMATCH",
		project: getProjectReference(context),
		designFileId: mismatch.designFileId,
		...describeRevisionMismatch(mismatch),
	});

export const createInvalidOperationResult = (
	context: TrickroomMcpServerContext,
	error: DesignTransformError,
): CallToolResult => {
	const payload = {
		status: "INVALID_OPERATION",
		project: getProjectReference(context),
		code: error.code,
		message: error.message,
		...error.details,
	};
	return createErrorResult(payload);
};
