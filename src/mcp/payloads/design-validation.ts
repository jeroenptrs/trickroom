import type { z } from "zod";
import { migrateTrickroomDesign } from "../../server-utils";
import { createDesignFileService } from "../../services/design-file-service";
import {
	applyCopySubtree,
	DesignTransformError,
	normalizeDesignForMutation,
	type SubtreeDiagnostic,
	validateProposedSubtreeForInsertion,
} from "../../services/design-transform-service";
import type { Node as DesignNode } from "../../types";
import { findDesignSystem } from "../../utils/design-system-store";
import {
	applyDryRunOperation,
	assertOperationAllowedByPolicy,
	type DesignOperationName,
	OPERATION_PARAMETER_SIGNATURES,
	validateDryRunOperationParameters,
} from "../design-operations";
import {
	getDesignDiagnostics,
	type McpDesignIssue,
	stripHeavyTokenDiagnostics,
} from "../diagnostics";
import {
	assertCanReadDesignFile,
	assertCanWriteDesignFile,
	getMcpPolicy,
} from "../governance";
import {
	applyOperationPlan,
	compactApplyOperationPlanResult,
	createOperationPlanDependencies,
	executeOperationPlanDryRun,
	type operationPlanInputSchema,
} from "../operation-plan";
import type { TrickroomMcpServerContext } from "../server-types";
import type {
	AddSubtreeOperationParameters,
	CopySubtreeOperationParameters,
	validateCopySubtreePayloadSchema,
	validateSubtreePayloadSchema,
} from "../tools/operation-schemas";
import {
	canonicalizeDesignSystemReferenceForStorage,
	summarizeDesignSystemReference,
} from "./design-system";
import {
	findElementContext,
	getCompactElementSummary,
	getDesignMetadata,
	getDesignSystemHandle,
	getMutationContext,
	readDesignFileForTool,
} from "./design-tree";
import { getProjectReference } from "./project";
import {
	assertCanUseSubtreeComponents,
	assertResourceElementReferenceExists,
	assertResourceReferencesExist,
	type ValidationIssue,
	validateElementReferences,
} from "./references";

