import type { DesignFileRevision } from "../services/design-file-service.types";
import type { Node, TrickroomDesign } from "../types";
import {
	type DesignManifest,
	insertAfterPredecessors,
	isSameJson,
	isSameManifest,
	mergeBoard,
	mergeBoardOrder,
	mergeManifest,
} from "./design-merge";
import {
	type BoardConflict,
	collectDescendantIds,
	createDesignBase,
	type DesignBase,
	type DesignConflicts,
	type DesignEntity,
	type DesignPartRevisions,
	type DesignStoreState,
	type DiskDesignRevisions,
	designStore,
	getBoardIdOf,
	getDesignManifest,
	normalizeEntity,
	serializeEntity,
} from "./design-store";

/**
 * Live sync of the open design with the files on disk, at board level.
 *
 * The store keeps a base: the last version of every board, the board order
 * and the top-level fields known to be on disk. A disk state is compared
 * against it part by part:
 *
 * - A part that did not change on disk is left alone.
 * - A part that changed on disk and has no unsaved local edits takes the disk
 *   version, without touching any other board, the selection or the view.
 * - A part that changed on both sides is merged three-way against the base
 *   (board by layer, order by position, top-level fields by field). What does
 *   not merge becomes a conflict for the human to resolve per part.
 *
 * Once every part of the base matches a disk state, the store's persisted
 * revision moves to that state's revision, so the next save's revision check
 * names exactly what the local edits were based on.
 */

/** A design state on disk, with the contents of the parts that changed. */
export type DiskDesignState = DiskDesignRevisions & {
	/** Needed when the manifest differs from the base. */
	manifest?: DesignManifest;
	/** Contents of boards that differ from the base (or all boards). */
	boards: Record<string, Node>;
	/** Every board's and the manifest's content is included. */
	complete?: boolean;
};

/** What an external change did, for markers and highlights. */
export type ExternalDesignChange = {
	/** Changed boards with the layers whose own content changed or that are new. */
	boards: Record<string, string[]>;
	addedBoardIds: string[];
	removedBoardIds: string[];
	manifest: boolean;
	order: boolean;
	/** Parts that need a choice; applied changes are listed above. */
	conflicts: boolean;
};

const emptyChange = (): ExternalDesignChange => ({
	boards: {},
	addedBoardIds: [],
	removedBoardIds: [],
	manifest: false,
	order: false,
	conflicts: false,
});

const changeListeners = new Set<(change: ExternalDesignChange) => void>();

/**
 * Listens to external changes applied to the open design (and conflicts
 * found), whichever path applied them: a change event, a save that kept
 * another writer's boards, a reload or a resolved conflict.
 */
export function subscribeExternalDesignChanges(
	listener: (change: ExternalDesignChange) => void,
) {
	changeListeners.add(listener);
	return () => {
		changeListeners.delete(listener);
	};
}

const emitChange = (change: ExternalDesignChange) => {
	if (hasExternalChange(change) || change.conflicts) {
		for (const listener of changeListeners) listener(change);
	}
	return change;
};

export const hasExternalChange = (change: ExternalDesignChange) =>
	Object.keys(change.boards).length > 0 ||
	change.addedBoardIds.length > 0 ||
	change.removedBoardIds.length > 0 ||
	change.manifest ||
	change.order;

const sameSequence = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length &&
	left.every((entry, index) => entry === right[index]);

const boardName = (
	node: Pick<Node, "props"> | null | undefined,
	id: string,
) => {
	const name = node?.props["data-trickroom-name"];
	return typeof name === "string" && name.length > 0 ? name : id;
};

/** The revisions and contents of a whole design read from disk. */
export function diskStateFromDesign(
	design: TrickroomDesign,
	revision: DesignFileRevision | null,
	parts?: DesignPartRevisions | null,
): DiskDesignState {
	const revisions = new Map(
		(parts?.boards ?? []).map((board) => [board.id, board.revision]),
	);
	return {
		revision,
		manifestRevision: parts?.manifest ?? null,
		manifest: getDesignManifest(design),
		order: design.boards.map((board) => board.id),
		boardRevisions: Object.fromEntries(
			design.boards.map((board) => [board.id, revisions.get(board.id) ?? null]),
		),
		boards: Object.fromEntries(design.boards.map((board) => [board.id, board])),
		complete: true,
	};
}

