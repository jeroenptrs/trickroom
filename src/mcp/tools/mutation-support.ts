import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DesignFileServiceError } from "../../services/design-file-service";
import { DesignTransformError } from "../../services/design-transform-service";
import { enrichElementLookupError } from "../../services/element-lookup-hints";
import type { TrickroomDesign } from "../../types";
import {
	getDesignDiagnostics,
	type MutationResponseOptions,
	shapeMutationDiagnostics,
} from "../diagnostics";
import {
	appendMcpAuditLog,
	type McpAuditEntry,
	McpPolicyError,
} from "../governance";
import { readDesignFileForTool } from "../payloads/design-tree";
import type { TrickroomMcpServerContext } from "../server-types";
import {
	createInvalidOperationResult,
	createPolicyDeniedResult,
	createToolErrorResult,
} from "./results";

// Shape post-write diagnostics for a mutation response. Minimal by default:
// error-severity issues plus a stripped token snapshot. Warnings and the
// heavy token catalog are opt-in via `options`; pass `affectedElementIds` to
// scope opt-in warnings to the elements this write touched. To inspect the
// full design after a single-element write, call validateDesignFile.
export const getMutationDiagnostics = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
	options?: MutationResponseOptions,
	affectedElementIds?: Iterable<string>,
) => {
	const diagnostics = await getDesignDiagnostics(context, design);
	return shapeMutationDiagnostics(diagnostics, options, affectedElementIds);
};

export const auditToolResult = async (
	context: TrickroomMcpServerContext,
	base: Omit<McpAuditEntry, "success" | "status" | "projectRoot">,
	result: CallToolResult,
) => {
	const payload = (result.structuredContent ?? {}) as Record<string, unknown>;
	const status =
		typeof payload.status === "string"
			? payload.status
			: result.isError
				? "error"
				: "success";
	const code = typeof payload.code === "string" ? payload.code : undefined;
	const message =
		typeof payload.message === "string" ? payload.message : undefined;
	const resultingRevision =
		typeof payload.newRevision === "string" ? payload.newRevision : null;

	await appendMcpAuditLog(context, {
		...base,
		projectRoot: context.projectRoot,
		resultingRevision,
		success: result.isError !== true && status === "success",
		status,
		...(code ? { code } : {}),
		...(message ? { message } : {}),
	});
};

// Element lookups fail deep inside transforms that only see one design;
// re-read the target (and copy source) here to add truncated-id and
// layer-name hints without threading designs through every throw site.
const enrichElementLookupErrorForAudit = async (
	context: TrickroomMcpServerContext,
	auditBase: Omit<McpAuditEntry, "success" | "status" | "projectRoot">,
	error: DesignTransformError,
): Promise<DesignTransformError> => {
	if (error.code !== "ELEMENT_NOT_FOUND" && error.code !== "PARENT_NOT_FOUND") {
		return error;
	}
	const sourceDesignFileId = auditBase.details?.sourceDesignFileId;
	const designFileIds = [
		...new Set(
			[auditBase.designFileId, sourceDesignFileId].filter(
				(id): id is string => typeof id === "string",
			),
		),
	];
	try {
		const designs = await Promise.all(
			designFileIds.map(
				async (designFileId) =>
					(await readDesignFileForTool(context, designFileId)).design,
			),
		);
		return enrichElementLookupError(error, designs);
	} catch {
		return error;
	}
};

export const withMutationErrorHandling = async (
	context: TrickroomMcpServerContext,
	auditBase: Omit<McpAuditEntry, "success" | "status" | "projectRoot">,
	fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> => {
	try {
		const result = await fn();
		await auditToolResult(context, auditBase, result);
		return result;
	} catch (error) {
		if (error instanceof DesignTransformError) {
			const result = createInvalidOperationResult(
				context,
				await enrichElementLookupErrorForAudit(context, auditBase, error),
			);
			await auditToolResult(context, auditBase, result);
			return result;
		}
		if (error instanceof McpPolicyError) {
			const result = createPolicyDeniedResult(context, error);
			await auditToolResult(context, auditBase, result);
			return result;
		}
		if (error instanceof DesignFileServiceError) {
			const result = createToolErrorResult(context, error.code, error.message);
			await auditToolResult(context, auditBase, result);
			return result;
		}
		throw error;
	}
};