export const validateDesignFilePayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	options: { includeTokenDiagnostics?: boolean } = {},
) => {
	const includeTokenDiagnostics = options.includeTokenDiagnostics ?? false;
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const service = createDesignFileService(context.projectRoot);
	const read = await service.readJsonFile(service.getFileForUuid(designFileId));
	const issues: ValidationIssue[] = [];
	const migration = migrateTrickroomDesign(read.value);

	if (!migration) {
		return {
			project: getProjectReference(context),
			designFile: {
				id: designFileId,
				file: read.file,
				revision: read.revision,
			},
			valid: false,
			issues: [
				{
					severity: "error",
					code: "INVALID_DESIGN_PAYLOAD",
					message: "File does not contain a valid Trickroom design payload.",
				},
			] satisfies ValidationIssue[],
		};
	}

	const design = migration.design;
	const diagnostics = await getDesignDiagnostics(context, design);
	issues.push(...diagnostics.issues);
	const systemHandle = getDesignSystemHandle(design);
	if (systemHandle !== null) {
		const system = await findDesignSystem(context.projectRoot, systemHandle);
		if (!system) {
			issues.push({
				severity: "error",
				code: "UNKNOWN_DESIGN_SYSTEM",
				message: `Design references unconfigured design system "${systemHandle}".`,
				path: design.systemId !== undefined ? "systemId" : "systemName",
			});
		}
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

	const registryReferences = [...componentUsage.entries()]
		.map(([componentRef, count]) => {
			const [library, component] = componentRef.split("/");
			return { library, component, count };
		})
		.sort((a, b) =>
			a.library === b.library
				? a.component.localeCompare(b.component)
				: a.library.localeCompare(b.library),
		);

	return {
		project: getProjectReference(context),
		designFile: {
			id: designFileId,
			file: read.file,
			name: design.name,
			systemId: design.systemId ?? null,
			systemName: systemHandle === null ? null : (design.systemName ?? null),
			revision: read.revision,
		},
		valid: issues.every((issue) => issue.severity !== "error"),
		issues,
		designSystem: await summarizeDesignSystemReference(context, systemHandle),
		tokenDiagnostics: stripHeavyTokenDiagnostics(
			diagnostics.tokenSnapshot,
			includeTokenDiagnostics,
		),
		registryReferences,
		elementCount: seenElementIds.size,
		rootElementIds: design.boards.map((board) => board.id),
	};
};

export const validateOperationPayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	expectedRevision: string,
	operation: DesignOperationName,
	parameters: unknown,
) => {
	const policy = getMcpPolicy(context.config);
	assertCanReadDesignFile(policy, designFileId);
	let params: Record<string, unknown>;
	try {
		params = validateDryRunOperationParameters(operation, parameters, {
			designFileId,
		});
	} catch (error) {
		if (
			error instanceof DesignTransformError &&
			error.code === "INVALID_OPERATION_PARAMETERS"
		) {
			throw new DesignTransformError(error.code, error.message, {
				...error.details,
				expectedParameters: OPERATION_PARAMETER_SIGNATURES[operation],
			});
		}
		throw error;
	}
	const read = await readDesignFileForTool(context, designFileId);

	if (read.revision !== expectedRevision) {
		return {
			status: "REVISION_MISMATCH",
			valid: false,
			project: getProjectReference(context),
			designFile: getDesignMetadata(designFileId, read),
			currentRevision: read.revision,
			expectedRevision,
			message:
				"The design file was modified since your last read. Re-read before applying or validating the operation.",
			suggestedReads: ["readDesignFile", "readDesignGraph"],
			issues: [
				{
					severity: "error",
					code: "REVISION_MISMATCH",
					message: "Expected revision does not match current revision.",
				},
			] satisfies ValidationIssue[],
		};
	}

	if (operation === "addSubtree") {
		const addSubtreeParameters = params as AddSubtreeOperationParameters;
		const validation = await validateSubtreePayload(context, {
			designFileId,
			expectedRevision,
			...addSubtreeParameters,
		});

		return {
			status: validation.status,
			valid: validation.valid,
			project: validation.project,
			designFile: validation.designFile,
			operation,
			predicted: {
				parentId: addSubtreeParameters.parentId,
				index: addSubtreeParameters.index,
				stats: validation.stats,
				...(validation.normalizedSubtree !== undefined
					? { normalizedSubtree: validation.normalizedSubtree }
					: {}),
				...(validation.recipeExpansions.length > 0
					? { recipeExpansions: validation.recipeExpansions }
					: {}),
			},
			issues: validation.diagnostics as ValidationIssue[],
			warnings: validation.warnings as ValidationIssue[],
			...(validation.tokenDiagnostics !== null
				? { tokenDiagnostics: validation.tokenDiagnostics }
				: {}),
			suggestedReads: validation.suggestedReads,
		};
	}

	if (operation === "copySubtree") {
		const copySubtreeParameters = params as CopySubtreeOperationParameters;
		const validation = await validateCopySubtreePayload(context, {
			...copySubtreeParameters,
			targetDesignFileId: designFileId,
			expectedRevision,
		});

		return {
			status: validation.status,
			valid: validation.valid,
			project: validation.project,
			designFile:
				validation.targetDesignFile ?? getDesignMetadata(designFileId, read),
			operation,
			predicted: {
				sourceDesignFileId: copySubtreeParameters.sourceDesignFileId,
				sourceElementId: copySubtreeParameters.sourceElementId,
				parentId: copySubtreeParameters.parentId,
				index: copySubtreeParameters.index,
				sameDesign: validation.sameDesign,
				stats: validation.stats,
			},
			issues: validation.diagnostics as ValidationIssue[],
			warnings: validation.warnings as ValidationIssue[],
			...(validation.tokenDiagnostics !== null
				? { tokenDiagnostics: validation.tokenDiagnostics }
				: {}),
			suggestedReads: validation.suggestedReads,
		};
	}

	assertOperationAllowedByPolicy(policy, read.design, operation, params);
	const result = await applyDryRunOperation(read.design, operation, params, {
		designFileId,
		projectRoot: context.projectRoot,
		sourceDesigns: new Map(),
	});
	if (operation === "addSystemComponent" && result.changedElementId) {
		const insertedRoot = findElementContext(
			result.design,
			result.changedElementId,
		);
		if (!insertedRoot) {
			throw new DesignTransformError(
				"INVALID_OPERATION",
				"Failed to validate inserted system component root after dry-run.",
			);
		}
		assertCanUseSubtreeComponents(policy, insertedRoot.element);
	}
	await assertResourceElementReferenceExists(
		context,
		result.design,
		result.changedElementId,
	);
	const diagnostics = await getDesignDiagnostics(context, result.design);
	const changedElement =
		result.changedElementId === undefined
			? null
			: getCompactElementSummary(result.design, result.changedElementId);
	const changedContext =
		result.changedElementId === undefined
			? null
			: getMutationContext(result.design, result.changedElementId);

	return {
		status: "success",
		valid: diagnostics.issues.every((issue) => issue.severity !== "error"),
		project: getProjectReference(context),
		designFile: getDesignMetadata(designFileId, read),
		operation,
		predicted: {
			...result.summary,
			changedElement,
			context: changedContext,
			deletedIds: result.deletedIds ?? [],
		},
		issues: diagnostics.issues,
		warnings: diagnostics.issues.filter(
			(issue) => issue.severity === "warning",
		),
		tokenDiagnostics: diagnostics.tokenSnapshot,
		suggestedReads: ["readDesignGraph", "readElement", "validateDesignFile"],
	};
};