/** The disk revisions of a design from a change event's or read's parts. */
export function diskRevisionsFromParts(
	revision: DesignFileRevision | null,
	parts: DesignPartRevisions,
): DiskDesignRevisions {
	return {
		revision,
		manifestRevision: parts.manifest,
		order: parts.boards.map((board) => board.id),
		boardRevisions: Object.fromEntries(
			parts.boards.map((board) => [board.id, board.revision]),
		),
	};
}

/**
 * What must be fetched to apply a disk state: the boards whose revision
 * differs from the base (unless a pending conflict already holds that
 * version), and the manifest when its revision differs.
 */
export function getDiskContentNeeds(
	state: DesignStoreState,
	disk: DiskDesignRevisions,
): { boardIds: string[]; manifest: boolean } {
	const base = state.base;
	if (!base) {
		return { boardIds: [...disk.order], manifest: true };
	}
	const boardIds = disk.order.filter((id) => {
		const revision = disk.boardRevisions[id] ?? null;
		if (revision !== null && base.boards[id]?.revision === revision) {
			return false;
		}
		return !getConflictTheirs(state, id, revision);
	});
	return {
		boardIds,
		manifest:
			disk.manifestRevision === null ||
			disk.manifestRevision !== base.manifestRevision,
	};
}

function getConflictTheirs(
	state: DesignStoreState,
	boardId: string,
	revision: string | null,
) {
	if (revision === null) return null;
	const conflict = state.conflicts?.boards.find(
		(entry) => entry.boardId === boardId,
	);
	return conflict?.theirs && conflict.theirsRevision === revision
		? conflict.theirs
		: null;
}

/** Layers of a replaced board that are new or whose own content changed. */
function collectChangedNodeIds(
	fresh: Record<string, DesignEntity>,
	previous: Record<string, DesignEntity>,
): string[] {
	const ids: string[] = [];
	for (const [id, entity] of Object.entries(fresh)) {
		const before = previous[id];
		if (before === entity) continue;
		if (
			!before ||
			before.parentId !== entity.parentId ||
			before.text !== entity.text ||
			!isSameJson(before.props, entity.props)
		) {
			ids.push(id);
			continue;
		}
		// Only the child list changed: new children are listed themselves, a
		// removed child leaves only its parent to point at.
		const children = new Set(entity.childIds ?? []);
		if ((before.childIds ?? []).some((childId) => !children.has(childId))) {
			ids.push(id);
		}
	}
	return ids;
}

function baseMatchesDisk(base: DesignBase, disk: DiskDesignState) {
	if (!sameSequence(base.order, disk.order)) return false;
	if (Object.keys(base.boards).length !== disk.order.length) return false;
	if (disk.complete) return true;
	return (
		disk.manifestRevision !== null &&
		base.manifestRevision === disk.manifestRevision &&
		disk.order.every((id) => {
			const revision = disk.boardRevisions[id] ?? null;
			return revision !== null && base.boards[id]?.revision === revision;
		})
	);
}

const withManifest = (
	state: DesignStoreState,
	manifest: DesignManifest,
): DesignStoreState => {
	const next: DesignStoreState = { ...state, name: manifest.name };
	for (const field of [
		"systemId",
		"systemName",
		"componentMigrationPolicy",
	] as const) {
		if (manifest[field] === undefined) {
			delete next[field];
		} else {
			(next as Record<string, unknown>)[field] = manifest[field];
		}
	}
	return next;
};

/** Drops the per-node dirty marks once nothing is left to save. */
const settleDirtyMarks = (state: DesignStoreState): DesignStoreState =>
	Object.keys(state.dirtyBoards ?? {}).length === 0 &&
	(state.manifestDirtyAt ?? null) === null &&
	(state.orderDirtyAt ?? null) === null &&
	(Object.keys(state.dirtyIds).length > 0 || state.designDirty)
		? { ...state, dirtyIds: {}, designDirty: false }
		: state;

