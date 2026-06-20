import type { Node, Props } from "../types";
import {
	getSystemComponentStructuralMetadata,
	type SystemComponentStructuralMetadata,
} from "./system-component-markers.ts";

export type SystemComponentBoundaryEntity = {
	id: string;
	props: Props;
	parentId: string | null;
	childIds?: readonly string[];
};

export type SystemComponentBoundaryEntityMap = Record<
	string,
	SystemComponentBoundaryEntity | undefined
>;

export type SystemComponentInstanceMetadata =
	SystemComponentStructuralMetadata & {
		rootId: string | null;
		elementId: string;
	};

export type SystemComponentSlotContainment = {
	hostId: string;
	slotName: string;
	systemId: string;
	componentId: string;
	instanceId: string;
	version: string;
};

type SystemComponentMetadataEntity =
	| Pick<SystemComponentBoundaryEntity, "props">
	| Pick<Node, "props">
	| null
	| undefined;

export const getElementSystemComponentMetadata = (
	entity: SystemComponentMetadataEntity,
) => getSystemComponentStructuralMetadata(entity?.props);

export const isSystemComponentOwnedStructuralNode = (
	entity: SystemComponentMetadataEntity,
) => !!entity && getElementSystemComponentMetadata(entity) !== null;

export const isSystemComponentRoot = (entity: SystemComponentMetadataEntity) =>
	getElementSystemComponentMetadata(entity)?.isRoot ?? false;

export const isSystemComponentSlotHost = (
	entity: SystemComponentMetadataEntity,
) => {
	const metadata = getElementSystemComponentMetadata(entity);
	return metadata !== null && metadata.slotName !== null;
};

export const getSystemComponentSlotName = (
	entity: SystemComponentMetadataEntity,
) => getElementSystemComponentMetadata(entity)?.slotName ?? null;

export const collectSystemComponentInstanceNodes = (
	roots: readonly Node[],
	instanceId: string,
) => {
	const nodes: Node[] = [];

	const visit = (node: Node) => {
		const metadata = getElementSystemComponentMetadata(node);
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

export const findSystemComponentRootNode = (
	roots: readonly Node[],
	instanceId: string,
) =>
	collectSystemComponentInstanceNodes(roots, instanceId).find((node) =>
		isSystemComponentRoot(node),
	) ?? null;

export const getSystemComponentOwnedStructuralIds = (
	entitiesById: SystemComponentBoundaryEntityMap,
	instanceId: string,
) =>
	Object.values(entitiesById)
		.filter((entity): entity is SystemComponentBoundaryEntity => {
			const metadata = entity
				? getElementSystemComponentMetadata(entity)
				: null;
			return metadata?.instanceId === instanceId;
		})
		.map((entity) => entity.id)
		.sort();

export const findSystemComponentRootId = (
	entitiesById: SystemComponentBoundaryEntityMap,
	instanceId: string,
) =>
	Object.values(entitiesById).find((entity) => {
		const metadata = entity ? getElementSystemComponentMetadata(entity) : null;
		return metadata?.instanceId === instanceId && metadata.isRoot;
	})?.id ?? null;

export const getSystemComponentInstanceMetadata = (
	entitiesById: SystemComponentBoundaryEntityMap,
	elementId: string,
): SystemComponentInstanceMetadata | null => {
	const entity = entitiesById[elementId];
	if (!entity) {
		return null;
	}
	const metadata = getElementSystemComponentMetadata(entity);
	if (!metadata) {
		return null;
	}
	const rootId = findSystemComponentRootId(entitiesById, metadata.instanceId);
	const rootMetadata = rootId
		? getElementSystemComponentMetadata(entitiesById[rootId])
		: null;

	return {
		...metadata,
		variantValues: rootMetadata?.variantValues ?? metadata.variantValues,
		overrides: rootMetadata?.overrides ?? metadata.overrides,
		elementId,
		rootId,
	};
};

export const getContainingSystemComponentSlot = (
	entitiesById: SystemComponentBoundaryEntityMap,
	elementId: string,
): SystemComponentSlotContainment | null => {
	let current = entitiesById[elementId];
	let parentId = current?.parentId ?? null;

	while (parentId) {
		const parent = entitiesById[parentId];
		if (!parent) {
			return null;
		}
		const metadata = getElementSystemComponentMetadata(parent);
		if (metadata?.slotName) {
			return {
				hostId: parent.id,
				slotName: metadata.slotName,
				systemId: metadata.systemId,
				componentId: metadata.componentId,
				instanceId: metadata.instanceId,
				version: metadata.version,
			};
		}
		current = parent;
		parentId = current.parentId;
	}

	return null;
};

export const isSystemComponentSlotContent = (
	entitiesById: SystemComponentBoundaryEntityMap,
	elementId: string,
) => getContainingSystemComponentSlot(entitiesById, elementId) !== null;

export const canInsertIntoSystemComponentBoundary = (
	entitiesById: SystemComponentBoundaryEntityMap,
	parentId: string | null,
) => {
	if (parentId === null) {
		return true;
	}

	const parent = entitiesById[parentId];
	if (!parent) {
		return false;
	}

	return (
		!isSystemComponentOwnedStructuralNode(parent) ||
		isSystemComponentSlotHost(parent)
	);
};

export const canMoveElementAcrossSystemComponentBoundary = (
	entitiesById: SystemComponentBoundaryEntityMap,
	elementId: string,
	targetParentId: string | null,
) => {
	const entity = entitiesById[elementId];
	if (!entity) {
		return false;
	}

	const metadata = getElementSystemComponentMetadata(entity);
	if (metadata && !metadata.isRoot) {
		return false;
	}

	return canInsertIntoSystemComponentBoundary(entitiesById, targetParentId);
};

export const canDeleteElementAcrossSystemComponentBoundary = (
	entitiesById: SystemComponentBoundaryEntityMap,
	elementId: string,
) => {
	const entity = entitiesById[elementId];
	if (!entity) {
		return false;
	}

	const metadata = getElementSystemComponentMetadata(entity);
	return !metadata || metadata.isRoot;
};

export const canUpdateSystemComponentStructuralNode = (
	entitiesById: SystemComponentBoundaryEntityMap,
	elementId: string,
) => {
	const entity = entitiesById[elementId];
	return !isSystemComponentOwnedStructuralNode(entity);
};
