import {
	availableRegistries,
	getControlDefinitions,
	getControlProps,
	getDefaultProps,
	getRegistry,
	getComponentIds as getRegistryComponentIds,
	isRegistryId,
	type RegistryId,
	resolveRegistryComponent,
	resolveRegistryRecipe,
} from "../../libraries/registry";
import {
	describeUnknownRegistryComponent,
	describeUnknownRegistryLibrary,
	describeUnknownRegistryRecipe,
} from "../../libraries/registry-suggestions";
import { RECIPE_MARKER_PROP_KEYS } from "../../recipes/markers";
import { describeRecipeSlotChildRef } from "../../recipes/slot-allowlist";
import { DesignTransformError } from "../../services/design-transform-service";
import type {
	RecipeDefinition,
	RecipeTemplateNode,
	RegistryComponentDefinition,
	Role,
} from "../../types";
import {
	assertCanUseComponent,
	isComponentAllowed,
	type McpPolicy,
} from "../governance";

export const getRegistryIds = () =>
	[...availableRegistries].sort() as RegistryId[];

export const getRegistryOrThrow = (library: string) => {
	if (!isRegistryId(library)) {
		const unknown = describeUnknownRegistryLibrary(library);
		throw new DesignTransformError(
			"UNKNOWN_REGISTRY_LIBRARY",
			unknown.message,
			unknown.details,
		);
	}

	return getRegistry(library);
};

export const throwUnknownRegistryComponent = (
	library: string,
	component: string,
): never => {
	const unknown = describeUnknownRegistryComponent(library, component);
	throw new DesignTransformError(
		"UNKNOWN_REGISTRY_COMPONENT",
		unknown.message,
		unknown.details,
	);
};

export const getComponentIds = (library: RegistryId) =>
	getRegistryComponentIds(library);

export const getAllowedChildrenMetadata = (role: Role) => {
	if (role === "text") {
		return {
			kind: "none",
			serializedChildren: "string",
			reason:
				"Text role elements store text in children and cannot contain child elements.",
		};
	}

	if (role === "leaf") {
		return {
			kind: "none",
			serializedChildren: "empty-array",
			reason:
				"Leaf role elements terminate the tree and cannot contain authored child elements or text.",
		};
	}

	return {
		kind: "nodes",
		serializedChildren: "array",
		reason: "Branch role elements can contain child element nodes.",
	};
};

const getDefaultMetadata = (
	library: RegistryId,
	component: string,
	role: Role,
	definition: RegistryComponentDefinition,
) => {
	return {
		...(definition.baseClassName === undefined
			? {}
			: { baseClassName: definition.baseClassName }),
		props: getDefaultProps(library, component, definition),
		controlProps: getControlProps(definition),
		children: role === "text" ? "Text" : [],
	};
};

/** Compact list entry: identity, role, child kind and control names. */
export const summarizeComponent = (library: RegistryId, component: string) => {
	const registry = getRegistryOrThrow(library);
	if (!Object.hasOwn(registry, component)) {
		throwUnknownRegistryComponent(library, component);
	}

	const definition = registry[component as keyof typeof registry];
	const controls = getControlDefinitions(definition)
		.filter((control) => control.visibility !== "hidden")
		.map((control) => control.prop);
	return {
		library,
		component,
		label: definition.label,
		role: definition.role,
		allowedChildren: { kind: getAllowedChildrenMetadata(definition.role).kind },
		...(controls.length > 0 ? { controls } : {}),
	};
};

