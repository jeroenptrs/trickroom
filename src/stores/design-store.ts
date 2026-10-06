import { createStore, shallow, useSelector } from "@tanstack/react-store";
import {
	canHaveElementChildren,
	getDefaultProps,
	getDefaultText,
	getLibraryComponent,
	isValidControlValue,
	normalizeRole,
	type RecipeRef,
	uniquifyControlPropsAmongSiblings,
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
	getRecipeSlotCandidateFromProps,
	isRecipeSlotInsertionAllowed,
} from "../recipes/slot-allowlist";
import type { DesignFileRevision } from "../services/design-file-service.types";
import type {
	JsonPrimitive,
	Node,
	Props,
	Role,
	TrickroomDesign,
} from "../types";
import { detachSystemComponentInstance } from "../utils/system-component-detach";
import {
	type SystemComponentInstanceMigrationContext,
	updateStaleSystemComponentInstance,
} from "../utils/system-component-instance-migration";
import {
	setSystemComponentOverrideAssetIdOnRoots,
	setSystemComponentOverrideClassNameOnRoots,
	setSystemComponentOverrideIconIdOnRoots,
	setSystemComponentOverridePropOnRoots,
	setSystemComponentOverrideTextOnRoots,
	setSystemComponentVariantValueOnRoots,
	updateSystemComponentInstanceOnRoots,
} from "../utils/system-component-instance-update";
import { isSystemComponentMarkerPropKey } from "../utils/system-component-markers";
import {
	canDeleteElementAcrossSystemComponentBoundary,
	canInsertIntoSystemComponentBoundary,
	canMoveElementAcrossSystemComponentBoundary,
	canUpdateSystemComponentStructuralNode,
	isSystemComponentOwnedStructuralNode,
} from "../utils/system-component-ownership";
import type { PublishedSystemComponentVersion } from "../utils/system-components";
import {
	type DesignManifest,
	isSameJson,
	isSameManifest,
	type ManifestField,
} from "./design-merge";

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

/** A board as last read from or written to disk. */
export type DesignBaseBoard = {
	node: Node;
	/** The board's revision on disk; null when the server did not report it. */
	revision: string | null;
};

/**
 * The last version of each part of the design known to be on disk: what the
 * local edits are based on. Live sync compares disk changes against it to
 * tell external changes from local ones, and merges against it.
 */
export type DesignBase = {
	manifest: DesignManifest;
	manifestRevision: string | null;
	order: string[];
	boards: Record<string, DesignBaseBoard>;
};

export type BoardConflict = {
	boardId: string;
	/** Layer name of the board, for the dialog. */
	name: string;
	/**
	 * `changed`: changed here and on disk; `deleted-on-disk`: changed here,
	 * deleted on disk; `deleted-here`: deleted here, changed on disk.
	 */
	reason: "changed" | "deleted-on-disk" | "deleted-here";
	/** Layers changed on both sides (empty when the conflict is not per layer). */
	nodeIds: string[];
	/** The disk version, or null when the board is deleted on disk. */
	theirs: Node | null;
	theirsRevision: string | null;
};

/** Disk changes that conflict with unsaved local edits, waiting for a choice. */
export type DesignConflicts = {
	/** The disk state the conflicts were found against. */
	disk: DiskDesignRevisions;
	boards: BoardConflict[];
	manifest: {
		theirs: DesignManifest;
		fields: ManifestField[];
	} | null;
	order: { theirs: string[] } | null;
};

/** The revisions of every part of a design on disk. */
export type DiskDesignRevisions = {
	/** The design revision of exactly this state; null when not known. */
	revision: DesignFileRevision | null;
	manifestRevision: string | null;
	order: string[];
	boardRevisions: Record<string, string | null>;
};

export type DesignStoreState = {
	version?: TrickroomDesign["version"];
	name: string;
	systemId?: string | null;
	systemName?: string | null;
	componentMigrationPolicy?: TrickroomDesign["componentMigrationPolicy"];
	rootIds: string[];
	entitiesById: Record<string, DesignEntity>;
	selectedId: string | null;
	/** Nodes changed locally since the last save (informational). */
	dirtyIds: Record<string, true>;
	designDirty: boolean;
	revision: number;
	persistedRevision?: DesignFileRevision | null;
	externalConflictPending?: boolean;
	designSavePending?: boolean;
	/** What local edits are based on; null before a design is loaded. */
	base?: DesignBase | null;
	/**
	 * Boards with unsaved local edits (including boards added or deleted
	 * locally), each with the store revision of its latest edit, so a save can
	 * tell edits it carried from edits made while it was in flight.
	 */
	dirtyBoards?: Record<string, number>;
	/** Store revision of the latest unsaved change to name or system. */
	manifestDirtyAt?: number | null;
	/** Store revision of the latest unsaved reorder of boards. */
	orderDirtyAt?: number | null;
	conflicts?: DesignConflicts | null;
};

