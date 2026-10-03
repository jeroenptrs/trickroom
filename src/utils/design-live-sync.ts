import type { DesignFileRevision } from "../services/design-file-service.types";

export type DesignSyncDecision = "ignore" | "reload" | "conflict";

export function getDesignSyncDecision({
	snapshotRevision,
	persistedRevision,
	hasUnsavedChanges,
	savePending,
}: {
	snapshotRevision: DesignFileRevision;
	persistedRevision: DesignFileRevision | null;
	hasUnsavedChanges: boolean;
	savePending: boolean;
}): DesignSyncDecision {
	if (savePending || snapshotRevision === persistedRevision) {
		return "ignore";
	}

	return hasUnsavedChanges ? "conflict" : "reload";
}

/**
 * Picks the board to show after hydrating a design snapshot. A reload of the
 * design that is already open (for example an agent write picked up by live
 * sync) keeps the current board while it still exists; a first load, or a
 * reload where the current board was removed, falls back to the first board.
 */
export function resolveActiveBoardAfterHydrate({
	boardIds,
	currentBoardId,
	isReload,
}: {
	boardIds: readonly string[];
	currentBoardId: string | null;
	isReload: boolean;
}): string | null {
	if (isReload && currentBoardId && boardIds.includes(currentBoardId)) {
		return currentBoardId;
	}

	return boardIds[0] ?? null;
}
