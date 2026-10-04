import { z } from "zod";
import { getRecipeStructuralMetadata } from "../recipes/markers";
import {
	createDesignFileService,
	type DesignFileRead,
	DesignFileServiceError,
} from "../services/design-file-service";
import { DesignTransformError } from "../services/design-transform-service";
import { enrichElementLookupError } from "../services/element-lookup-hints";
import type { Node as DesignNode, TrickroomDesign } from "../types";
import {
	applyDryRunOperation,
	assertOperationAllowedByPolicy,
	type DesignOperationName,
	type DryRunOperationContext,
	designOperationNameSchema,
	OPERATION_PARAMETER_SIGNATURES,
	validateDryRunOperationParameters,
} from "./design-operations";
import { type McpDesignIssue, shapeMutationDiagnostics } from "./diagnostics";
import {
	assertCanReadDesignFile,
	assertCanWriteDesignFile,
	type McpPolicy,
} from "./governance";
import type { TrickroomMcpProjectRef } from "./project-resolver";
import {
	designFileIdSchema,
	expectedRevisionSchema,
	mutationResponseOptionsSchema,
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
	response: mutationResponseOptionsSchema.optional(),
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
};

export type OperationPlanStepRecipe = {
	tempId?: string;
	recipeId: string;
	rootElementId: string;
	slots: Record<string, string>;
};

