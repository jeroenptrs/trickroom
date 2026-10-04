import { z } from "zod";
import { getRecipeStructuralMetadata } from "../recipes/markers";
import type { DesignFileRead } from "../services/design-file-service";
import { DesignTransformError } from "../services/design-transform-service";
import { enrichElementLookupError } from "../services/element-lookup-hints";
import type { Node as DesignNode, TrickroomDesign } from "../types";
import {
	applyDryRunOperation,
	assertOperationAllowedByPolicy,
	type DesignOperationName,
	type DryRunResult,
	designOperationNameSchema,
	OPERATION_PARAMETER_SIGNATURES,
	resolveRecipeControlParameters,
	validateDryRunOperationParameters,
} from "./design-operations";
import type { MutationResponseDetail } from "./diagnostics";
import { assertCanReadDesignFile, type McpPolicy } from "./governance";
import type { TrickroomMcpProjectRef } from "./project-resolver";
import {
	designFileIdSchema,
	expectedRevisionSchema,
	mutationResponseDetailSchema,
} from "./tools/schemas";

const projectRefSchema: z.ZodType<TrickroomMcpProjectRef | undefined> = z
	.object({
		locationId: z.string().min(1).optional(),
		projectId: z.string().min(1).optional(),
	})
	.strict()
	.optional();

export const operationPlanStepSchema = z.object({
	operation: designOperationNameSchema,
	parameters: z.record(z.string(), z.unknown()).optional(),
});

export const operationPlanInputSchema = z.object({
	designFileId: designFileIdSchema,
	expectedRevision: expectedRevisionSchema,
	operations: z.array(operationPlanStepSchema).min(1),
	project: projectRefSchema,
	response: mutationResponseDetailSchema.optional(),
});

export type OperationPlanInput = z.infer<typeof operationPlanInputSchema>;

export type OperationPlanStepOutput = {
	stepIndex: number;
	operation: DesignOperationName;
	summary: Record<string, unknown>;
	changedElementId?: string;
	rootElementId?: string;
	deletedIds?: string[];
	insertedElementIds?: string[];
	recipeExpansions?: unknown[];
	idMap?: Record<string, string>;
	/** Recipe instances this step inserted, with slot host ids by slot name. */
	recipes?: OperationPlanStepRecipe[];
	/** A copySubtree step asked for its id map in compact responses. */
	includeIdMap?: true;
};

export type OperationPlanStepRecipe = {
	tempId?: string;
	recipeId: string;
	rootElementId: string;
	slots: Record<string, string>;
};

const STEP_REFERENCE_PATTERN = /^\$step:(\d+)(?::(.+))?$/su;

/** Accepted step reference forms, listed in errors for malformed references. */
export const STEP_REFERENCE_FORMS = [
	"$step:N",
	"$step:N:changedElementId",
	"$step:N:rootElementId",
	"$step:N:tempId:<tempId>",
	"$step:N:slot:<slotName>",
	"$step:N:tempId:<recipeTempId>:slot:<slotName>",
];

const STEP_REFERENCE_PARAMETER_KEYS = new Set([
	"elementId",
	"parentId",
	"targetParentId",
	"sourceElementId",
	"instanceId",
	"rootElementId",
]);

const stepReferenceError = (
	value: string,
	reason: string,
	details: Record<string, unknown> = {},
) =>
	new DesignTransformError(
		"INVALID_OPERATION_PARAMETERS",
		`Step reference "${value}" ${reason}`,
		{ stepReferenceForms: STEP_REFERENCE_FORMS, ...details },
	);

