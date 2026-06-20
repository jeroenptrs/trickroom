import { createStore, shallow, useSelector } from "@tanstack/react-store";
import { getLibraryComponent } from "../libraries/registry";
import type { Node, Props, TrickroomDesign } from "../types";

type ComponentSelection = Pick<
	Props,
	"data-trickroom-library" | "data-trickroom-component"
>;

type TrickroomRole = Props["data-trickroom-role"];

export type DesignEntity = {
	id: string;
	props: Props;
	parentId: string | null;
	role: TrickroomRole;
	childIds?: string[];
	text?: string;
};

export type DesignStoreState = {
	name: string;
	systemName?: string | null;
	rootIds: string[];
	entitiesById: Record<string, DesignEntity>;
	selectedId: string | null;
	dirtyIds: Record<string, true>;
	designDirty: boolean;
	revision: number;
};

const emptyState: DesignStoreState = {
	name: "",
	rootIds: [],
	entitiesById: {},
	selectedId: null,
	dirtyIds: {},
	designDirty: false,
	revision: 0,
};
const emptyIds: string[] = [];

export const designStore = createStore<DesignStoreState>(emptyState);

const isTextRole = (role: TrickroomRole) => role === "text";

const canHaveChildren = (entity: DesignEntity | null | undefined) =>
	!!entity && !isTextRole(entity.role);

function getComponentRole(selection: ComponentSelection): TrickroomRole {
	return getLibraryComponent(
		selection["data-trickroom-library"],
		selection["data-trickroom-component"],
	).role;
}

function createComponentProps(
	name: string,
	selection: ComponentSelection,
): Props {
	const role = getComponentRole(selection);
	return {
		"data-trickroom-name": name,
		"data-trickroom-library": selection["data-trickroom-library"],
		"data-trickroom-component": selection["data-trickroom-component"],
		...(role ? { "data-trickroom-role": role } : {}),
	};
}

function normalizeEntity(
	data: Node,
	parentId: string | null,
	entitiesById: Record<string, DesignEntity>,
) {
	const role = data.props["data-trickroom-role"];
	const entity: DesignEntity = {
		id: data.id,
		props: { ...data.props },
		parentId,
		role,
	};

	entitiesById[data.id] = entity;

	if (isTextRole(role)) {
		entity.text = typeof data.children === "string" ? data.children : "";
		return;
	}

	if (typeof data.children === "string") {
		entity.childIds = [];
		return;
	}

	entity.childIds = data.children.map((child) => child.id);
	for (const child of data.children) {
		normalizeEntity(child, data.id, entitiesById);
	}
}

export function normalizeDesign(design: TrickroomDesign): DesignStoreState {
	const entitiesById: Record<string, DesignEntity> = {};

	for (const board of design.boards) {
		normalizeEntity(board, null, entitiesById);
	}

	return {
		name: design.name,
		...(design.systemName !== undefined
			? { systemName: design.systemName }
			: {}),
		rootIds: design.boards.map((board) => board.id),
		entitiesById,
		selectedId: null,
		dirtyIds: {},
		designDirty: false,
		revision: 0,
	};
}

function serializeEntity(
	entityId: string,
	entitiesById: Record<string, DesignEntity>,
): Node {
	const entity = entitiesById[entityId];
	if (!entity) {
		throw new Error(`Cannot serialize missing design entity: ${entityId}`);
	}

	const children = isTextRole(entity.role)
		? (entity.text ?? "")
		: (entity.childIds ?? []).map((childId) =>
				serializeEntity(childId, entitiesById),
			);

	return {
		id: entity.id,
		props: entity.props,
		children: children as string | Node[],
	};
}

export function serializeDesignState(state: DesignStoreState): TrickroomDesign {
	return {
		name: state.name,
		...(state.systemName !== undefined
			? { systemName: state.systemName }
			: {}),
		boards: state.rootIds.map((rootId) =>
			serializeEntity(rootId, state.entitiesById),
		),
	};
}

const hasDirtyChanges = (state: DesignStoreState) =>
	state.designDirty || Object.keys(state.dirtyIds).length > 0;

const isSameSerializedDesign = (
	state: DesignStoreState,
	design: TrickroomDesign,
) => JSON.stringify(serializeDesignState(state)) === JSON.stringify(design);

export function hydrateDesign(design: TrickroomDesign) {
	designStore.setState((state) => {
		if (hasDirtyChanges(state)) {
			return state;
		}

		if (isSameSerializedDesign(state, design)) {
			return state;
		}

		// TODO: show popup that page was reloaded because changes were detected

		const nextState = normalizeDesign(design);
		return {
			...nextState,
			revision: state.revision,
			selectedId:
				state.selectedId && nextState.entitiesById[state.selectedId]
					? state.selectedId
					: null,
		};
	});
}

