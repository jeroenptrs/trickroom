import { formatDidYouMean, suggestClosest } from "../utils/suggestions";
import {
	availableRegistries,
	getComponentIds,
	getRecipeIds,
	isRegistryId,
	type RegistryId,
} from "./registry";

/** Candidate lists at or below this size are returned in full. */
const SMALL_CANDIDATE_LIST = 20;

export type UnknownRegistryReference = {
	message: string;
	details: Record<string, unknown>;
};

/** Recipe ids without the `<library>/` prefix, the form agents usually pass. */
const getLocalRecipeIds = (library: RegistryId) =>
	getRecipeIds(library).map((id) =>
		id.startsWith(`${library}/`) ? id.slice(library.length + 1) : id,
	);

const withCandidates = (key: string, candidates: readonly string[]) =>
	candidates.length <= SMALL_CANDIDATE_LIST ? { [key]: [...candidates] } : {};

export const describeUnknownRegistryLibrary = (
	library: string,
): UnknownRegistryReference => {
	const suggestions = suggestClosest(library, availableRegistries);
	return {
		message: `Unknown registry library "${library}". Available libraries: ${availableRegistries.join(", ")}.`,
		details: {
			suggestions,
			availableLibraries: [...availableRegistries],
		},
	};
};

const findLibrariesWith = (
	lookup: (library: RegistryId) => readonly string[],
	name: string,
	except: RegistryId,
) =>
	availableRegistries.filter(
		(library) => library !== except && lookup(library).includes(name),
	);

export const describeUnknownRegistryComponent = (
	library: string,
	component: string,
): UnknownRegistryReference => {
	if (!isRegistryId(library)) {
		return describeUnknownRegistryLibrary(library);
	}

	const componentIds = getComponentIds(library);
	const suggestions = suggestClosest(component, componentIds);
	const otherLibraries = findLibrariesWith(getComponentIds, component, library);
	const recipeMatches = suggestClosest(component, getLocalRecipeIds(library), {
		limit: 2,
		maxDistance: 1,
	});
	let message = `Unknown component "${component}" in registry "${library}".${formatDidYouMean(suggestions)}`;
	if (otherLibraries.length > 0) {
		message += ` "${component}" exists in library ${otherLibraries.map((value) => `"${value}"`).join(", ")}.`;
	}
	if (recipeMatches.length > 0) {
		message += ` ${recipeMatches.map((value) => `"${value}"`).join(", ")} ${recipeMatches.length === 1 ? "is a recipe" : "are recipes"}; insert recipes with addRecipe or a { kind: "recipe" } subtree node.`;
	}
	return {
		message,
		details: {
			suggestions,
			...(otherLibraries.length > 0
				? { foundInLibraries: otherLibraries }
				: {}),
			...(recipeMatches.length > 0 ? { recipeSuggestions: recipeMatches } : {}),
			...withCandidates("availableComponents", componentIds),
		},
	};
};

export const describeUnknownRegistryRecipe = (
	library: string,
	recipe: string,
): UnknownRegistryReference => {
	if (!isRegistryId(library)) {
		return describeUnknownRegistryLibrary(library);
	}

	const localRecipe = recipe.startsWith(`${library}/`)
		? recipe.slice(library.length + 1)
		: recipe;
	const recipeIds = getLocalRecipeIds(library);
	const suggestions = suggestClosest(localRecipe, recipeIds);
	const otherLibraries = findLibrariesWith(
		getLocalRecipeIds,
		localRecipe,
		library,
	);
	let message = `Unknown recipe "${recipe}" in registry "${library}".${formatDidYouMean(suggestions)}`;
	if (otherLibraries.length > 0) {
		message += ` "${recipe}" exists in library ${otherLibraries.map((value) => `"${value}"`).join(", ")}.`;
	}
	return {
		message,
		details: {
			suggestions,
			...(otherLibraries.length > 0
				? { foundInLibraries: otherLibraries }
				: {}),
			...withCandidates("availableRecipes", recipeIds),
		},
	};
};