const resolveSlotHost = (
	value: string,
	step: OperationPlanStepOutput,
	slotName: string,
	recipeRootElementId?: string,
) => {
	const recipes = (step.recipes ?? []).filter(
		(recipe) =>
			recipeRootElementId === undefined ||
			recipe.rootElementId === recipeRootElementId,
	);
	const withSlot = recipes.filter((recipe) =>
		Object.hasOwn(recipe.slots, slotName),
	);
	if (withSlot.length === 1) {
		return withSlot[0].slots[slotName];
	}
	const availableSlots = recipes.map((recipe) => ({
		...(recipe.tempId !== undefined ? { tempId: recipe.tempId } : {}),
		recipeId: recipe.recipeId,
		rootElementId: recipe.rootElementId,
		slots: Object.keys(recipe.slots),
	}));
	if (withSlot.length > 1) {
		throw stepReferenceError(
			value,
			`is ambiguous: step ${step.stepIndex} inserted ${withSlot.length} recipes with slot "${slotName}". Qualify it with the recipe's tempId: $step:${step.stepIndex}:tempId:<recipeTempId>:slot:${slotName}.`,
			{ availableSlots },
		);
	}
	throw stepReferenceError(
		value,
		recipes.length === 0
			? `cannot resolve slot "${slotName}": step ${step.stepIndex} did not insert a recipe${recipeRootElementId === undefined ? "" : " with that tempId"}.`
			: `cannot resolve slot "${slotName}" in step ${step.stepIndex}. Available slots: ${[...new Set(recipes.flatMap((recipe) => Object.keys(recipe.slots)))].join(", ") || "none"}.`,
		{ availableSlots },
	);
};

const resolveStepReferenceString = (
	value: string,
	steps: OperationPlanStepOutput[],
) => {
	if (!value.startsWith("$step:")) {
		return value;
	}
	const match = value.match(STEP_REFERENCE_PATTERN);
	if (!match) {
		throw stepReferenceError(value, "is malformed.");
	}

	const stepIndex = Number(match[1]);
	const field = match[2] ?? "changedElementId";
	const step = steps[stepIndex];
	if (!step) {
		throw stepReferenceError(
			value,
			`refers to step ${stepIndex}, but only ${steps.length} prior step(s) exist.`,
		);
	}

	if (field === "rootElementId") {
		const resolved =
			typeof step.summary.rootElementId === "string"
				? step.summary.rootElementId
				: (step.rootElementId ?? step.changedElementId);
		if (typeof resolved !== "string") {
			throw stepReferenceError(
				value,
				`could not resolve rootElementId for step ${stepIndex}.`,
			);
		}
		return resolved;
	}

	if (field === "changedElementId") {
		if (typeof step.changedElementId !== "string") {
			throw stepReferenceError(
				value,
				`could not resolve changedElementId for step ${stepIndex}.`,
			);
		}
		return step.changedElementId;
	}

	if (field.startsWith("slot:")) {
		return resolveSlotHost(value, step, field.slice("slot:".length));
	}

	if (field.startsWith("tempId:")) {
		const rest = field.slice("tempId:".length);
		const slotIndex = rest.lastIndexOf(":slot:");
		const tempId = slotIndex >= 0 ? rest.slice(0, slotIndex) : rest;
		const resolved = step.idMap?.[tempId];
		if (resolved === undefined) {
			const availableTempIds = Object.keys(step.idMap ?? {});
			throw stepReferenceError(
				value,
				availableTempIds.length === 0
					? `cannot resolve tempId "${tempId}": step ${stepIndex} (${step.operation}) produced no tempId map.`
					: `cannot resolve tempId "${tempId}" in step ${stepIndex}. Available tempIds: ${availableTempIds.join(", ")}.`,
				{ availableTempIds },
			);
		}
		if (slotIndex < 0) {
			return resolved;
		}
		return resolveSlotHost(
			value,
			step,
			rest.slice(slotIndex + ":slot:".length),
			resolved,
		);
	}

	throw stepReferenceError(value, `uses unknown field "${field}".`);
};

export const resolveStepReferencesInValue = (
	value: unknown,
	steps: OperationPlanStepOutput[],
	resolveStrings = false,
): unknown => {
	if (typeof value === "string") {
		return resolveStrings ? resolveStepReferenceString(value, steps) : value;
	}

	if (Array.isArray(value)) {
		return value.map((entry) =>
			resolveStepReferencesInValue(entry, steps, false),
		);
	}

	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				key,
				resolveStepReferencesInValue(
					entry,
					steps,
					STEP_REFERENCE_PARAMETER_KEYS.has(key),
				),
			]),
		);
	}

	return value;
};

