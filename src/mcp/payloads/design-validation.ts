import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { readTrickroomDesignValue } from "../../server-utils";
import {
	createDesignFileService,
	type DesignFileRead,
} from "../../services/design-file-service";
import type { DesignTransformError } from "../../services/design-transform-service";
import type { TrickroomDesign } from "../../types";
import { findDesignSystem } from "../../utils/design-system-store";
import type { DesignOperationName } from "../design-operations";
import {
	countIssuesByCode,
	getDesignDiagnostics,
	groupWarnings,
	type McpDesignIssue,
	type MutationResponseDetail,
	shapeMutationDiagnostics,
} from "../diagnostics";
import { assertCanReadDesignFile, getMcpPolicy } from "../governance";
import {
	describeCreatedElements,
	describeFailedPlanStep,
	executeOperationPlan,
	type OperationPlanExecution,
	type OperationPlanInput,
	type OperationPlanStepOutput,
} from "../operation-plan";
import type { TrickroomMcpServerContext } from "../server-types";
import {
	createDesignOperationDependencies,
	mutateDesignFile,
	skipDesignWrite,
} from "../tools/mutation-support";
import { createJsonResult } from "../tools/results";
import { summarizeDesignSystemReference } from "./design-system";
import { getDesignSystemHandle, readDesignFileForTool } from "./design-tree";
import { getProjectReference } from "./project";
import { type ValidationIssue, validateElementReferences } from "./references";

/**
 * Element ids listed per grouped warning in validation results; larger groups
 * report their total in `count`.
 */
const MAX_VALIDATION_GROUP_ELEMENT_IDS = 5;

type ValidationStatus =
	| "success"
	| "INVALID_OPERATION"
	| "REVISION_MISMATCH"
	| "SOURCE_REVISION_MISMATCH";

/**
 * The result shape every validation tool shares: a per-code summary first,
 * then error issues in full, then warnings grouped by code and offending
 * class (ungrouped with response "full"), then tool-specific fields.
 */
export const createValidationResult = (
	context: TrickroomMcpServerContext,
	{
		status = "success",
		designFileId,
		revision,
		issues,
		detail,
		extra = {},
	}: {
		status?: ValidationStatus;
		designFileId: string;
		revision?: string;
		issues: readonly McpDesignIssue[];
		detail?: MutationResponseDetail;
		extra?: Record<string, unknown>;
	},
) => {
	const errors = issues.filter((issue) => issue.severity === "error");
	const warnings = issues.filter((issue) => issue.severity === "warning");
	return {
		status,
		valid: status === "success" && errors.length === 0,
		project: getProjectReference(context),
		designFileId,
		...(revision !== undefined ? { revision } : {}),
		summary: {
			errors: errors.length,
			warnings: warnings.length,
			codes: countIssuesByCode(issues),
		},
		issues: errors,
		...(warnings.length > 0
			? {
					warnings:
						detail === "full"
							? warnings
							: groupWarnings(warnings, {
									maxElementIds: MAX_VALIDATION_GROUP_ELEMENT_IDS,
								}),
				}
			: {}),
		...extra,
	};
};

const toIssue = (error: DesignTransformError): McpDesignIssue => ({
	severity: "error",
	code: error.code,
	message: error.message,
	...error.details,
});

const createInvalidValidationResult = (
	context: TrickroomMcpServerContext,
	designFileId: string,
	error: DesignTransformError,
	extra: Record<string, unknown> = {},
) =>
	createValidationResult(context, {
		status:
			error.code === "SOURCE_REVISION_MISMATCH"
				? "SOURCE_REVISION_MISMATCH"
				: "INVALID_OPERATION",
		designFileId,
		issues: [toIssue(error)],
		extra,
	});

const createRevisionMismatchValidationResult = (
	context: TrickroomMcpServerContext,
	designFileId: string,
	read: DesignFileRead,
	expectedRevision: string,
) =>
	createValidationResult(context, {
		status: "REVISION_MISMATCH",
		designFileId,
		issues: [
			{
				severity: "error",
				code: "REVISION_MISMATCH",
				message:
					"The design changed since your last read. Re-read it and validate against its current revision.",
			},
		],
		extra: { currentRevision: read.revision, expectedRevision },
	});

/** Diagnostics on `design`, warnings scoped to the touched elements. */
const getScopedDesignIssues = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
	affectedElementIds: Iterable<string>,
) => {
	const affected = new Set(affectedElementIds);
	const diagnostics = await getDesignDiagnostics(context, design);
	return {
		tokenSnapshot: diagnostics.tokenSnapshot,
		issues: diagnostics.issues.filter(
			(issue) =>
				issue.severity === "error" ||
				issue.elementId === undefined ||
				affected.has(issue.elementId),
		),
	};
};

const readRawDesignFile = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	const service = createDesignFileService(context.projectRoot);
	try {
		return await service.readJsonFile(service.getFileForUuid(designFileId));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			// Throws the shared DESIGN_NOT_FOUND error for missing designs.
			await readDesignFileForTool(context, designFileId);
		}
		throw error;
	}
};

