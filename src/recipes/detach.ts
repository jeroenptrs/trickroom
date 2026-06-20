import type { Node } from "../types";
import {
	getRecipeStructuralMetadata,
	omitRecipeMarkerProps,
	type RecipeStructuralMetadata,
	recipeInstanceProp,
} from "./markers";

export type DetachRecipeInstanceTarget = string | Pick<Node, "id">;

export type DetachRecipeInstanceResult = {
	roots: Node[];
	recipeId: string;
	instanceId: string;
	targetElementId: string;
	changedElementId: string;
	selectionElementId: string;
	rootElementId: string | null;
	detachedElementIds: string[];
};

type RecipeTarget = {
	metadata: RecipeStructuralMetadata;
};

const getTargetElementId = (target: DetachRecipeInstanceTarget) =>
	typeof target === "string" ? target : target.id;

const findRecipeTarget = (
	node: Node,
	targetElementId: string,
): RecipeTarget | null => {
	if (node.id === targetElementId) {
		const metadata = getRecipeStructuralMetadata(node.props);
		return metadata ? { metadata } : null;
	}

	if (Array.isArray(node.children)) {
		for (const child of node.children) {
			const target = findRecipeTarget(child, targetElementId);
			if (target) {
				return target;
			}
		}
	}

	return null;
};

const findRecipeTargetInRoots = (
	roots: readonly Node[],
	targetElementId: string,
) => {
	for (const root of roots) {
		const target = findRecipeTarget(root, targetElementId);
		if (target) {
			return target;
		}
	}

	return null;
};

export const detachRecipeInstance = (
	roots: readonly Node[],
	target: DetachRecipeInstanceTarget,
): DetachRecipeInstanceResult | null => {
	const targetElementId = getTargetElementId(target);
	const recipeTarget = findRecipeTargetInRoots(roots, targetElementId);
	if (!recipeTarget) {
		return null;
	}

	const { recipeId, instanceId } = recipeTarget.metadata;
	const detachedElementIds: string[] = [];
	let rootElementId: string | null = null;

	const stripInstanceMarkers = (node: Node): Node => {
		const metadata = getRecipeStructuralMetadata(node.props);
		const isTargetInstance = node.props[recipeInstanceProp] === instanceId;
		if (isTargetInstance) {
			detachedElementIds.push(node.id);
			if (metadata?.isRoot) {
				rootElementId = node.id;
			}
		}

		const children = Array.isArray(node.children)
			? node.children.map(stripInstanceMarkers)
			: node.children;

		return {
			...node,
			props: isTargetInstance ? omitRecipeMarkerProps(node.props) : node.props,
			children,
		};
	};

	return {
		roots: roots.map(stripInstanceMarkers),
		recipeId,
		instanceId,
		targetElementId,
		changedElementId: targetElementId,
		selectionElementId: targetElementId,
		rootElementId,
		detachedElementIds,
	};
};