export const resolveStepReferencesInParameters = (
	params: Record<string, unknown>,
	steps: OperationPlanStepOutput[],
) =>
	resolveStepReferencesInValue(params, steps, false) as Record<string, unknown>;

/** What executing one design operation needs besides the design itself. */
export type DesignOperationDependencies = {
	policy: McpPolicy;
	projectRoot: string;
	/** Reject asset/icon references on these elements that the system lacks. */
	assertResourceReferencesExist: (
		design: TrickroomDesign,
		elementIds: readonly string[],
	) => Promise<void>;
	assertCanUseSubtreeComponents: (subtree: DesignNode) => void;
};

export type OperationPlanDependencies = DesignOperationDependencies & {
	/** Reads other designs, for cross-design copySubtree sources. */
	readDesignFile: (designFileId: string) => Promise<DesignFileRead>;
};

export type DesignOperationExecution = DryRunResult & {
	/**
	 * Elements the operation inserted or changed: the scope of its resource
	 * checks and of the warnings a write reports.
	 */
	affectedElementIds: string[];
};

const findNode = (
	design: TrickroomDesign,
	elementId: string,
): DesignNode | null => {
	const visit = (node: DesignNode): DesignNode | null => {
		if (node.id === elementId) {
			return node;
		}
		if (typeof node.children === "string") {
			return null;
		}
		for (const child of node.children) {
			const found = visit(child);
			if (found) {
				return found;
			}
		}
		return null;
	};

	for (const root of design.boards) {
		const found = visit(root);
		if (found) {
			return found;
		}
	}

	return null;
};

const getSubtreeIds = (design: TrickroomDesign, rootElementId: string) => {
	const ids: string[] = [];
	const visit = (node: DesignNode) => {
		ids.push(node.id);
		if (Array.isArray(node.children)) {
			for (const child of node.children) {
				visit(child);
			}
		}
	};
	const root = findNode(design, rootElementId);
	if (root) {
		visit(root);
	}
	return ids;
};

const getAffectedElementIds = (result: DryRunResult): string[] => {
	switch (result.operation) {
		case "renameDesignFile":
		case "deleteElement":
			return [];
		case "detachRecipeInstance":
		case "detachSystemComponent":
			return Array.isArray(result.summary.detachedElementIds)
				? (result.summary.detachedElementIds as string[])
				: [];
		case "updateSystemComponentInstance":
			return getSubtreeIds(result.design, String(result.summary.rootElementId));
		case "updateRecipeInstance":
			return result.changedElementId
				? getSubtreeIds(result.design, result.changedElementId)
				: [];
		default:
			return (
				result.insertedElementIds ??
				(result.changedElementId ? [result.changedElementId] : [])
			);
	}
};

const SUBTREE_POLICY_OPERATIONS = new Set<DesignOperationName>([
	"addSubtree",
	"addSystemComponent",
]);

/**
 * Apply one validated operation to an in-memory design: policy checks, the
 * transform, and resource checks on the elements it touched. The single
 * implementation behind design_apply and design_validate steps.
 */
