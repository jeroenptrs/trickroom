import {
	getControlDefinitions,
	getRegistryRecipes,
	type RegistryId,
	resolveRegistryComponent,
} from "../../libraries/registry";
import { describeRecipeSlotChildRef } from "../../recipes/slot-allowlist";
import type {
	ControlDefinition,
	RecipeDefinition,
	RecipeTemplateNode,
} from "../../types";
import { suggestClosest } from "../../utils/suggestions";
import { isComponentAllowed, type McpPolicy } from "../governance";
import {
	getComponentIds,
	getRegistryIds,
	getRegistryOrThrow,
	isRecipeAllowed,
} from "../payloads/registry";

export type RegistryFilter = { library?: string; name?: string };

/** Above this many matches a filtered topic lists ids instead of details. */
const MAX_DETAILED_MATCHES = 40;

const localRecipeId = (recipe: RecipeDefinition) =>
	recipe.id.slice(recipe.id.indexOf("/") + 1);

/**
 * Match ids by family first ("dialog" matches dialog and dialog.*, not
 * alert-dialog.*), then fall back to a substring match.
 */
const filterByName = <T>(
	items: readonly T[],
	getId: (item: T) => string,
	name: string | undefined,
) => {
	if (name === undefined) {
		return [...items];
	}
	const needle = name.trim().toLowerCase();
	const family = items.filter((item) => {
		const id = getId(item).toLowerCase();
		return id === needle || id.startsWith(`${needle}.`);
	});
	return family.length > 0
		? family
		: items.filter((item) => getId(item).toLowerCase().includes(needle));
};

const selectLibraries = (library: string | undefined): RegistryId[] => {
	if (library === undefined) {
		return getRegistryIds();
	}
	getRegistryOrThrow(library);
	return [library as RegistryId];
};

const describeControl = (control: ControlDefinition & { path?: string }) => ({
	prop: control.prop,
	...(control.path === undefined ? {} : { path: control.path }),
	type: control.valueType,
	...(control.options
		? { options: control.options.map((option) => option.value) }
		: {}),
	...(control.defaultValue === undefined
		? {}
		: { default: control.defaultValue }),
	...(control.visibility === "deprecated" ? { deprecated: true } : {}),
	...(control.description ? { description: control.description } : {}),
});

const describeRegistryElement = (library: RegistryId, component: string) => {
	const registry = getRegistryOrThrow(library);
	const definition = registry[component as keyof typeof registry];
	const controls = getControlDefinitions(definition).filter(
		(control) => control.visibility !== "hidden",
	);
	return {
		component: `${library}/${component}`,
		label: definition.label,
		role: definition.role,
		...(definition.description ? { description: definition.description } : {}),
		...(definition.baseClassName
			? { baseClassName: definition.baseClassName }
			: {}),
		...(controls.length > 0 ? { controls: controls.map(describeControl) } : {}),
	};
};

const getRegistryRole = (library: string, component: string) => {
	const resolution = resolveRegistryComponent(library, component);
	return resolution.status === "known" ? resolution.definition.role : null;
};

const familyCounts = (components: readonly string[]) => {
	const families: Record<string, number> = {};
	for (const component of components) {
		const family = component.split(".")[0];
		families[family] = (families[family] ?? 0) + 1;
	}
	return families;
};

export const buildRegistryTopic = (
	policy: McpPolicy,
	filter: RegistryFilter,
) => {
	const allowedByLibrary = selectLibraries(filter.library).map((library) => ({
		library,
		components: getComponentIds(library).filter((component) =>
			isComponentAllowed(policy, library, component),
		),
	}));
	const roles = {
		branch: "holds child elements",
		text: "holds a string, set with text (insert) or updateElementText",
		leaf: "holds nothing",
	};
	const writableProps =
		"className, name (stored as data-trickroom-name) and the declared controls below. data-trickroom-library, -component and -role are owned by Trickroom.";

	if (filter.name === undefined && filter.library === undefined) {
		return {
			roles,
			writableProps,
			libraries: allowedByLibrary.map(({ library, components }) =>
				components.length <= 8
					? {
							library,
							elements: components.map((component) =>
								describeRegistryElement(library, component),
							),
						}
					: {
							library,
							elementCount: components.length,
							families: familyCounts(components),
						},
			),
			note: "base-ui elements are the headless parts recipes are built from. Prefer the recipe (recipes topic); place raw parts only to compose something no recipe covers.",
			filter:
				'Pass library and/or name (a family such as "select", or a full id such as "select.trigger") for element roles, controls and defaults.',
		};
	}

	const matches = allowedByLibrary.flatMap(({ library, components }) =>
		filterByName(components, (component) => component, filter.name).map(
			(component) => ({ library, component }),
		),
	);
	if (matches.length === 0) {
		const all = allowedByLibrary.flatMap(({ components }) => components);
		return {
			matches: 0,
			suggestions: suggestClosest(filter.name ?? "", all, { limit: 5 }),
		};
	}
	if (matches.length > MAX_DETAILED_MATCHES) {
		return {
			roles,
			matches: matches.length,
			elements: matches.map(
				({ library, component }) =>
					`${library}/${component} (${getRegistryRole(library, component)})`,
			),
			note: `More than ${MAX_DETAILED_MATCHES} matches: pass a narrower name for controls and defaults.`,
		};
	}
	return {
		roles,
		writableProps,
		elements: matches.map(({ library, component }) =>
			describeRegistryElement(library, component),
		),
	};
};

