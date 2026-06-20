import { z } from "zod";
import { isJsonPrimitive, resolveRegistryRecipe } from "../libraries/registry";
import { findRecipeControlTargetElement } from "../recipes/controls";
import {
	applyAddElement,
	applyAddRecipe,
	applyAddSubtree,
	applyAddSystemComponent,
	applyCopySubtree,
	applyDeleteElement,
	applyDetachRecipeInstance,
	applyDetachSystemComponent,
	applyUpdateSystemComponentInstance,
	applyMoveElement,
	applyUpdateElementProps,
	applyUpdateElementText,
	applyUpdateRecipeControl,
	applyUpdateRecipeInstance,
	DesignTransformError,
	normalizeDesignForMutation,
	type ProposedSubtreeNode,
} from "../services/design-transform-service";
import type {
	Node as DesignNode,
	JsonPrimitive,
	RecipeDefinition,
	RecipeTemplateNode,
	TrickroomDesign,
} from "../types";
import { getSystemComponentStructuralMetadata } from "../utils/system-component-markers";
import {
	assertCanUseComponent,
	getComponentRef,
	getComponentRef as getGovernanceComponentRef,
	type McpPolicy,
} from "./governance";
import {
	addSubtreeOptionsSchema,
	proposedSubtreeNodeSchema,
	validateCopySubtreeOptionsSchema,
} from "./subtree-schemas";

export const designOperationNameSchema = z.enum([
	"renameDesignFile",
	"addElement",
	"addRecipe",
	"addSystemComponent",
	"updateSystemComponentInstance",
	"detachSystemComponent",
	"addSubtree",
	"updateRecipeControl",
	"updateRecipeInstance",
	"updateElementProps",
	"updateElementText",
	"moveElement",
	"deleteElement",
	"copySubtree",
	"detachRecipeInstance",
]);

export type DesignOperationName = z.infer<typeof designOperationNameSchema>;

export type DryRunResult = {
	operation: DesignOperationName;
	design: TrickroomDesign;
	changedElementId?: string;
	deletedIds?: string[];
	insertedElementIds?: string[];
	recipeExpansions?: unknown[];
	summary: Record<string, unknown>;
};

export type DryRunOperationContext = {
	designFileId: string;
	projectRoot: string;
	sourceDesigns: ReadonlyMap<string, TrickroomDesign>;
};

type ElementContext = {
	element: DesignNode;
	parent: DesignNode | null;
};

const jsonPrimitiveSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
]);

const addRecipeOperationParametersSchema = z.object({
	parentId: z.string().min(1).nullable(),
	index: z.number().int().min(0),
	library: z.string().min(1),
	recipe: z.string().min(1),
});

const addSystemComponentOperationParametersSchema = z.object({
	parentId: z.string().min(1).nullable(),
	index: z.number().int().min(0),
	systemId: z.string().min(1),
	componentId: z.string().min(1),
	version: z.string().min(1).nullable().optional(),
	variantValues: z.record(z.string(), z.string()).optional(),
	overrides: z
		.record(
			z.string(),
			z.object({
				className: z.string().optional(),
			}),
		)
		.optional(),
});

const detachRecipeInstanceOperationParametersSchema = z.object({
	elementId: z.string().min(1),
});

const updateSystemComponentInstanceOperationParametersSchema = z.object({
	rootElementId: z
		.string()
		.min(1)
		.describe("Attached system component root element ID."),
	variantValues: z
		.record(z.string(), z.string())
		.optional()
		.describe("Variant axis values to merge into the instance."),
	overrides: z
		.record(
			z.string(),
			z.object({
				className: z.string().optional(),
			}),
		)
		.optional()
		.describe(
			"Override classNames keyed by declared override target id. Replaces the full override map when provided.",
		),
});

const detachSystemComponentOperationParametersSchema = z.object({
	elementId: z
		.string()
		.min(1)
		.describe(
			"Any element ID inside the attached system component instance to detach.",
		),
});

const updateRecipeInstanceOperationParametersSchema = z.object({
	elementId: z.string().min(1),
});

const updateRecipeControlOperationParametersSchema = z.object({
	instanceId: z.string().min(1),
	path: z.string().min(1),
	prop: z.string().min(1),
	value: jsonPrimitiveSchema,
});