export const executeDesignOperation = async (
	deps: DesignOperationDependencies,
	design: TrickroomDesign,
	operation: DesignOperationName,
	validatedParams: Record<string, unknown>,
	context: {
		designFileId: string;
		sourceDesigns?: ReadonlyMap<string, TrickroomDesign>;
	},
): Promise<DesignOperationExecution> => {
	const sourceDesigns = context.sourceDesigns ?? new Map();
	const params =
		operation === "updateRecipeControl"
			? resolveRecipeControlParameters(design, validatedParams)
			: validatedParams;
	if (operation === "copySubtree") {
		const sourceDesignFileId = String(params.sourceDesignFileId);
		const sourceDesign =
			sourceDesignFileId === context.designFileId
				? design
				: sourceDesigns.get(sourceDesignFileId);
		const sourceElementId = String(params.sourceElementId);
		const sourceElement = sourceDesign
			? findNode(sourceDesign, sourceElementId)
			: null;
		if (sourceDesign && !sourceElement) {
			throw new DesignTransformError(
				"ELEMENT_NOT_FOUND",
				`Element "${sourceElementId}" not found.`,
			);
		}
		if (sourceElement) {
			deps.assertCanUseSubtreeComponents(sourceElement);
		}
	} else if (
		operation !== "renameDesignFile" &&
		!SUBTREE_POLICY_OPERATIONS.has(operation)
	) {
		assertOperationAllowedByPolicy(deps.policy, design, operation, params);
	}

	const result = await applyDryRunOperation(design, operation, params, {
		designFileId: context.designFileId,
		projectRoot: deps.projectRoot,
		sourceDesigns,
	});

	if (SUBTREE_POLICY_OPERATIONS.has(operation) && result.changedElementId) {
		const insertedRoot = findNode(result.design, result.changedElementId);
		if (!insertedRoot) {
			throw new DesignTransformError(
				"INVALID_OPERATION",
				`Failed to validate the inserted ${operation} root.`,
			);
		}
		deps.assertCanUseSubtreeComponents(insertedRoot);
	}

	const affectedElementIds = getAffectedElementIds(result);
	await deps.assertResourceReferencesExist(result.design, affectedElementIds);
	return { ...result, affectedElementIds };
};

/**
 * Group the recipe-owned nodes among a step's inserted ids by recipe instance,
 * so later steps can address slot hosts with $step:N:slot:<name>.
 */
const collectInsertedRecipes = (
	design: TrickroomDesign,
	insertedElementIds: readonly string[],
	idMap: Record<string, string> | undefined,
): OperationPlanStepRecipe[] => {
	if (insertedElementIds.length === 0) {
		return [];
	}
	const inserted = new Set(insertedElementIds);
	const instances = new Map<
		string,
		{ recipeId: string; rootElementId?: string; slots: Record<string, string> }
	>();
	const visit = (node: DesignNode) => {
		if (inserted.has(node.id)) {
			const metadata = getRecipeStructuralMetadata(node.props);
			if (metadata) {
				const instance = instances.get(metadata.instanceId) ?? {
					recipeId: metadata.recipeId,
					slots: {},
				};
				if (metadata.isRoot) {
					instance.rootElementId = node.id;
				}
				if (metadata.slotName !== null) {
					instance.slots[metadata.slotName] = node.id;
				}
				instances.set(metadata.instanceId, instance);
			}
		}
		if (Array.isArray(node.children)) {
			for (const child of node.children) {
				visit(child);
			}
		}
	};
	for (const board of design.boards) {
		visit(board);
	}

	const tempIdByElementId = new Map(
		Object.entries(idMap ?? {}).map(([tempId, id]) => [id, tempId]),
	);
	const recipes: OperationPlanStepRecipe[] = [];
	for (const instance of instances.values()) {
		if (instance.rootElementId === undefined) continue;
		const tempId = tempIdByElementId.get(instance.rootElementId);
		recipes.push({
			...(tempId !== undefined ? { tempId } : {}),
			recipeId: instance.recipeId,
			rootElementId: instance.rootElementId,
			slots: instance.slots,
		});
	}
	return recipes;
};

/**
 * A missing element id that equals a tempId (or slot name) from an earlier
 * step is almost always a bare tempId; point at the step reference instead.
 */
const withStepReferenceHint = (
	error: DesignTransformError,
	steps: OperationPlanStepOutput[],
): DesignTransformError => {
	const missingId = error.details?.missingElementId;
	if (typeof missingId !== "string") {
		return error;
	}
	const references: string[] = [];
	for (const step of steps) {
		if (step.idMap && Object.hasOwn(step.idMap, missingId)) {
			references.push(`$step:${step.stepIndex}:tempId:${missingId}`);
		}
		if (
			step.recipes?.some((recipe) => Object.hasOwn(recipe.slots, missingId))
		) {
			references.push(`$step:${step.stepIndex}:slot:${missingId}`);
		}
	}
	if (references.length === 0) {
		return error;
	}
	return new DesignTransformError(
		error.code,
		`${error.message} "${missingId}" is a tempId or slot name from an earlier step; reference it as ${references.map((reference) => `"${reference}"`).join(" or ")}.`,
		{ ...error.details, suggestedStepReferences: references },
	);
};