/**
 * Replaces, adds and removes boards in the entity map. Old entities of every
 * replaced or removed board go first, so a layer that moved between two
 * replaced boards ends up only where it is now. Unchanged layers keep their
 * entity objects.
 */
function replaceBoards(
	entitiesById: Record<string, DesignEntity>,
	rootIds: readonly string[],
	replacements: ReadonlyMap<string, Node | null>,
	change: ExternalDesignChange,
): Record<string, DesignEntity> {
	if (replacements.size === 0) {
		return entitiesById;
	}
	const next = { ...entitiesById };
	const localRoots = new Set(rootIds);
	for (const id of replacements.keys()) {
		if (!localRoots.has(id)) continue;
		const ids = new Set<string>();
		collectDescendantIds(entitiesById, id, ids);
		for (const removed of ids) delete next[removed];
	}
	for (const [id, node] of replacements) {
		if (!node) {
			if (localRoots.has(id)) change.removedBoardIds.push(id);
			continue;
		}
		const fresh: Record<string, DesignEntity> = {};
		normalizeEntity(node, null, fresh, entitiesById);
		Object.assign(next, fresh);
		if (localRoots.has(id)) {
			const changed = collectChangedNodeIds(fresh, entitiesById);
			if (changed.length > 0) change.boards[id] = changed;
		} else {
			change.addedBoardIds.push(id);
			change.boards[id] = [id];
		}
	}
	return next;
}

/**
 * Reconciles the store with a disk state. Returns the next state and what
 * changed; throws when the disk state lacks content it needs (see
 * `getDiskContentNeeds`).
 */
