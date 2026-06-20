import {
	getRecipeStructuralMetadata,
	RECIPE_MARKER_PROP_KEYS,
} from "../recipes/markers";
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
import {
	type ClassLayer,
	createClassLayers,
	flattenClassLayers,
} from "../utils/class-layers";
import {
	type ClassResolution,
	type ResolveClassLayersOptions,
	resolveClassLayers,
} from "../utils/class-resolution";
import { SYSTEM_COMPONENT_MARKER_PROP_KEYS } from "../utils/system-component-markers";
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

export const MATERIALIZED_BASE_CLASS_PROP =
	"data-trickroom-materialized-base-class";

export const REGISTRY_REFERENCE_PROP_KEYS = new Set([
	"data-trickroom-library",
	"data-trickroom-component",
	"data-trickroom-role",
]);

export const SYSTEM_PROP_KEYS = new Set([
	...REGISTRY_REFERENCE_PROP_KEYS,
	...RECIPE_MARKER_PROP_KEYS,
	...SYSTEM_COMPONENT_MARKER_PROP_KEYS,
	MATERIALIZED_BASE_CLASS_PROP,
]);

const isBaseClassMaterialized = (props: Props): boolean =>
	props[MATERIALIZED_BASE_CLASS_PROP] === "true";

const hasClassValue = (value: string | undefined): value is string =>
	typeof value === "string" && value.trim().length > 0;

const splitClassName = (value: string | undefined): string[] =>
	value?.trim().split(/\s+/u).filter(Boolean) ?? [];

const defaultClassResolutionOptions = {
	colorTokens: new Set<string>(),
} satisfies ResolveClassLayersOptions;

export type RegistryClassComposition = {
	layers: ClassLayer[];
	resolution: ClassResolution;
	className: string | undefined;
};

export const stripBaseClassName = (
	className: string | undefined,
	baseClassName: string | undefined,
): string | undefined => {
	const classNames = splitClassName(className);
	const baseClassNames = new Set(splitClassName(baseClassName));
	if (classNames.length === 0 || baseClassNames.size === 0) {
		return hasClassValue(className) ? className : undefined;
	}

	const authoredClassNames = classNames.filter(
		(classToken) => !baseClassNames.has(classToken),
	);
	return authoredClassNames.length > 0
		? authoredClassNames.join(" ")
		: undefined;
};

export const getComposableClassName = (
	className: string | undefined,
	baseClassName: string | undefined,
	isBaseClassMaterialized = false,
): string | undefined => {
	return getComposableClassComposition(
		className,
		baseClassName,
		isBaseClassMaterialized,
	).className;
};

export const getComposableClassComposition = (
	className: string | undefined,
	baseClassName: string | undefined,
	isBaseClassMaterialized = false,
	options: ResolveClassLayersOptions = defaultClassResolutionOptions,
): RegistryClassComposition => {
	const authoredClassName = isBaseClassMaterialized
		? className
		: stripBaseClassName(className, baseClassName);
	const layers = createClassLayers(
		isBaseClassMaterialized
			? [{ source: "materialized-snapshot", className: authoredClassName }]
			: [
					{ source: "registry-base", className: baseClassName },
					{ source: "authored", className: authoredClassName },
				],
	);

	return {
		layers,
		resolution: resolveClassLayers(layers, options),
		className: flattenClassLayers(layers),
	};
};

export const getMaterializedBaseClassProps = (
	className: string | undefined,
	definition: RegistryComponentDefinition,
): Partial<Props> => {
	const materializedClassName = getComposableClassName(
		className,
		definition.baseClassName,
		false,
	);

	return {
		...(materializedClassName ? { className: materializedClassName } : {}),
		...(hasClassValue(definition.baseClassName)
			? { [MATERIALIZED_BASE_CLASS_PROP]: "true" }
			: {}),
	};
};