const addSubtreeOperationParametersSchema = z.object({
	parentId: z.string().min(1).nullable(),
	index: z.number().int().min(0),
	subtree: proposedSubtreeNodeSchema,
	options: addSubtreeOptionsSchema.optional(),
});

const copySubtreeOperationParametersSchema = z.object({
	sourceDesignFileId: z.string().uuid(),
	sourceElementId: z.string().min(1),
	sourceExpectedRevision: z.string().startsWith("sha256:").optional(),
	parentId: z.string().min(1).nullable(),
	index: z.number().int().min(0),
	options: validateCopySubtreeOptionsSchema.optional(),
});

type PropUpdateParameter = {
	name: string;
	value: JsonPrimitive;
};

const findElementContext = (
	design: TrickroomDesign,
	elementId: string,
): ElementContext | null => {
	const visit = (
		node: DesignNode,
		parent: DesignNode | null,
	): ElementContext | null => {
		if (node.id === elementId) {
			return { element: node, parent };
		}

		if (typeof node.children === "string") {
			return null;
		}

		for (const child of node.children) {
			const found = visit(child, node);
			if (found) {
				return found;
			}
		}

		return null;
	};

	for (const root of design.boards) {
		const found = visit(root, null);
		if (found) {
			return found;
		}
	}

	return null;
};

const getOperationParameters = (parameters: unknown) => {
	if (
		typeof parameters !== "object" ||
		parameters === null ||
		Array.isArray(parameters)
	) {
		return {};
	}

	return parameters as Record<string, unknown>;
};

const getOperationSchemaMessage = (
	operation: DesignOperationName,
	issue: z.ZodIssue,
) => {
	const parameterPath =
		issue.path.length === 0 ? "parameters" : issue.path.join(".");
	return `Operation "${operation}" parameter "${parameterPath}" is invalid: ${issue.message}`;
};

const parseOperationParameters = <Schema extends z.ZodTypeAny>(
	operation: DesignOperationName,
	schema: Schema,
	params: Record<string, unknown>,
): z.infer<Schema> => {
	const result = schema.safeParse(params);
	if (!result.success) {
		const issue = result.error.issues[0];
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			issue
				? getOperationSchemaMessage(operation, issue)
				: `Operation "${operation}" parameters are invalid.`,
		);
	}

	return result.data;
};

export const validateDryRunOperationParameters = (
	operation: DesignOperationName,
	parameters: unknown,
): Record<string, unknown> => {
	const params = getOperationParameters(parameters);

	if (operation === "addRecipe") {
		return parseOperationParameters(
			operation,
			addRecipeOperationParametersSchema,
			params,
		);
	}

	if (operation === "addSubtree") {
		return parseOperationParameters(
			operation,
			addSubtreeOperationParametersSchema,
			params,
		);
	}

	if (operation === "addSystemComponent") {
		return parseOperationParameters(
			operation,
			addSystemComponentOperationParametersSchema,
			params,
		);
	}

	if (operation === "updateSystemComponentInstance") {
		return parseOperationParameters(
			operation,
			updateSystemComponentInstanceOperationParametersSchema,
			params,
		);
	}

	if (operation === "detachSystemComponent") {
		return parseOperationParameters(
			operation,
			detachSystemComponentOperationParametersSchema,
			params,
		);
	}

	if (operation === "copySubtree") {
		return parseOperationParameters(
			operation,
			copySubtreeOperationParametersSchema,
			params,
		);
	}

	if (operation === "detachRecipeInstance") {
		return parseOperationParameters(
			operation,
			detachRecipeInstanceOperationParametersSchema,
			params,
		);
	}

	if (operation === "updateRecipeInstance") {
		return parseOperationParameters(
			operation,
			updateRecipeInstanceOperationParametersSchema,
			params,
		);
	}

	if (operation === "updateRecipeControl") {
		return parseOperationParameters(
			operation,
			updateRecipeControlOperationParametersSchema,
			params,
		);
	}

	return params;
};

const requireStringParameter = (
	params: Record<string, unknown>,
	name: string,
) => {
	const value = params[name];
	if (typeof value !== "string") {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			`Operation parameter "${name}" must be a string.`,
		);
	}

	return value;
};