export function reconcileWithDisk(
	state: DesignStoreState,
	disk: DiskDesignState,
): { state: DesignStoreState; change: ExternalDesignChange } {
	const change = emptyChange();
	const base = state.base ?? createDesignBase(serializeDesignContent(state));
	const baseBoards = { ...base.boards };
	const dirtyBoards = { ...(state.dirtyBoards ?? {}) };
	const localRoots = new Set(state.rootIds);
	const replacements = new Map<string, Node | null>();
	const boardConflicts: BoardConflict[] = [];
	const diskIds = new Set(disk.order);

	for (const id of disk.order) {
		const revision = disk.boardRevisions[id] ?? null;
		const baseBoard = baseBoards[id];
		if (baseBoard && revision !== null && baseBoard.revision === revision) {
			continue;
		}
		const theirs = disk.boards[id] ?? getConflictTheirs(state, id, revision);
		if (!theirs) {
			throw new Error(`Missing the disk version of board "${id}"`);
		}
		if (baseBoard && isSameJson(baseBoard.node, theirs)) {
			baseBoards[id] = { node: baseBoard.node, revision };
			continue;
		}
		const local = localRoots.has(id)
			? serializeEntity(id, state.entitiesById)
			: null;
		if (dirtyBoards[id] === undefined) {
			replacements.set(id, theirs);
			baseBoards[id] = { node: theirs, revision };
			continue;
		}
		if (local && isSameJson(local, theirs)) {
			// Both sides made the same change.
			baseBoards[id] = { node: theirs, revision };
			delete dirtyBoards[id];
			continue;
		}
		if (!local || !baseBoard) {
			boardConflicts.push({
				boardId: id,
				name: boardName(theirs, id),
				reason: local ? "changed" : "deleted-here",
				nodeIds: [],
				theirs,
				theirsRevision: revision,
			});
			continue;
		}
		const merged = mergeBoard(baseBoard.node, local, theirs, (nodeId) => {
			const owner = getBoardIdOf(state.entitiesById, nodeId);
			return owner !== null && owner !== id;
		});
		if (merged.status === "conflict") {
			boardConflicts.push({
				boardId: id,
				name: boardName(theirs, id),
				reason: "changed",
				nodeIds: merged.nodeIds,
				theirs,
				theirsRevision: revision,
			});
			continue;
		}
		replacements.set(id, merged.board);
		baseBoards[id] = { node: theirs, revision };
		if (isSameJson(merged.board, theirs)) {
			delete dirtyBoards[id];
		}
	}

	for (const id of Object.keys(baseBoards)) {
		if (diskIds.has(id)) continue;
		if (!localRoots.has(id)) {
			// Deleted on both sides.
			delete baseBoards[id];
			delete dirtyBoards[id];
			continue;
		}
		if (dirtyBoards[id] === undefined) {
			replacements.set(id, null);
			delete baseBoards[id];
			continue;
		}
		boardConflicts.push({
			boardId: id,
			name: boardName(state.entitiesById[id], id),
			reason: "deleted-on-disk",
			nodeIds: [],
			theirs: null,
			theirsRevision: null,
		});
	}

	const entitiesById = replaceBoards(
		state.entitiesById,
		state.rootIds,
		replacements,
		change,
	);

	// Board order.
	const present = new Set(
		[...state.rootIds, ...change.addedBoardIds].filter(
			(id) => replacements.get(id) !== null,
		),
	);
	const mergedOrder = mergeBoardOrder({
		base: base.order,
		local: state.rootIds,
		disk: disk.order,
		present,
	});
	let orderDirtyAt = state.orderDirtyAt ?? null;
	if (!mergedOrder.conflict && sameSequence(mergedOrder.order, disk.order)) {
		orderDirtyAt = null;
	}
	const rootIds = sameSequence(mergedOrder.order, state.rootIds)
		? state.rootIds
		: mergedOrder.order;
	const keptLocalOrder = state.rootIds.filter((id) => present.has(id));
	change.order = !sameSequence(
		mergedOrder.order.filter((id) => keptLocalOrder.includes(id)),
		keptLocalOrder,
	);

	// Top-level fields.
	const localManifest = getDesignManifest(state);
	let manifest = localManifest;
	let baseManifest = base.manifest;
	let manifestRevision = base.manifestRevision;
	let manifestDirtyAt = state.manifestDirtyAt ?? null;
	let manifestConflict: DesignConflicts["manifest"] = null;
	const theirsManifest = disk.manifest;
	if (theirsManifest) {
		if (!isSameManifest(base.manifest, theirsManifest)) {
			if (manifestDirtyAt === null) {
				manifest = theirsManifest;
			} else {
				const merged = mergeManifest(
					base.manifest,
					localManifest,
					theirsManifest,
				);
				if (merged.conflicts.length > 0) {
					manifestConflict = {
						theirs: theirsManifest,
						fields: merged.conflicts,
					};
				} else {
					manifest = merged.manifest;
				}
			}
			if (!manifestConflict && isSameManifest(manifest, theirsManifest)) {
				manifestDirtyAt = null;
			}
		}
		if (!manifestConflict) {
			baseManifest = theirsManifest;
			manifestRevision = disk.manifestRevision;
		}
	} else if (
		disk.manifestRevision !== null &&
		disk.manifestRevision !== base.manifestRevision
	) {
		throw new Error("Missing the disk version of the design manifest");
	}
	change.manifest = !isSameManifest(localManifest, manifest);

	const conflicts: DesignConflicts | null =
		boardConflicts.length > 0 || manifestConflict || mergedOrder.conflict
			? {
					disk: {
						revision: disk.revision,
						manifestRevision: disk.manifestRevision,
						order: [...disk.order],
						boardRevisions: { ...disk.boardRevisions },
					},
					boards: boardConflicts,
					manifest: manifestConflict,
					order: mergedOrder.conflict ? { theirs: [...disk.order] } : null,
				}
			: null;
	change.conflicts = conflicts !== null;

	const nextBase: DesignBase = {
		manifest: baseManifest,
		manifestRevision,
		order: mergedOrder.conflict ? base.order : [...disk.order],
		boards: baseBoards,
	};
	const inSync = conflicts === null && baseMatchesDisk(nextBase, disk);
	const contentChanged =
		entitiesById !== state.entitiesById ||
		rootIds !== state.rootIds ||
		change.manifest;

	const next = settleDirtyMarks({
		...withManifest(state, manifest),
		rootIds,
		entitiesById,
		base: nextBase,
		dirtyBoards,
		manifestDirtyAt,
		orderDirtyAt,
		conflicts,
		externalConflictPending: conflicts !== null,
		persistedRevision:
			inSync && disk.revision
				? disk.revision
				: (state.persistedRevision ?? null),
		selectedId:
			state.selectedId && entitiesById[state.selectedId]
				? state.selectedId
				: null,
		revision: contentChanged ? state.revision + 1 : state.revision,
	});
	return { state: next, change };
}