export const validateDesignFilePayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	options: { detail?: MutationResponseDetail } = {},
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readRawDesignFile(context, designFileId);
	const migration = readTrickroomDesignValue(read.value);

	if (!migration.ok) {
		return createValidationResult(context, {
			designFileId,
			revision: read.revision,
			issues: [
				{
					severity: "error",
					code: migration.code,
					message: migration.message,
				},
			],
		});
	}

	const design = migration.design;
	const diagnostics = await getDesignDiagnostics(context, design);
	const issues: ValidationIssue[] = [
		...diagnostics.issues,
		...(read.warnings ?? []).map((warning) => ({
			severity: "warning" as const,
			code: warning.code,
			message: warning.message,
		})),
	];
	const systemHandle = getDesignSystemHandle(design);
	if (
		systemHandle !== null &&
		!(await findDesignSystem(context.projectRoot, systemHandle))
	) {
		issues.push({
			severity: "error",
			code: "UNKNOWN_DESIGN_SYSTEM",
			message: `Design references unconfigured design system "${systemHandle}".`,
			path: design.systemId !== undefined ? "systemId" : "systemName",
		});
	}

	const seenElementIds = new Map<string, string>();
	const componentUsage = new Map<string, number>();
	for (const [rootIndex, board] of design.boards.entries()) {
		validateElementReferences(
			board,
			`boards[${rootIndex}]`,
			seenElementIds,
			issues,
			componentUsage,
		);
	}

	const full = options.detail === "full";
	return createValidationResult(context, {
		designFileId,
		revision: read.revision,
		issues,
		detail: options.detail,
		extra: {
			elementCount: seenElementIds.size,
			...(full
				? {
						rootElementIds: design.boards.map((board) => board.id),
						designSystem: await summarizeDesignSystemReference(
							context,
							systemHandle,
						),
						tokenDiagnostics: diagnostics.tokenSnapshot,
						registryReferences: [...componentUsage.entries()]
							.map(([componentRef, count]) => {
								const [library, component] = componentRef.split("/");
								return { library, component, count };
							})
							.sort(
								(a, b) =>
									a.library.localeCompare(b.library) ||
									a.component.localeCompare(b.component),
							),
					}
				: {}),
		},
	});
};

/**
 * What a dry-run step would do. Insertions report where and how many nodes,
 * without the generated ids (they are not the ids a write would create);
 * other operations report their summary and the element they change.
 */
const describePredictedStep = (step: OperationPlanStepOutput) => {
	if (!step.insertedElementIds) {
		return {
			...step.summary,
			...(step.changedElementId
				? { changedElementId: step.changedElementId }
				: {}),
			...(step.deletedIds ? { deletedCount: step.deletedIds.length } : {}),
		};
	}
	const {
		rootElementId: _rootElementId,
		recipe,
		systemComponent,
		...summary
	} = step.summary as Record<string, unknown> & {
		recipe?: { id: string };
		systemComponent?: Record<string, unknown>;
	};
	const {
		instanceId: _instanceId,
		elementIdsByPath: _elementIdsByPath,
		...component
	} = systemComponent ?? {};
	return {
		...summary,
		...(recipe ? { recipeId: recipe.id } : {}),
		...(systemComponent ? { systemComponent: component } : {}),
		nodeCount: step.insertedElementIds.length,
	};
};

/**
 * Dry-run operations against the current revision with the same executor as
 * design_apply, and report them in the shared validation shape.
 */
const validateOperations = async (
	context: TrickroomMcpServerContext,
	input: Pick<OperationPlanInput, "designFileId" | "expectedRevision"> & {
		operations: Array<{
			operation: DesignOperationName;
			parameters?: Record<string, unknown>;
		}>;
		detail?: MutationResponseDetail;
	},
	describe: (
		execution: Extract<OperationPlanExecution, { status: "success" }>,
	) => Record<string, unknown>,
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), input.designFileId);
	const read = await readDesignFileForTool(context, input.designFileId);
	if (read.revision !== input.expectedRevision) {
		return createRevisionMismatchValidationResult(
			context,
			input.designFileId,
			read,
			input.expectedRevision,
		);
	}

	const execution = await executeOperationPlan(
		createDesignOperationDependencies(context),
		input,
		read.design,
	);
	if (execution.status === "failed") {
		const {
			code: _code,
			message: _message,
			...failure
		} = describeFailedPlanStep(execution);
		return createInvalidValidationResult(
			context,
			input.designFileId,
			execution.error,
			{
				failedStepIndex: failure.failedStepIndex,
				failedOperation: failure.failedOperation,
			},
		);
	}

	const scoped = await getScopedDesignIssues(
		context,
		execution.design,
		execution.affectedElementIds,
	);
	return createValidationResult(context, {
		designFileId: input.designFileId,
		revision: read.revision,
		issues: scoped.issues,
		detail: input.detail,
		extra: {
			...describe(execution),
			...(input.detail === "full"
				? { tokenDiagnostics: scoped.tokenSnapshot }
				: {}),
		},
	});
};