/** Show the valid parameter signature when a step's parameters are wrong. */
const withExpectedParameters = (
	operation: DesignOperationName,
	error: DesignTransformError,
): DesignTransformError =>
	error.code === "INVALID_OPERATION_PARAMETERS"
		? new DesignTransformError(error.code, error.message, {
				...error.details,
				expectedParameters: OPERATION_PARAMETER_SIGNATURES[operation],
			})
		: error;

const toStepOutput = (
	stepIndex: number,
	result: DryRunResult,
): OperationPlanStepOutput => {
	const rootElementId =
		typeof result.summary.rootElementId === "string"
			? result.summary.rootElementId
			: result.changedElementId;
	const stepOutput: OperationPlanStepOutput = {
		stepIndex,
		operation: result.operation,
		summary: result.summary,
		...(result.changedElementId
			? { changedElementId: result.changedElementId }
			: {}),
		...(rootElementId ? { rootElementId } : {}),
		...(result.deletedIds ? { deletedIds: result.deletedIds } : {}),
		...(result.insertedElementIds
			? { insertedElementIds: result.insertedElementIds }
			: {}),
		...(result.recipeExpansions
			? { recipeExpansions: result.recipeExpansions }
			: {}),
		...(result.idMap && Object.keys(result.idMap).length > 0
			? { idMap: result.idMap }
			: {}),
	};
	const recipes = collectInsertedRecipes(
		result.design,
		result.insertedElementIds ?? [],
		result.idMap,
	);
	if (recipes.length > 0) {
		stepOutput.recipes = recipes;
	}
	return stepOutput;
};

export type OperationPlanExecution =
	| {
			status: "success";
			design: TrickroomDesign;
			steps: OperationPlanStepOutput[];
			/** Inserted or changed elements that still exist after the plan. */
			affectedElementIds: string[];
			deletedIds: string[];
	  }
	| {
			status: "failed";
			failedStepIndex: number;
			failedOperation: DesignOperationName;
			error: DesignTransformError;
			steps: OperationPlanStepOutput[];
	  };

/**
 * Load the source of a cross-design copySubtree step and check its revision.
 * Same-design copies read the candidate design instead.
 */
const loadCopySource = async (
	deps: OperationPlanDependencies,
	params: Record<string, unknown>,
	sourceDesignReads: Map<string, DesignFileRead>,
) => {
	const sourceDesignFileId = String(params.sourceDesignFileId);
	assertCanReadDesignFile(deps.policy, sourceDesignFileId);
	const sourceExpectedRevision = params.sourceExpectedRevision;
	if (typeof sourceExpectedRevision !== "string") {
		throw new DesignTransformError(
			"SOURCE_REVISION_REQUIRED",
			"sourceExpectedRevision is required for cross-design copySubtree.",
			{ sourceDesignFileId },
		);
	}

	let sourceRead = sourceDesignReads.get(sourceDesignFileId);
	if (!sourceRead) {
		sourceRead = await deps.readDesignFile(sourceDesignFileId);
		sourceDesignReads.set(sourceDesignFileId, sourceRead);
	}
	if (sourceRead.revision !== sourceExpectedRevision) {
		throw new DesignTransformError(
			"SOURCE_REVISION_MISMATCH",
			"The copy source design changed since your last read. Re-read it and retry with its current revision.",
			{
				sourceDesignFileId,
				currentSourceRevision: sourceRead.revision,
				sourceExpectedRevision,
			},
		);
	}
};

/**
 * Run an ordered list of operations against an in-memory design. Stops at the
 * first failing step; nothing is written. Revision checks on the target are
 * the caller's (see mutateDesignFile).
 */
