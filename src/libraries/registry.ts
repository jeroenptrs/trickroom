import { RECIPE_MARKER_PROP_KEYS } from "../recipes/markers";
import type {
	ControlDefinition,
	JsonPrimitive,
	LibraryRegistry,
	Props,
	RecipeDefinition,
	Registry,
	RegistryComponentDefinition,
	Role,
} from "../types";
import baseUiRegistry from "./base-ui/registry";
import trickroomRegistry from "./trickroom/registry";

export const availableRegistries = ["base-ui", "trickroom"] as const;
export type RegistryId = (typeof availableRegistries)[number];

const libraryRegistries: Record<RegistryId, LibraryRegistry> = {
	"base-ui": baseUiRegistry,
	trickroom: trickroomRegistry,
};

const registries: Record<RegistryId, Registry> = {
	"base-ui": libraryRegistries["base-ui"].components,
	trickroom: libraryRegistries.trickroom.components,
};

export type ComponentRef = {
	library: RegistryId;
	component: string;
};

export type RecipeRef = {
	library: RegistryId;
	recipe: string;
};

export type RegistryResolution =
	| {
			status: "known";
			library: RegistryId;
			component: string;
			definition: RegistryComponentDefinition;
	  }
	| { status: "unknown-library"; library: string; component: string }
	| { status: "unknown-component"; library: RegistryId; component: string };

export type RegistryRecipeResolution =
	| {
			status: "known";
			library: RegistryId;
			recipe: string;
			definition: RecipeDefinition;
	  }
	| { status: "unknown-library"; library: string; recipe: string }
	| { status: "unknown-recipe"; library: RegistryId; recipe: string };

export const CORE_PROP_KEYS = new Set([
	"className",
	"data-trickroom-name",
	"data-trickroom-library",
	"data-trickroom-component",
	"data-trickroom-role",
]);

export const REGISTRY_REFERENCE_PROP_KEYS = new Set([
	"data-trickroom-library",
	"data-trickroom-component",
	"data-trickroom-role",
]);

export const SYSTEM_PROP_KEYS = new Set([
	...REGISTRY_REFERENCE_PROP_KEYS,
	...RECIPE_MARKER_PROP_KEYS,
]);

export const isRegistryId = (value: unknown): value is RegistryId =>
	typeof value === "string" &&
	availableRegistries.includes(value as RegistryId);

export function getRegistry(library: RegistryId) {
	return registries[library];
}

export function getComponentIds(library: RegistryId) {
	return Object.keys(getRegistry(library)).sort();
}

export function getRegistryRecipes(library: RegistryId) {
	return Object.values(libraryRegistries[library].recipes).sort((a, b) =>
		a.id.localeCompare(b.id),
	);
}

export function getRecipeIds(library: RegistryId) {
	return getRegistryRecipes(library).map((recipe) => recipe.id);
}

const getRecipeRegistryKey = (
	library: RegistryId,
	recipe: string,
): string | null => {
	const recipes = libraryRegistries[library].recipes;
	if (Object.hasOwn(recipes, recipe)) {
		return recipe;
	}

	const localRecipe = recipe.startsWith(`${library}/`)
		? recipe.slice(library.length + 1)
		: recipe;
	if (Object.hasOwn(recipes, localRecipe)) {
		return localRecipe;
	}

	return Object.keys(recipes).find((key) => recipes[key].id === recipe) ?? null;
};

export function resolveRegistryComponent(
	library: string,
	component: string,
): RegistryResolution {
	if (!isRegistryId(library)) {
		return { status: "unknown-library", library, component };
	}

	const registry = getRegistry(library);
	if (!Object.hasOwn(registry, component)) {
		return { status: "unknown-component", library, component };
	}

	return {
		status: "known",
		library,
		component,
		definition: registry[component as keyof typeof registry],
	};
}

export function resolveRegistryRecipe(
	library: string,
	recipe: string,
): RegistryRecipeResolution {
	if (!isRegistryId(library)) {
		return { status: "unknown-library", library, recipe };
	}

	const recipeKey = getRecipeRegistryKey(library, recipe);
	if (!recipeKey) {
		return { status: "unknown-recipe", library, recipe };
	}

	return {
		status: "known",
		library,
		recipe,
		definition: libraryRegistries[library].recipes[recipeKey],
	};
}

export function getLibraryComponent(
	library: string,
	component: string,
): RegistryComponentDefinition {
	const resolution = resolveRegistryComponent(library, component);
	if (resolution.status !== "known") {
		throw new Error(
			resolution.status === "unknown-library"
				? `Unknown registry library "${library}".`
				: `Unknown component "${component}" in registry "${library}".`,
		);
	}

	return resolution.definition;
}

export function getRecipe(library: string, recipe: string): RecipeDefinition {
	const resolution = resolveRegistryRecipe(library, recipe);
	if (resolution.status !== "known") {
		throw new Error(
			resolution.status === "unknown-library"
				? `Unknown registry library "${library}".`
				: `Unknown recipe "${recipe}" in registry "${library}".`,
		);
	}

	return resolution.definition;
}

export const normalizeRole = (role: Props["data-trickroom-role"]): Role =>
	role ?? "branch";

export const canHaveElementChildren = (role: Role) => role === "branch";

export const getDefaultChildren = (role: Role): string | [] =>
	role === "text" ? "Text" : [];

export const getDefaultText = (role: Role) =>
	role === "text" ? "Text" : undefined;

export const getControlDefinitions = (
	definition: RegistryComponentDefinition,
) => Object.values(definition.controls ?? {});

export const getControlProps = (
	definition: RegistryComponentDefinition,
): Record<string, JsonPrimitive | undefined> => {
	const props: Record<string, JsonPrimitive | undefined> = {
		...(definition.defaultProps ?? {}),
	};

	for (const control of getControlDefinitions(definition)) {
		if (
			props[control.prop] === undefined &&
			control.defaultValue !== undefined
		) {
			props[control.prop] = control.defaultValue;
		}
	}

	return props;
};

export const getDefaultProps = (
	library: string,
	component: string,
	definition: RegistryComponentDefinition,
	name = definition.label,
): Props => ({
	...getControlProps(definition),
	"data-trickroom-name": name,
	"data-trickroom-library": library,
	"data-trickroom-component": component,
	"data-trickroom-role": definition.role,
});

export function getRenderableProps(
	props: Props,
	definition: RegistryComponentDefinition,
) {
	const controlProps = new Set(
		getControlDefinitions(definition).map((control) => control.prop),
	);

	return Object.fromEntries(
		Object.entries(props).filter(
			([key]) => CORE_PROP_KEYS.has(key) || controlProps.has(key),
		),
	);
}

export function getControlByProp(
	definition: RegistryComponentDefinition,
	prop: string,
): ControlDefinition | undefined {
	return getControlDefinitions(definition).find(
		(control) => control.prop === prop,
	);
}

export function isJsonPrimitive(value: unknown): value is JsonPrimitive {
	return (
		value === null ||
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	);
}

export function isValidControlValue(
	control: ControlDefinition,
	value: JsonPrimitive | undefined,
) {
	if (value === undefined) {
		return true;
	}

	if (value === null) {
		return false;
	}

	if (typeof value !== control.valueType) {
		return false;
	}

	if (control.options) {
		return control.options.some((option) => option.value === value);
	}

	return true;
}

export { libraryRegistries, registries };