const cleanSyncState = {
	dirtyBoards: {},
	manifestDirtyAt: null,
	orderDirtyAt: null,
	conflicts: null,
} satisfies Partial<DesignStoreState>;

const emptyState: DesignStoreState = {
	name: "",
	rootIds: [],
	entitiesById: {},
	selectedId: null,
	dirtyIds: {},
	designDirty: false,
	revision: 0,
	persistedRevision: null,
	externalConflictPending: false,
	designSavePending: false,
	base: null,
	...cleanSyncState,
};
const emptyIds: string[] = [];

export const designStore = createStore<DesignStoreState>(emptyState);

const canHaveChildren = (
	entity: DesignEntity | null | undefined,
): entity is DesignEntity => !!entity && canHaveElementChildren(entity.role);

/**
 * Resolves where an insertion lands: `{ parent: null }` for the root level,
 * the parent entity when it accepts children, or null when it does not.
 */
function resolveInsertionParent(
	state: DesignStoreState,
	targetParentId: string | null,
): { parent: DesignEntity | null } | null {
	if (!targetParentId) {
		return { parent: null };
	}
	const parent = state.entitiesById[targetParentId];
	return canHaveChildren(parent) ? { parent } : null;
}

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

const isSameIdList = (left?: string[], right?: string[]) =>
	left === right ||
	(left !== undefined &&
		right !== undefined &&
		left.length === right.length &&
		left.every((id, index) => id === right[index]));

/**
 * Returns `previous` when it describes the same node as `next`, so stores and
 * subscribers comparing entities by reference see no change for nodes a
 * reload did not touch.
 */
function reuseEntity(
	next: DesignEntity,
	previous: DesignEntity | undefined,
): DesignEntity {
	if (
		!previous ||
		previous.parentId !== next.parentId ||
		previous.role !== next.role ||
		previous.text !== next.text ||
		!isSameIdList(previous.childIds, next.childIds) ||
		!isSameJson(previous.props, next.props)
	) {
		return next;
	}
	return previous;
}

/**
 * Normalizes a node tree into `entitiesById`. With `previousEntitiesById`,
 * structurally unchanged nodes keep their existing entity object.
 */
export function normalizeEntity(
	data: Node,
	parentId: string | null,
	entitiesById: Record<string, DesignEntity>,
	previousEntitiesById?: Record<string, DesignEntity>,
) {
	const role = normalizeRole(data.props["data-trickroom-role"]);
	const entity: DesignEntity = {
		id: data.id,
		props: { ...data.props, "data-trickroom-role": role },
		parentId,
		role,
	};
	// Parents are inserted before their children, as callers iterate in order.
	entitiesById[data.id] = entity;

	if (role === "text") {
		entity.text = typeof data.children === "string" ? data.children : "";
	} else if (role === "leaf" || typeof data.children === "string") {
		entity.childIds = [];
	} else {
		entity.childIds = data.children.map((child) => child.id);
		for (const child of data.children) {
			normalizeEntity(child, data.id, entitiesById, previousEntitiesById);
		}
	}

	entitiesById[data.id] = reuseEntity(entity, previousEntitiesById?.[data.id]);
}

export function normalizeDesign(
	design: TrickroomDesign,
	previousEntitiesById?: Record<string, DesignEntity>,
): DesignStoreState {
	const entitiesById: Record<string, DesignEntity> = {};

	for (const board of design.boards) {
		normalizeEntity(board, null, entitiesById, previousEntitiesById);
	}

	return {
		...(design.version !== undefined ? { version: design.version } : {}),
		name: design.name,
		...(design.systemId !== undefined ? { systemId: design.systemId } : {}),
		...(design.systemName !== undefined
			? { systemName: design.systemName }
			: {}),
		...(design.componentMigrationPolicy !== undefined
			? { componentMigrationPolicy: design.componentMigrationPolicy }
			: {}),
		rootIds: design.boards.map((board) => board.id),
		entitiesById,
		selectedId: null,
		dirtyIds: {},
		designDirty: false,
		revision: 0,
		persistedRevision: null,
		externalConflictPending: false,
		designSavePending: false,
		base: null,
		...cleanSyncState,
	};
}