const createOperationPlanHooks = (context: TrickroomMcpServerContext) => {
	const policy = getMcpPolicy(context.config);
	return createOperationPlanDependencies(context, policy, {
		readDesignFileForTool: (designFileId) =>
			readDesignFileForTool(context, designFileId),
		getProjectReference: () => getProjectReference(context),
		getDesignMetadata,
		getDesignDiagnostics: (design) => getDesignDiagnostics(context, design),
		assertResourceReferencesExist: (design) =>
			assertResourceReferencesExist(context, design),
		assertCanUseSubtreeComponents: (subtree) =>
			assertCanUseSubtreeComponents(policy, subtree),
		canonicalizeDesignForStorage: (design) =>
			canonicalizeDesignSystemReferenceForStorage(context, design),
	});
};

export const validateOperationPlanPayload = async (
	context: TrickroomMcpServerContext,
	input: z.infer<typeof operationPlanInputSchema>,
) => {
	const policy = getMcpPolicy(context.config);
	assertCanReadDesignFile(policy, input.designFileId);
	const { finalDesign: _finalDesign, ...result } =
		await executeOperationPlanDryRun(createOperationPlanHooks(context), input);
	return result;
};

export const applyDesignOperationsPayload = async (
	context: TrickroomMcpServerContext,
	input: z.infer<typeof operationPlanInputSchema>,
) => {
	const result = await applyOperationPlan(
		createOperationPlanHooks(context),
		input,
	);
	return {
		status: result.status,
		valid: result.valid,
		payload: compactApplyOperationPlanResult(result, input),
	};
};

type ValidateSubtreePayload = z.infer<typeof validateSubtreePayloadSchema>;
type ValidateCopySubtreePayload = Omit<
	z.infer<typeof validateCopySubtreePayloadSchema>,
	"sourceDesignFileId"
> & { sourceDesignFileId: string };

/** Same-file copies may omit sourceDesignFileId; default it to the target. */
export const normalizeCopySubtreePayload = (
	input: z.infer<typeof validateCopySubtreePayloadSchema>,
): ValidateCopySubtreePayload => ({
	...input,
	sourceDesignFileId: input.sourceDesignFileId ?? input.targetDesignFileId,
});

const createSubtreeDiagnosticFromTransformError = (
	error: DesignTransformError,
	path: string,
): SubtreeDiagnostic => ({
	severity: "error",
	code: error.code,
	message: error.message,
	path,
});

const createSubtreeDiagnosticFromDesignIssue = (
	issue: McpDesignIssue,
	index: number,
): SubtreeDiagnostic => ({
	severity: issue.severity,
	code: issue.code,
	message: issue.message,
	path: "/subtree",
	details: {
		source: "candidateDesign",
		index,
		issuePath: issue.path,
		...(issue.elementId !== undefined ? { elementId: issue.elementId } : {}),
	},
});