type CompactTemplateNode = {
	path: string;
	component: string;
	slot?: string;
	className?: string;
	props?: Record<string, unknown>;
	text?: string;
	children?: CompactTemplateNode[];
};

const compactTemplate = (
	recipe: RecipeDefinition,
	node: RecipeTemplateNode,
): CompactTemplateNode => {
	const slot =
		node.slot ??
		Object.values(recipe.slots ?? {}).find(
			(candidate) => candidate.hostPath === node.path,
		)?.name;
	const props = Object.fromEntries(
		Object.entries(node.props ?? {}).filter(
			([key, value]) => value !== undefined && !key.startsWith("data-"),
		),
	);
	return {
		path: node.path,
		component: `${node.library}/${node.component}`,
		...(slot ? { slot } : {}),
		...(node.className ? { className: node.className } : {}),
		...(Object.keys(props).length > 0 ? { props } : {}),
		...(node.text === undefined ? {} : { text: node.text }),
		...(node.children && node.children.length > 0
			? {
					children: node.children.map((child) =>
						compactTemplate(recipe, child),
					),
				}
			: {}),
	};
};

const describeRecipeForGuide = (recipe: RecipeDefinition) => ({
	recipe: recipe.id,
	label: recipe.label,
	...(recipe.description ? { description: recipe.description } : {}),
	template: compactTemplate(recipe, recipe.root),
	slots: Object.values(recipe.slots ?? {})
		.sort((left, right) => left.name.localeCompare(right.name))
		.map((slot) => ({
			name: slot.name,
			hostPath: slot.hostPath,
			...(slot.description ? { description: slot.description } : {}),
			allowedChildren: slot.allowedChildren
				? slot.allowedChildren.map((ref) => describeRecipeSlotChildRef(ref).ref)
				: "any",
			...(slot.defaultChildren
				? {
						defaultChildren: slot.defaultChildren.map((child) =>
							compactTemplate(recipe, child),
						),
					}
				: {}),
		})),
	controls: Object.values(recipe.controls ?? {})
		.filter((control) => control.visibility !== "hidden")
		.map(describeControl),
});

const indexRecipe = (recipe: RecipeDefinition) => {
	const slots = Object.keys(recipe.slots ?? {});
	const controls = Object.values(recipe.controls ?? {})
		.filter((control) => control.visibility !== "hidden")
		.map((control) =>
			control.path === recipe.root.path
				? control.prop
				: `${control.prop}@${control.path}`,
		);
	return `${recipe.id}: ${recipe.label}. slots: ${slots.join(", ") || "none"}${controls.length > 0 ? `. controls: ${controls.join(", ")}` : ""}`;
};

const allowedRecipes = (policy: McpPolicy, library: string | undefined) =>
	selectLibraries(library).flatMap((registry) =>
		getRegistryRecipes(registry).filter((recipe) =>
			isRecipeAllowed(policy, recipe),
		),
	);

/** Recipes whose root renders open unless defaultOpen is set to false. */
export const listOpenByDefaultRecipes = (policy: McpPolicy) =>
	allowedRecipes(policy, undefined)
		.filter((recipe) =>
			Object.values(recipe.controls ?? {}).some(
				(control) =>
					control.prop === "defaultOpen" &&
					control.path === recipe.root.path &&
					control.defaultValue === true,
			),
		)
		.map((recipe) => recipe.id);

export const buildRecipesTopic = (
	policy: McpPolicy,
	filter: RegistryFilter,
) => {
	const recipes = allowedRecipes(policy, filter.library);
	const usage = [
		'Insert a recipe with addRecipe, or as { kind: "recipe", tempId, library, recipe } inside addSubtree (recipe nodes take no children or classes). The step result lists the instance\'s slots: slot name to host element id.',
		"Fill a slot by inserting into its host: parentId $step:N:slot:<slot> in the same batch, or the host id from the step result or a read (reads mark slot hosts with slot).",
		"Slots start with default content, for example a dialog's title, description and close button. Default content is ordinary elements: edit, restyle or delete it.",
		"Everything else is locked recipe structure: it cannot be moved, deleted, given text or given children. Its elements accept a new name, className and declared controls.",
		"Set a control with updateElementProps on the element at the control's path, props: { <prop>: value }. The root path is the recipe root, which is the step's changedElementId ($step:N). updateRecipeControl does the same but takes the recipe instance id (data-trickroom-recipe-instance in readElement), not an element id.",
		"Template classes are defaults such as bg-white or bg-black/20. When the design system lacks those tokens the write warns: restyle those elements with system classes.",
		"Delete the recipe root to remove the instance. detachRecipeInstance turns it into plain elements; only do that for a structure the recipe cannot express.",
	];

	if (filter.name === undefined) {
		return {
			usage,
			openByDefault: listOpenByDefaultRecipes(policy),
			recipes: recipes.map(indexRecipe),
			controls:
				"A control listed as prop@path sits on the element at that template path; the others sit on the recipe root.",
			filter:
				'Pass name (e.g. "dialog") and optionally library for a recipe\'s template tree, slots with allowed and default children, and control options.',
		};
	}

	const matches = filterByName(recipes, localRecipeId, filter.name);
	if (matches.length === 0) {
		return {
			matches: 0,
			suggestions: suggestClosest(filter.name, recipes.map(localRecipeId), {
				limit: 5,
			}),
			recipes: recipes.map((recipe) => recipe.id),
		};
	}
	return {
		usage,
		recipes: matches
			.slice(0, MAX_DETAILED_MATCHES)
			.map((recipe) => describeRecipeForGuide(recipe)),
	};
};
