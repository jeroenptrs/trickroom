import type { Props } from "../types";

export const recipeIdProp = "data-trickroom-recipe-id";
export const recipeInstanceProp = "data-trickroom-recipe-instance";
export const recipeRootProp = "data-trickroom-recipe-root";
export const recipePathProp = "data-trickroom-recipe-path";
export const recipeSlotProp = "data-trickroom-recipe-slot";

export const RECIPE_MARKER_PROP_KEYS = new Set([
	recipeIdProp,
	recipeInstanceProp,
	recipeRootProp,
	recipePathProp,
	recipeSlotProp,
]);

export type RecipeMarkerPropKey =
	| typeof recipeIdProp
	| typeof recipeInstanceProp
	| typeof recipeRootProp
	| typeof recipePathProp
	| typeof recipeSlotProp;

export const isRecipeMarkerPropKey = (
	key: string,
): key is RecipeMarkerPropKey => RECIPE_MARKER_PROP_KEYS.has(key);

const getStringProp = (
	props: Props | null | undefined,
	key: RecipeMarkerPropKey,
) => {
	const value = props?.[key];
	return typeof value === "string" && value.trim().length > 0 ? value : null;
};

export type RecipeStructuralMetadata = {
	recipeId: string;
	instanceId: string;
	path: string;
	isRoot: boolean;
	slotName: string | null;
};

export const getRecipeStructuralMetadata = (
	props: Props | null | undefined,
): RecipeStructuralMetadata | null => {
	const recipeId = getStringProp(props, recipeIdProp);
	const instanceId = getStringProp(props, recipeInstanceProp);
	const path = getStringProp(props, recipePathProp);
	if (!recipeId || !instanceId || !path) {
		return null;
	}

	const rootValue = props?.[recipeRootProp];
	return {
		recipeId,
		instanceId,
		path,
		isRoot: rootValue === "true" || rootValue === true,
		slotName: getStringProp(props, recipeSlotProp),
	};
};

export const getRecipeMarkerProps = ({
	recipeId,
	instanceId,
	path,
	isRoot = false,
	slotName = null,
}: {
	recipeId: string;
	instanceId: string;
	path: string;
	isRoot?: boolean;
	slotName?: string | null;
}): Partial<Props> => ({
	[recipeIdProp]: recipeId,
	[recipeInstanceProp]: instanceId,
	[recipePathProp]: path,
	...(isRoot ? { [recipeRootProp]: "true" } : {}),
	...(slotName ? { [recipeSlotProp]: slotName } : {}),
});

export const omitRecipeMarkerProps = (props: Props): Props => {
	const nextProps = { ...props };
	for (const key of RECIPE_MARKER_PROP_KEYS) {
		delete nextProps[key];
	}
	return nextProps;
};
