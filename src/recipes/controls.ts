import { resolveRegistryRecipe } from "../libraries/registry";
import type { JsonPrimitive, RecipeControlDefinition } from "../types";
import { getElementRecipeMetadata } from "./ownership";

export type RecipeControlEntity = {
	id: string;
	props: Record<string, JsonPrimitive | undefined>;
};

export type RecipeControlEntityMap = Record<
	string,
	RecipeControlEntity | undefined
>;

export type RecipeControlTarget = {
	control: RecipeControlDefinition;
	elementId: string;
};

export const getRecipeControlDefinitions = (recipeId: string) => {
	const library = recipeId.split("/")[0];
	if (!library) {
		return [];
	}

	const resolution = resolveRegistryRecipe(library, recipeId);
	return resolution.status === "known"
		? Object.values(resolution.definition.controls ?? {})
		: [];
};

export const getRecipeControlTargets = (
	entitiesById: RecipeControlEntityMap,
	instanceId: string,
	recipeId: string,
): RecipeControlTarget[] =>
	getRecipeControlDefinitions(recipeId)
		.map((control) => {
			const target = findRecipeControlTargetElement(
				entitiesById,
				instanceId,
				control.path,
			);
			return target ? { control, elementId: target.id } : null;
		})
		.filter((target): target is RecipeControlTarget => target !== null);

export const findRecipeControlTargetElement = (
	entitiesById: RecipeControlEntityMap,
	instanceId: string,
	path: string,
) =>
	Object.values(entitiesById).find((entity) => {
		const metadata = getElementRecipeMetadata(entity);
		return metadata?.instanceId === instanceId && metadata.path === path;
	}) ?? null;

export const getRecipeControlByPathAndProp = (
	recipeId: string,
	path: string,
	prop: string,
) => {
	const library = recipeId.split("/")[0];
	if (!library) {
		return null;
	}

	const resolution = resolveRegistryRecipe(library, recipeId);
	if (resolution.status !== "known") {
		return null;
	}

	return (
		Object.values(resolution.definition.controls ?? {}).find(
			(control) => control.path === path && control.prop === prop,
		) ?? null
	);
};