export const validateOperationPlanPayload = async (
	context: TrickroomMcpServerContext,
	input: Pick<
		OperationPlanInput,
		"designFileId" | "expectedRevision" | "operations"
	> & { detail?: MutationResponseDetail },
) =>
	validateOperations(context, input, (execution) => ({
		operationCount: input.operations.length,
		...(input.detail === "full"
			? { steps: execution.steps }
			: { predicted: execution.steps.map(describePredictedStep) }),
		...(execution.deletedIds.length > 0
			? { deletedCount: execution.deletedIds.length }
			: {}),
	}));

/** An error result that keeps the payload's own status (a failed plan). */
const createErrorResult = (
	payload: Record<string, unknown>,
): CallToolResult => ({
	...createJsonResult(payload),
	isError: true,
});

/**
 * Identity of an error issue across a write: element-bound errors by element,
 * others by path. Paths of element-bound issues shift when elements move.
 */
const errorIssueKey = (issue: McpDesignIssue) =>
	`${issue.code}\0${issue.elementId ?? issue.path ?? ""}`;

/**
 * Split the errors of a plan's result into the ones the plan introduced and
 * the ones the design already had. The starting design's issues are only
 * read when the result has errors.
 */
export const splitIntroducedErrors = async (
	afterErrors: readonly McpDesignIssue[],
	readIssuesBefore: () => Promise<readonly McpDesignIssue[]>,
) => {
	if (afterErrors.length === 0) {
		return { introduced: [], preExistingCount: 0 };
	}
	const remaining = new Map<string, number>();
	for (const issue of await readIssuesBefore()) {
		if (issue.severity === "error") {
			const key = errorIssueKey(issue);
			remaining.set(key, (remaining.get(key) ?? 0) + 1);
		}
	}
	const introduced = afterErrors.filter((issue) => {
		const key = errorIssueKey(issue);
		const count = remaining.get(key) ?? 0;
		if (count === 0) {
			return true;
		}
		remaining.set(key, count - 1);
		return false;
	});
	return {
		introduced,
		preExistingCount: afterErrors.length - introduced.length,
	};
};

/**
 * Run an operation plan inside mutateDesignFile: one read, one revision check,
 * one write when every step succeeds and the plan adds no error issues.
 * Errors the design already had are counted in preExistingErrorCount and do
 * not block the write. Success returns the new revision, ids created per
 * inserting step, the deleted count and diagnostics on touched elements; a
 * failing step returns its index, operation and error with hints.
 */
export const applyDesignOperationsPayload = async (
	context: TrickroomMcpServerContext,
	input: Pick<
		OperationPlanInput,
		"designFileId" | "expectedRevision" | "operations" | "response"
	> & {
		/** Called after a write that renamed the design. */
		onRename?: () => Promise<void>;
	},
): Promise<CallToolResult> => {
	const { designFileId, expectedRevision, operations, response } = input;
	const base = {
		project: getProjectReference(context),
		designFileId,
		operationCount: operations.length,
	};
	return mutateDesignFile(
		context,
		{ designFileId, expectedRevision },
		{
			mutate: async (read) => {
				const execution = await executeOperationPlan(
					createDesignOperationDependencies(context),
					{ designFileId, operations },
					read.design,
				);
				if (execution.status === "failed") {
					return skipDesignWrite(
						createErrorResult({
							status: "INVALID_OPERATION",
							valid: false,
							...base,
							...describeFailedPlanStep(execution),
						}),
					);
				}
				const shaped = shapeMutationDiagnostics(
					await getDesignDiagnostics(context, execution.design),
					response,
					execution.affectedElementIds,
				);
				const { introduced, preExistingCount } = await splitIntroducedErrors(
					shaped.issues,
					async () => (await getDesignDiagnostics(context, read.design)).issues,
				);
				const diagnostics = {
					...shaped,
					issues: introduced,
					...(preExistingCount > 0
						? { preExistingErrorCount: preExistingCount }
						: {}),
				};
				if (introduced.length > 0) {
					return skipDesignWrite(
						createErrorResult({
							status: "INVALID_OPERATION",
							valid: false,
							...base,
							code: "PLAN_LEAVES_ERRORS",
							message:
								"This plan would add error issues to the design, so nothing was written. Fix them in the plan.",
							...diagnostics,
						}),
					);
				}
				return { design: execution.design, execution, diagnostics };
			},
			respond: async ({ execution, diagnostics }, write) => {
				if (
					input.onRename &&
					execution.steps.some((step) => step.operation === "renameDesignFile")
				) {
					await input.onRename();
				}
				const created = execution.steps
					.map((step) => describeCreatedElements(step, response))
					.filter((entry) => entry !== null);
				return createJsonResult({
					status: "success",
					valid: true,
					...base,
					newRevision: write.revision,
					...(response === "full"
						? { steps: execution.steps }
						: created.length > 0
							? { created }
							: {}),
					...(execution.deletedIds.length > 0
						? { deletedCount: execution.deletedIds.length }
						: {}),
					...diagnostics,
				});
			},
		},
	);
};
