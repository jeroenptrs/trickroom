import { useEffect, useRef } from "react";
import {
	editorChannelReady,
	editorClientId,
	postEditorContext,
} from "../queries/editor-channel";
import type { EditorContextReport } from "../services/editor-channel.types";
import { designStore } from "../stores/design-store";
import { stageViewStore } from "../stores/stage-view-store";

const reportDebounceMs = 150;
/** Interactions refresh `focusedAt` at most this often. */
const interactionFocusIntervalMs = 1_000;

export type EditorContextReporterOptions = {
	enabled: boolean;
	projectId: string | null;
	designFileId: string | null;
};

/**
 * Reports what this tab shows to the server, debounced. Store changes are read
 * through subscriptions so a selection change does not re-render the caller.
 */
export function useEditorContextReporter({
	enabled,
	projectId,
	designFileId,
}: EditorContextReporterOptions) {
	// A tab counts as focused when it gains focus, becomes visible or is
	// interacted with; the server sends focus requests to the latest one.
	const focusedAtRef = useRef<number | null>(null);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const isVisible = () => document.visibilityState === "visible";
		if (focusedAtRef.current === null && isVisible() && document.hasFocus()) {
			focusedAtRef.current = Date.now();
		}
		let lastSentKey: string | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const build = (): Omit<EditorContextReport, "sentAt"> => {
			const design = designStore.get();
			const stage = stageViewStore.get();
			const inDesign = designFileId !== null;
			return {
				clientId: editorClientId,
				projectId,
				designFileId,
				activeBoardId: inDesign ? stage.activeBoardId : null,
				selectedId: inDesign ? design.selectedId : null,
				stageMode: inDesign ? stage.stageMode : null,
				responsiveWidth: inDesign ? stage.responsiveWidth : null,
				focusedAt: focusedAtRef.current,
				visible: isVisible(),
			};
		};

		const flush = (force = false) => {
			clearTimeout(timer);
			timer = undefined;
			const context = build();
			const key = JSON.stringify(context);
			if (!force && key === lastSentKey) {
				return;
			}
			lastSentKey = key;
			void postEditorContext({ ...context, sentAt: Date.now() });
		};

		const schedule = () => {
			clearTimeout(timer);
			timer = setTimeout(flush, reportDebounceMs);
		};

		const markFocused = () => {
			focusedAtRef.current = Date.now();
			schedule();
		};
		const onInteraction = () => {
			const focusedAt = focusedAtRef.current;
			if (
				focusedAt === null ||
				Date.now() - focusedAt > interactionFocusIntervalMs
			) {
				markFocused();
			}
		};
		const onVisibilityChange = () => {
			if (isVisible()) {
				markFocused();
				return;
			}
			// Hidden tabs may be throttled; send now rather than after a timer.
			flush();
		};

		const designSubscription = designStore.subscribe(schedule);
		const stageSubscription = stageViewStore.subscribe(schedule);
		window.addEventListener("focus", markFocused);
		window.addEventListener("pointerdown", onInteraction, true);
		window.addEventListener("keydown", onInteraction, true);
		document.addEventListener("visibilitychange", onVisibilityChange);
		const unsubscribeReady = editorChannelReady.subscribe(() => flush(true));
		flush();

		return () => {
			clearTimeout(timer);
			designSubscription.unsubscribe();
			stageSubscription.unsubscribe();
			window.removeEventListener("focus", markFocused);
			window.removeEventListener("pointerdown", onInteraction, true);
			window.removeEventListener("keydown", onInteraction, true);
			document.removeEventListener("visibilitychange", onVisibilityChange);
			unsubscribeReady();
		};
	}, [designFileId, enabled, projectId]);
}
