import { z } from "zod";
import { isJsonPrimitive, resolveRegistryRecipe } from "../libraries/registry";
import {
	describeUnknownRegistryLibrary,
	describeUnknownRegistryRecipe,
} from "../libraries/registry-suggestions";
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
	applyMoveElement,
	applyUpdateElementProps,
	applyUpdateElementText,
	applyUpdateRecipeControl,
	applyUpdateRecipeInstance,
	applyUpdateSystemComponentInstance,
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
import {
	getSystemComponentStructuralMetadata,
	type SystemComponentInstanceOverrides,
} from "../utils/system-component-markers";
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
import { systemComponentInstanceOverridesSchema } from "./system-component-schemas";
import {
	designFileIdSchema,
	expectedRevisionSchema,
	jsonPrimitiveSchema,
} from "./tools/schemas";

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

export const SUBTREE_NODE_SIGNATURE =
	'{ tempId?, library, component, name?, className?, text?, props?: { [prop]: primitive }, children?: Node[] } | { kind: "recipe", tempId?, library, recipe }';

/** One batch operation parameter, for generated documentation. */
export type DesignOperationParameter = {
	name: string;
	/** TypeScript-like type; `Node` is SUBTREE_NODE_SIGNATURE. */
	type: string;
	required: boolean;
	description: string;
	example: unknown;
};

const parentIdParameter: DesignOperationParameter = {
	name: "parentId",
	type: "string | null",
	required: true,
	description:
		"Parent element id, or null to insert at the design root as a board. targetParentId is accepted as an alias.",
	example: "board-id",
};

const indexParameter: DesignOperationParameter = {
	name: "index",
	type: "int",
	required: true,
	description: "Position among the parent's children, 0..childCount.",
	example: 0,
};

const elementIdParameter = (
	description: string,
	example = "element-id",
): DesignOperationParameter => ({
	name: "elementId",
	type: "string",
	required: true,
	description,
	example,
});

const variantValuesParameter = (
	description: string,
): DesignOperationParameter => ({
	name: "variantValues",
	type: "{ [axis]: string }",
	required: false,
	description,
	example: { size: "sm" },
});

const unsetVariantAxesParameter = (
	description: string,
): DesignOperationParameter => ({
	name: "unsetVariantAxes",
	type: "string[]",
	required: false,
	description,
	example: ["tone"],
});

const overridesParameter = (description: string): DesignOperationParameter => ({
	name: "overrides",
	type: "{ [overrideTargetId]: { className?, text?, props? } }",
	required: false,
	description,
	example: { label: { text: "Save" } },
});

const propsParameter = (description: string): DesignOperationParameter => ({
	name: "props",
	type: "{ [prop]: primitive }",
	required: false,
	description,
	example: { orientation: "vertical" },
});

/**
 * Machine-readable parameters of every batch operation (primitive = string |
 * number | boolean | null). The single source for the operations catalogue in
 * the batch tool schemas, the expectedParameters on parameter errors, and the
 * authoring guide's operations topic. A test keeps it in step with
 * OPERATION_PARAMETER_SHAPES, which validates the parameters.
 */
export const DESIGN_OPERATION_PARAMETERS: Record<
	DesignOperationName,
	readonly DesignOperationParameter[]
