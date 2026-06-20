import type { Node, Props } from "../types";
import {
	getRecipeStructuralMetadata,
	type RecipeStructuralMetadata,
} from "./markers";

export type RecipeBoundaryEntity = {
	id: string;
	props: Props;
	parentId: string | null;
	childIds?: readonly string[];
};

export type RecipeBoundaryEntityMap = Record<
	string,
	RecipeBoundaryEntity | undefined
>;

export type RecipeInstanceMetadata = RecipeStructuralMetadata & {
	rootId: string | null;
	elementId: string;
};

export type RecipeSlotContainment = {
	hostId: string;
	slotName: string;
	recipeId: string;
	instanceId: string;
};

type RecipeMetadataEntity =
	| Pick<RecipeBoundaryEntity, "props">
	| Pick<Node, "props">
	| null
	| undefined;

export const getElementRecipeMetadata = (entity: RecipeMetadataEntity) =>
	getRecipeStructuralMetadata(entity?.props);

export const isRecipeOwnedStructuralNode = (entity: RecipeMetadataEntity) =>
	!!entity && getElementRecipeMetadata(entity) !== null;

export const isRecipeRoot = (entity: RecipeMetadataEntity) =>
	getElementRecipeMetadata(entity)?.isRoot ?? false;

export const isRecipeSlotHost = (entity: RecipeMetadataEntity) => {
	const metadata = getElementRecipeMetadata(entity);
	return metadata !== null && metadata.slotName !== null;
};

export const getRecipeSlotName = (entity: RecipeMetadataEntity) =>
	getElementRecipeMetadata(entity)?.slotName ?? null;

export const collectRecipeInstanceNodes = (
	roots: readonly Node[],
	instanceId: string,
) => {
	const nodes: Node[] = [];

	const visit = (node: Node) => {
		const metadata = getElementRecipeMetadata(node);
		if (metadata?.instanceId === instanceId) {
			nodes.push(node);
		}
		if (Array.isArray(node.children)) {
			for (const child of node.children) {
				visit(child);
			}
		}
	};

	for (const root of roots) {
		visit(root);
	}

	return nodes;
};

export const findRecipeRootNode = (
	roots: readonly Node[],
	instanceId: string,
) =>
	collectRecipeInstanceNodes(roots, instanceId).find((node) =>
		isRecipeRoot(node),
	) ?? null;

export const getRecipeOwnedStructuralIds = (
	entitiesById: RecipeBoundaryEntityMap,
	instanceId: string,
) =>
	Object.values(entitiesById)
		.filter((entity): entity is RecipeBoundaryEntity => {
			const metadata = entity ? getElementRecipeMetadata(entity) : null;
			return metadata?.instanceId === instanceId;
		})
		.map((entity) => entity.id)
		.sort();

export const findRecipeRootId = (
	entitiesById: RecipeBoundaryEntityMap,
	instanceId: string,
) =>
	Object.values(entitiesById).find((entity) => {
		const metadata = entity ? getElementRecipeMetadata(entity) : null;
		return metadata?.instanceId === instanceId && metadata.isRoot;
	})?.id ?? null;

export const getRecipeInstanceMetadata = (
	entitiesById: RecipeBoundaryEntityMap,
	elementId: string,
): RecipeInstanceMetadata | null => {
	const entity = entitiesById[elementId];
	if (!entity) {
		return null;
	}
	const metadata = getElementRecipeMetadata(entity);
	if (!metadata) {
		return null;
	}

	return {
		...metadata,
		elementId,
		rootId: findRecipeRootId(entitiesById, metadata.instanceId),
	};
};

export const getContainingRecipeSlot = (
	entitiesById: RecipeBoundaryEntityMap,
	elementId: string,
): RecipeSlotContainment | null => {
	let current = entitiesById[elementId];
	let parentId = current?.parentId ?? null;

	while (parentId) {
		const parent = entitiesById[parentId];
		if (!parent) {
			return null;
		}
		const metadata = getElementRecipeMetadata(parent);
		if (metadata?.slotName) {
			return {
				hostId: parent.id,
				slotName: metadata.slotName,
				recipeId: metadata.recipeId,
				instanceId: metadata.instanceId,
			};
		}
		current = parent;
		parentId = current.parentId;
	}

	return null;
};

export const isRecipeSlotContent = (
	entitiesById: RecipeBoundaryEntityMap,
	elementId: string,
) => getContainingRecipeSlot(entitiesById, elementId) !== null;

export const canInsertIntoRecipeBoundary = (
	entitiesById: RecipeBoundaryEntityMap,
	parentId: string | null,
) => {
	if (parentId === null) {
		return true;
	}

	const parent = entitiesById[parentId];
	if (!parent) {
		return false;
	}

	return !isRecipeOwnedStructuralNode(parent) || isRecipeSlotHost(parent);
};

export const canMoveElementAcrossRecipeBoundary = (
	entitiesById: RecipeBoundaryEntityMap,
	elementId: string,
	targetParentId: string | null,
) => {
	const entity = entitiesById[elementId];
	if (!entity) {
		return false;
	}

	const metadata = getElementRecipeMetadata(entity);
	if (metadata && !metadata.isRoot) {
		return false;
	}

	return canInsertIntoRecipeBoundary(entitiesById, targetParentId);
};

export const canDeleteElementAcrossRecipeBoundary = (
	entitiesById: RecipeBoundaryEntityMap,
	elementId: string,
) => {
	const entity = entitiesById[elementId];
	if (!entity) {
		return false;
	}

	const metadata = getElementRecipeMetadata(entity);
	return !metadata || metadata.isRoot;
};
