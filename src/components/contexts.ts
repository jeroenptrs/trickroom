import { createContext, useContext } from "react";
import type { ViewState } from "../hooks/useStageNavigation";
import type { TailwindSyncController } from "../hooks/useTailwindSyncController";
import type { ProjectQueryScope } from "../queries/project-scope";
import type { SystemSummary } from "../queries/systems";
import type { TrickroomConfig } from "../types";

export const IFrameViewContext = createContext<ViewState | undefined>(
	undefined,
);

export const ProjectConfigContext = createContext<TrickroomConfig | undefined>(
	undefined,
);

export const ProjectSystemsContext = createContext<SystemSummary[] | undefined>(
	undefined,
);

export const ProjectScopeContext = createContext<ProjectQueryScope>(undefined);

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

export function useProjectSystems() {
	const context = useContext(ProjectSystemsContext);
	if (!context) {
		throw new Error(
			"useProjectSystems must be used within ProjectSystemsContext",
		);
	}

	return context;
}

export function useProjectScope() {
	return useContext(ProjectScopeContext);
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