export function serializeEntity(
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
		...(state.version !== undefined ? { version: state.version } : {}),
		name: state.name,
		...(state.systemId !== undefined ? { systemId: state.systemId } : {}),
		...(state.systemId === undefined && state.systemName !== undefined
			? { systemName: state.systemName }
			: {}),
		...(state.componentMigrationPolicy !== undefined
			? { componentMigrationPolicy: state.componentMigrationPolicy }
			: {}),
		boards: state.rootIds.map((rootId) =>
			serializeEntity(rootId, state.entitiesById),
		),
	};
}

const hasDirtyChanges = (state: DesignStoreState) =>
	state.designDirty ||
	Object.keys(state.dirtyIds).length > 0 ||
	Object.keys(state.dirtyBoards ?? {}).length > 0 ||
	(state.manifestDirtyAt ?? null) !== null ||
	(state.orderDirtyAt ?? null) !== null;

/**
 * Whether leaving the open design now could lose work: unsaved edits, a save
 * in flight or an unresolved conflict with the disk version.
 */
export const hasPendingDesignWork = (state = designStore.get()) =>
	hasDirtyChanges(state) ||
	(state.externalConflictPending ?? false) ||
	(state.conflicts ?? null) !== null ||
	(state.designSavePending ?? false);

/**
 * Whether the store holds `design`. The store does not keep `updatedAt`
 * (server-owned, see `TrickroomDesign`), so it is left out of the comparison.
 */
const isSameSerializedDesign = (
	state: DesignStoreState,
	{ updatedAt: _updatedAt, ...design }: TrickroomDesign,
) => JSON.stringify(serializeDesignState(state)) === JSON.stringify(design);

/** The revision of each part of a design, as the server reports it. */
export type DesignPartRevisions = {
	manifest: string;
	boards: { id: string; revision: string }[];
};

/** The board a node belongs to, or null when it is not in the tree. */
export function getBoardIdOf(
	entitiesById: Record<string, DesignEntity>,
	id: string,
): string | null {
	let current = entitiesById[id];
	const seen = new Set<string>();
	while (current && current.parentId !== null && !seen.has(current.id)) {
		seen.add(current.id);
		current = entitiesById[current.parentId];
	}
	return current && current.parentId === null ? current.id : null;
}

export const getDesignManifest = (
	state: Pick<
		DesignStoreState,
		"name" | "systemId" | "systemName" | "componentMigrationPolicy"
	>,
): DesignManifest => ({
	name: state.name,
	...(state.systemId !== undefined ? { systemId: state.systemId } : {}),
	...(state.systemName !== undefined ? { systemName: state.systemName } : {}),
	...(state.componentMigrationPolicy !== undefined
		? { componentMigrationPolicy: state.componentMigrationPolicy }
		: {}),
});

/** A base for a design just read from disk. */
export function createDesignBase(
	design: TrickroomDesign,
	parts?: DesignPartRevisions | null,
): DesignBase {
	const revisions = new Map(
		(parts?.boards ?? []).map((board) => [board.id, board.revision]),
	);
	return {
		manifest: getDesignManifest(design),
		manifestRevision: parts?.manifest ?? null,
		order: design.boards.map((board) => board.id),
		boards: Object.fromEntries(
			design.boards.map((board) => [
				board.id,
				{ node: board, revision: revisions.get(board.id) ?? null },
			]),
		),
	};
}

/**
 * Records which parts of the design a local edit touched: the boards of every
 * node it marked dirty (where the node was and where it is now, so a move
 * marks both boards), boards it added or removed, a change to the relative
 * order of boards, and changes to the design's top-level fields.
 */
