import { createStore, shallow, useSelector } from "@tanstack/react-store";
import {
	canHaveElementChildren,
	getDefaultProps,
	getDefaultText,
	getLibraryComponent,
	isValidControlValue,
	normalizeRole,
	type RecipeRef,
} from "../libraries/registry";
import {
	findRecipeControlTargetElement,
	getRecipeControlByPathAndProp,
} from "../recipes/controls";
import { detachRecipeInstance } from "../recipes/detach";
import { expandRegistryRecipe } from "../recipes/expansion";
import { updateStaleRecipeInstance } from "../recipes/migration";
import {
	canDeleteElementAcrossRecipeBoundary,
	canInsertIntoRecipeBoundary,
	canMoveElementAcrossRecipeBoundary,
} from "../recipes/ownership";
import {
	getRecipeSlotCandidateForExistingNode,
	isRecipeSlotInsertionAllowed,
} from "../recipes/slot-allowlist";
import { applyExtractSubtree } from "../services/design-transform-service";
import type {
	JsonPrimitive,
	Node,
	Props,
	Role,
	TrickroomDesign,
} from "../types";

export type ComponentSelection = Pick<
	Props,
	"data-trickroom-library" | "data-trickroom-component"
>;

export type DesignEntity = {
	id: string;
	props: Props;
	parentId: string | null;
	role: Role;
	childIds?: string[];
	text?: string;
};