export const describeComponent = (library: RegistryId, component: string) => {
	const registry = getRegistryOrThrow(library);
	if (!Object.hasOwn(registry, component)) {
		throwUnknownRegistryComponent(library, component);
	}

	const definition = registry[component as keyof typeof registry];
	const role = definition.role;
	const controls = getControlDefinitions(definition);
	const describedControls = controls.map((control) => ({
		...control,
		visibility: control.visibility ?? null,
		deprecationReason: control.deprecationReason ?? null,
	}));
	const controlProps = controls.map((control) => ({
		name: control.prop,
		label: control.label,
		type: control.valueType,
		input: control.input,
		required: false,
		source: "registry-control",
		description: control.description ?? null,
		defaultValue: control.defaultValue ?? null,
		options: control.options ?? null,
		visibility: control.visibility ?? null,
		deprecationReason: control.deprecationReason ?? null,
	}));

	return {
		library,
		component,
		label: definition.label,
		role,
		builtIn: true,
		readOnly: true,
		description: definition.description ?? null,
		allowedChildren: getAllowedChildrenMetadata(role),
		controls: describedControls,
		defaults: getDefaultMetadata(library, component, role, definition),
		writableInstanceProps: [
			{
				name: "className",
				type: "string",
				required: false,
				description: "Tailwind class string applied to this element instance.",
			},
			{
				name: "data-trickroom-name",
				modelFacingName: "name",
				type: "string",
				required: true,
				description:
					"Human-readable layer name. Mutation tools expose this as name.",
			},
			...controlProps,
		],
		fixedSystemProps: [
			{
				name: "data-trickroom-library",
				type: "string",
				fixedValue: library,
			},
			{
				name: "data-trickroom-component",
				type: "string",
				fixedValue: component,
			},
			{
				name: "data-trickroom-role",
				type: "string",
				fixedValue: role,
			},
		],
		content:
			role === "text"
				? {
						kind: "text",
						storage: "children",
						updateTool: "updateElementText",
					}
				: role === "leaf"
					? {
							kind: "none",
							storage: "children",
							serializedChildren: [],
						}
					: {
							kind: "children",
							storage: "children",
						},
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

const getRecipeTemplateSlotName = (
	recipe: RecipeDefinition,
	template: RecipeTemplateNode,
) =>
	template.slot ??
	Object.values(recipe.slots ?? {}).find(
		(slot) => slot.hostPath === template.path,
	)?.name ??
	null;

export const describeRecipeComponentRef = ({
	library,
	component,
}: {
	library: string;
	component: string;
}) => ({
	library,
	component,
	ref: `${library}/${component}`,
});

const describeRecipeSlots = (recipe: RecipeDefinition) =>
	Object.values(recipe.slots ?? {})
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((slot) => ({
			name: slot.name,
			label: slot.label,
			description: slot.description ?? null,
			hostPath: slot.hostPath,
			allowedChildren: slot.allowedChildren
				? slot.allowedChildren.map(describeRecipeSlotChildRef)
				: {
						kind: "any-valid-node",
						reason:
							"No slot-specific component allowlist is declared for this recipe.",
					},
			defaultChildren: slot.defaultChildren
				? slot.defaultChildren.map((defaultChild) => ({
						path: defaultChild.path,
						library: defaultChild.library,
						component: defaultChild.component,
					}))
				: null,
			history: slot.history ?? null,
		}));

export const describeRecipeControls = (recipe: RecipeDefinition) =>
	Object.entries(recipe.controls ?? {})
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, control]) => ({
			name,
			label: control.label,
			description: control.description ?? null,
			path: control.path,
			prop: control.prop,
			input: control.input,
			valueType: control.valueType,
			options: control.options ?? null,
			defaultValue: control.defaultValue ?? null,
			visibility: control.visibility ?? null,
			deprecationReason: control.deprecationReason ?? null,
		}));

const describeRecipeTemplateHistory = (recipe: RecipeDefinition) =>
	(recipe.previousTemplates ?? []).map((entry) => ({
		version: entry.version,
		description: entry.description ?? null,
		root: {
			path: entry.root.path,
			library: entry.root.library,
			component: entry.root.component,
			componentRef: `${entry.root.library}/${entry.root.component}`,
		},
		structure: {
			nodeCount: getRecipeTemplateNodes(entry.root).length,
			paths: getRecipeTemplateNodes(entry.root).map((node) => node.path),
		},
		slots: Object.values(entry.slots ?? {})
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((slot) => ({
				name: slot.name,
				hostPath: slot.hostPath,
			})),
		controls: Object.keys(entry.controls ?? {}).sort(),
	}));

const getRecipeTemplateDefaults = (
	template: RecipeTemplateNode,
	definition: RegistryComponentDefinition,
) => {
	const role = definition.role;
	const name = template.name ?? definition.label;
	const props = {
		...getDefaultProps(
			template.library as RegistryId,
			template.component,
			definition,
			name,
		),
		...(template.props ?? {}),
		...(template.className !== undefined
			? { className: template.className }
			: {}),
		"data-trickroom-name": name,
		"data-trickroom-library": template.library,
		"data-trickroom-component": template.component,
		"data-trickroom-role": role,
	};

	return {
		props,
		content:
			role === "text"
				? {
						kind: "text",
						children: template.text ?? "Text",
					}
				: role === "leaf"
					? {
							kind: "none",
							children: [],
						}
					: {
							kind: "children",
							childPaths: (template.children ?? []).map((child) => child.path),
						},
	};
};