function trackLocalChange(
	previous: DesignStoreState,
	next: DesignStoreState,
): DesignStoreState {
	if (next === previous) {
		return next;
	}
	const at = next.revision;
	let dirtyBoards = next.dirtyBoards ?? {};
	let copied = false;
	const mark = (boardId: string | null) => {
		if (boardId === null || dirtyBoards[boardId] === at) {
			return;
		}
		if (!copied) {
			dirtyBoards = { ...dirtyBoards };
			copied = true;
		}
		dirtyBoards[boardId] = at;
	};

	for (const id of Object.keys(next.dirtyIds)) {
		if (
			previous.dirtyIds[id] &&
			previous.entitiesById[id] === next.entitiesById[id]
		) {
			continue;
		}
		mark(getBoardIdOf(next.entitiesById, id));
		mark(getBoardIdOf(previous.entitiesById, id));
	}

	let orderDirtyAt = next.orderDirtyAt ?? null;
	if (previous.rootIds !== next.rootIds) {
		const before = new Set(previous.rootIds);
		const after = new Set(next.rootIds);
		for (const id of next.rootIds) {
			if (!before.has(id)) mark(id);
		}
		for (const id of previous.rootIds) {
			if (!after.has(id)) mark(id);
		}
		const kept = next.rootIds.filter((id) => before.has(id));
		const keptBefore = previous.rootIds.filter((id) => after.has(id));
		if (kept.some((id, index) => keptBefore[index] !== id)) {
			orderDirtyAt = at;
		}
	}

	const manifestDirtyAt = isSameManifest(
		getDesignManifest(previous),
		getDesignManifest(next),
	)
		? (next.manifestDirtyAt ?? null)
		: at;

	return { ...next, dirtyBoards, manifestDirtyAt, orderDirtyAt };
}

/** Applies a local edit and records which parts of the design it touched. */
function mutateDesign(update: (state: DesignStoreState) => DesignStoreState) {
	designStore.setState((state) => trackLocalChange(state, update(state)));
}

const keepSelection = (
	selectedId: string | null,
	entitiesById: Record<string, DesignEntity>,
) => (selectedId && entitiesById[selectedId] ? selectedId : null);

export function hydrateDesign(
	design: TrickroomDesign,
	persistedRevision?: DesignFileRevision,
	parts?: DesignPartRevisions | null,
) {
	designStore.setState((state) => {
		if (hasDirtyChanges(state) || state.conflicts) {
			return state;
		}

		if (isSameSerializedDesign(state, design)) {
			if (
				(!persistedRevision || state.persistedRevision === persistedRevision) &&
				state.base &&
				!parts
			) {
				return state;
			}
			return {
				...state,
				persistedRevision: persistedRevision ?? state.persistedRevision ?? null,
				base: createDesignBase(design, parts),
			};
		}

		const nextState = normalizeDesign(design, state.entitiesById);
		return {
			...nextState,
			revision: state.revision + 1,
			persistedRevision: persistedRevision ?? state.persistedRevision ?? null,
			base: createDesignBase(design, parts),
			externalConflictPending: false,
			designSavePending: false,
			selectedId: keepSelection(state.selectedId, nextState.entitiesById),
		};
	});
}

export function forceHydrateDesign(
	design: TrickroomDesign,
	persistedRevision: DesignFileRevision,
	parts?: DesignPartRevisions | null,
) {
	designStore.setState((state) => {
		const nextState = normalizeDesign(design, state.entitiesById);
		return {
			...nextState,
			revision: state.revision + 1,
			persistedRevision,
			base: createDesignBase(design, parts),
			externalConflictPending: false,
			selectedId: keepSelection(state.selectedId, nextState.entitiesById),
		};
	});
}

export function setPersistedDesignRevision(revision: DesignFileRevision) {
	designStore.setState((state) =>
		state.persistedRevision === revision
			? state
			: { ...state, persistedRevision: revision },
	);
}

export function setExternalConflictPending(pending: boolean) {
	designStore.setState((state) =>
		state.externalConflictPending === pending
			? state
			: { ...state, externalConflictPending: pending },
	);
}