function serializeDesignContent(state: DesignStoreState): TrickroomDesign {
	return {
		...getDesignManifest(state),
		boards: state.rootIds.map((id) => serializeEntity(id, state.entitiesById)),
	};
}

/** Applies a disk state to the open design. See `reconcileWithDisk`. */
export function applyDiskDesign(disk: DiskDesignState): ExternalDesignChange {
	let change = emptyChange();
	designStore.setState((state) => {
		const result = reconcileWithDisk(state, disk);
		change = result.change;
		return result.state;
	});
	return emitChange(change);
}

/**
 * Records a completed save: every board, the order and the top-level fields
 * the save stored as sent become the base, and edits the save carried stop
 * being dirty (edits made while it was in flight stay dirty). The stored
 * design is then reconciled like any disk state, which applies boards
 * another writer changed that the save kept (a merged save) without
 * reloading anything else.
 */
export function commitDesignSaveResult({
	sent,
	savedStoreRevision,
	saved,
}: {
	sent: TrickroomDesign;
	/** Store revision that was serialized for this save. */
	savedStoreRevision: number;
	saved: {
		design: TrickroomDesign;
		revision: DesignFileRevision;
		parts?: DesignPartRevisions | null;
	};
}): ExternalDesignChange {
	const carried = (at: number | null | undefined) =>
		at !== null && at !== undefined && at <= savedStoreRevision;
	designStore.setState((state) => {
		const base = state.base ?? createDesignBase(sent);
		const revisions = new Map(
			(saved.parts?.boards ?? []).map((board) => [board.id, board.revision]),
		);
		const storedById = new Map(
			saved.design.boards.map((board) => [board.id, board]),
		);
		const sentIds = new Set(sent.boards.map((board) => board.id));
		const boards = { ...base.boards };
		const dirtyBoards = { ...(state.dirtyBoards ?? {}) };
		for (const board of sent.boards) {
			const stored = storedById.get(board.id);
			if (stored && isSameJson(stored, board)) {
				boards[board.id] = {
					node: stored,
					revision: revisions.get(board.id) ?? null,
				};
				if (carried(dirtyBoards[board.id])) delete dirtyBoards[board.id];
			}
		}
		for (const id of new Set([
			...Object.keys(boards),
			...Object.keys(dirtyBoards),
		])) {
			if (sentIds.has(id) || storedById.has(id)) continue;
			// Deleted by this save.
			delete boards[id];
			if (carried(dirtyBoards[id])) delete dirtyBoards[id];
		}
		const sentManifest = getDesignManifest(sent);
		const storedManifest = getDesignManifest(saved.design);
		const manifestStored = isSameManifest(sentManifest, storedManifest);
		const orderStored = sameSequence(
			sent.boards.map((board) => board.id),
			saved.design.boards.map((board) => board.id),
		);
		return {
			...state,
			base: {
				manifest: manifestStored ? storedManifest : base.manifest,
				manifestRevision: manifestStored
					? (saved.parts?.manifest ?? null)
					: base.manifestRevision,
				order: orderStored
					? saved.design.boards.map((board) => board.id)
					: base.order,
				boards,
			},
			dirtyBoards,
			manifestDirtyAt:
				manifestStored && carried(state.manifestDirtyAt)
					? null
					: (state.manifestDirtyAt ?? null),
			orderDirtyAt:
				orderStored && carried(state.orderDirtyAt)
					? null
					: (state.orderDirtyAt ?? null),
		};
	});
	return applyDiskDesign(
		diskStateFromDesign(saved.design, saved.revision, saved.parts),
	);
}