export const executeOperationPlan = async (
	deps: OperationPlanDependencies,
	input: Pick<OperationPlanInput, "designFileId" | "operations">,
	design: TrickroomDesign,
): Promise<OperationPlanExecution> => {
	const sourceDesignReads = new Map<string, DesignFileRead>();
	const steps: OperationPlanStepOutput[] = [];
	const affectedElementIds = new Set<string>();
	const deletedIds: string[] = [];
	let candidateDesign = design;

	for (let stepIndex = 0; stepIndex < input.operations.length; stepIndex++) {
		const { operation, parameters } = input.operations[stepIndex];
		try {
			const params = resolveStepReferencesInParameters(
				validateDryRunOperationParameters(operation, parameters, {
					designFileId: input.designFileId,
				}),
				steps,
			);
			if (
				operation === "copySubtree" &&
				params.sourceDesignFileId !== input.designFileId
			) {
				await loadCopySource(deps, params, sourceDesignReads);
			}

			const result = await executeDesignOperation(
				deps,
				candidateDesign,
				operation,
				params,
				{
					designFileId: input.designFileId,
					sourceDesigns: new Map(
						[...sourceDesignReads].map(([id, read]) => [id, read.design]),
					),
				},
			);
			candidateDesign = result.design;
			const stepOutput = toStepOutput(stepIndex, result);
			if (operation === "copySubtree" && params.includeIdMap === true) {
				stepOutput.includeIdMap = true;
			}
			steps.push(stepOutput);
			for (const id of result.affectedElementIds) {
				affectedElementIds.add(id);
			}
			if (result.deletedIds) {
				deletedIds.push(...result.deletedIds);
				for (const id of result.deletedIds) {
					affectedElementIds.delete(id);
				}
			}
		} catch (error) {
			if (error instanceof DesignTransformError) {
				return {
					status: "failed",
					failedStepIndex: stepIndex,
					failedOperation: operation,
					error: withExpectedParameters(
						operation,
						withStepReferenceHint(
							enrichElementLookupError(error, [
								candidateDesign,
								...[...sourceDesignReads.values()].map(
									(sourceRead) => sourceRead.design,
								),
							]),
							steps,
						),
					),
					steps,
				};
			}
			throw error;
		}
	}

	return {
		status: "success",
		design: candidateDesign,
		steps,
		affectedElementIds: [...affectedElementIds],
		deletedIds,
	};
};

/** The failing step of a plan: index, operation, and its error with hints. */
export const describeFailedPlanStep = (
	execution: Extract<OperationPlanExecution, { status: "failed" }>,
) => ({
	failedStepIndex: execution.failedStepIndex,
	failedOperation: execution.failedOperation,
	code: execution.error.code,
	message: execution.error.message,
	...execution.error.details,
});

/**
 * Ids a step created that the caller could not know: the inserted root, the
 * tempId map of addSubtree, and slot hosts of inserted recipes. Updates,
 * moves and deletes return nothing. copySubtree id maps come with the step's
 * includeIdMap, or "full".
 */
export const describeCreatedElements = (
	step: OperationPlanStepOutput,
	detail: MutationResponseDetail = "compact",
) => {
	if (!step.insertedElementIds || !step.rootElementId) {
		return null;
	}
	const recipes = step.recipes ?? [];
	const rootRecipe =
		recipes.length === 1 && recipes[0].rootElementId === step.rootElementId
			? recipes[0]
			: null;
	const includeIdMap =
		step.idMap !== undefined &&
		(step.operation === "addSubtree" ||
			step.includeIdMap === true ||
			detail === "full");
	return {
		step: step.stepIndex,
		id: step.rootElementId,
		...(step.operation === "copySubtree"
			? { nodeCount: step.insertedElementIds.length }
			: {}),
		...(includeIdMap ? { idMap: step.idMap } : {}),
		...(rootRecipe ? { slots: rootRecipe.slots } : {}),
		...(!rootRecipe && recipes.length > 0
			? {
					recipes: recipes.map((recipe) => ({
						...(recipe.tempId !== undefined ? { tempId: recipe.tempId } : {}),
						id: recipe.rootElementId,
						slots: recipe.slots,
					})),
				}
			: {}),
	};
};
