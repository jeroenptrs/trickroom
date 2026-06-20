/**
 * Adjusts a sibling insertion index for moveElement/moveTemplateNode, which
 * remove the source from the parent before splicing at `index`.
 */
export function reorderInsertionIndex(
	siblings: readonly string[],
	sourceId: string,
	index: number,
): number {
	const sourceIndex = siblings.indexOf(sourceId);
	if (sourceIndex !== -1 && sourceIndex < index) {
		return index - 1;
	}
	return index;
}

/** Index for a same-parent layer drag to land before or after a sibling. */
export function layerDropInsertionIndex(
	siblings: readonly string[],
	sourceId: string,
	placement: "before" | "after",
	targetId: string,
): number {
	const targetIndex = siblings.indexOf(targetId);
	if (targetIndex === -1) {
		throw new Error(`Target sibling not found: ${targetId}`);
	}
	const rawIndex = placement === "after" ? targetIndex + 1 : targetIndex;
	return reorderInsertionIndex(siblings, sourceId, rawIndex);
}