export function selectElement(id: string | null) {
	designStore.setState((state) => {
		if (state.selectedId === id) {
			return state;
		}

		return {
			...state,
			selectedId: id && state.entitiesById[id] ? id : null,
		};
	});
}

export function updateElementProps(id: string, patch: Partial<Props>) {
	designStore.setState((state) => {
		const entity = state.entitiesById[id];
		if (!entity) {
			return state;
		}
		const props = {
			...entity.props,
			...patch,
		};
		const role = props["data-trickroom-role"];
		const nextEntity: DesignEntity = {
			...entity,
			props,
			role,
		};

		if (isTextRole(role)) {
			nextEntity.text = entity.text ?? "";
			delete nextEntity.childIds;
		} else {
			nextEntity.childIds = entity.childIds ?? [];
			delete nextEntity.text;
		}

		return {
			...state,
			entitiesById: {
				...state.entitiesById,
				[id]: nextEntity,
			},
			dirtyIds: {
				...state.dirtyIds,
				[id]: true,
			},
			revision: state.revision + 1,
		};
	});
}

export function updateElementClassName(id: string, className: string) {
	updateElementProps(id, { className });
}

export function renameElement(id: string, name: string) {
	updateElementProps(id, { "data-trickroom-name": name });
}

export function updateElementText(id: string, text: string) {
	designStore.setState((state) => {
		const entity = state.entitiesById[id];
		if (!entity || !isTextRole(entity.role)) {
			return state;
		}

		return {
			...state,
			entitiesById: {
				...state.entitiesById,
				[id]: {
					...entity,
					text,
				},
			},
			dirtyIds: {
				...state.dirtyIds,
				[id]: true,
			},
			revision: state.revision + 1,
		};
	});
}

function withoutId(ids: string[], id: string) {
	return ids.filter((currentId) => currentId !== id);
}

function insertAt(ids: string[], id: string, index: number) {
	const nextIds = [...ids];
	const boundedIndex = Math.max(0, Math.min(index, nextIds.length));
	nextIds.splice(boundedIndex, 0, id);
	return nextIds;
}

export function addElement(
	selection: ComponentSelection,
	targetParentId: string | null,
	index: number,
) {
	designStore.setState((state) => {
		const targetParent = targetParentId
			? state.entitiesById[targetParentId]
			: null;

		if (targetParentId && !canHaveChildren(targetParent)) {
			return state;
		}

		const id = crypto.randomUUID();
		const role = getComponentRole(selection);
		const componentName = selection["data-trickroom-component"];
		const nextEntity: DesignEntity = {
			id,
			parentId: targetParentId,
			role,
			props: createComponentProps(
				componentName === "container" ? "Container" : "Text",
				selection,
			),
		};

		if (isTextRole(role)) {
			nextEntity.text = "Text";
		} else {
			nextEntity.childIds = [];
		}

		const nextEntitiesById: Record<string, DesignEntity> = {
			...state.entitiesById,
			[id]: nextEntity,
		};

		let nextRootIds = state.rootIds;
		const nextDirtyIds = {
			...state.dirtyIds,
			[id]: true,
		};

		if (!targetParentId) {
			nextRootIds = insertAt(nextRootIds, id, index);
		} else {
			const parentChildIds = targetParent.childIds ?? [];
			nextEntitiesById[targetParentId] = {
				...targetParent,
				childIds: insertAt(parentChildIds, id, index),
			};
			nextDirtyIds[targetParentId] = true;
		}

		return {
			...state,
			rootIds: nextRootIds,
			entitiesById: nextEntitiesById,
			selectedId: id,
			dirtyIds: nextDirtyIds,
			revision: state.revision + 1,
		};
	});
}

function isDescendantOf(
	entitiesById: Record<string, DesignEntity>,
	id: string,
	ancestorId: string,
) {
	let current = entitiesById[id] ?? null;

	while (current?.parentId) {
		if (current.parentId === ancestorId) {
			return true;
		}

		current = entitiesById[current.parentId] ?? null;
	}

	return false;
}

function collectDescendantIds(
	entitiesById: Record<string, DesignEntity>,
	id: string,
	ids: Set<string>,
) {
	if (ids.has(id)) {
		return;
	}

	ids.add(id);
	const entity = entitiesById[id];
	for (const childId of entity?.childIds ?? []) {
		collectDescendantIds(entitiesById, childId, ids);
	}
}

