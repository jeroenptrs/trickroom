import type { Node, TrickroomDesign } from "../types";
import {
	calculateBoardRevision,
	calculateManifestRevision,
	type DecodedDesignRevision,
	type DesignBoardRevision,
	type DesignRevisionParts,
	getDesignManifestFields,
	hashBoardId,
} from "./design-revision";

/**
 * Plans a revision-checked design write at the level of the manifest and of
 * individual boards.
 *
 * The caller hands over a whole design (`incoming`) that it derived from the
 * design at revision `base`. Parts the caller did not change (equal to their
 * `base` revision) keep whatever is on disk now, so concurrent changes to
 * other boards survive. Parts the caller did change are written, unless they
 * changed on disk since `base` (or, when `expected` differs from `base`,
 * unless the caller's own `expected` revision was already stale for them):
 * that is a conflict, reported per board.
 *
 * Board order follows the same rule: when the caller kept the relative order
 * of the boards it knew about, the order on disk wins and new boards slot in
 * after their predecessor; when the caller reordered, its order wins unless
 * the order on disk changed too.
 */

export type DesignWriteConflict = {
	/** Boards the caller changed (or deleted) that are stale. */
	staleBoardIds: string[];
	/** The caller changed the manifest and it is stale. */
	manifest: boolean;
	/** The caller reordered boards and the order is stale. */
	order: boolean;
};

export type DesignWritePlan = {
	/** The design to store: the caller's changes over the current design. */
	design: TrickroomDesign;
	manifestChanged: boolean;
	/** Boards whose content changes (including new boards). */
	changedBoardIds: string[];
	deletedBoardIds: string[];
	/** Whether the relative order of boards already on disk changes. */
	orderChanged: boolean;
	/** Whether the stored design differs from `incoming` (other writers' changes were kept). */
	merged: boolean;
	conflict: DesignWriteConflict | null;
	/** Revisions of `design`, so the caller does not hash it again. */
	revisions: DesignRevisionParts;
};

type RevisionIndex = {
	byIdHash: Map<string, { revision: DesignBoardRevision; position: number }>;
	sequence: string[];
};

const indexRevision = (revision: DecodedDesignRevision): RevisionIndex => {
	const counts = new Map<string, number>();
	for (const board of revision.boards) {
		counts.set(board.idHash, (counts.get(board.idHash) ?? 0) + 1);
	}
	const byIdHash: RevisionIndex["byIdHash"] = new Map();
	const sequence: string[] = [];
	revision.boards.forEach((board, position) => {
		// Two board ids sharing a hash prefix are ambiguous: treat both as
		// unknown, which only makes the check stricter.
		if (counts.get(board.idHash) === 1) {
			byIdHash.set(board.idHash, { revision: board.revision, position });
			sequence.push(board.idHash);
		}
	});
	return { byIdHash, sequence };
};

const sameSequence = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length &&
	left.every((entry, index) => entry === right[index]);

/** Restricts `sequence` to entries in `keep`, preserving order. */
const restrict = (sequence: readonly string[], keep: ReadonlySet<string>) =>
	sequence.filter((entry) => keep.has(entry));

/**
 * Inserts `extra` ids into `sequence`, each right after the closest entry
 * that precedes it in `reference` and is already placed (or first when none
 * is).
 */
export const insertAfterPredecessors = (
	sequence: string[],
	extra: readonly string[],
	reference: readonly string[],
) => {
	const result = [...sequence];
	const extraSet = new Set(extra);
	for (const id of reference) {
		if (!extraSet.has(id)) {
			continue;
		}
		const referenceIndex = reference.indexOf(id);
		let insertAt = 0;
		for (let index = referenceIndex - 1; index >= 0; index -= 1) {
			const placed = result.indexOf(reference[index] as string);
			if (placed !== -1) {
				insertAt = placed + 1;
				break;
			}
		}
		result.splice(insertAt, 0, id);
	}
	return result;
};