> = {
	renameDesignFile: [
		{
			name: "name",
			type: "string",
			required: true,
			description: "New design name. The file id does not change.",
			example: "Checkout flow",
		},
	],
	addElement: [
		parentIdParameter,
		indexParameter,
		{
			name: "library",
			type: "string",
			required: true,
			description: "Registry library id.",
			example: "trickroom",
		},
		{
			name: "component",
			type: "string",
			required: true,
			description: "Registry component id.",
			example: "text",
		},
		{
			name: "name",
			type: "string",
			required: false,
			description: "Layer name. Defaults to the component label.",
			example: "Caption",
		},
		{
			name: "className",
			type: "string",
			required: false,
			description: "Tailwind class string.",
			example: "text-sm text-slate-700",
		},
		{
			name: "text",
			type: "string",
			required: false,
			description: "Initial text of a text-role element.",
			example: "Hello",
		},
		propsParameter("Registry control props."),
	],
	addRecipe: [
		parentIdParameter,
		indexParameter,
		{
			name: "library",
			type: "string",
			required: true,
			description: "Registry library id.",
			example: "base-ui",
		},
		{
			name: "recipe",
			type: "string",
			required: true,
			description: "Registry recipe id; the step reports its slot host ids.",
			example: "dialog.default",
		},
	],
	addSystemComponent: [
		parentIdParameter,
		indexParameter,
		{
			name: "systemId",
			type: "string",
			required: true,
			description: "Design system id from the component manifest.",
			example: "sys_…",
		},
		{
			name: "componentId",
			type: "string",
			required: true,
			description: "Published system component id.",
			example: "cmp_…",
		},
		{
			name: "version",
			type: "string | null",
			required: false,
			description: "Published version. Omit or null for the current version.",
			example: null,
		},
		variantValuesParameter("Initial variant axis values."),
		unsetVariantAxesParameter(
			"Axes to clear before schema defaults are resolved.",
		),
		overridesParameter(
			"Initial overrides keyed by declared override target id.",
		),
	],
	updateSystemComponentInstance: [
		{
			name: "rootElementId",
			type: "string",
			required: true,
			description: "Root element id of the attached system component instance.",
			example: "instance-root-id",
		},
		variantValuesParameter(
			"Axis values to merge; other axes keep their value.",
		),
		unsetVariantAxesParameter("Axes to clear."),
		overridesParameter("Replaces the whole override map."),
	],
	detachSystemComponent: [
		elementIdParameter(
			"Any element in the attached system component instance.",
			"instance-root-id",
		),
	],
	addSubtree: [
		parentIdParameter,
		indexParameter,
		{
			name: "subtree",
			type: "Node",
			required: true,
			description:
				"Element tree to insert; a tempId names a node for $step:N:tempId:<tempId> references. Recipe nodes take no children.",
			example: {
				tempId: "card",
				library: "trickroom",
				component: "container",
				className: "flex flex-col gap-2 p-4",
				children: [
					{
						tempId: "title",
						library: "trickroom",
						component: "text",
						text: "Title",
					},
				],
			},
		},
		{
			name: "options",
			type: "{ maxNodes?: int, maxDepth?: int, allowRecipes?: boolean }",
			required: false,
			description: "Size limits and recipe gate for the inserted tree.",
			example: { maxNodes: 50 },
		},
	],
	updateRecipeControl: [
		{
			name: "instanceId",
			type: "string",
			required: true,
			description: "Attached recipe instance id.",
			example: "recipe-instance-id",
		},
		{
			name: "path",
			type: "string",
			required: true,
			description: "Declared recipe template path of the control target.",
			example: "root",
		},
		{
			name: "prop",
			type: "string",
			required: true,
			description: "Declared recipe control prop.",
			example: "defaultOpen",
		},
		{
			name: "value",
			type: "primitive",
			required: true,
			description: "New control value.",
			example: false,
		},
	],
	updateRecipeInstance: [
		elementIdParameter("Any element in the stale attached recipe instance."),
	],
	updateElementProps: [
		elementIdParameter("Element to update."),
		{
			name: "name",
			type: "string",
			required: false,
			description: "New layer name.",
			example: "Header",
		},
		{
			name: "className",
			type: "string",
			required: false,
			description: 'Replaces the whole class string; "" clears it.',
			example: "flex items-center gap-4 p-4",
		},
		propsParameter("Registry control props to set."),
		{
			name: "propUpdates",
			type: "{ name: string, value: primitive }[]",
			required: false,
			description: "Legacy list form of name, className and props.",
			example: [{ name: "className", value: "p-2" }],
		},
	],
	updateElementText: [
		elementIdParameter("Text-role element to update.", "text-element-id"),
		{
			name: "text",
			type: "string",
			required: true,
			description: "New text content.",
			example: "Welcome back",
		},
	],
	moveElement: [
		elementIdParameter("Element to move."),
		{
			name: "targetParentId",
			type: "string | null",
			required: true,
			description:
				"New parent element id, or null to move to the design root. parentId is accepted as an alias.",
			example: "new-parent-id",
		},
		indexParameter,
	],
	deleteElement: [
		elementIdParameter("Element to delete with its descendants."),
	],
	copySubtree: [
		{
			name: "sourceElementId",
			type: "string",
			required: true,
			description: "Root element id of the subtree to copy.",
			example: "card-id",
		},
		parentIdParameter,
		indexParameter,
		{
			name: "sourceDesignFileId",
			type: "string",
			required: false,
			description: "Source design file UUID. Defaults to this design.",
			example: "00000000-0000-4000-8000-000000000000",
		},
		{
			name: "sourceExpectedRevision",
			type: "string",
			required: false,
			description: "Source design revision; required for cross-design copies.",
			example: "sha256:…",
		},
		{
			name: "options",
			type: "{ maxNodes?: int, maxDepth?: int }",
			required: false,
			description: "Size limits for the copied subtree.",
			example: { maxNodes: 200 },
		},
	],
	detachRecipeInstance: [
		elementIdParameter("Any element in the attached recipe instance."),
	],
};