export function moveElement(
	id: string,
	targetParentId: string | null,
	index: number,
) {
	designStore.setState((state) => {
		const entity = state.entitiesById[id];
		const targetParent = targetParentId
			? state.entitiesById[targetParentId]
			: null;

		if (
			!entity ||
			targetParentId === id ||
			(targetParentId && isDescendantOf(state.entitiesById, targetParentId, id))
		) {
			return state;
		}

		if (targetParentId && !canHaveChildren(targetParent)) {
			return state;
		}

		const nextEntitiesById = {
			...state.entitiesById,
			[id]: {
				...entity,
				parentId: targetParentId,
			},
		};

		let nextRootIds = state.rootIds;
		if (entity.parentId === null) {
			nextRootIds = withoutId(nextRootIds, id);
		} else {
			const previousParent = state.entitiesById[entity.parentId];
			if (!previousParent?.childIds) {
				return state;
			}

			nextEntitiesById[entity.parentId] = {
				...previousParent,
				childIds: withoutId(previousParent.childIds, id),
			};
		}

		if (targetParentId === null) {
			nextRootIds = insertAt(nextRootIds, id, index);
		} else {
			const parent = nextEntitiesById[targetParentId];
			if (!parent?.childIds) {
				return state;
			}

			nextEntitiesById[targetParentId] = {
				...parent,
				childIds: insertAt(withoutId(parent.childIds, id), id, index),
			};
		}

		return {
			...state,
			rootIds: nextRootIds,
			entitiesById: nextEntitiesById,
			dirtyIds: {
				...state.dirtyIds,
				[id]: true,
			},
			revision: state.revision + 1,
		};
	});
}

export function deleteElement(id: string) {
	designStore.setState((state) => {
		const entity = state.entitiesById[id];
		if (!entity) {
			return state;
		}

		const deletedIds = new Set<string>();
		collectDescendantIds(state.entitiesById, id, deletedIds);

		const nextEntitiesById = { ...state.entitiesById };
		for (const deletedId of deletedIds) {
			delete nextEntitiesById[deletedId];
		}

		let nextRootIds = state.rootIds;
		const dirtyTargetId = entity.parentId ?? id;

		if (entity.parentId === null) {
			nextRootIds = withoutId(nextRootIds, id);
		} else {
			const parent = state.entitiesById[entity.parentId];
			if (parent?.childIds) {
				nextEntitiesById[entity.parentId] = {
					...parent,
					childIds: withoutId(parent.childIds, id),
				};
			}
		}

		return {
			...state,
			rootIds: nextRootIds,
			entitiesById: nextEntitiesById,
			selectedId:
				state.selectedId && deletedIds.has(state.selectedId)
					? null
					: state.selectedId,
			dirtyIds: {
				...state.dirtyIds,
				[dirtyTargetId]: true,
			},
			revision: state.revision + 1,
		};
	});
}

export function clearDirty(expectedRevision?: number) {
	designStore.setState((state) => {
		if (expectedRevision !== undefined && state.revision !== expectedRevision) {
			return state;
		}

		if (!hasDirtyChanges(state)) {
			return state;
		}

		return {
			...state,
			dirtyIds: {},
			designDirty: false,
		};
	});
}

export function serializeDesign() {
	return serializeDesignState(designStore.get());
}

export function useDesignName() {
	return useSelector(designStore, (state) => state.name);
}

export function useDesignSystemName() {
	return useSelector(designStore, (state) => state.systemName);
}

function normalizeDesignSystemNameInput(
	systemName: string | null,
): string | null {
	if (systemName === null) {
		return null;
	}

	const trimmedSystemName = systemName.trim();
	return trimmedSystemName.length > 0 ? trimmedSystemName : null;
}

export function setDesignSystemName(systemName: string | null) {
	const nextSystemName = normalizeDesignSystemNameInput(systemName);

	designStore.setState((state) => {
		if (state.systemName === nextSystemName) {
			return state;
		}

		return {
			...state,
			systemName: nextSystemName,
			designDirty: true,
			revision: state.revision + 1,
		};
	});
}

export function useDesignRoots() {
	return useSelector(designStore, (state) => state.rootIds, {
		compare: shallow,
	});
}

export function useHasUnsavedChanges() {
	return useSelector(designStore, hasDirtyChanges);
}

export function useDesignRevision() {
	return useSelector(designStore, (state) => state.revision);
}

export function useElement(id: string) {
	return useSelector(designStore, (state) => state.entitiesById[id]);
}

export function useChildren(parentId: string) {
	return useSelector(
		designStore,
		(state) => state.entitiesById[parentId]?.childIds ?? emptyIds,
		{ compare: shallow },
	);
}

export function useSelectedId() {
	return useSelector(designStore, (state) => state.selectedId);
}

export function useSelectedElement() {
	return useSelector(designStore, (state) => {
		if (!state.selectedId) {
			return null;
		}

		return state.entitiesById[state.selectedId] ?? null;
	});
}

export function useLayerSummary(id: string) {
	return useSelector(
		designStore,
		(state) => {
			const entity = state.entitiesById[id];
			return {
				id,
				name: entity?.props["data-trickroom-name"] ?? "Untitled",
				className: entity?.props.className,
				parentId: entity?.parentId ?? null,
				role: entity?.role,
				canHaveChildren: canHaveChildren(entity),
				childIds: entity?.childIds ?? emptyIds,
				isSelected: state.selectedId === id,
			};
		},
		{ compare: shallow },
	);
}
