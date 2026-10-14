import { type Dispatch, type SetStateAction, useEffect, useRef } from "react";

/** Rows explicitly collapsed in a layer rail are `false`; others are open. */
export type LayerOpenMap = Record<string, boolean | undefined>;

/**
 * Reveals the selected layer in a layer rail when the selection changes
 * (the canvas, the inspector breadcrumb): opens its collapsed ancestors,
 * then calls `reveal` to scroll the row into view. It runs once per
 * selection, so collapsing an ancestor afterwards sticks; clearing the
 * selection resets it, so selecting the same layer again reveals it again.
 * `reveal` returns false while the row is not laid out yet, to retry on the
 * next render.
 */
export function useLayerSelectionReveal({
	selectedId,
	getParentId,
	openMap,
	setOpenMap,
	reveal,
}: {
	selectedId: string | null;
	getParentId: (id: string) => string | null;
	openMap: LayerOpenMap;
	setOpenMap: Dispatch<SetStateAction<LayerOpenMap>>;
	reveal?: (id: string) => boolean;
}) {
	const revealedIdRef = useRef<string | null>(null);

	useEffect(() => {
		if (!selectedId) {
			revealedIdRef.current = null;
			return;
		}
		if (revealedIdRef.current === selectedId) {
			return;
		}
		const collapsedAncestors: string[] = [];
		const seen = new Set<string>();
		let parentId = getParentId(selectedId);
		while (parentId && !seen.has(parentId)) {
			seen.add(parentId);
			if (openMap[parentId] === false) {
				collapsedAncestors.push(parentId);
			}
			parentId = getParentId(parentId);
		}
		if (collapsedAncestors.length > 0) {
			setOpenMap((current) => {
				const next = { ...current };
				for (const id of collapsedAncestors) {
					next[id] = true;
				}
				return next;
			});
			return;
		}
		if (reveal && !reveal(selectedId)) {
			return;
		}
		revealedIdRef.current = selectedId;
	}, [getParentId, openMap, reveal, selectedId, setOpenMap]);
}
