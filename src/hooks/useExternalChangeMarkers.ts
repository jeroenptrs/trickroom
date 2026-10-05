import { type RefObject, useEffect } from "react";
import { designStore, getBoardIdOf } from "../stores/design-store";
import { subscribeExternalDesignChanges } from "../stores/design-sync";
import {
	clearExternalChanges,
	externalChangeStore,
	recordExternalChange,
	resetExternalChanges,
	showExternalChanges,
} from "../stores/external-change-store";
import { stageViewStore } from "../stores/stage-view-store";

/** How long a changed board stays marked once it has been in view. */
const VIEWED_CLEAR_MS = 4_000;
const CHECK_DELAY_MS = 150;
/**
 * Canvas pans and zooms stay out of React, so while a marked board is out of
 * view its position is checked at this interval.
 */
const OUT_OF_VIEW_POLL_MS = 500;

/**
 * Keeps the "changed externally" markers of the open design:
 *
 * - External changes applied by live sync mark their boards and layers.
 * - A marked board in view (the active board in the responsive view, any
 *   part of it in the canvas viewport) has its changed layers outlined on
 *   the stage once, and its marker cleared a few seconds later.
 * - Selecting a layer in a marked board or editing it clears its marker.
 * - Nothing is shown or cleared while the tab is hidden.
 */
export function useExternalChangeMarkers({
	designId,
	iframeRef,
	didMount,
}: {
	designId: string | null;
	iframeRef: RefObject<HTMLIFrameElement | null>;
	didMount: boolean;
}) {
	// Markers belong to one design: a new design starts without any.
	useEffect(() => {
		resetExternalChanges();
		if (!designId) {
			return;
		}
		const unsubscribe = subscribeExternalDesignChanges(recordExternalChange);
		return () => {
			unsubscribe();
			resetExternalChanges();
		};
	}, [designId]);

	useEffect(() => {
		let { selectedId, dirtyBoards } = designStore.get();
		const subscription = designStore.subscribe(() => {
			const state = designStore.get();
			const touched: string[] = [];
			if (state.selectedId !== selectedId) {
				selectedId = state.selectedId;
				const boardId = selectedId
					? getBoardIdOf(state.entitiesById, selectedId)
					: null;
				if (boardId) touched.push(boardId);
			}
			if (state.dirtyBoards !== dirtyBoards) {
				for (const [boardId, at] of Object.entries(state.dirtyBoards ?? {})) {
					if (dirtyBoards?.[boardId] !== at) touched.push(boardId);
				}
				dirtyBoards = state.dirtyBoards;
			}
			if (touched.length > 0) clearExternalChanges(touched);
		});
		return () => subscription.unsubscribe();
	}, []);

	useEffect(() => {
		if (!didMount) {
			return;
		}
		let timer: ReturnType<typeof setTimeout> | undefined;

		const visibleBoards = (boardIds: string[]) => {
			const { stageMode, activeBoardId } = stageViewStore.get();
			if (stageMode === "responsive") {
				return boardIds.filter((id) => id === activeBoardId);
			}
			const iframe = iframeRef.current;
			const frameDocument = iframe?.contentDocument;
			if (!iframe || !frameDocument) {
				return [];
			}
			const width = iframe.clientWidth;
			const height = iframe.clientHeight;
			return boardIds.filter((id) => {
				const board = frameDocument.querySelector(
					`[data-trickroom-root-id="${CSS.escape(id)}"]`,
				);
				if (!board) return false;
				const rect = board.getBoundingClientRect();
				return (
					rect.right > 0 &&
					rect.bottom > 0 &&
					rect.left < width &&
					rect.top < height
				);
			});
		};

		const check = () => {
			timer = undefined;
			if (document.visibilityState !== "visible") {
				return;
			}
			const { boards } = externalChangeStore.get();
			const now = Date.now();
			const viewed = Object.entries(boards)
				.filter(([, board]) => board.shownAt !== null)
				.filter(([, board]) => now - (board.shownAt ?? now) >= VIEWED_CLEAR_MS)
				.map(([boardId]) => boardId);
			if (viewed.length > 0) {
				clearExternalChanges(viewed);
			}
			const unseen = Object.entries(boards)
				.filter(([, board]) => board.shownAt === null)
				.map(([boardId]) => boardId);
			const inView = visibleBoards(unseen);
			if (inView.length > 0) {
				showExternalChanges(inView, now);
			}
			const remaining = Object.values(externalChangeStore.get().boards);
			const shown = remaining
				.map((board) => board.shownAt)
				.filter((shownAt): shownAt is number => shownAt !== null);
			const delays = [
				...(shown.length > 0
					? [Math.max(0, Math.min(...shown) + VIEWED_CLEAR_MS - now)]
					: []),
				...(shown.length < remaining.length ? [OUT_OF_VIEW_POLL_MS] : []),
			];
			if (delays.length > 0) {
				schedule(Math.min(...delays));
			}
		};

		const schedule = (delay = CHECK_DELAY_MS) => {
			if (timer !== undefined) clearTimeout(timer);
			timer = setTimeout(check, delay);
		};

		const changes = externalChangeStore.subscribe(() => schedule());
		const stage = stageViewStore.subscribe(() => schedule());
		const onVisibility = () => schedule();
		document.addEventListener("visibilitychange", onVisibility);
		schedule();

		return () => {
			if (timer !== undefined) clearTimeout(timer);
			changes.unsubscribe();
			stage.unsubscribe();
			document.removeEventListener("visibilitychange", onVisibility);
		};
	}, [didMount, iframeRef]);
}