export const planDesignWrite = ({
	current,
	incoming,
	base,
	expected = base,
	currentRevision,
	incomingRevision,
}: {
	current: TrickroomDesign;
	/** Supplies revisions of current boards already known, to skip hashing them. */
	currentRevision?: (board: Node) => DesignBoardRevision | undefined;
	/**
	 * Supplies revisions of incoming boards known without hashing (for
	 * example a board whose stored file it would rewrite byte for byte). It
	 * must judge content, not object identity: callers may change a board in
	 * place.
	 */
	incomingRevision?: (board: Node) => DesignBoardRevision | undefined;
	incoming: TrickroomDesign;
	/** What `incoming` was derived from; null when unknown (every change is checked strictly). */
	base: DecodedDesignRevision | null;
	/** The caller's revision when it differs from `base` (a fresh read). */
	expected?: DecodedDesignRevision | null;
}): DesignWritePlan => {
	const baseIndex = base ? indexRevision(base) : null;
	const expectedIndex =
		expected && expected !== base ? indexRevision(expected) : null;
	const expectedDiffers = expected !== base;

	const currentById = new Map<
		string,
		{ node: Node; revision: DesignBoardRevision }
	>();
	const currentByIdHash = new Map<string, string>();
	for (const board of current.boards) {
		currentById.set(board.id, {
			node: board,
			revision: currentRevision?.(board) ?? calculateBoardRevision(board),
		});
		currentByIdHash.set(hashBoardId(board.id), board.id);
	}

	const staleBoardIds = new Set<string>();
	let staleManifest = false;
	let staleOrder = false;
	const expectedMatchesBase = (idHash: string, baseRevision: string) => {
		if (!expectedDiffers) return true;
		return expectedIndex?.byIdHash.get(idHash)?.revision === baseRevision;
	};

	// Boards, with the revision of each one stored.
	const finalNodes = new Map<string, Node>();
	const finalRevisions = new Map<string, DesignBoardRevision>();
	const changedBoardIds: string[] = [];
	const droppedIds = new Set<string>();
	const incomingIds = new Set<string>();
	let merged = false;

	for (const board of incoming.boards) {
		incomingIds.add(board.id);
		const idHash = hashBoardId(board.id);
		const boardRevision =
			incomingRevision?.(board) ?? calculateBoardRevision(board);
		const currentBoard = currentById.get(board.id);
		const baseEntry = baseIndex?.byIdHash.get(idHash);

		if (baseEntry) {
			if (boardRevision === baseEntry.revision) {
				// Unchanged by the caller: keep what is on disk now.
				if (!currentBoard) {
					droppedIds.add(board.id);
					merged = true;
				} else {
					finalNodes.set(board.id, currentBoard.node);
					finalRevisions.set(board.id, currentBoard.revision);
					if (currentBoard.revision !== boardRevision) merged = true;
				}
				continue;
			}
			if (!currentBoard || currentBoard.revision !== baseEntry.revision) {
				staleBoardIds.add(board.id);
			} else if (!expectedMatchesBase(idHash, baseEntry.revision)) {
				staleBoardIds.add(board.id);
			}
			finalNodes.set(board.id, board);
			finalRevisions.set(board.id, boardRevision);
			if (currentBoard?.revision !== boardRevision) {
				changedBoardIds.push(board.id);
			}
			continue;
		}

		// A board the caller's base did not have.
		if (currentBoard) {
			if (currentBoard.revision !== boardRevision) {
				staleBoardIds.add(board.id);
			}
			finalNodes.set(board.id, currentBoard.node);
			finalRevisions.set(board.id, currentBoard.revision);
			continue;
		}
		finalNodes.set(board.id, board);
		finalRevisions.set(board.id, boardRevision);
		changedBoardIds.push(board.id);
	}

	// Boards the caller deleted.
	const deletedBoardIds: string[] = [];
	if (baseIndex) {
		for (const [idHash, baseEntry] of baseIndex.byIdHash) {
			const currentId = currentByIdHash.get(idHash);
			if (currentId === undefined || incomingIds.has(currentId)) {
				continue;
			}
			const currentBoard = currentById.get(currentId);
			if (currentBoard?.revision !== baseEntry.revision) {
				staleBoardIds.add(currentId);
			} else if (!expectedMatchesBase(idHash, baseEntry.revision)) {
				staleBoardIds.add(currentId);
			}
			deletedBoardIds.push(currentId);
		}
	}
	const deletedSet = new Set(deletedBoardIds);

	// Boards only on disk (added by another writer, or every current board
	// when the base is unknown) stay.
	for (const board of current.boards) {
		if (!finalNodes.has(board.id) && !deletedSet.has(board.id)) {
			if (!baseIndex) {
				// Without a base, a board missing from the caller's design is a
				// deletion the service cannot verify.
				staleBoardIds.add(board.id);
				deletedBoardIds.push(board.id);
				continue;
			}
			finalNodes.set(board.id, board);
			finalRevisions.set(
				board.id,
				currentById.get(board.id)?.revision as DesignBoardRevision,
			);
			merged = true;
		}
	}

	// Manifest.
	const incomingManifestRevision = calculateManifestRevision(incoming);
	const currentManifestRevision = calculateManifestRevision(current);
	let manifestSource: TrickroomDesign = incoming;
	if (!base) {
		if (incomingManifestRevision !== currentManifestRevision) {
			staleManifest = true;
		}
	} else if (incomingManifestRevision === base.manifest) {
		manifestSource = current;
		if (currentManifestRevision !== incomingManifestRevision) merged = true;
	} else if (currentManifestRevision !== base.manifest) {
		staleManifest = true;
	} else if (expectedDiffers && expected?.manifest !== base.manifest) {
		staleManifest = true;
	}
	const manifestRevision =
		manifestSource === incoming
			? incomingManifestRevision
			: currentManifestRevision;
	const manifestChanged = manifestRevision !== currentManifestRevision;

	// Order.
	const currentSequence = current.boards
		.map((board) => board.id)
		.filter((id) => finalNodes.has(id));
	const callerSequence = incoming.boards
		.map((board) => board.id)
		.filter((id) => finalNodes.has(id));
	const toHashes = (ids: readonly string[]) => ids.map(hashBoardId);
	let finalSequence: string[];
	if (baseIndex) {
		const known = new Set(
			callerSequence
				.map(hashBoardId)
				.filter((idHash) => baseIndex.byIdHash.has(idHash)),
		);
		const callerKnown = restrict(toHashes(callerSequence), known);
		const baseKnown = restrict(baseIndex.sequence, known);
		if (sameSequence(callerKnown, baseKnown)) {
			const callerNew = callerSequence.filter(
				(id) => !currentSequence.includes(id),
			);
			finalSequence = insertAfterPredecessors(
				currentSequence,
				callerNew,
				callerSequence,
			);
		} else {
			const onDisk = new Set(toHashes(currentSequence));
			const reordered = new Set(
				[...known].filter((idHash) => onDisk.has(idHash)),
			);
			if (
				!sameSequence(
					restrict(toHashes(currentSequence), reordered),
					restrict(baseIndex.sequence, reordered),
				)
			) {
				staleOrder = true;
			} else if (
				expectedDiffers &&
				!sameSequence(
					restrict(expectedIndex?.sequence ?? [], reordered),
					restrict(baseIndex.sequence, reordered),
				)
			) {
				staleOrder = true;
			}
			const others = currentSequence.filter(
				(id) => !callerSequence.includes(id),
			);
			finalSequence = insertAfterPredecessors(
				callerSequence,
				others,
				currentSequence,
			);
		}
	} else {
		const shared = new Set(
			callerSequence.filter((id) => currentSequence.includes(id)),
		);
		if (
			!sameSequence(
				restrict(callerSequence, shared),
				restrict(currentSequence, shared),
			)
		) {
			staleOrder = true;
		}
		finalSequence = callerSequence;
	}

	const existing = new Set(currentSequence);
	const orderChanged = !sameSequence(
		restrict(finalSequence, existing),
		currentSequence,
	);
	if (
		!sameSequence(
			finalSequence,
			incoming.boards.map((board) => board.id),
		)
	) {
		merged = true;
	}
	if (droppedIds.size > 0) merged = true;

	const conflict =
		staleBoardIds.size > 0 || staleManifest || staleOrder
			? {
					staleBoardIds: [...staleBoardIds],
					manifest: staleManifest,
					order: staleOrder,
				}
			: null;

	return {
		design: {
			...getDesignManifestFields(manifestSource),
			boards: finalSequence.map((id) => finalNodes.get(id) as Node),
		} as TrickroomDesign,
		manifestChanged,
		changedBoardIds,
		deletedBoardIds,
		orderChanged,
		merged,
		conflict,
		revisions: {
			manifest: manifestRevision,
			boards: finalSequence.map((id) => ({
				id,
				revision: finalRevisions.get(id) as DesignBoardRevision,
			})),
		},
	};
};