const optionalStringParameter = (
	params: Record<string, unknown>,
	name: string,
) => {
	const value = params[name];
	if (value === undefined) return undefined;
	if (typeof value !== "string") {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			`Operation parameter "${name}" must be a string when provided.`,
		);
	}

	return value;
};

const requireNumberParameter = (
	params: Record<string, unknown>,
	name: string,
) => {
	const value = params[name];
	if (typeof value !== "number" || !Number.isInteger(value)) {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			`Operation parameter "${name}" must be an integer.`,
		);
	}

	return value;
};

const requireNullableStringParameter = (
	params: Record<string, unknown>,
	name: string,
) => {
	const value = params[name];
	if (value === null) return null;
	if (typeof value !== "string") {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			`Operation parameter "${name}" must be a string or null.`,
		);
	}

	return value;
};

const optionalPropsParameter = (params: Record<string, unknown>) => {
	const value = params.props;
	if (value === undefined) return undefined;
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		!Object.values(value).every(isJsonPrimitive)
	) {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			'Operation parameter "props" must be an object with JSON primitive values.',
		);
	}

	return value as Record<string, JsonPrimitive>;
};

const optionalPropUpdatesParameter = (params: Record<string, unknown>) => {
	const value = params.propUpdates;
	if (value === undefined) return undefined;
	if (
		!Array.isArray(value) ||
		!value.every(
			(update) =>
				typeof update === "object" &&
				update !== null &&
				!Array.isArray(update) &&
				typeof (update as { name?: unknown }).name === "string" &&
				isJsonPrimitive((update as { value?: unknown }).value),
		)
	) {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			'Operation parameter "propUpdates" must be an array of { name, value } objects with JSON primitive values.',
		);
	}

	return value as PropUpdateParameter[];
};

export const normalizeUpdateElementPropsParameters = (params: {
	name?: string;
	className?: string;
	props?: Record<string, JsonPrimitive>;
	propUpdates?: PropUpdateParameter[];
}) => {
	const normalized: {
		name?: string;
		className?: string;
		props?: Record<string, JsonPrimitive>;
	} = {};
	const props: Record<string, JsonPrimitive> = {};

	for (const update of params.propUpdates ?? []) {
		if (update.name === "name") {
			if (typeof update.value !== "string") {
				throw new DesignTransformError(
					"INVALID_OPERATION_PARAMETERS",
					'Prop update "name" must be a string.',
				);
			}
			normalized.name = update.value;
			continue;
		}

		if (update.name === "className") {
			if (typeof update.value !== "string") {
				throw new DesignTransformError(
					"INVALID_OPERATION_PARAMETERS",
					'Prop update "className" must be a string.',
				);
			}
			normalized.className = update.value;
			continue;
		}

		props[update.name] = update.value;
	}

	if (params.props) {
		Object.assign(props, params.props);
	}
	if (params.name !== undefined) normalized.name = params.name;
	if (params.className !== undefined) normalized.className = params.className;
	if (Object.keys(props).length > 0) normalized.props = props;

	if (
		normalized.name === undefined &&
		normalized.className === undefined &&
		normalized.props === undefined
	) {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			'At least one of "name", "className", "props", or "propUpdates" must contain an update.',
		);
	}

	return normalized;
};

export const getElementComponentReference = (
	design: TrickroomDesign,
	elementId: string,
	errorCode: "ELEMENT_NOT_FOUND" | "PARENT_NOT_FOUND" = "ELEMENT_NOT_FOUND",
) => {
	const elementContext = findElementContext(design, elementId);
	if (!elementContext) {
		throw new DesignTransformError(
			errorCode,
			errorCode === "PARENT_NOT_FOUND"
				? `Target parent element "${elementId}" not found.`
				: `Element "${elementId}" not found.`,
		);
	}
	return {
		library: elementContext.element.props["data-trickroom-library"],
		component: elementContext.element.props["data-trickroom-component"],
	};
};

const getRecipeTemplateNodes = (
	template: RecipeTemplateNode,
): RecipeTemplateNode[] => [
	template,
	...(template.children ?? []).flatMap((child) =>
		getRecipeTemplateNodes(child),
	),
];