export type DesignStoreState = {
	name: string;
	systemId?: string | null;
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

const canHaveChildren = (entity: DesignEntity | null | undefined) =>
	!!entity && canHaveElementChildren(entity.role);

function getComponentDefinition(selection: ComponentSelection) {
	return getLibraryComponent(
		selection["data-trickroom-library"],
		selection["data-trickroom-component"],
	);
}

function getComponentRole(selection: ComponentSelection): Role {
	return getComponentDefinition(selection).role;
}

function createComponentProps(
	name: string,
	selection: ComponentSelection,
): Props {
	const definition = getComponentDefinition(selection);
	const library = selection["data-trickroom-library"];
	const component = selection["data-trickroom-component"];
	return getDefaultProps(library, component, definition, name);
}

function normalizeEntity(
	data: Node,
	parentId: string | null,
	entitiesById: Record<string, DesignEntity>,
) {
	const role = normalizeRole(data.props["data-trickroom-role"]);
	const entity: DesignEntity = {
		id: data.id,
		props: { ...data.props, "data-trickroom-role": role },
		parentId,
		role,
	};

	entitiesById[data.id] = entity;

	if (role === "text") {
		entity.text = typeof data.children === "string" ? data.children : "";
		return;
	}

	if (role === "leaf") {
		entity.childIds = [];
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
		...(design.systemId !== undefined ? { systemId: design.systemId } : {}),
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

	const children =
		entity.role === "text"
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
		...(state.systemId !== undefined ? { systemId: state.systemId } : {}),
		...(state.systemId === undefined && state.systemName !== undefined
			? { systemName: state.systemName }
			: {}),
		boards: state.rootIds.map((rootId) =>
			serializeEntity(rootId, state.entitiesById),
		),
	};
}

export function extractSubtreeToDesign(
	id: string,
	options: { name?: string } = {},
): TrickroomDesign {
	return applyExtractSubtree(serializeDesignState(designStore.get()), {
		elementId: id,
		name: options.name,
	}).newDesign;
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
			revision: state.revision + 1,
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
		const role = normalizeRole(props["data-trickroom-role"]);
		const nextEntity: DesignEntity = {
			...entity,
			props: { ...props, "data-trickroom-role": role },
			role,
		};

		if (role === "text") {
			nextEntity.text = entity.text ?? "";
			delete nextEntity.childIds;
		} else if (role === "leaf") {
			nextEntity.childIds = [];
			delete nextEntity.text;
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

export function updateRecipeControl(
	instanceId: string,
	path: string,
	prop: string,
	value: JsonPrimitive,
) {
	designStore.setState((state) => {
		const target = findRecipeControlTargetElement(
			state.entitiesById,
			instanceId,
			path,
		);
		if (!target) {
			return state;
		}

		const recipeId = target.props["data-trickroom-recipe-id"];
		const control =
			typeof recipeId === "string"
				? getRecipeControlByPathAndProp(recipeId, path, prop)
				: null;
		if (!control || !isValidControlValue(control, value)) {
			return state;
		}

		return {
			...state,
			entitiesById: {
				...state.entitiesById,
				[target.id]: {
					...target,
					props: {
						...target.props,
						[prop]: value,
					},
				},
			},
			dirtyIds: {
				...state.dirtyIds,
				[target.id]: true,
			},
			revision: state.revision + 1,
		};
	});
}

export function renameElement(id: string, name: string) {
	updateElementProps(id, { "data-trickroom-name": name });
}

export function updateElementText(id: string, text: string) {
	designStore.setState((state) => {
		const entity = state.entitiesById[id];
		if (!entity || entity.role !== "text") {
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

		if (!canInsertIntoRecipeBoundary(state.entitiesById, targetParentId)) {
			return state;
		}

		if (
			!isRecipeSlotInsertionAllowed(state.entitiesById, targetParentId, {
				kind: "component",
				library: selection["data-trickroom-library"],
				component: selection["data-trickroom-component"],
			})
		) {
			return state;
		}

		const id = crypto.randomUUID();
		const role = getComponentRole(selection);
		const componentName = selection["data-trickroom-component"];
		const definition = getComponentDefinition(selection);
		const nextEntity: DesignEntity = {
			id,
			parentId: targetParentId,
			role,
			props: createComponentProps(definition.label || componentName, selection),
		};

		if (role === "text") {
			nextEntity.text = getDefaultText(role);
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

export function addRecipe(
	recipeRef: RecipeRef,
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

		if (!canInsertIntoRecipeBoundary(state.entitiesById, targetParentId)) {
			return state;
		}

		if (
			!isRecipeSlotInsertionAllowed(state.entitiesById, targetParentId, {
				kind: "recipe",
				library: recipeRef.library,
				recipe: recipeRef.recipe,
			})
		) {
			return state;
		}

		const expansion = expandRegistryRecipe(recipeRef.library, recipeRef.recipe);
		const insertedEntitiesById: Record<string, DesignEntity> = {};
		normalizeEntity(expansion.root, targetParentId, insertedEntitiesById);

		const nextEntitiesById: Record<string, DesignEntity> = {
			...state.entitiesById,
			...insertedEntitiesById,
		};

		let nextRootIds = state.rootIds;
		const nextDirtyIds = {
			...state.dirtyIds,
		};

		for (const id of Object.keys(insertedEntitiesById)) {
			nextDirtyIds[id] = true;
		}

		if (!targetParentId) {
			nextRootIds = insertAt(nextRootIds, expansion.root.id, index);
		} else {
			const parentChildIds = targetParent.childIds ?? [];
			nextEntitiesById[targetParentId] = {
				...targetParent,
				childIds: insertAt(parentChildIds, expansion.root.id, index),
			};
			nextDirtyIds[targetParentId] = true;
		}

		return {
			...state,
			rootIds: nextRootIds,
			entitiesById: nextEntitiesById,
			selectedId: expansion.root.id,
			dirtyIds: nextDirtyIds,
			revision: state.revision + 1,
		};
	});
}

export function detachRecipe(id: string) {
	designStore.setState((state) => {
		const result = detachRecipeInstance(serializeDesignState(state).boards, id);
		if (!result) {
			return state;
		}

		const nextState = normalizeDesign({
			...serializeDesignState(state),
			boards: result.roots,
		});
		const nextDirtyIds = {
			...state.dirtyIds,
		};
		for (const detachedElementId of result.detachedElementIds) {
			nextDirtyIds[detachedElementId] = true;
		}

		return {
			...nextState,
			selectedId: nextState.entitiesById[result.selectionElementId]
				? result.selectionElementId
				: state.selectedId && nextState.entitiesById[state.selectedId]
					? state.selectedId
					: null,
			dirtyIds: nextDirtyIds,
			designDirty: state.designDirty,
			revision: state.revision + 1,
		};
	});
}

export function updateRecipeInstance(id: string) {
	designStore.setState((state) => {
		const result = updateStaleRecipeInstance(serializeDesignState(state), id);
		const nextState = normalizeDesign(result.design);
		const dirtyIds = { ...state.dirtyIds };
		for (const mapping of [
			...result.metadata.preservedPaths,
			...result.metadata.remappedPaths,
			...result.metadata.addedPaths,
		]) {
			dirtyIds[mapping.elementId] = true;
		}

		return {
			...nextState,
			selectedId: nextState.entitiesById[result.changedElementId]
				? result.changedElementId
				: result.metadata.rootElementId,
			dirtyIds,
			designDirty: state.designDirty,
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

		if (
			!canMoveElementAcrossRecipeBoundary(
				state.entitiesById,
				id,
				targetParentId,
			)
		) {
			return state;
		}

		const candidate = getRecipeSlotCandidateForExistingNode(
			state.entitiesById,
			id,
		);
		if (
			candidate &&
			!isRecipeSlotInsertionAllowed(
				state.entitiesById,
				targetParentId,
				candidate,
			)
		) {
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

		if (!canDeleteElementAcrossRecipeBoundary(state.entitiesById, id)) {
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

export function isDesignCleanAtRevision(expectedRevision: number) {
	const state = designStore.get();
	return state.revision === expectedRevision && !hasDirtyChanges(state);
}

export function serializeDesign() {
	return serializeDesignState(designStore.get());
}

export function useDesignName() {
	return useSelector(designStore, (state) => state.name);
}

export function setDesignName(name: string) {
	const trimmed = name.trim();
	if (!trimmed) return;

	designStore.setState((state) => {
		if (state.name === trimmed) return state;
		return {
			...state,
			name: trimmed,
			designDirty: true,
			revision: state.revision + 1,
		};
	});
}

export function useDesignSystemName() {
	return useSelector(designStore, (state) => state.systemName);
}

export function useDesignSystemId() {
	return useSelector(designStore, (state) => state.systemId);
}

function normalizeDesignSystemIdInput(systemId: string | null): string | null {
	if (systemId === null) {
		return null;
	}

	const trimmedSystemId = systemId.trim();
	return trimmedSystemId.length > 0 ? trimmedSystemId : null;
}

export function setDesignSystemId(systemId: string | null) {
	const nextSystemId = normalizeDesignSystemIdInput(systemId);

	designStore.setState((state) => {
		if (state.systemId === nextSystemId && state.systemName === undefined) {
			return state;
		}

		return {
			...state,
			systemId: nextSystemId,
			systemName: undefined,
			designDirty: true,
			revision: state.revision + 1,
		};
	});
}

export function setDesignSystemName(systemName: string | null) {
	setDesignSystemId(systemName);
}

export function useDesignRoots() {
	return useSelector(designStore, (state) => state.rootIds, {
		compare: shallow,
	});
}

export function useLayerTreeSnapshot() {
	return useSelector(
		designStore,
		(state) => ({
			rootIds: state.rootIds,
			entitiesById: state.entitiesById,
		}),
		{ compare: shallow },
	);
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
