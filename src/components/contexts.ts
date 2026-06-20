import { createContext, useContext } from "react";
import type { TailwindSyncController } from "../hooks/useTailwindSyncController";
import type { ViewState } from "../hooks/useStageNavigation";
import type { TrickroomConfig } from "../types";

export const IFrameViewContext = createContext<ViewState | undefined>(
	undefined,
);

export const ProjectConfigContext = createContext<TrickroomConfig | undefined>(
	undefined,
);

export const TailwindSyncControllerContext = createContext<
	TailwindSyncController | undefined
>(undefined);

export function useIFrameView() {
	const context = useContext(IFrameViewContext);
	if (!context) {
		throw new Error("useIFrameView must be used within IFrameViewContext");
	}

	return context;
}

export function useProjectConfig() {
	const context = useContext(ProjectConfigContext);
	if (!context) {
		throw new Error(
			"useProjectConfig must be used within ProjectConfigContext",
		);
	}

	return context;
}

export function useTailwindSyncController() {
	const context = useContext(TailwindSyncControllerContext);
	if (!context) {
		throw new Error(
			"useTailwindSyncController must be used within TailwindSyncControllerContext",
		);
	}

	return context;
}
