import {
	availableRegistries,
	getRegistry,
	getComponentIds as getRegistryComponentIds,
	isRegistryId,
	type RegistryId,
} from "../../libraries/registry";
import { describeUnknownRegistryLibrary } from "../../libraries/registry-suggestions";
import { DesignTransformError } from "../../services/design-transform-service";
import type { RecipeDefinition, RecipeTemplateNode } from "../../types";
import { isComponentAllowed, type McpPolicy } from "../governance";

// Registry lookups for the guide's registry and recipes topics.

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

export const getComponentIds = (library: RegistryId) =>
	getRegistryComponentIds(library);

const getRecipeTemplateNodes = (
	template: RecipeTemplateNode,
): RecipeTemplateNode[] => [
	template,
	...(template.children ?? []).flatMap((child) =>
		getRecipeTemplateNodes(child),
	),
];

/** Whether policy allows every component a recipe's template uses. */
export const isRecipeAllowed = (policy: McpPolicy, recipe: RecipeDefinition) =>
	getRecipeTemplateNodes(recipe.root).every((template) =>
		isComponentAllowed(policy, template.library, template.component),
	);