export function setDesignSavePending(pending: boolean) {
	designStore.setState((state) =>
		state.designSavePending === pending
			? state
			: { ...state, designSavePending: pending },
	);
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
	mutateDesign((state) => {
		const entity = state.entitiesById[id];
		if (!entity) {
			return state;
		}
		if (Object.keys(patch).some(isSystemComponentMarkerPropKey)) {
			return state;
		}
		if (
			!canUpdateSystemComponentStructuralNode(state.entitiesById, id) &&
			Object.keys(patch).length > 0
		) {
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
	mutateDesign((state) => {
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
	mutateDesign((state) => {
		const entity = state.entitiesById[id];
		if (!entity || entity.role !== "text") {
			return state;
		}
		if (isSystemComponentOwnedStructuralNode(entity)) {
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
	mutateDesign((state) => {
		const insertion = resolveInsertionParent(state, targetParentId);
		if (!insertion) {
			return state;
		}
		const targetParent = insertion.parent;

		if (!canInsertIntoRecipeBoundary(state.entitiesById, targetParentId)) {
			return state;
		}
		if (
			!canInsertIntoSystemComponentBoundary(state.entitiesById, targetParentId)
		) {
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
		const siblingIds = targetParent
			? (targetParent.childIds ?? [])
			: state.rootIds;
		const siblingProps = siblingIds.flatMap(
			(siblingId) => state.entitiesById[siblingId]?.props ?? [],
		);
		const nextEntity: DesignEntity = {
			id,
			parentId: targetParentId,
			role,
			props: uniquifyControlPropsAmongSiblings(
				createComponentProps(definition.label || componentName, selection),
				definition,
				siblingProps,
			),
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
		const nextDirtyIds: Record<string, true> = {
			...state.dirtyIds,
			[id]: true,
		};

		if (!targetParent) {
			nextRootIds = insertAt(nextRootIds, id, index);
		} else {
			nextEntitiesById[targetParent.id] = {
				...targetParent,
				childIds: insertAt(targetParent.childIds ?? [], id, index),
			};
			nextDirtyIds[targetParent.id] = true;
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
	mutateDesign((state) => {
		const insertion = resolveInsertionParent(state, targetParentId);
		if (!insertion) {
			return state;
		}
		const targetParent = insertion.parent;

		if (!canInsertIntoRecipeBoundary(state.entitiesById, targetParentId)) {
			return state;
		}
		if (
			!canInsertIntoSystemComponentBoundary(state.entitiesById, targetParentId)
		) {
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

		if (!targetParent) {
			nextRootIds = insertAt(nextRootIds, expansion.root.id, index);
		} else {
			nextEntitiesById[targetParent.id] = {
				...targetParent,
				childIds: insertAt(
					targetParent.childIds ?? [],
					expansion.root.id,
					index,
				),
			};
			nextDirtyIds[targetParent.id] = true;
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

export function addNodeTree(
	root: Node,
	targetParentId: string | null,
	index: number,
) {
	mutateDesign((state) => {
		const insertion = resolveInsertionParent(state, targetParentId);
		if (!insertion) {
			return state;
		}
		const targetParent = insertion.parent;

		if (!canInsertIntoRecipeBoundary(state.entitiesById, targetParentId)) {
			return state;
		}
		if (
			!canInsertIntoSystemComponentBoundary(state.entitiesById, targetParentId)
		) {
			return state;
		}

		const insertedState = normalizeDesign({
			name: state.name,
			boards: [root],
		});
		const insertedRoot = insertedState.entitiesById[root.id];
		if (!insertedRoot) {
			return state;
		}
		if (
			!isRecipeSlotInsertionAllowed(
				state.entitiesById,
				targetParentId,
				getRecipeSlotCandidateFromProps(insertedRoot.props),
			)
		) {
			return state;
		}

		const insertedEntitiesById: Record<string, DesignEntity> = {};
		for (const [id, entity] of Object.entries(insertedState.entitiesById)) {
			insertedEntitiesById[id] = {
				...entity,
				parentId: entity.parentId ?? (id === root.id ? targetParentId : null),
			};
		}

		const nextEntitiesById: Record<string, DesignEntity> = {
			...state.entitiesById,
			...insertedEntitiesById,
		};
		const nextDirtyIds = { ...state.dirtyIds };
		for (const id of Object.keys(insertedEntitiesById)) {
			nextDirtyIds[id] = true;
		}

		let nextRootIds = state.rootIds;
		if (!targetParent) {
			nextRootIds = insertAt(nextRootIds, root.id, index);
		} else {
			nextEntitiesById[targetParent.id] = {
				...targetParent,
				childIds: insertAt(targetParent.childIds ?? [], root.id, index),
			};
			nextDirtyIds[targetParent.id] = true;
		}

		return {
			...state,
			rootIds: nextRootIds,
			entitiesById: nextEntitiesById,
			selectedId: root.id,
			dirtyIds: nextDirtyIds,
			revision: state.revision + 1,
		};
	});
}

export function canReplaceElementWithCandidateProps(
	targetId: string,
	candidateProps: Pick<
		Props,
		"data-trickroom-library" | "data-trickroom-component"
	> &
		Partial<Props>,
): boolean {
	const state = designStore.get();
	const target = state.entitiesById[targetId];
	if (!target) {
		return false;
	}

	const targetParentId = target.parentId;
	const targetParent = targetParentId
		? state.entitiesById[targetParentId]
		: null;
	const parentChildIds = targetParent?.childIds ?? [];
	const targetIndex = targetParentId
		? parentChildIds.indexOf(targetId)
		: state.rootIds.indexOf(targetId);
	if (targetIndex < 0) {
		return false;
	}
	if (!canDeleteElementAcrossRecipeBoundary(state.entitiesById, targetId)) {
		return false;
	}
	if (
		!canDeleteElementAcrossSystemComponentBoundary(state.entitiesById, targetId)
	) {
		return false;
	}
	if (!canInsertIntoRecipeBoundary(state.entitiesById, targetParentId)) {
		return false;
	}
	if (
		!canInsertIntoSystemComponentBoundary(state.entitiesById, targetParentId)
	) {
		return false;
	}

	return isRecipeSlotInsertionAllowed(
		state.entitiesById,
		targetParentId,
		getRecipeSlotCandidateFromProps(candidateProps),
	);
}

export function replaceElementWithNodeTree(
	targetId: string,
	root: Node,
): boolean {
	let didReplace = false;
	mutateDesign((state) => {
		const target = state.entitiesById[targetId];
		if (!target) {
			return state;
		}

		const targetParentId = target.parentId;
		const targetParent = targetParentId
			? state.entitiesById[targetParentId]
			: null;
		const parentChildIds = targetParent?.childIds ?? [];
		const targetIndex = targetParentId
			? parentChildIds.indexOf(targetId)
			: state.rootIds.indexOf(targetId);
		if (targetIndex < 0) {
			return state;
		}
		if (!canDeleteElementAcrossRecipeBoundary(state.entitiesById, targetId)) {
			return state;
		}
		if (
			!canDeleteElementAcrossSystemComponentBoundary(
				state.entitiesById,
				targetId,
			)
		) {
			return state;
		}
		if (!canInsertIntoRecipeBoundary(state.entitiesById, targetParentId)) {
			return state;
		}
		if (
			!canInsertIntoSystemComponentBoundary(state.entitiesById, targetParentId)
		) {
			return state;
		}

		const insertedState = normalizeDesign({
			name: state.name,
			boards: [root],
		});
		const insertedRoot = insertedState.entitiesById[root.id];
		if (!insertedRoot) {
			return state;
		}
		if (
			!isRecipeSlotInsertionAllowed(
				state.entitiesById,
				targetParentId,
				getRecipeSlotCandidateFromProps(insertedRoot.props),
			)
		) {
			return state;
		}

		const deletedIds = new Set<string>();
		collectDescendantIds(state.entitiesById, targetId, deletedIds);
		const nextEntitiesById: Record<string, DesignEntity> = {
			...state.entitiesById,
		};
		for (const id of deletedIds) {
			delete nextEntitiesById[id];
		}

		const insertedEntitiesById: Record<string, DesignEntity> = {};
		for (const [id, entity] of Object.entries(insertedState.entitiesById)) {
			insertedEntitiesById[id] = {
				...entity,
				parentId: entity.parentId ?? (id === root.id ? targetParentId : null),
			};
		}
		Object.assign(nextEntitiesById, insertedEntitiesById);

		const nextDirtyIds = { ...state.dirtyIds };
		for (const id of [...deletedIds, ...Object.keys(insertedEntitiesById)]) {
			nextDirtyIds[id] = true;
		}

		let nextRootIds = state.rootIds;
		if (targetParentId && targetParent) {
			nextEntitiesById[targetParentId] = {
				...targetParent,
				childIds: parentChildIds.map((childId) =>
					childId === targetId ? root.id : childId,
				),
			};
			nextDirtyIds[targetParentId] = true;
		} else {
			nextRootIds = state.rootIds.map((rootId) =>
				rootId === targetId ? root.id : rootId,
			);
		}

		didReplace = true;
		return {
			...state,
			rootIds: nextRootIds,
			entitiesById: nextEntitiesById,
			selectedId: root.id,
			dirtyIds: nextDirtyIds,
			revision: state.revision + 1,
		};
	});
	return didReplace;
}

export function detachRecipe(id: string) {
	mutateDesign((state) => {
		const result = detachRecipeInstance(serializeDesignState(state).boards, id);
		if (!result) {
			return state;
		}

		const nextState = normalizeDesign(
			{
				...serializeDesignState(state),
				boards: result.roots,
			},
			state.entitiesById,
		);
		const nextDirtyIds = {
			...state.dirtyIds,
		};
		for (const detachedElementId of result.detachedElementIds) {
			nextDirtyIds[detachedElementId] = true;
		}

		return {
			...state,
			rootIds: nextState.rootIds,
			entitiesById: nextState.entitiesById,
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

export function detachSystemComponent(
	id: string,
	version?: PublishedSystemComponentVersion,
) {
	mutateDesign((state) => {
		const result = detachSystemComponentInstance(
			serializeDesignState(state).boards,
			id,
			version,
		);
		if (!result) {
			return state;
		}

		const nextState = normalizeDesign(
			{
				...serializeDesignState(state),
				boards: result.roots,
			},
			state.entitiesById,
		);
		const nextDirtyIds = { ...state.dirtyIds };
		for (const detachedElementId of result.detachedElementIds) {
			nextDirtyIds[detachedElementId] = true;
		}

		return {
			...state,
			rootIds: nextState.rootIds,
			entitiesById: nextState.entitiesById,
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

function applySystemComponentInstanceUpdate(
	state: DesignStoreState,
	rootElementId: string,
	_version: PublishedSystemComponentVersion,
	updater: (
		boards: Node[],
	) => ReturnType<typeof setSystemComponentVariantValueOnRoots>,
) {
	const result = updater(serializeDesignState(state).boards);
	if (!result) {
		return state;
	}

	const nextState = normalizeDesign(
		{
			...serializeDesignState(state),
			boards: result.roots,
		},
		state.entitiesById,
	);
	const nextDirtyIds = { ...state.dirtyIds };
	for (const changedElementId of result.changedElementIds) {
		nextDirtyIds[changedElementId] = true;
	}

	return {
		...state,
		rootIds: nextState.rootIds,
		entitiesById: nextState.entitiesById,
		selectedId:
			state.selectedId && nextState.entitiesById[state.selectedId]
				? state.selectedId
				: rootElementId,
		dirtyIds: nextDirtyIds,
		designDirty: state.designDirty,
		revision: state.revision + 1,
	};
}

export function setSystemComponentVariantValue(
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	axisKey: string,
	value: string | null,
) {
	mutateDesign((state) =>
		applySystemComponentInstanceUpdate(
			state,
			rootElementId,
			version,
			(boards) =>
				setSystemComponentVariantValueOnRoots(
					boards,
					rootElementId,
					version,
					axisKey,
					value,
				),
		),
	);
}

export function setSystemComponentOverrideClassName(
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	targetId: string,
	className: string,
) {
	mutateDesign((state) =>
		applySystemComponentInstanceUpdate(
			state,
			rootElementId,
			version,
			(boards) =>
				setSystemComponentOverrideClassNameOnRoots(
					boards,
					rootElementId,
					version,
					targetId,
					className,
				),
		),
	);
}

function applySystemComponentOverridePatch(
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	targetId: string,
	patch:
		| { kind: "text"; value: string }
		| { kind: "icon"; value: string }
		| { kind: "asset"; value: string },
) {
	mutateDesign((state) =>
		applySystemComponentInstanceUpdate(
			state,
			rootElementId,
			version,
			(boards) => {
				switch (patch.kind) {
					case "text":
						return setSystemComponentOverrideTextOnRoots(
							boards,
							rootElementId,
							version,
							targetId,
							patch.value,
						);
					case "icon":
						return setSystemComponentOverrideIconIdOnRoots(
							boards,
							rootElementId,
							version,
							targetId,
							patch.value,
						);
					case "asset":
						return setSystemComponentOverrideAssetIdOnRoots(
							boards,
							rootElementId,
							version,
							targetId,
							patch.value,
						);
				}
			},
		),
	);
}

export function setSystemComponentOverrideText(
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	targetId: string,
	text: string,
) {
	applySystemComponentOverridePatch(rootElementId, version, targetId, {
		kind: "text",
		value: text,
	});
}

export function setSystemComponentOverrideIconId(
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	targetId: string,
	iconId: string,
) {
	applySystemComponentOverridePatch(rootElementId, version, targetId, {
		kind: "icon",
		value: iconId,
	});
}

export function setSystemComponentOverrideAssetId(
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	targetId: string,
	assetId: string,
) {
	applySystemComponentOverridePatch(rootElementId, version, targetId, {
		kind: "asset",
		value: assetId,
	});
}

export function setSystemComponentOverrideProp(
	rootElementId: string,
	version: PublishedSystemComponentVersion,
	targetId: string,
	prop: string,
	value: JsonPrimitive | undefined,
) {
	mutateDesign((state) =>
		applySystemComponentInstanceUpdate(
			state,
			rootElementId,
			version,
			(boards) =>
				setSystemComponentOverridePropOnRoots(
					boards,
					rootElementId,
					version,
					targetId,
					prop,
					value,
				),
		),
	);
}

export function resetSystemComponentOverrides(
	rootElementId: string,
	version: PublishedSystemComponentVersion,
) {
	mutateDesign((state) =>
		applySystemComponentInstanceUpdate(
			state,
			rootElementId,
			version,
			(boards) =>
				updateSystemComponentInstanceOnRoots(boards, rootElementId, version, {
					overrides: {},
				}),
		),
	);
}

export function updateSystemComponentInstance(
	rootElementId: string,
	context: SystemComponentInstanceMigrationContext,
) {
	mutateDesign((state) => {
		const result = updateStaleSystemComponentInstance(
			serializeDesignState(state).boards,
			rootElementId,
			context,
		);
		const nextState = normalizeDesign(
			{
				...serializeDesignState(state),
				boards: result.roots,
			},
			state.entitiesById,
		);
		const dirtyIds = { ...state.dirtyIds };
		for (const mapping of [
			...result.metadata.preservedPaths,
			...result.metadata.remappedPaths,
			...result.metadata.addedPaths,
		]) {
			dirtyIds[mapping.elementId] = true;
		}
		for (const slotMapping of result.metadata.preservedSlots) {
			for (const childId of slotMapping.preservedChildIds) {
				dirtyIds[childId] = true;
			}
		}

		return {
			...state,
			rootIds: nextState.rootIds,
			entitiesById: nextState.entitiesById,
			selectedId: nextState.entitiesById[result.changedElementId]
				? result.changedElementId
				: result.metadata.rootElementId,
			dirtyIds,
			designDirty: state.designDirty,
			revision: state.revision + 1,
		};
	});
}

export function updateRecipeInstance(id: string) {
	mutateDesign((state) => {
		const result = updateStaleRecipeInstance(serializeDesignState(state), id);
		const nextState = normalizeDesign(result.design, state.entitiesById);
		const dirtyIds = { ...state.dirtyIds };
		for (const mapping of [
			...result.metadata.preservedPaths,
			...result.metadata.remappedPaths,
			...result.metadata.addedPaths,
		]) {
			dirtyIds[mapping.elementId] = true;
		}

		return {
			...state,
			rootIds: nextState.rootIds,
			entitiesById: nextState.entitiesById,
			selectedId: nextState.entitiesById[result.changedElementId]
				? result.changedElementId
				: result.metadata.rootElementId,
			dirtyIds,
			designDirty: state.designDirty,
			revision: state.revision + 1,
		};
	});
}

export function isDescendantOf(
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

export function collectDescendantIds(
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
	mutateDesign((state) => {
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
		if (
			!canMoveElementAcrossSystemComponentBoundary(
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
	mutateDesign((state) => {
		const entity = state.entitiesById[id];
		if (!entity) {
			return state;
		}

		if (!canDeleteElementAcrossRecipeBoundary(state.entitiesById, id)) {
			return state;
		}
		if (
			!canDeleteElementAcrossSystemComponentBoundary(state.entitiesById, id)
		) {
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
			dirtyBoards: {},
			manifestDirtyAt: null,
			orderDirtyAt: null,
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

	mutateDesign((state) => {
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

	mutateDesign((state) => {
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

export function usePersistedDesignRevision() {
	return useSelector(designStore, (state) => state.persistedRevision ?? null);
}

export function useExternalConflictPending() {
	return useSelector(
		designStore,
		(state) => state.externalConflictPending ?? false,
	);
}

export function useDesignSavePending() {
	return useSelector(designStore, (state) => state.designSavePending ?? false);
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

export function useDesignConflicts() {
	return useSelector(designStore, (state) => state.conflicts ?? null);
}