export const migrateRegistryBaseClassProps = (
	props: Props,
	options: { materializeBaseClass?: boolean } = {},
): Props => {
	const resolution = resolveRegistryComponent(
		props["data-trickroom-library"],
		props["data-trickroom-component"],
	);
	if (
		resolution.status !== "known" ||
		!hasClassValue(resolution.definition.baseClassName)
	) {
		return props;
	}

	const authoredClassName = stripBaseClassName(
		typeof props.className === "string" ? props.className : undefined,
		resolution.definition.baseClassName,
	);
	const nextProps = { ...props };

	if (options.materializeBaseClass) {
		const materializedClassName = getComposableClassName(
			authoredClassName,
			resolution.definition.baseClassName,
			false,
		);
		if (materializedClassName) {
			nextProps.className = materializedClassName;
		} else {
			delete nextProps.className;
		}
		nextProps[MATERIALIZED_BASE_CLASS_PROP] = "true";
		return nextProps;
	}

	if (authoredClassName) {
		nextProps.className = authoredClassName;
	} else {
		delete nextProps.className;
	}
	delete nextProps[MATERIALIZED_BASE_CLASS_PROP];
	return nextProps;
};

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

/**
 * Rewrites discriminator control props (marked uniqueAmongSiblings) so their
 * values don't collide with the same prop on sibling elements. Duplicate
 * discriminators break library behavior at runtime (e.g. Base UI tabs with
 * equal values activate together and loop). Only props not listed in
 * `explicitProps` are rewritten, so caller-provided values stay untouched.
 */
export const uniquifyControlPropsAmongSiblings = (
	props: Props,
	definition: RegistryComponentDefinition,
	siblingProps: readonly Props[],
	explicitProps?: ReadonlySet<string>,
): Props => {
	let nextProps = props;

	for (const control of getControlDefinitions(definition)) {
		if (!control.uniqueAmongSiblings || control.valueType !== "string") {
			continue;
		}
		if (explicitProps?.has(control.prop)) {
			continue;
		}
		const current = nextProps[control.prop];
		if (typeof current !== "string") {
			continue;
		}

		const taken = new Set<string>();
		for (const sibling of siblingProps) {
			const siblingValue = sibling[control.prop];
			if (
				typeof siblingValue === "string" &&
				sibling["data-trickroom-library"] === props["data-trickroom-library"] &&
				sibling["data-trickroom-component"] ===
					props["data-trickroom-component"]
			) {
				taken.add(siblingValue);
			}
		}

		if (!taken.has(current)) {
			continue;
		}

		const base = current.replace(/-\d+$/, "");
		let suffix = 2;
		let candidate = `${base}-${suffix}`;
		while (taken.has(candidate)) {
			suffix += 1;
			candidate = `${base}-${suffix}`;
		}
		nextProps = { ...nextProps, [control.prop]: candidate };
	}

	return nextProps;
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
	const classComposition = getRenderableClassComposition(props, definition);

	const renderableProps = Object.fromEntries(
		Object.entries(props).filter(
			([key]) =>
				key !== MATERIALIZED_BASE_CLASS_PROP &&
				(CORE_PROP_KEYS.has(key) || controlProps.has(key)) &&
				key !== "className",
		),
	);

	if (typeof classComposition.className === "string") {
		renderableProps.className = classComposition.className;
	}

	return {
		...renderableProps,
	};
}

export function getRenderableClassComposition(
	props: Props,
	definition: RegistryComponentDefinition,
	options: ResolveClassLayersOptions = defaultClassResolutionOptions,
): RegistryClassComposition {
	const composition = getComposableClassComposition(
		typeof props.className === "string" ? props.className : undefined,
		definition.baseClassName,
		isBaseClassMaterialized(props),
		options,
	);
	const recipeMetadata = getRecipeStructuralMetadata(props);
	const metadata = {
		...(typeof props["data-trickroom-library"] === "string"
			? { library: props["data-trickroom-library"] }
			: {}),
		...(typeof props["data-trickroom-component"] === "string"
			? { component: props["data-trickroom-component"] }
			: {}),
		...(recipeMetadata
			? {
					recipeId: recipeMetadata.recipeId,
					instanceId: recipeMetadata.instanceId,
					path: recipeMetadata.path,
					...(recipeMetadata.slotName
						? { slotName: recipeMetadata.slotName }
						: {}),
				}
			: {}),
	};
	if (Object.keys(metadata).length === 0) {
		return composition;
	}

	const layers = composition.layers.map((layer) => ({
		...layer,
		metadata: { ...metadata, ...layer.metadata },
	}));

	return {
		layers,
		resolution: resolveClassLayers(layers, options),
		className: composition.className,
	};
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