export type ConflictChoice = "theirs" | "mine";

export type ConflictChoices = {
	boards?: Record<string, ConflictChoice>;
	manifest?: ConflictChoice;
	order?: ConflictChoice;
};

/**
 * Resolves pending conflicts part by part (unspecified parts take the disk
 * version). "theirs" replaces the local part with the disk version and drops
 * its local edits. "mine" keeps the local part and moves its base to the
 * disk version, so the next save overwrites exactly that part on disk with a
 * revision check against the version the human saw.
 */
export function resolveDesignConflicts(
	choices: ConflictChoices,
): ExternalDesignChange {
	let change = emptyChange();
	designStore.setState((state) => {
		const conflicts = state.conflicts;
		const base = state.base;
		if (!conflicts || !base) {
			return state;
		}
		change = emptyChange();
		const editedAt = state.revision + 1;
		const boards = { ...base.boards };
		const dirtyBoards = { ...(state.dirtyBoards ?? {}) };
		const replacements = new Map<string, Node | null>();
		for (const conflict of conflicts.boards) {
			const choice = choices.boards?.[conflict.boardId] ?? "theirs";
			if (conflict.theirs) {
				boards[conflict.boardId] = {
					node: conflict.theirs,
					revision: conflict.theirsRevision,
				};
			} else {
				delete boards[conflict.boardId];
			}
			if (choice === "theirs") {
				replacements.set(conflict.boardId, conflict.theirs);
				delete dirtyBoards[conflict.boardId];
			} else {
				dirtyBoards[conflict.boardId] = editedAt;
			}
		}
		const entitiesById = replaceBoards(
			state.entitiesById,
			state.rootIds,
			replacements,
			change,
		);

		let rootIds = state.rootIds.filter((id) => replacements.get(id) !== null);
		rootIds = insertAfterPredecessors(
			rootIds,
			change.addedBoardIds,
			conflicts.disk.order,
		);
		let orderDirtyAt = state.orderDirtyAt ?? null;
		if (conflicts.order) {
			if ((choices.order ?? "theirs") === "theirs") {
				const present = new Set(rootIds);
				rootIds = insertAfterPredecessors(
					conflicts.order.theirs.filter((id) => present.has(id)),
					rootIds.filter((id) => !conflicts.order?.theirs.includes(id)),
					rootIds,
				);
				orderDirtyAt = null;
				change.order = true;
			} else {
				orderDirtyAt = editedAt;
			}
		}

		let next: DesignStoreState = state;
		let manifestDirtyAt = state.manifestDirtyAt ?? null;
		let manifest = base.manifest;
		let manifestRevision = base.manifestRevision;
		if (conflicts.manifest) {
			manifest = conflicts.manifest.theirs;
			manifestRevision = conflicts.disk.manifestRevision;
			if ((choices.manifest ?? "theirs") === "theirs") {
				next = withManifest(state, conflicts.manifest.theirs);
				manifestDirtyAt = null;
				change.manifest = true;
			} else {
				manifestDirtyAt = editedAt;
			}
		}

		const nextBase: DesignBase = {
			manifest,
			manifestRevision,
			order: [...conflicts.disk.order],
			boards,
		};
		const disk: DiskDesignState = { ...conflicts.disk, boards: {} };
		return settleDirtyMarks({
			...next,
			rootIds,
			entitiesById,
			base: nextBase,
			dirtyBoards,
			manifestDirtyAt,
			orderDirtyAt,
			conflicts: null,
			externalConflictPending: false,
			persistedRevision:
				conflicts.disk.revision && baseMatchesDisk(nextBase, disk)
					? conflicts.disk.revision
					: (state.persistedRevision ?? null),
			selectedId:
				state.selectedId && entitiesById[state.selectedId]
					? state.selectedId
					: null,
			revision: editedAt,
		});
	});
	return emitChange(change);
}
