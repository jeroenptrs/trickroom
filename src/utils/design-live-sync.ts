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