const assertCanUseRecipe = (policy: McpPolicy, recipe: RecipeDefinition) => {
	for (const template of getRecipeTemplateNodes(recipe.root)) {
		assertCanUseComponent(policy, template.library, template.component);
	}
};

const walkDesignTree = (
	nodes: readonly DesignNode[],
	visit: (node: DesignNode) => void,
) => {
	for (const node of nodes) {
		visit(node);
		if (Array.isArray(node.children)) {
			walkDesignTree(node.children, visit);
		}
	}
};

const walkElementSubtree = (
	node: DesignNode,
	visit: (node: DesignNode) => void,
) => {
	visit(node);
	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			walkElementSubtree(child, visit);
		}
	}
};

const findSystemComponentInstanceRoot = (
	design: TrickroomDesign,
	instanceId: string,
): DesignNode | null => {
	let instanceRoot: DesignNode | null = null;
	walkDesignTree(design.boards, (node) => {
		if (instanceRoot) {
			return;
		}
		const metadata = getSystemComponentStructuralMetadata(node.props);
		if (metadata?.instanceId === instanceId && metadata.isRoot) {
			instanceRoot = node;
		}
	});
	return instanceRoot;
};

export const assertCanUseSystemComponentInstanceSubtree = (
	policy: McpPolicy,
	design: TrickroomDesign,
	anchorElementId: string,
) => {
	const anchor = findElementContext(design, anchorElementId);
	if (!anchor) {
		throw new DesignTransformError(
			"ELEMENT_NOT_FOUND",
			`Element "${anchorElementId}" not found.`,
		);
	}

	const anchorMetadata = getSystemComponentStructuralMetadata(anchor.element.props);
	if (!anchorMetadata) {
		throw new DesignTransformError(
			"SYSTEM_COMPONENT_INSTANCE_NOT_FOUND",
			`Element "${anchorElementId}" is not part of an attached system component instance.`,
		);
	}

	const instanceRoot = findSystemComponentInstanceRoot(
		design,
		anchorMetadata.instanceId,
	);
	if (!instanceRoot) {
		throw new DesignTransformError(
			"SYSTEM_COMPONENT_INSTANCE_NOT_FOUND",
			`System component instance "${anchorMetadata.instanceId}" was not found.`,
		);
	}

	walkElementSubtree(instanceRoot, (node) => {
		const library = node.props["data-trickroom-library"];
		const component = node.props["data-trickroom-component"];
		if (typeof library !== "string" || typeof component !== "string") {
			return;
		}

		assertCanUseComponent(policy, library, component);
	});
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

export const assertOperationAllowedByPolicy = (
	policy: McpPolicy,
	design: TrickroomDesign,
	operation: DesignOperationName,
	params: Record<string, unknown>,
) => {
	if (operation === "addElement") {
		assertCanUseComponent(
			policy,
			requireStringParameter(params, "library"),
			requireStringParameter(params, "component"),
		);
		return;
	}

	if (operation === "addRecipe") {
		const library = requireStringParameter(params, "library");
		const recipe = requireStringParameter(params, "recipe");
		const resolution = resolveRegistryRecipe(library, recipe);
		if (resolution.status === "unknown-library") {
			throw new DesignTransformError(
				"UNKNOWN_REGISTRY_LIBRARY",
				`Unknown registry library "${library}".`,
			);
		}
		if (resolution.status === "unknown-recipe") {
			throw new DesignTransformError(
				"UNKNOWN_REGISTRY_RECIPE",
				`Unknown recipe "${recipe}" in registry "${library}".`,
			);
		}
		assertCanUseRecipe(policy, resolution.definition);
		return;
	}

	if (
		operation === "addSubtree" ||
		operation === "addSystemComponent" ||
		operation === "copySubtree" ||
		operation === "renameDesignFile"
	) {
		return;
	}

	if (operation === "updateSystemComponentInstance") {
		assertCanUseSystemComponentInstanceSubtree(
			policy,
			design,
			requireStringParameter(params, "rootElementId"),
		);
		return;
	}

	if (operation === "detachSystemComponent") {
		assertCanUseSystemComponentInstanceSubtree(
			policy,
			design,
			requireStringParameter(params, "elementId"),
		);
		return;
	}

	if (operation === "updateRecipeControl") {
		const instanceId = requireStringParameter(params, "instanceId");
		const path = requireStringParameter(params, "path");
		const target = findRecipeControlTargetElement(
			normalizeDesignForMutation(design).entitiesById,
			instanceId,
			path,
		);
		if (target === null) {
			throw new DesignTransformError(
				"RECIPE_INSTANCE_NOT_FOUND",
				`Recipe instance "${instanceId}" does not contain path "${path}".`,
			);
		}

		const controlTarget = getElementComponentReference(design, target.id);
		assertCanUseComponent(
			policy,
			controlTarget.library,
			controlTarget.component,
		);
		return;
	}

	const elementId = requireStringParameter(params, "elementId");
	const target = getElementComponentReference(design, elementId);
	assertCanUseComponent(policy, target.library, target.component);

	if (operation === "moveElement" && params.targetParentId !== null) {
		const targetParentId = requireNullableStringParameter(
			params,
			"targetParentId",
		);
		if (targetParentId !== null) {
			const parent = getElementComponentReference(
				design,
				targetParentId,
				"PARENT_NOT_FOUND",
			);
			assertCanUseComponent(policy, parent.library, parent.component);
		}
	}
};

export const applyDryRunOperation = async (
	design: TrickroomDesign,
	operation: DesignOperationName,
	params: Record<string, unknown>,
	context?: DryRunOperationContext,
): Promise<DryRunResult> => {
	switch (operation) {
		case "renameDesignFile": {
			const name = requireStringParameter(params, "name");
			return {
				operation,
				design: { ...design, name },
				summary: { name },
			};
		}
		case "addElement": {
			const parentId = requireNullableStringParameter(params, "parentId");
			const index = requireNumberParameter(params, "index");
			const library = requireStringParameter(params, "library");
			const component = requireStringParameter(params, "component");
			const result = applyAddElement(design, {
				parentId,
				index,
				library,
				component,
				name: optionalStringParameter(params, "name"),
				className: optionalStringParameter(params, "className"),
				text: optionalStringParameter(params, "text"),
				props: optionalPropsParameter(params),
			});
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				insertedElementIds: [result.changedElementId],
				summary: {
					parentId,
					index,
					componentRef: getComponentRef(library, component),
				},
			};
		}
		case "addRecipe": {
			const parentId = requireNullableStringParameter(params, "parentId");
			const index = requireNumberParameter(params, "index");
			const library = requireStringParameter(params, "library");
			const recipe = requireStringParameter(params, "recipe");
			const result = applyAddRecipe(design, {
				parentId,
				index,
				library,
				recipe,
			});
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				insertedElementIds: Object.values(result.elementIdsByPath),
				summary: {
					parentId,
					index,
					recipe: {
						id: result.recipeId,
						instanceId: result.instanceId,
						elementIdsByPath: result.elementIdsByPath,
					},
				},
			};
		}
		case "addSystemComponent": {
			if (!context) {
				throw new DesignTransformError(
					"INVALID_OPERATION_PARAMETERS",
					'Operation "addSystemComponent" requires dry-run context with project root.',
				);
			}
			const parentId = requireNullableStringParameter(params, "parentId");
			const index = requireNumberParameter(params, "index");
			const systemId = requireStringParameter(params, "systemId");
			const componentId = requireStringParameter(params, "componentId");
			const result = await applyAddSystemComponent(design, {
				projectRoot: context.projectRoot,
				parentId,
				index,
				systemId,
				componentId,
				version:
					params.version === null
						? null
						: optionalStringParameter(params, "version"),
				variantValues: params.variantValues as
					| Record<string, string>
					| undefined,
				overrides: params.overrides as
					| Record<string, { className?: string }>
					| undefined,
			});
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				insertedElementIds: Object.values(result.elementIdsByPath),
				summary: {
					parentId,
					index,
					systemComponent: {
						systemId: result.systemId,
						componentId: result.componentId,
						version: result.version,
						instanceId: result.instanceId,
						elementIdsByPath: result.elementIdsByPath,
						variantValues: result.variantValues,
						overrides: result.overrides,
					},
				},
			};
		}
		case "updateSystemComponentInstance": {
			if (!context) {
				throw new DesignTransformError(
					"INVALID_OPERATION_PARAMETERS",
					'Operation "updateSystemComponentInstance" requires dry-run context with project root.',
				);
			}
			const rootElementId = requireStringParameter(params, "rootElementId");
			const result = await applyUpdateSystemComponentInstance(design, {
				projectRoot: context.projectRoot,
				rootElementId,
				variantValues: params.variantValues as
					| Record<string, string>
					| undefined,
				overrides: params.overrides as
					| Record<string, { className?: string }>
					| undefined,
			});
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				summary: {
					rootElementId: result.rootElementId,
					systemComponent: {
						systemId: result.systemId,
						componentId: result.componentId,
						version: result.version,
						instanceId: result.instanceId,
					},
					changedElementIds: result.changedElementIds,
					variantValues: result.variantValues,
					overrides: result.overrides,
				},
			};
		}
		case "detachSystemComponent": {
			if (!context) {
				throw new DesignTransformError(
					"INVALID_OPERATION_PARAMETERS",
					'Operation "detachSystemComponent" requires dry-run context with project root.',
				);
			}
			const elementId = requireStringParameter(params, "elementId");
			const result = await applyDetachSystemComponent(design, {
				projectRoot: context.projectRoot,
				elementId,
			});
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				summary: {
					elementId,
					systemComponent: {
						systemId: result.systemId,
						componentId: result.componentId,
						instanceId: result.instanceId,
						rootElementId: result.rootElementId,
					},
					detachedElementIds: result.detachedElementIds,
				},
			};
		}
		case "addSubtree": {
			const parentId = requireNullableStringParameter(params, "parentId");
			const index = requireNumberParameter(params, "index");
			const subtree = params.subtree as ProposedSubtreeNode;
			const options = params.options as
				| z.infer<typeof addSubtreeOptionsSchema>
				| undefined;
			const result = applyAddSubtree(design, {
				parentId,
				index,
				subtree,
				options,
			});
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				insertedElementIds: result.inserted.elementIds,
				recipeExpansions: result.recipeExpansions,
				summary: {
					parentId,
					index,
					rootElementId: result.rootElementId,
					stats: {
						nodeCount: result.inserted.nodeCount,
					},
				},
			};
		}
		case "copySubtree": {
			if (!context) {
				throw new DesignTransformError(
					"INVALID_OPERATION_PARAMETERS",
					'Operation "copySubtree" requires dry-run context with source designs.',
				);
			}
			const sourceDesignFileId = requireStringParameter(
				params,
				"sourceDesignFileId",
			);
			const sameDesign = sourceDesignFileId === context.designFileId;
			const sourceDesign = sameDesign
				? design
				: context.sourceDesigns.get(sourceDesignFileId);
			if (!sourceDesign) {
				throw new DesignTransformError(
					"DESIGN_NOT_FOUND",
					`Source design "${sourceDesignFileId}" was not loaded for copySubtree.`,
				);
			}
			const sourceElementId = requireStringParameter(params, "sourceElementId");
			const parentId = requireNullableStringParameter(params, "parentId");
			const index = requireNumberParameter(params, "index");
			const options = params.options as
				| z.infer<typeof validateCopySubtreeOptionsSchema>
				| undefined;
			const sourceElementContext = findElementContext(
				sourceDesign,
				sourceElementId,
			);
			if (!sourceElementContext) {
				throw new DesignTransformError(
					"ELEMENT_NOT_FOUND",
					`Element "${sourceElementId}" not found.`,
				);
			}
			const stats = getSubtreeStats(sourceElementContext.element);
			if (
				options?.maxNodes !== undefined &&
				stats.nodeCount > options.maxNodes
			) {
				throw new DesignTransformError(
					"SUBTREE_TOO_LARGE",
					`Source subtree has ${stats.nodeCount} nodes, exceeding maxNodes ${options.maxNodes}.`,
				);
			}
			if (
				options?.maxDepth !== undefined &&
				stats.maxDepth > options.maxDepth
			) {
				throw new DesignTransformError(
					"SUBTREE_TOO_DEEP",
					`Source subtree depth ${stats.maxDepth} exceeds maxDepth ${options.maxDepth}.`,
				);
			}
			const result = await applyCopySubtree(sourceDesign, design, {
				sourceElementId,
				parentId,
				index,
				sameDesign,
				projectRoot: context.projectRoot,
			});
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				insertedElementIds: result.inserted.elementIds,
				summary: {
					sourceDesignFileId,
					sourceElementId,
					parentId,
					index,
					sameDesign,
					rootElementId: result.rootElementId,
					stats,
				},
			};
		}
		case "updateElementProps": {
			const normalizedProps = normalizeUpdateElementPropsParameters({
				name: optionalStringParameter(params, "name"),
				className: optionalStringParameter(params, "className"),
				props: optionalPropsParameter(params),
				propUpdates: optionalPropUpdatesParameter(params),
			});
			const result = applyUpdateElementProps(design, {
				elementId: requireStringParameter(params, "elementId"),
				...normalizedProps,
			});
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				summary: {
					elementId: params.elementId,
					updatedProps: {
						...(normalizedProps.name !== undefined
							? { name: normalizedProps.name }
							: {}),
						...(normalizedProps.className !== undefined
							? { className: normalizedProps.className }
							: {}),
						...(normalizedProps.props !== undefined
							? { props: normalizedProps.props }
							: {}),
					},
				},
			};
		}
		case "updateRecipeControl": {
			const instanceId = requireStringParameter(params, "instanceId");
			const path = requireStringParameter(params, "path");
			const prop = requireStringParameter(params, "prop");
			const value = params.value;
			if (!isJsonPrimitive(value)) {
				throw new DesignTransformError(
					"INVALID_OPERATION_PARAMETERS",
					'Parameter "value" must be a JSON primitive.',
				);
			}
			const result = applyUpdateRecipeControl(design, {
				instanceId,
				path,
				prop,
				value,
			});
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				summary: {
					instanceId,
					path,
					prop,
					value,
				},
			};
		}
		case "updateRecipeInstance": {
			const elementId = requireStringParameter(params, "elementId");
			const result = applyUpdateRecipeInstance(design, { elementId });
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				summary: {
					elementId,
					recipeMigration: result.recipeMigration,
				},
			};
		}
		case "updateElementText": {
			const result = applyUpdateElementText(design, {
				elementId: requireStringParameter(params, "elementId"),
				text: requireStringParameter(params, "text"),
			});
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				summary: {
					elementId: params.elementId,
					textLength: String(params.text).length,
				},
			};
		}
		case "moveElement": {
			const result = applyMoveElement(design, {
				elementId: requireStringParameter(params, "elementId"),
				targetParentId: requireNullableStringParameter(
					params,
					"targetParentId",
				),
				index: requireNumberParameter(params, "index"),
			});
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				summary: {
					elementId: params.elementId,
					targetParentId: params.targetParentId,
					index: params.index,
				},
			};
		}
		case "deleteElement": {
			const result = applyDeleteElement(design, {
				elementId: requireStringParameter(params, "elementId"),
			});
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				deletedIds: result.deletedIds,
				summary: {
					elementId: params.elementId,
					deletedCount: result.deletedIds.length,
				},
			};
		}
		case "detachRecipeInstance": {
			const elementId = requireStringParameter(params, "elementId");
			const result = applyDetachRecipeInstance(design, { elementId });
			return {
				operation,
				design: result.design,
				changedElementId: result.changedElementId,
				summary: {
					elementId,
					recipe: {
						id: result.recipeId,
						instanceId: result.instanceId,
						rootElementId: result.rootElementId,
					},
					detachedElementIds: result.detachedElementIds,
				},
			};
		}
	}
};

export const getCopySubtreeComponentRefs = (
	sourceDesign: TrickroomDesign,
	sourceElementId: string,
) => {
	const refs = new Set<string>();
	const sourceElementContext = findElementContext(
		sourceDesign,
		sourceElementId,
	);
	if (!sourceElementContext) {
		return refs;
	}

	const walk = (node: DesignNode) => {
		refs.add(
			getGovernanceComponentRef(
				node.props["data-trickroom-library"],
				node.props["data-trickroom-component"],
			),
		);
		if (typeof node.children !== "string") {
			for (const child of node.children) {
				walk(child);
			}
		}
	};

	walk(sourceElementContext.element);
	return refs;
};