const formatParameterSignature = (
	parameters: readonly DesignOperationParameter[],
) => {
	const fields = parameters
		.map(
			(parameter) =>
				`${parameter.name}${parameter.required ? "" : "?"}: ${parameter.type}`,
		)
		.join(", ");
	return parameters.some((parameter) => parameter.type === "Node")
		? `{ ${fields} } where Node = ${SUBTREE_NODE_SIGNATURE}`
		: `{ ${fields} }`;
};

/**
 * Compact parameter signature per batch operation, generated from
 * DESIGN_OPERATION_PARAMETERS. Attached to INVALID_OPERATION_PARAMETERS errors
 * so a model can see what is valid without another tool call. `?` marks
 * optional parameters.
 */
export const OPERATION_PARAMETER_SIGNATURES = Object.fromEntries(
	Object.entries(DESIGN_OPERATION_PARAMETERS).map(([operation, parameters]) => [
		operation,
		formatParameterSignature(parameters),
	]),
) as Record<DesignOperationName, string>;

/**
 * One line per operation: its name and required parameters, with "…" when it
 * also takes optional ones. Full parameters live in the authoring guide.
 */
export const describeOperationCatalogue = () =>
	Object.entries(DESIGN_OPERATION_PARAMETERS)
		.map(([operation, parameters]) => {
			const required = parameters
				.filter((parameter) => parameter.required)
				.map((parameter) => parameter.name);
			const hasOptional = parameters.some((parameter) => !parameter.required);
			return `${operation}(${[...required, ...(hasOptional ? ["…"] : [])].join(", ")})`;
		})
		.join("\n");

/** @deprecated Use describeOperationCatalogue or OPERATION_PARAMETER_SIGNATURES. */
export const describeOperationParameterSignatures = () =>
	Object.entries(OPERATION_PARAMETER_SIGNATURES)
		.map(([operation, signature]) => `${operation} ${signature}`)
		.join("; ");

