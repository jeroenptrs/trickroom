import { createStore, useSelector } from "@tanstack/react-store";
import type { SetStateAction } from "react";
import {
	clampResponsiveStageWidth,
	RESPONSIVE_STAGE_DEFAULT_WIDTH,
	type ResponsiveStageMode,
} from "../components/responsive-stage-context";

// View state of the open design's stage. It lives outside `Design` so the
// editor channel can report it and focus requests can drive it. The design
// route resets it on mount, which keeps the old per-mount `useState` behaviour.

/** Asks the stage and the layers panel to bring an element into view. */
export type StageRevealRequest = {
	/** Distinguishes repeated requests for the same element. */
	requestId: string;
	elementId: string;
};

export type StageViewState = {
	stageMode: ResponsiveStageMode;
	activeBoardId: string | null;
	responsiveWidth: number;
	reveal: StageRevealRequest | null;
};

const initialState: StageViewState = {
	stageMode: "canvas",
	activeBoardId: null,
	responsiveWidth: RESPONSIVE_STAGE_DEFAULT_WIDTH,
	reveal: null,
};

export const stageViewStore = createStore<StageViewState>(initialState);

const resolveAction = <T>(action: SetStateAction<T>, current: T): T =>
	typeof action === "function"
		? (action as (previous: T) => T)(current)
		: action;

const update = <K extends keyof StageViewState>(
	key: K,
	value: StageViewState[K],
) => {
	stageViewStore.setState((state) =>
		Object.is(state[key], value) ? state : { ...state, [key]: value },
	);
};

export function resetStageView(responsiveWidth: number) {
	stageViewStore.setState(() => ({
		...initialState,
		responsiveWidth: clampResponsiveStageWidth(responsiveWidth),
	}));
}

export function setStageMode(action: SetStateAction<ResponsiveStageMode>) {
	update("stageMode", resolveAction(action, stageViewStore.get().stageMode));
}

export function setActiveBoardId(action: SetStateAction<string | null>) {
	update(
		"activeBoardId",
		resolveAction(action, stageViewStore.get().activeBoardId),
	);
}

export function setResponsiveWidth(action: SetStateAction<number>) {
	update(
		"responsiveWidth",
		clampResponsiveStageWidth(
			resolveAction(action, stageViewStore.get().responsiveWidth),
		),
	);
}

export function requestStageReveal(reveal: StageRevealRequest) {
	update("reveal", reveal);
}

export function useStageMode() {
	return useSelector(stageViewStore, (state) => state.stageMode);
}

export function useActiveBoardId() {
	return useSelector(stageViewStore, (state) => state.activeBoardId);
}

export function useResponsiveWidth() {
	return useSelector(stageViewStore, (state) => state.responsiveWidth);
}

export function useStageReveal() {
	return useSelector(stageViewStore, (state) => state.reveal);
}
