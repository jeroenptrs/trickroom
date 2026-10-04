import { createStore, shallow, useSelector } from "@tanstack/react-store";
import { type DesignEntity, designStore } from "./design-store";
import type { ExternalDesignChange } from "./design-sync";

// "Changed externally" markers of the open design: boards and layers that
// changed through a write from outside this editor (an agent, another tab,
// git) and that the human has not looked at or touched since. Render-only
// state; nothing here reaches the design file.

export type ExternallyChangedBoard = {
	/** Layers that are new or whose own content changed. */
	layerIds: string[];
	/** When the stage last outlined the changes; null while not yet shown. */
	shownAt: number | null;
};

export type ExternalChangeState = {
	boards: Record<string, ExternallyChangedBoard>;
	/** Layer id to its board, for every marked layer. */
	layers: Record<string, string>;
	/** Layers the stage outlines now; each request replaces the previous. */
	flash: { id: number; layerIds: string[] } | null;
};

const initialState: ExternalChangeState = {
	boards: {},
	layers: {},
	flash: null,
};

export const externalChangeStore =
	createStore<ExternalChangeState>(initialState);

let flashId = 0;

export function resetExternalChanges() {
	externalChangeStore.setState(() => initialState);
}

const indexLayers = (boards: ExternalChangeState["boards"]) => {
	const layers: Record<string, string> = {};
	for (const [boardId, board] of Object.entries(boards)) {
		for (const layerId of board.layerIds) layers[layerId] = boardId;
	}
	return layers;
};

/** Marks the boards and layers an external change touched. */
export function recordExternalChange(change: ExternalDesignChange) {
	const changed = Object.entries(change.boards);
	if (changed.length === 0 && change.removedBoardIds.length === 0) {
		return;
	}
	externalChangeStore.setState((state) => {
		const boards = { ...state.boards };
		for (const boardId of change.removedBoardIds) delete boards[boardId];
		for (const [boardId, layerIds] of changed) {
			const previous = boards[boardId]?.layerIds ?? [];
			boards[boardId] = {
				layerIds: [...new Set([...previous, ...layerIds])],
				shownAt: null,
			};
		}
		return { ...state, boards, layers: indexLayers(boards) };
	});
}

/** Removes the markers of boards the human looked at or worked on. */
export function clearExternalChanges(boardIds: readonly string[]) {
	if (!boardIds.some((id) => externalChangeStore.get().boards[id])) {
		return;
	}
	externalChangeStore.setState((state) => {
		const boards = { ...state.boards };
		for (const boardId of boardIds) delete boards[boardId];
		return { ...state, boards, layers: indexLayers(boards) };
	});
}

/**
 * Changed layers to outline: those still in the design, without layers
 * whose ancestor is outlined too (a replaced subtree shows as one box).
 */
export function getOutlinedLayerIds(
	layerIds: readonly string[],
	entitiesById: Record<string, DesignEntity> = designStore.get().entitiesById,
) {
	const set = new Set(layerIds.filter((id) => entitiesById[id]));
	return [...set].filter((id) => {
		let parentId = entitiesById[id]?.parentId ?? null;
		while (parentId) {
			if (set.has(parentId)) return false;
			parentId = entitiesById[parentId]?.parentId ?? null;
		}
		return true;
	});
}

/** Outlines the changes of boards that just came into view. */
export function showExternalChanges(boardIds: readonly string[], now: number) {
	externalChangeStore.setState((state) => {
		const boards = { ...state.boards };
		const layerIds: string[] = [];
		for (const boardId of boardIds) {
			const board = boards[boardId];
			if (!board) continue;
			boards[boardId] = { ...board, shownAt: now };
			layerIds.push(...board.layerIds);
		}
		flashId += 1;
		return {
			...state,
			boards,
			flash: { id: flashId, layerIds: getOutlinedLayerIds(layerIds) },
		};
	});
}

export function useBoardChangedExternally(boardId: string) {
	return useSelector(externalChangeStore, (state) =>
		Boolean(state.boards[boardId]),
	);
}

export function useLayerChangedExternally(layerId: string) {
	return useSelector(externalChangeStore, (state) =>
		Boolean(state.layers[layerId]),
	);
}

export function useExternallyChangedBoardIds() {
	return useSelector(
		externalChangeStore,
		(state) => Object.keys(state.boards),
		{ compare: shallow },
	);
}

export function useExternalChangeFlash() {
	return useSelector(externalChangeStore, (state) => state.flash);
}