export type DryRunResult = {
	operation: DesignOperationName;
	design: TrickroomDesign;
	changedElementId?: string;
	deletedIds?: string[];
	insertedElementIds?: string[];
	recipeExpansions?: unknown[];
	/** Generated ids keyed by addSubtree tempId, or by source id for copySubtree. */
	idMap?: Record<string, string>;
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

const parentIdSchema = z
	.string()
	.min(1)
	.nullable()
	.describe("Parent element ID, or null to insert at the design root.");

const indexSchema = z
	.number()
	.int()
	.min(0)
	.describe("Position among the parent's children, 0..childCount.");

const elementIdSchema = (description: string) =>
	z.string().min(1).describe(description);

const primitivePropsSchema = z.record(z.string(), jsonPrimitiveSchema);

/**
 * Zod parameter shape per operation: validates batch steps, and the
 * single-element tools spread the same shapes into their input schemas so
 * both paths accept the same parameters. Field names match
 * DESIGN_OPERATION_PARAMETERS (a test checks this).
 */
export const OPERATION_PARAMETER_SHAPES = {
	renameDesignFile: {
		name: z.string().min(1).describe("New design file name."),
	},
	addElement: {
		parentId: parentIdSchema,
		index: indexSchema,
		library: z
			.string()
			.min(1)
			.describe("Registry library id, e.g. 'trickroom'."),
		component: z
			.string()
			.min(1)
			.describe("Registry component id, e.g. 'container' or 'text'."),
		name: z.string().min(1).optional().describe("Layer name."),
		className: z.string().optional().describe("Tailwind class string."),
		text: z
			.string()
			.optional()
			.describe("Initial text for text-role elements. Defaults to 'Text'."),
		props: primitivePropsSchema
			.optional()
			.describe("Registry control props; other keys are rejected."),
	},
	addRecipe: {
		parentId: parentIdSchema,
		index: indexSchema,
		library: z.string().min(1).describe("Registry library id, e.g. 'base-ui'."),
		recipe: z
			.string()
			.min(1)
			.describe("Registry recipe id, e.g. 'dialog.default'."),
	},
	addSystemComponent: {
		parentId: parentIdSchema,
		index: indexSchema,
		systemId: z
			.string()
			.min(1)
			.describe("Design system id from the component manifest."),
		componentId: z.string().min(1).describe("Published system component id."),
		version: z
			.string()
			.min(1)
			.nullable()
			.optional()
			.describe("Published version. Omit or null for the current version."),
		variantValues: z
			.record(z.string(), z.string())
			.optional()
			.describe("Initial variant axis values."),
		unsetVariantAxes: z
			.array(z.string())
			.optional()
			.describe("Variant axes to clear before schema defaults are resolved."),
		overrides: systemComponentInstanceOverridesSchema
			.optional()
			.describe("Initial overrides keyed by declared override target id."),
	},
	updateSystemComponentInstance: {
		rootElementId: elementIdSchema(
			"Attached system component root element ID.",
		),
		variantValues: z
			.record(z.string(), z.string())
			.optional()
			.describe("Variant axis values to merge; other axes keep their value."),
		unsetVariantAxes: z
			.array(z.string())
			.optional()
			.describe("Variant axes to clear."),
		overrides: systemComponentInstanceOverridesSchema
			.optional()
			.describe("Replaces the whole override map."),
	},
	detachSystemComponent: {
		elementId: elementIdSchema(
			"Any element ID in the attached system component instance.",
		),
	},
	addSubtree: {
		parentId: parentIdSchema,
		index: indexSchema,
		subtree: proposedSubtreeNodeSchema,
		options: addSubtreeOptionsSchema.optional(),
	},
	updateRecipeControl: {
		instanceId: elementIdSchema("Attached recipe instance ID."),
		path: z
			.string()
			.min(1)
			.describe("Declared recipe template path of the control target."),
		prop: z.string().min(1).describe("Declared recipe control prop."),
		value: jsonPrimitiveSchema.describe("New control value."),
	},
	updateRecipeInstance: {
		elementId: elementIdSchema(
			"Any element ID in the stale attached recipe instance.",
		),
	},
	updateElementProps: {
		elementId: elementIdSchema("Element ID to update."),
		name: z.string().min(1).optional().describe("New layer name."),
		className: z
			.string()
			.optional()
			.describe('Replaces the whole class string; "" clears it.'),
		props: primitivePropsSchema
			.optional()
			.describe("Registry control props to set."),
		propUpdates: z
			.array(z.object({ name: z.string().min(1), value: jsonPrimitiveSchema }))
			.optional()
			.describe("Legacy list form of name, className and props."),
	},
	updateElementText: {
		elementId: elementIdSchema("Text-role element ID to update."),
		text: z.string().describe("New text content."),
	},
	moveElement: {
		elementId: elementIdSchema("Element ID to move."),
		targetParentId: z
			.string()
			.min(1)
			.nullable()
			.describe("New parent element ID, or null to move to the design root."),
		index: indexSchema,
	},
	deleteElement: {
		elementId: elementIdSchema("Element ID to delete with its descendants."),
	},
	copySubtree: {
		sourceDesignFileId: designFileIdSchema.describe(
			"Source design file UUID. Defaults to this design.",
		),
		sourceElementId: elementIdSchema("Root element ID of the subtree to copy."),
		sourceExpectedRevision: expectedRevisionSchema
			.optional()
			.describe("Source design revision; required for cross-design copies."),
		parentId: parentIdSchema,
		index: indexSchema,
		options: validateCopySubtreeOptionsSchema.optional(),
	},
	detachRecipeInstance: {
		elementId: elementIdSchema(
			"Any element ID in the attached recipe instance.",
		),
	},
} satisfies Record<DesignOperationName, z.ZodRawShape>;

const OPERATION_PARAMETER_SCHEMAS = Object.fromEntries(
	Object.entries(OPERATION_PARAMETER_SHAPES).map(([operation, shape]) => [
		operation,
		z.object(shape),
	]),
) as {
	[Operation in DesignOperationName]: z.ZodObject<
		(typeof OPERATION_PARAMETER_SHAPES)[Operation]
	>;
};

export type DesignOperationParameters<Operation extends DesignOperationName> =
	z.infer<(typeof OPERATION_PARAMETER_SCHEMAS)[Operation]>;

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

const getValueAtPath = (value: unknown, path: readonly PropertyKey[]) =>
	path.reduce<unknown>(
		(current, key) =>
			typeof current === "object" && current !== null
				? (current as Record<PropertyKey, unknown>)[key]
				: undefined,
		value,
	);

/**
 * Validate step parameters against the operation's shape. Reports every
 * invalid parameter in one error, and names unknown parameters, so a model
 * can fix the step in one go.
 */
const parseOperationParameters = <Operation extends DesignOperationName>(
	operation: Operation,
	params: Record<string, unknown>,
): DesignOperationParameters<Operation> => {
	const schema = OPERATION_PARAMETER_SCHEMAS[operation];
	const result = schema.safeParse(params);
	if (result.success) {
		return result.data as DesignOperationParameters<Operation>;
	}

	const problems = result.error.issues.map((issue) => {
		const parameterPath =
			issue.path.length === 0 ? "parameters" : issue.path.join(".");
		return getValueAtPath(params, issue.path) === undefined &&
			issue.path.length > 0
			? `"${parameterPath}" is required`
			: `"${parameterPath}" is invalid: ${issue.message}`;
	});
	const unknownParameters = Object.keys(params).filter(
		(key) => !Object.hasOwn(schema.shape, key),
	);
	throw new DesignTransformError(
		"INVALID_OPERATION_PARAMETERS",
		`Operation "${operation}" parameters are invalid: ${problems.join("; ")}.${
			unknownParameters.length > 0
				? ` Unknown parameters: ${unknownParameters.join(", ")}.`
				: ""
		}`,
		unknownParameters.length > 0 ? { unknownParameters } : {},
	);
};

const INSERT_OPERATIONS = new Set<DesignOperationName>([
	"addElement",
	"addRecipe",
	"addSystemComponent",
	"addSubtree",
	"copySubtree",
]);

/**
 * Accept the parameter names agents mix up between operations: insertions
 * take `parentId`, moveElement takes `targetParentId`; either spelling works
 * for both. Same-file copySubtree may omit sourceDesignFileId (it defaults to
 * the design being edited). The canonical key wins when both are present.
 */
export const normalizeOperationParameterAliases = (
	operation: DesignOperationName,
	params: Record<string, unknown>,
	defaults: { designFileId?: string } = {},
): Record<string, unknown> => {
	const normalized = { ...params };
	if (INSERT_OPERATIONS.has(operation)) {
		if (
			normalized.parentId === undefined &&
			normalized.targetParentId !== undefined
		) {
			normalized.parentId = normalized.targetParentId;
		}
		delete normalized.targetParentId;
	}
	if (operation === "moveElement") {
		if (
			normalized.targetParentId === undefined &&
			normalized.parentId !== undefined
		) {
			normalized.targetParentId = normalized.parentId;
		}
		delete normalized.parentId;
	}
	if (operation === "copySubtree") {
		if (
			normalized.sourceDesignFileId === undefined &&
			defaults.designFileId !== undefined
		) {
			normalized.sourceDesignFileId = defaults.designFileId;
		}
		delete normalized.targetDesignFileId;
	}
	return normalized;
};

export const validateDryRunOperationParameters = (
	operation: DesignOperationName,
	parameters: unknown,
	defaults: { designFileId?: string } = {},
): Record<string, unknown> =>
	parseOperationParameters(
		operation,
		normalizeOperationParameterAliases(
			operation,
			getOperationParameters(parameters),
			defaults,
		),
	);

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

	const anchorMetadata = getSystemComponentStructuralMetadata(
		anchor.element.props,
	);
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
			const unknown = describeUnknownRegistryLibrary(library);
			throw new DesignTransformError(
				"UNKNOWN_REGISTRY_LIBRARY",
				unknown.message,
				unknown.details,
			);
		}
		if (resolution.status === "unknown-recipe") {
			const unknown = describeUnknownRegistryRecipe(library, recipe);
			throw new DesignTransformError(
				"UNKNOWN_REGISTRY_RECIPE",
				unknown.message,
				unknown.details,
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
				unsetVariantAxes: params.unsetVariantAxes as string[] | undefined,
				overrides: params.overrides as
					| SystemComponentInstanceOverrides
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
				unsetVariantAxes: params.unsetVariantAxes as string[] | undefined,
				overrides: params.overrides as
					| SystemComponentInstanceOverrides
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
				idMap: result.idMap,
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
				idMap: result.idMap,
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
