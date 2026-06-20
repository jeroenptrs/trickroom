import {
	availableRegistries,
	resolveRegistryRecipe,
} from "../libraries/registry";
import type {
	NormalizedRecipeSlotChildRef,
	Props,
	RecipeDefinition,
	RecipeSlotChildRef,
} from "../types";
import {
	getElementRecipeMetadata,
	type RecipeBoundaryEntityMap,
} from "./ownership";

export const normalizeRecipeSlotChildRef = (
	ref: RecipeSlotChildRef,
): NormalizedRecipeSlotChildRef => {
	if (ref.kind === "recipe") {
		return {
			kind: "recipe",
			library: ref.library,
			recipe: ref.recipe,
		};
	}

	return {
		kind: "component",
		library: ref.library,
		component: ref.component,
	};
};

export const describeRecipeSlotChildRef = (ref: RecipeSlotChildRef) => {
	const normalized = normalizeRecipeSlotChildRef(ref);
	return {
		kind: normalized.kind,
		library: normalized.library,
		...(normalized.kind === "component"
			? { component: normalized.component }
			: { recipe: normalized.recipe }),
		ref:
			normalized.kind === "component"
				? `${normalized.library}/${normalized.component}`
				: `${normalized.library}/${normalized.recipe}`,
	};
};

const isAllowedComponentRef = (
	allowlistEntry: NormalizedRecipeSlotChildRef,
	candidate: NormalizedRecipeSlotChildRef,
) =>
	allowlistEntry.kind === "component" &&
	allowlistEntry.kind === candidate.kind &&
	allowlistEntry.library === candidate.library &&
	allowlistEntry.component === candidate.component;

const isAllowedRecipeRef = (
	allowlistEntry: NormalizedRecipeSlotChildRef,
	candidate: NormalizedRecipeSlotChildRef,
) =>
	allowlistEntry.kind === "recipe" &&
	allowlistEntry.kind === candidate.kind &&
	allowlistEntry.library === candidate.library &&
	allowlistEntry.recipe === candidate.recipe;

export const isRecipeSlotChildAllowed = (
	allowedChildren: readonly RecipeSlotChildRef[] | undefined,
	candidate: RecipeSlotChildRef,
) => {
	if (allowedChildren === undefined) {
		return true;
	}

	const normalizedCandidate = normalizeRecipeSlotChildRef(candidate);
	return allowedChildren.some((entry) => {
		const normalizedEntry = normalizeRecipeSlotChildRef(entry);
		return (
			isAllowedComponentRef(normalizedEntry, normalizedCandidate) ||
			isAllowedRecipeRef(normalizedEntry, normalizedCandidate)
		);
	});
};

const resolveRecipeDefinitionById = (recipeId: string) => {
	const resolution = availableRegistries
		.map((library) => resolveRegistryRecipe(library, recipeId))
		.find((entry) => entry.status === "known");

	return resolution?.definition ?? null;
};

export const getRecipeSlotDefinitionForHost = (
	recipe: RecipeDefinition,
	slotName: string,
) => recipe.slots?.[slotName] ?? null;

export const getRecipeSlotDefinitionForParent = (
	entitiesById: RecipeBoundaryEntityMap,
	parentId: string | null,
) => {
	if (parentId === null) {
		return null;
	}

	const parent = entitiesById[parentId];
	const metadata = getElementRecipeMetadata(parent);
	if (!metadata?.slotName) {
		return null;
	}

	const recipe = resolveRecipeDefinitionById(metadata.recipeId);
	if (!recipe) {
		return null;
	}

	return getRecipeSlotDefinitionForHost(recipe, metadata.slotName);
};

export const getRecipeSlotCandidateFromProps = (
	props: Pick<Props, "data-trickroom-library" | "data-trickroom-component"> &
		Partial<Props>,
): RecipeSlotChildRef => {
	const metadata = getElementRecipeMetadata({ props });
	if (metadata?.isRoot) {
		const [library, ...recipeParts] = metadata.recipeId.split("/");
		if (library && recipeParts.length > 0) {
			return {
				kind: "recipe",
				library,
				recipe: recipeParts.join("/"),
			};
		}
	}

	return {
		kind: "component",
		library: props["data-trickroom-library"],
		component: props["data-trickroom-component"],
	};
};

export const getRecipeSlotCandidateForExistingNode = (
	entitiesById: RecipeBoundaryEntityMap,
	elementId: string,
): RecipeSlotChildRef | null => {
	const entity = entitiesById[elementId];
	if (!entity) {
		return null;
	}

	return getRecipeSlotCandidateFromProps(entity.props);
};

export const isRecipeSlotInsertionAllowed = (
	entitiesById: RecipeBoundaryEntityMap,
	parentId: string | null,
	candidate: RecipeSlotChildRef,
) => {
	const slot = getRecipeSlotDefinitionForParent(entitiesById, parentId);
	return slot
		? isRecipeSlotChildAllowed(slot.allowedChildren, candidate)
		: true;
};