export type OperationPlanResult = {
	status: string;
	valid: boolean;
	project: Record<string, unknown>;
	designFile: Record<string, unknown>;
	operationCount: number;
	steps: OperationPlanStepOutput[];
	issues: McpDesignIssue[];
	warnings?: McpDesignIssue[];
	tokenDiagnostics?: unknown;
	changedElementIds: string[];
	deletedIds: string[];
	insertedElementIds: string[];
	recipeExpansions: unknown[];
	suggestedReads: string[];
	failedStepIndex?: number;
	failedOperation?: DesignOperationName;
	currentRevision?: string;
	expectedRevision?: string;
	newRevision?: string;
	message?: string;
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

const assertCrossFileCopySourceRevision = async (
	deps: OperationPlanDependencies,
	input: OperationPlanInput,
	read: DesignFileRead,
	sourceDesignFileId: string,
	sourceExpectedRevision: unknown,
	stepIndex: number,
	operation: DesignOperationName,
	steps: OperationPlanStepOutput[],
	sourceDesignReads: Map<string, DesignFileRead>,
	aggregates: {
		changedElementIds: string[];
		deletedIds: string[];
		insertedElementIds: string[];
		recipeExpansions: unknown[];
	},
): Promise<
	| { kind: "ok"; sourceRead: DesignFileRead }
	| { kind: "error"; result: OperationPlanResult }
> => {
	if (typeof sourceExpectedRevision !== "string") {
		throw new DesignTransformError(
			"SOURCE_REVISION_REQUIRED",
			"sourceExpectedRevision is required for cross-file copySubtree operations in a plan.",
		);
	}

	let sourceRead = sourceDesignReads.get(sourceDesignFileId);
	if (!sourceRead) {
		sourceRead = await deps.readDesignFile(sourceDesignFileId);
		sourceDesignReads.set(sourceDesignFileId, sourceRead);
	}

	if (sourceRead.revision !== sourceExpectedRevision) {
		return {
			kind: "error",
			result: {
				status: "SOURCE_REVISION_MISMATCH",
				valid: false,
				project: deps.getProjectReference(),
				designFile: deps.getDesignMetadata(input.designFileId, read),
				operationCount: input.operations.length,
				steps,
				failedStepIndex: stepIndex,
				failedOperation: operation,
				currentRevision: sourceRead.revision,
				expectedRevision: sourceExpectedRevision,
				issues: [
					{
						severity: "error",
						code: "SOURCE_REVISION_MISMATCH",
						message:
							"Expected source revision does not match current revision.",
					},
				],
				warnings: [],
				tokenDiagnostics: null,
				changedElementIds: aggregates.changedElementIds,
				deletedIds: aggregates.deletedIds,
				insertedElementIds: aggregates.insertedElementIds,
				recipeExpansions: aggregates.recipeExpansions,
				suggestedReads: ["readDesignFile", "readDesignGraph"],
			},
		};
	}

	return { kind: "ok", sourceRead };
};

type OperationPlanDependencies = {
	policy: McpPolicy;
	projectRoot: string;
	readDesignFile: (designFileId: string) => Promise<DesignFileRead>;
	getProjectReference: () => Record<string, unknown>;
	getDesignMetadata: (
		designFileId: string,
		read: DesignFileRead,
	) => Record<string, unknown>;
	getDesignDiagnostics: (design: TrickroomDesign) => Promise<{
		issues: McpDesignIssue[];
		tokenSnapshot: unknown;
	}>;
	assertResourceReferencesExist: (design: TrickroomDesign) => Promise<void>;
	assertCanUseSubtreeComponents: (subtree: DesignNode) => void;
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

const findElementContext = (
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

const buildRevisionMismatchResult = (
	deps: OperationPlanDependencies,
	designFileId: string,
	read: DesignFileRead,
	expectedRevision: string,
): OperationPlanResult => ({
	status: "REVISION_MISMATCH",
	valid: false,
	project: deps.getProjectReference(),
	designFile: deps.getDesignMetadata(designFileId, read),
	operationCount: 0,
	steps: [],
	currentRevision: read.revision,
	expectedRevision,
	message:
		"The design file was modified since your last read. Re-read before validating or applying the operation plan.",
	suggestedReads: ["readDesignFile", "readDesignGraph"],
	issues: [
		{
			severity: "error",
			code: "REVISION_MISMATCH",
			message: "Expected revision does not match current revision.",
		},
	],
	warnings: [],
	tokenDiagnostics: null,
	changedElementIds: [],
	deletedIds: [],
	insertedElementIds: [],
	recipeExpansions: [],
});

const buildInvalidStepResult = (
	deps: OperationPlanDependencies,
	input: OperationPlanInput,
	read: DesignFileRead,
	stepIndex: number,
	operation: DesignOperationName,
	steps: OperationPlanStepOutput[],
	error: DesignTransformError,
	aggregates: {
		changedElementIds: string[];
		deletedIds: string[];
		insertedElementIds: string[];
		recipeExpansions: unknown[];
	},
): OperationPlanResult => ({
	status: "invalid",
	valid: false,
	project: deps.getProjectReference(),
	designFile: deps.getDesignMetadata(input.designFileId, read),
	operationCount: input.operations.length,
	steps,
	failedStepIndex: stepIndex,
	failedOperation: operation,
	issues: [
		{
			severity: "error",
			code: error.code,
			message: error.message,
			...error.details,
		},
	],
	warnings: [],
	tokenDiagnostics: null,
	changedElementIds: aggregates.changedElementIds,
	deletedIds: aggregates.deletedIds,
	insertedElementIds: aggregates.insertedElementIds,
	recipeExpansions: aggregates.recipeExpansions,
	suggestedReads: ["readDesignGraph", "readElement", "validateDesignFile"],
});

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

export const executeOperationPlanDryRun = async (
	deps: OperationPlanDependencies,
	input: OperationPlanInput,
): Promise<OperationPlanResult & { finalDesign?: TrickroomDesign }> => {
	const read = await deps.readDesignFile(input.designFileId);
	if (read.revision !== input.expectedRevision) {
		return buildRevisionMismatchResult(
			deps,
			input.designFileId,
			read,
			input.expectedRevision,
		);
	}

	const sourceDesignReads = new Map<string, DesignFileRead>();
	const steps: OperationPlanStepOutput[] = [];
	const changedElementIds: string[] = [];
	const deletedIds: string[] = [];
	const insertedElementIds: string[] = [];
	const recipeExpansions: unknown[] = [];

	let candidateDesign = read.design;

	for (let stepIndex = 0; stepIndex < input.operations.length; stepIndex++) {
		const step = input.operations[stepIndex];
		const operation = step.operation;

		try {
			const rawParams = validateDryRunOperationParameters(
				operation,
				step.parameters,
				{ designFileId: input.designFileId },
			);
			const params = resolveStepReferencesInParameters(rawParams, steps);

			if (operation === "copySubtree") {
				const sourceDesignFileId = String(params.sourceDesignFileId);
				const sourceElementId = String(params.sourceElementId);
				let sourceDesign = candidateDesign;

				if (sourceDesignFileId !== input.designFileId) {
					assertCanReadDesignFile(deps.policy, sourceDesignFileId);
					const sourceRevisionResult = await assertCrossFileCopySourceRevision(
						deps,
						input,
						read,
						sourceDesignFileId,
						params.sourceExpectedRevision,
						stepIndex,
						operation,
						steps,
						sourceDesignReads,
						{
							changedElementIds,
							deletedIds,
							insertedElementIds,
							recipeExpansions,
						},
					);
					if (sourceRevisionResult.kind === "error") {
						return sourceRevisionResult.result;
					}
					sourceDesign = sourceRevisionResult.sourceRead.design;
				}

				const sourceElement = findElementContext(sourceDesign, sourceElementId);
				if (!sourceElement) {
					throw new DesignTransformError(
						"ELEMENT_NOT_FOUND",
						`Element "${sourceElementId}" not found.`,
					);
				}
				deps.assertCanUseSubtreeComponents(sourceElement);
			} else if (
				operation !== "renameDesignFile" &&
				operation !== "addSubtree" &&
				operation !== "addSystemComponent"
			) {
				assertOperationAllowedByPolicy(
					deps.policy,
					candidateDesign,
					operation,
					params,
				);
			}

			const dryRunContext: DryRunOperationContext = {
				designFileId: input.designFileId,
				projectRoot: deps.projectRoot,
				sourceDesigns: new Map(
					[...sourceDesignReads.entries()].map(([id, sourceRead]) => [
						id,
						sourceRead.design,
					]),
				),
			};

			const result = await applyDryRunOperation(
				candidateDesign,
				operation,
				params,
				dryRunContext,
			);

			if (
				(operation === "addSubtree" || operation === "addSystemComponent") &&
				result.changedElementId
			) {
				const insertedRoot = findElementContext(
					result.design,
					result.changedElementId,
				);
				if (!insertedRoot) {
					throw new DesignTransformError(
						"INVALID_OPERATION",
						`Failed to validate inserted ${operation} root after applying plan step.`,
					);
				}
				deps.assertCanUseSubtreeComponents(insertedRoot);
			}

			await deps.assertResourceReferencesExist(result.design);

			candidateDesign = result.design;

			const rootElementId =
				typeof result.summary.rootElementId === "string"
					? result.summary.rootElementId
					: result.changedElementId;

			const stepOutput: OperationPlanStepOutput = {
				stepIndex,
				operation,
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
			steps.push(stepOutput);

			if (result.changedElementId) {
				changedElementIds.push(result.changedElementId);
			}
			if (result.deletedIds) {
				deletedIds.push(...result.deletedIds);
			}
			if (result.insertedElementIds) {
				insertedElementIds.push(...result.insertedElementIds);
			}
			if (result.recipeExpansions) {
				recipeExpansions.push(...result.recipeExpansions);
			}
		} catch (error) {
			if (error instanceof DesignTransformError) {
				return buildInvalidStepResult(
					deps,
					input,
					read,
					stepIndex,
					operation,
					steps,
					withExpectedParameters(
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
					{
						changedElementIds,
						deletedIds,
						insertedElementIds,
						recipeExpansions,
					},
				);
			}
			throw error;
		}
	}

	const diagnostics = await deps.getDesignDiagnostics(candidateDesign);
	const shaped = shapeMutationDiagnostics(diagnostics, input.response, [
		...changedElementIds,
		...insertedElementIds,
	]);

	return {
		status: "success",
		valid: diagnostics.issues.every((issue) => issue.severity !== "error"),
		project: deps.getProjectReference(),
		designFile: deps.getDesignMetadata(input.designFileId, read),
		operationCount: input.operations.length,
		steps,
		...shaped,
		changedElementIds,
		deletedIds,
		insertedElementIds,
		recipeExpansions,
		suggestedReads: ["readDesignGraph", "readElement", "validateDesignFile"],
		finalDesign: candidateDesign,
	};
};

export const applyOperationPlan = async (
	deps: OperationPlanDependencies & {
		canonicalizeDesignForStorage: (
			design: TrickroomDesign,
		) => Promise<TrickroomDesign>;
		writeDesignFile: (
			designFileId: string,
			design: TrickroomDesign,
			expectedRevision: string,
		) => Promise<{ revision: string }>;
	},
	input: OperationPlanInput,
): Promise<OperationPlanResult> => {
	assertCanWriteDesignFile(deps.policy, input.designFileId);

	const dryRun = await executeOperationPlanDryRun(deps, input);
	const { finalDesign, ...publicResult } = dryRun;

	if (dryRun.status !== "success" || !dryRun.valid || !finalDesign) {
		return publicResult;
	}

	const read = await deps.readDesignFile(input.designFileId);
	if (read.revision !== input.expectedRevision) {
		return buildRevisionMismatchResult(
			deps,
			input.designFileId,
			read,
			input.expectedRevision,
		);
	}

	try {
		const nextDesign = await deps.canonicalizeDesignForStorage(finalDesign);
		const write = await deps.writeDesignFile(
			input.designFileId,
			nextDesign,
			input.expectedRevision,
		);
		return {
			...publicResult,
			newRevision: write.revision,
		};
	} catch (error) {
		if (
			error instanceof DesignFileServiceError &&
			error.code === "REVISION_MISMATCH"
		) {
			const raceRead = await deps.readDesignFile(input.designFileId);
			return buildRevisionMismatchResult(
				deps,
				input.designFileId,
				raceRead,
				input.expectedRevision,
			);
		}
		throw error;
	}
};

export const createOperationPlanDependencies = (
	context: {
		projectRoot: string;
		config: { projectId?: string | null; name: string };
		locationId?: string;
	},
	policy: McpPolicy,
	hooks: {
		readDesignFileForTool: (designFileId: string) => Promise<DesignFileRead>;
		getProjectReference: () => Record<string, unknown>;
		getDesignMetadata: (
			designFileId: string,
			read: DesignFileRead,
		) => Record<string, unknown>;
		getDesignDiagnostics: (design: TrickroomDesign) => Promise<{
			issues: McpDesignIssue[];
			tokenSnapshot: unknown;
		}>;
		assertResourceReferencesExist: (design: TrickroomDesign) => Promise<void>;
		assertCanUseSubtreeComponents: (subtree: DesignNode) => void;
		canonicalizeDesignForStorage: (
			design: TrickroomDesign,
		) => Promise<TrickroomDesign>;
	},
): OperationPlanDependencies & {
	canonicalizeDesignForStorage: (
		design: TrickroomDesign,
	) => Promise<TrickroomDesign>;
	writeDesignFile: (
		designFileId: string,
		design: TrickroomDesign,
		expectedRevision: string,
	) => Promise<{ revision: string }>;
} => {
	const service = createDesignFileService(context.projectRoot);

	return {
		policy,
		projectRoot: context.projectRoot,
		readDesignFile: hooks.readDesignFileForTool,
		getProjectReference: hooks.getProjectReference,
		getDesignMetadata: hooks.getDesignMetadata,
		getDesignDiagnostics: hooks.getDesignDiagnostics,
		assertResourceReferencesExist: hooks.assertResourceReferencesExist,
		assertCanUseSubtreeComponents: hooks.assertCanUseSubtreeComponents,
		canonicalizeDesignForStorage: hooks.canonicalizeDesignForStorage,
		writeDesignFile: async (designFileId, design, expectedRevision) => {
			const file = service.getFileForUuid(designFileId);
			const write = await service.writeDesignFile(file, design, {
				expectedRevision,
			});
			return { revision: write.revision };
		},
	};
};

/**
 * Compact a step for the applyDesignOperations response: the ids an agent
 * needs to continue (changed/root ids, tempId maps, recipe roots), without
 * echoing the submitted parameters or full recipe path maps.
 */
export const compactOperationPlanStep = (step: OperationPlanStepOutput) => {
	const recipes = step.recipes ?? [];
	return {
		stepIndex: step.stepIndex,
		operation: step.operation,
		...(step.changedElementId
			? { changedElementId: step.changedElementId }
			: {}),
		...(step.rootElementId && step.rootElementId !== step.changedElementId
			? { rootElementId: step.rootElementId }
			: {}),
		...(step.idMap ? { idMap: step.idMap } : {}),
		...(recipes.length > 0 ? { recipes } : {}),
		...(step.deletedIds ? { deletedCount: step.deletedIds.length } : {}),
	};
};

/**
 * Shape an applyDesignOperations result. The default is compact: new revision,
 * per-step created ids, and diagnostics. Pass `includeStepDetails` to get the
 * full validateOperationPlan-style result.
 */
export const compactApplyOperationPlanResult = (
	result: OperationPlanResult,
	input: Pick<OperationPlanInput, "designFileId" | "response">,
): Record<string, unknown> => {
	if (input.response?.includeStepDetails) {
		return result as unknown as Record<string, unknown>;
	}

	const {
		designFile: _designFile,
		steps,
		changedElementIds: _changedElementIds,
		deletedIds,
		insertedElementIds: _insertedElementIds,
		recipeExpansions: _recipeExpansions,
		suggestedReads,
		tokenDiagnostics,
		...rest
	} = result;
	const failed = result.status !== "success" || !result.valid;

	return {
		...rest,
		designFileId: input.designFileId,
		...(failed
			? { suggestedReads }
			: { steps: steps.map(compactOperationPlanStep) }),
		...(!failed && deletedIds.length > 0
			? { deletedCount: deletedIds.length }
			: {}),
		...(input.response?.includeTokenDiagnostics ? { tokenDiagnostics } : {}),
	};
};