export const validateSubtreePayload = async (
	context: TrickroomMcpServerContext,
	input: ValidateSubtreePayload,
) => {
	const policy = getMcpPolicy(context.config);
	assertCanReadDesignFile(policy, input.designFileId);
	const read = await readDesignFileForTool(context, input.designFileId);

	if (read.revision !== input.expectedRevision) {
		return {
			status: "REVISION_MISMATCH",
			valid: false,
			project: getProjectReference(context),
			designFile: getDesignMetadata(input.designFileId, read),
			currentRevision: read.revision,
			expectedRevision: input.expectedRevision,
			diagnostics: [
				{
					severity: "error",
					code: "REVISION_MISMATCH",
					message: "Expected revision does not match current revision.",
					path: "/expectedRevision",
				},
			] satisfies SubtreeDiagnostic[],
			stats: { nodeCount: 0, maxDepth: 0, recipeCount: 0 },
			warnings: [] satisfies SubtreeDiagnostic[],
			suggestedReads: ["readDesignFile", "readDesignGraph"],
		};
	}

	const validation = validateProposedSubtreeForInsertion(read.design, {
		parentId: input.parentId,
		index: input.index,
		subtree: input.subtree,
		options: input.options,
	});
	const diagnostics = [...validation.diagnostics];
	let tokenDiagnostics: Awaited<
		ReturnType<typeof getDesignDiagnostics>
	>["tokenSnapshot"] = null;

	if (validation.candidateDesign && validation.candidateRootId) {
		const candidateRoot = findElementContext(
			validation.candidateDesign,
			validation.candidateRootId,
		);
		if (candidateRoot) {
			assertCanUseSubtreeComponents(policy, candidateRoot.element);
		}

		try {
			await assertResourceReferencesExist(context, validation.candidateDesign);
		} catch (error) {
			if (error instanceof DesignTransformError) {
				diagnostics.push(
					createSubtreeDiagnosticFromTransformError(error, "/subtree"),
				);
			} else {
				throw error;
			}
		}

		const candidateDiagnostics = await getDesignDiagnostics(
			context,
			validation.candidateDesign,
		);
		tokenDiagnostics = candidateDiagnostics.tokenSnapshot;
		diagnostics.push(
			...candidateDiagnostics.issues.map((issue, index) =>
				createSubtreeDiagnosticFromDesignIssue(issue, index),
			),
		);
	}

	const valid = diagnostics.every(
		(diagnostic) => diagnostic.severity !== "error",
	);

	return {
		status: "success",
		valid,
		project: getProjectReference(context),
		designFile: getDesignMetadata(input.designFileId, read),
		expectedRevision: input.expectedRevision,
		diagnostics,
		stats: validation.stats,
		...(validation.normalizedSubtree !== undefined
			? { normalizedSubtree: validation.normalizedSubtree }
			: {}),
		recipeExpansions: validation.recipeExpansions,
		warnings: diagnostics.filter(
			(diagnostic) => diagnostic.severity === "warning",
		),
		tokenDiagnostics,
		suggestedReads: ["readDesignGraph", "validateDesignFile"],
	};
};

const getSubtreeStats = (root: DesignNode) => {
	let nodeCount = 0;
	let maxDepth = 0;
	const visit = (node: DesignNode, depth: number) => {
		nodeCount += 1;
		maxDepth = Math.max(maxDepth, depth);
		if (typeof node.children === "string") {
			return;
		}
		for (const child of node.children) {
			visit(child, depth + 1);
		}
	};
	visit(root, 1);
	return { nodeCount, maxDepth };
};

const createCopySubtreeDiagnosticFromTransformError = (
	error: DesignTransformError,
	path: string,
): SubtreeDiagnostic => ({
	severity: "error",
	code: error.code,
	message: error.message,
	path,
});

