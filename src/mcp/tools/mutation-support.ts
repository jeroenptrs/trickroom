import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	createDesignFileService,
	type DesignFileRead,
	type DesignFileService,
	DesignFileServiceError,
} from "../../services/design-file-service";
import { DesignTransformError } from "../../services/design-transform-service";
import { enrichElementLookupError } from "../../services/element-lookup-hints";
import type { TrickroomDesign } from "../../types";
import {
	type DesignOperationName,
	validateDryRunOperationParameters,
} from "../design-operations";
import {
	getDesignDiagnostics,
	type MutationResponseDetail,
	shapeMutationDiagnostics,
} from "../diagnostics";
import {
	appendMcpAuditLog,
	getMcpPolicy,
	type McpAuditEntry,
	McpPolicyError,
} from "../governance";
import {
	type DesignOperationExecution,
	executeDesignOperation,
	type OperationPlanDependencies,
} from "../operation-plan";
import { canonicalizeDesignSystemReferenceForStorage } from "../payloads/design-system";
import { readDesignFileForTool } from "../payloads/design-tree";
import {
	assertCanUseSubtreeComponents,
	assertResourceElementReferenceExists,
} from "../payloads/references";
import type { TrickroomMcpServerContext } from "../server-types";
import {
	createInvalidOperationResult,
	createPolicyDeniedResult,
	createRevisionMismatchResult,
	createToolErrorResult,
	readJsonResultPayload,
} from "./results";

// Shape post-write diagnostics for a mutation response: every error issue, a
// warningCount, and grouped likely-typo warnings scoped to
// `affectedElementIds` (the elements this write touched). "full" returns every
// scoped warning and the token diagnostics. To inspect the full design, call
// validateDesignFile.
export const getMutationDiagnostics = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
	detail?: MutationResponseDetail,
	affectedElementIds?: Iterable<string>,
) => {
	const diagnostics = await getDesignDiagnostics(context, design);
	return shapeMutationDiagnostics(diagnostics, detail, affectedElementIds);
};

/** Policy, project root and checks for executing design operations. */
export const createDesignOperationDependencies = (
	context: TrickroomMcpServerContext,
): OperationPlanDependencies => {
	const policy = getMcpPolicy(context.config);
	return {
		policy,
		projectRoot: context.projectRoot,
		readDesignFile: (designFileId) =>
			readDesignFileForTool(context, designFileId),
		assertResourceReferencesExist: async (design, elementIds) => {
			for (const elementId of elementIds) {
				await assertResourceElementReferenceExists(context, design, elementId);
			}
		},
		assertCanUseSubtreeComponents: (subtree) =>
			assertCanUseSubtreeComponents(policy, subtree),
	};
};

export const auditToolResult = async (
	context: TrickroomMcpServerContext,
	base: Omit<McpAuditEntry, "success" | "status" | "projectRoot">,
	result: CallToolResult,
) => {
	const payload = readJsonResultPayload(result);
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

const skippedDesignWrite = Symbol("skippedDesignWrite");

type SkippedDesignWrite = { [skippedDesignWrite]: CallToolResult };

// Ends a mutateDesignFile call without writing and responds with `result`.
export const skipDesignWrite = (
	result: CallToolResult,
): SkippedDesignWrite => ({
	[skippedDesignWrite]: result,
});

type DesignFileWriteResult = Awaited<
	ReturnType<DesignFileService["writeDesignFile"]>
>;

// The read, revision check, write, and race re-read shared by every design
// mutation; the one place that reads and writes existing design files. Reads the design, rejects a stale expectedRevision,
// applies `mutate`, writes the canonicalized design guarded by
// expectedRevision, and reports a lost write race as REVISION_MISMATCH with
// the revision now on disk. `load` runs after the read and before the
// revision check, for mutations that also read another design file.
export const mutateDesignFile = async <
	Result extends { design: TrickroomDesign },
	Loaded = undefined,
>(
	context: TrickroomMcpServerContext,
	{
		designFileId,
		expectedRevision,
	}: { designFileId: string; expectedRevision: string },
	steps: {
		load?: (
			read: DesignFileRead,
			readDesignFile: (designFileId: string) => Promise<DesignFileRead>,
		) => Promise<Loaded>;
		mutate: (
			read: DesignFileRead,
			loaded: Loaded,
		) => Promise<Result | SkippedDesignWrite>;
		respond: (
			result: Result,
			write: DesignFileWriteResult,
			loaded: Loaded,
		) => Promise<CallToolResult>;
	},
): Promise<CallToolResult> => {
	const service = createDesignFileService(context.projectRoot);
	const file = service.getFileForUuid(designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	const loaded = steps.load
		? await steps.load(read, (otherDesignFileId) =>
				readDesignFileForTool(context, otherDesignFileId),
			)
		: (undefined as Loaded);

	if (read.revision !== expectedRevision) {
		return createRevisionMismatchResult(
			context,
			read.revision,
			expectedRevision,
		);
	}

	const result = await steps.mutate(read, loaded);
	if (skippedDesignWrite in result) {
		return result[skippedDesignWrite];
	}

	let write: DesignFileWriteResult;
	try {
		const nextDesign = await canonicalizeDesignSystemReferenceForStorage(
			context,
			result.design,
		);
		write = await service.writeDesignFile(file, nextDesign, {
			expectedRevision,
		});
	} catch (error) {
		if (
			error instanceof DesignFileServiceError &&
			error.code === "REVISION_MISMATCH"
		) {
			const raceRead = await service.readJsonFile(file);
			return createRevisionMismatchResult(
				context,
				raceRead.revision,
				expectedRevision,
			);
		}
		throw error;
	}

	return steps.respond(result, write, loaded);
};

/**
 * Validate parameters and execute one design operation inside
 * mutateDesignFile: the single-element write tools are thin wrappers over the
 * same implementation as the matching applyDesignOperations step.
 */
export const mutateDesignWithOperation = (
	context: TrickroomMcpServerContext,
	target: { designFileId: string; expectedRevision: string },
	operation: DesignOperationName,
	parameters: Record<string, unknown>,
	respond: (
		execution: DesignOperationExecution,
		write: DesignFileWriteResult,
		before: TrickroomDesign,
	) => Promise<CallToolResult>,
): Promise<CallToolResult> =>
	mutateDesignFile(context, target, {
		mutate: async (read) => {
			const params = validateDryRunOperationParameters(operation, parameters, {
				designFileId: target.designFileId,
			});
			const execution = await executeDesignOperation(
				createDesignOperationDependencies(context),
				read.design,
				operation,
				params,
				{ designFileId: target.designFileId },
			);
			return { design: execution.design, execution, before: read.design };
		},
		respond: (result, write) => respond(result.execution, write, result.before),
	});

/**
 * Create a new design file: canonicalize its system reference and write it
 * with exclusive-create semantics. The one place that creates design files.
 */
export const createDesignFileForTool = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	design: TrickroomDesign,
) => {
	const service = createDesignFileService(context.projectRoot);
	return service.createDesignFile(
		service.getFileForUuid(designFileId),
		await canonicalizeDesignSystemReferenceForStorage(context, design),
	);
};
