import {
	createContext,
	type Dispatch,
	type SetStateAction,
	useContext,
} from "react";
import { type DesignEntity, isDescendantOf } from "../stores/design-store";
import type { ResolvedBreakpoint } from "../utils/resolved-breakpoints";

export type ResponsiveStageMode = "canvas" | "responsive";

export const RESPONSIVE_STAGE_DEFAULT_WIDTH = 640;
export const RESPONSIVE_STAGE_MIN_WIDTH = 320;
export const RESPONSIVE_STAGE_MAX_WIDTH = 2400;

export function clampResponsiveStageWidth(width: number) {
	if (!Number.isFinite(width)) {
		return RESPONSIVE_STAGE_MIN_WIDTH;
	}

	return Math.min(
		RESPONSIVE_STAGE_MAX_WIDTH,
		Math.max(RESPONSIVE_STAGE_MIN_WIDTH, Math.round(width)),
	);
}

export type ResponsiveStageControls = {
	setMode: Dispatch<SetStateAction<ResponsiveStageMode>>;
	setActiveBoardId: Dispatch<SetStateAction<string | null>>;
	setResponsiveWidth: Dispatch<SetStateAction<number>>;
};

export type ResponsiveStageContextValue = {
	mode: ResponsiveStageMode;
	activeBoardId: string | null;
	responsiveWidth: number;
	breakpoints: readonly ResolvedBreakpoint[];
	controls: ResponsiveStageControls;
};

export const ResponsiveStageContext = createContext<
	ResponsiveStageContextValue | undefined
>(undefined);

export function useResponsiveStage() {
	const context = useContext(ResponsiveStageContext);
	if (!context) {
		throw new Error(
			"useResponsiveStage must be used within ResponsiveStageContext",
		);
	}

	return context;
}

export function resolveResponsiveStageActiveBoardId(
	rootIds: readonly string[],
	currentBoardId: string | null,
) {
	if (currentBoardId && rootIds.includes(currentBoardId)) {
		return currentBoardId;
	}

	return rootIds[0] ?? null;
}

export type ResponsiveStageBoardCycleDirection = "previous" | "next";

export function getResponsiveStageBoardPosition(
	rootIds: readonly string[],
	currentBoardId: string | null,
) {
	const activeBoardId = resolveResponsiveStageActiveBoardId(
		rootIds,
		currentBoardId,
	);
	const activeIndex = activeBoardId ? rootIds.indexOf(activeBoardId) : -1;

	return {
		activeBoardId,
		index: activeIndex >= 0 ? activeIndex + 1 : 0,
		total: rootIds.length,
	};
}

export function cycleResponsiveStageBoard(
	rootIds: readonly string[],
	currentBoardId: string | null,
	direction: ResponsiveStageBoardCycleDirection,
) {
	if (rootIds.length === 0) {
		return null;
	}

	const activeBoardId = resolveResponsiveStageActiveBoardId(
		rootIds,
		currentBoardId,
	);
	const activeIndex = activeBoardId ? rootIds.indexOf(activeBoardId) : 0;
	if (activeIndex < 0) {
		return rootIds[0] ?? null;
	}

	const delta = direction === "next" ? 1 : -1;
	const nextIndex = (activeIndex + delta + rootIds.length) % rootIds.length;
	return rootIds[nextIndex] ?? null;
}

export function getResponsiveBoardCycleDirectionFromKey(
	event: Pick<
		KeyboardEvent,
		"key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
	>,
): ResponsiveStageBoardCycleDirection | null {
	if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
		return null;
	}

	if (event.key === "ArrowUp") {
		return "previous";
	}

	if (event.key === "ArrowDown") {
		return "next";
	}

	return null;
}

export function shouldPreserveSelectionOnActiveBoard(
	entitiesById: Record<string, DesignEntity>,
	selectedId: string | null,
	activeBoardId: string | null,
) {
	if (!selectedId || !activeBoardId) {
		return true;
	}

	return (
		selectedId === activeBoardId ||
		isDescendantOf(entitiesById, selectedId, activeBoardId)
	);
}