export const validateCopySubtreePayload = async (
	context: TrickroomMcpServerContext,
	input: ValidateCopySubtreePayload,
) => {
	const policy = getMcpPolicy(context.config);
	const sameDesign = input.sourceDesignFileId === input.targetDesignFileId;
	assertCanReadDesignFile(policy, input.sourceDesignFileId);
	assertCanWriteDesignFile(policy, input.targetDesignFileId);

	if (!sameDesign && input.sourceExpectedRevision === undefined) {
		return {
			status: "success",
			valid: false,
			project: getProjectReference(context),
			sourceDesignFile: null,
			targetDesignFile: null,
			expectedRevision: input.expectedRevision,
			sourceExpectedRevision: null,
			diagnostics: [
				{
					severity: "error",
					code: "SOURCE_REVISION_REQUIRED",
					message:
						"sourceExpectedRevision is required for cross-file copySubtree validation.",
					path: "/sourceExpectedRevision",
				},
			] satisfies SubtreeDiagnostic[],
			stats: { nodeCount: 0, maxDepth: 0 },
			warnings: [] satisfies SubtreeDiagnostic[],
			suggestedReads: ["readDesignFile", "readDesignGraph"],
		};
	}

	const service = createDesignFileService(context.projectRoot);
	const targetFile = service.getFileForUuid(input.targetDesignFileId);
	const targetRead = await service.readDesignFile(targetFile);
	const sourceRead = sameDesign
		? targetRead
		: await service.readDesignFile(
				service.getFileForUuid(input.sourceDesignFileId),
			);

	if (targetRead.revision !== input.expectedRevision) {
		return {
			status: "REVISION_MISMATCH",
			valid: false,
			project: getProjectReference(context),
			sourceDesignFile: getDesignMetadata(input.sourceDesignFileId, sourceRead),
			targetDesignFile: getDesignMetadata(input.targetDesignFileId, targetRead),
			currentRevision: targetRead.revision,
			expectedRevision: input.expectedRevision,
			diagnostics: [
				{
					severity: "error",
					code: "REVISION_MISMATCH",
					message: "Expected target revision does not match current revision.",
					path: "/expectedRevision",
				},
			] satisfies SubtreeDiagnostic[],
			stats: { nodeCount: 0, maxDepth: 0 },
			warnings: [] satisfies SubtreeDiagnostic[],
			suggestedReads: ["readDesignFile", "readDesignGraph"],
		};
	}

	if (
		input.sourceExpectedRevision !== undefined &&
		sourceRead.revision !== input.sourceExpectedRevision
	) {
		return {
			status: "SOURCE_REVISION_MISMATCH",
			valid: false,
			project: getProjectReference(context),
			sourceDesignFile: getDesignMetadata(input.sourceDesignFileId, sourceRead),
			targetDesignFile: getDesignMetadata(input.targetDesignFileId, targetRead),
			currentSourceRevision: sourceRead.revision,
			sourceExpectedRevision: input.sourceExpectedRevision,
			expectedRevision: input.expectedRevision,
			diagnostics: [
				{
					severity: "error",
					code: "SOURCE_REVISION_MISMATCH",
					message: "Expected source revision does not match current revision.",
					path: "/sourceExpectedRevision",
				},
			] satisfies SubtreeDiagnostic[],
			stats: { nodeCount: 0, maxDepth: 0 },
			warnings: [] satisfies SubtreeDiagnostic[],
			suggestedReads: ["readDesignFile", "readDesignGraph"],
		};
	}

	const diagnostics: SubtreeDiagnostic[] = [];
	let stats = { nodeCount: 0, maxDepth: 0 };
	let result: Awaited<ReturnType<typeof applyCopySubtree>> | null = null;
	let tokenDiagnostics: Awaited<
		ReturnType<typeof getDesignDiagnostics>
	>["tokenSnapshot"] = null;

	try {
		normalizeDesignForMutation(sourceRead.design);
		const sourceElementContext = findElementContext(
			sourceRead.design,
			input.sourceElementId,
		);
		if (!sourceElementContext) {
			throw new DesignTransformError(
				"ELEMENT_NOT_FOUND",
				`Element "${input.sourceElementId}" not found.`,
			);
		}
		assertCanUseSubtreeComponents(policy, sourceElementContext.element);
		stats = getSubtreeStats(sourceElementContext.element);
		if (
			input.options?.maxNodes !== undefined &&
			stats.nodeCount > input.options.maxNodes
		) {
			throw new DesignTransformError(
				"SUBTREE_TOO_LARGE",
				`Source subtree has ${stats.nodeCount} nodes, exceeding maxNodes ${input.options.maxNodes}.`,
			);
		}
		if (
			input.options?.maxDepth !== undefined &&
			stats.maxDepth > input.options.maxDepth
		) {
			throw new DesignTransformError(
				"SUBTREE_TOO_DEEP",
				`Source subtree depth ${stats.maxDepth} exceeds maxDepth ${input.options.maxDepth}.`,
			);
		}

		result = await applyCopySubtree(sourceRead.design, targetRead.design, {
			sourceElementId: input.sourceElementId,
			parentId: input.parentId,
			index: input.index,
			sameDesign,
			projectRoot: context.projectRoot,
		});
		await assertResourceReferencesExist(context, result.design);
		const candidateDiagnostics = await getDesignDiagnostics(
			context,
			result.design,
		);
		tokenDiagnostics = candidateDiagnostics.tokenSnapshot;
		diagnostics.push(
			...candidateDiagnostics.issues.map((issue, index) =>
				createSubtreeDiagnosticFromDesignIssue(issue, index),
			),
		);
	} catch (error) {
		if (error instanceof DesignTransformError) {
			diagnostics.push(
				createCopySubtreeDiagnosticFromTransformError(error, "/copySubtree"),
			);
		} else {
			throw error;
		}
	}

	const valid = diagnostics.every(
		(diagnostic) => diagnostic.severity !== "error",
	);

	return {
		status: "success",
		valid,
		project: getProjectReference(context),
		sourceDesignFile: getDesignMetadata(input.sourceDesignFileId, sourceRead),
		targetDesignFile: getDesignMetadata(input.targetDesignFileId, targetRead),
		sourceElementId: input.sourceElementId,
		expectedRevision: input.expectedRevision,
		sourceExpectedRevision: input.sourceExpectedRevision ?? null,
		sameDesign,
		diagnostics,
		stats,
		warnings: diagnostics.filter(
			(diagnostic) => diagnostic.severity === "warning",
		),
		tokenDiagnostics,
		suggestedReads: ["readDesignGraph", "validateDesignFile"],
	};
};