const describeRecipeTemplateNode = (
	recipe: RecipeDefinition,
	template: RecipeTemplateNode,
): Record<string, unknown> => {
	const resolution = resolveRegistryComponent(
		template.library,
		template.component,
	);
	if (resolution.status !== "known") {
		return {
			path: template.path,
			library: template.library,
			component: template.component,
			componentRef: `${template.library}/${template.component}`,
			status: resolution.status,
		};
	}

	const slotName = getRecipeTemplateSlotName(recipe, template);

	return {
		path: template.path,
		library: resolution.library,
		component: resolution.component,
		componentRef: `${resolution.library}/${resolution.component}`,
		label: resolution.definition.label,
		role: resolution.definition.role,
		slot: slotName,
		defaults: getRecipeTemplateDefaults(template, resolution.definition),
		contract: {
			structuralNode: true,
			lockedByRecipe: true,
			slotHost: slotName !== null,
			authoredChildrenAllowed: slotName !== null,
		},
		children: (template.children ?? []).map((child) =>
			describeRecipeTemplateNode(recipe, child),
		),
	};
};

export const summarizeRecipe = (
	library: RegistryId,
	recipe: RecipeDefinition,
) => {
	const nodes = getRecipeTemplateNodes(recipe.root);

	return {
		library,
		recipe: recipe.id,
		label: recipe.label,
		description: recipe.description ?? null,
		version: recipe.version,
		root: describeRecipeComponentRef(recipe.root),
		structure: {
			nodeCount: nodes.length,
			paths: nodes.map((node) => node.path),
		},
		slots: describeRecipeSlots(recipe).map((slot) => ({
			name: slot.name,
			label: slot.label,
			hostPath: slot.hostPath,
		})),
	};
};

export const getRecipeOrThrow = (library: string, recipe: string) => {
	const resolution = resolveRegistryRecipe(library, recipe);
	if (resolution.status !== "known") {
		const unknown =
			resolution.status === "unknown-library"
				? describeUnknownRegistryLibrary(library)
				: describeUnknownRegistryRecipe(library, recipe);
		throw new DesignTransformError(
			resolution.status === "unknown-library"
				? "UNKNOWN_REGISTRY_LIBRARY"
				: "UNKNOWN_REGISTRY_RECIPE",
			unknown.message,
			unknown.details,
		);
	}

	return resolution;
};

export const isRecipeAllowed = (policy: McpPolicy, recipe: RecipeDefinition) =>
	getRecipeTemplateNodes(recipe.root).every((template) =>
		isComponentAllowed(policy, template.library, template.component),
	);

export const assertCanUseRecipe = (
	policy: McpPolicy,
	recipe: RecipeDefinition,
) => {
	for (const template of getRecipeTemplateNodes(recipe.root)) {
		assertCanUseComponent(policy, template.library, template.component);
	}
};

export const describeRecipe = (
	library: RegistryId,
	recipe: RecipeDefinition,
) => {
	const localRecipe = recipe.id.startsWith(`${library}/`)
		? recipe.id.slice(library.length + 1)
		: recipe.id;

	return {
		library,
		recipe: recipe.id,
		localRecipe,
		aliases: [...new Set([recipe.id, localRecipe])],
		label: recipe.label,
		description: recipe.description ?? null,
		version: recipe.version,
		builtIn: true,
		readOnly: true,
		previousTemplates: describeRecipeTemplateHistory(recipe),
		slots: describeRecipeSlots(recipe),
		controls: describeRecipeControls(recipe),
		structure: {
			nodeCount: getRecipeTemplateNodes(recipe.root).length,
			root: describeRecipeTemplateNode(recipe, recipe.root),
		},
		markerGuidance: {
			systemOwned: true,
			markerProps: [...RECIPE_MARKER_PROP_KEYS],
			defaultsOmitMarkers:
				"Recipe marker props are applied by recipe expansion and are intentionally omitted from node defaults.",
			mutationRules: [
				"Do not pass recipe marker props to generic element mutation tools.",
				"Do not manually create recipe instances by copying marker props.",
				"Treat recipe root and structural nodes as locked by the recipe contract; authored content belongs in declared slots.",
			],
			writableSurface: {
				slots: Object.keys(recipe.slots ?? {}).sort(),
				controls: Object.keys(recipe.controls ?? {}).sort(),
			},
		},
	};
};
