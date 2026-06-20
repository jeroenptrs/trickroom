import type { TrickroomDesign } from "../types";
import { detachRecipeInstance } from "./detach";
import {
	type RecipeInstanceValidationIssueCode,
	type RecipeInstanceValidationReport,
	validateRecipeInstances,
} from "./validation";

export const recipeLoadRepairHeaderName = "x-trickroom-recipe-repair";

export type RecipeLoadRepairInstance = {
	recipeId: string;
	instanceId: string;
	rootElementId: string | null;
	targetElementId: string;
	detachedElementIds: string[];
	issueCodes: RecipeInstanceValidationIssueCode[];
};

export type RecipeLoadRepairUnknownInstance = {
	recipeId: string;
	instanceId: string;
	rootElementId: string | null;
	structuralElementIds: string[];
};

export type RecipeLoadRepairReport = {
	repairedCount: number;
	repairedInstances: RecipeLoadRepairInstance[];
	staleCount: number;
	staleInstances: RecipeLoadRepairUnknownInstance[];
	unknownCount: number;
	unknownInstances: RecipeLoadRepairUnknownInstance[];
};

export type RecipeLoadRepairResult = {
	design: TrickroomDesign;
	report: RecipeLoadRepairReport;
};

const getRepairTargetElementId = (
	instance: RecipeInstanceValidationReport,
): string | null =>
	instance.rootElementId ?? instance.structuralElementIds[0] ?? null;

const getIssueCodes = (instance: RecipeInstanceValidationReport) =>
	instance.issues.map((issue) => issue.code);

const getUnknownInstanceReport = (
	instance: RecipeInstanceValidationReport,
): RecipeLoadRepairUnknownInstance => ({
	recipeId: instance.recipeId,
	instanceId: instance.instanceId,
	rootElementId: instance.rootElementId,
	structuralElementIds: instance.structuralElementIds,
});

export const repairInvalidKnownRecipeInstances = (
	design: TrickroomDesign,
): RecipeLoadRepairResult => {
	const validation = validateRecipeInstances(design.boards);
	let boards = design.boards;
	const repairedInstances: RecipeLoadRepairInstance[] = [];

	for (const instance of validation.invalidKnown) {
		const targetElementId = getRepairTargetElementId(instance);
		if (!targetElementId) {
			continue;
		}

		const detached = detachRecipeInstance(boards, targetElementId);
		if (!detached) {
			continue;
		}

		boards = detached.roots;
		repairedInstances.push({
			recipeId: instance.recipeId,
			instanceId: instance.instanceId,
			rootElementId: instance.rootElementId,
			targetElementId,
			detachedElementIds: detached.detachedElementIds,
			issueCodes: getIssueCodes(instance),
		});
	}

	const report: RecipeLoadRepairReport = {
		repairedCount: repairedInstances.length,
		repairedInstances,
		staleCount: validation.stale.length,
		staleInstances: validation.stale.map(getUnknownInstanceReport),
		unknownCount: validation.unknown.length,
		unknownInstances: validation.unknown.map(getUnknownInstanceReport),
	};

	return {
		design:
			repairedInstances.length > 0
				? {
						...design,
						boards,
					}
				: design,
		report,
	};
};
