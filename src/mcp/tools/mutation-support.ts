import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
	createDesignFileService,
	type DesignFileRead,
	type DesignFileService,
	DesignFileServiceError,
	skipDesignUpdate,
} from "../../services/design-file-service";
import { DesignTransformError } from "../../services/design-transform-service";
import { enrichElementLookupError } from "../../services/element-lookup-hints";
import type { TrickroomDesign } from "../../types";
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
import type { OperationPlanDependencies } from "../operation-plan";
import {
	diffDesignRevision,
	getTouchedBoardIds,
} from "../payloads/design-revisions";
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
// scoped warning and the token diagnostics. With `affectedElementIds`, only
// the boards holding them are diagnosed. To inspect the full design, call
// design_validate.
export const getMutationDiagnostics = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
	detail?: MutationResponseDetail,
	affectedElementIds?: Iterable<string>,
) => {
	const affected =
		affectedElementIds === undefined ? undefined : [...affectedElementIds];
	const diagnostics = await getDesignDiagnostics(
		context,
		design,
		affected === undefined
			? {}
			: { boardIds: getTouchedBoardIds(design, design, affected) },
	);
	return shapeMutationDiagnostics(diagnostics, detail, affected);
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

/**
 * A step that failed on a read newer than the caller's revision may have
 * failed only because the caller's view is stale (for example an element
 * another writer removed): report a revision mismatch naming the boards that
 * changed, so the caller re-reads them. Returns null when no board changed
 * (a change to just the name or settings cannot explain a failed step).
 */
export const createStaleViewMismatchResult = (
	context: TrickroomMcpServerContext,
	designFileId: string,
	read: DesignFileRead,
	expectedRevision: string,
): CallToolResult | null => {
	if (read.revision === expectedRevision) {
		return null;
	}
	const changes = diffDesignRevision(expectedRevision, read);
	if (
		changes !== null &&
		changes.changedBoardIds.length === 0 &&
		changes.removedBoardCount === 0
	) {
		return null;
	}
	return createRevisionMismatchResult(context, {
		designFileId,
		currentRevision: read.revision,
		expectedRevision,
		staleBoardIds: changes?.changedBoardIds,
		design: read.design,
	});
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
// mutation run through the design file service's updateDesignFile. Reads the
// design, rejects a stale expectedRevision, applies `mutate`, writes the
// canonicalized design guarded by expectedRevision, and reports a lost write
// race as REVISION_MISMATCH with the revision now on disk. `load` runs after
// the read and before `mutate`, for mutations that also read another design
// file.
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
	let loaded = undefined as Loaded;
	let lastRead: DesignFileRead | null = null;
	const outcome = await createDesignFileService(
		context.projectRoot,
	).updateDesignFile(designFileId, {
		expectedRevision,
		read: () => readDesignFileForTool(context, designFileId),
		mutate: async (read) => {
			lastRead = read;
			loaded = steps.load
				? await steps.load(read, (otherDesignFileId) =>
						readDesignFileForTool(context, otherDesignFileId),
					)
				: (undefined as Loaded);
			let result: Result | SkippedDesignWrite;
			try {
				result = await steps.mutate(read, loaded);
			} catch (error) {
				// The operation may fail only because the caller's view is out of
				// date (for example an element another writer removed): ask it to
				// re-read instead of reporting the failure.
				const mismatch =
					error instanceof DesignTransformError
						? createStaleViewMismatchResult(
								context,
								designFileId,
								read,
								expectedRevision,
							)
						: null;
				if (mismatch) {
					return skipDesignUpdate(mismatch);
				}
				throw error;
			}
			return skippedDesignWrite in result
				? skipDesignUpdate(result[skippedDesignWrite])
				: result;
		},
		prepare: (design) =>
			canonicalizeDesignSystemReferenceForStorage(context, design),
	});

	if (outcome.status === "revision-mismatch") {
		return createRevisionMismatchResult(context, {
			designFileId,
			currentRevision: outcome.currentRevision,
			expectedRevision: outcome.expectedRevision,
			staleBoardIds: outcome.staleBoardIds,
			manifest: outcome.manifest,
			order: outcome.order,
			design: (lastRead as DesignFileRead | null)?.design,
		});
	}
	if (outcome.status === "skipped") {
		return outcome.value;
	}
	return steps.respond(outcome.result, outcome.write, loaded);
};

/**
 * Create a new design file: canonicalize its system reference and write it
 * with exclusive-create semantics. The one place that creates design files.
 */
export const createDesignFileForTool = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	design: TrickroomDesign,
) => {
	return createDesignFileService(context.projectRoot).createDesignFile(
		designFileId,
		await canonicalizeDesignSystemReferenceForStorage(context, design),
	);
};
