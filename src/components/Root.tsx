import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { Navigate, Route, Routes } from "react-router";
import { toast } from "sonner";
import { useProjectFileEvents } from "../hooks/useProjectFileEvents";
import { useTailwindSyncController } from "../hooks/useTailwindSyncController";
import { configFileQueryOptions } from "../queries/config-file";
import { getProjectQueryScope } from "../queries/project-scope";
import { sessionQueryOptions } from "../queries/projects";
import { systemsQueryOptions } from "../queries/systems";
import { HttpError } from "../utils/readJsonOrThrow";
import { CreateProjectPanel } from "./CreateProjectPanel";
import {
	ProjectConfigContext,
	ProjectScopeContext,
	ProjectSystemsContext,
	TailwindSyncControllerContext,
} from "./contexts";
import { Design } from "./Design";
import { HomeShell } from "./HomeShell";
import { OpenProjectPanel } from "./OpenProjectPanel";
import { Project } from "./Project";
import { SystemEditor } from "./SystemEditor";
import {
	getSystemAttentionSummary,
	getSystemAttentionToastIds,
} from "./system-attention-toasts";

function HomeRoutes() {
	return (
		<Routes>
			<Route element={<HomeShell />}>
				<Route index element={<OpenProjectPanel />} />
				<Route path="new" element={<CreateProjectPanel />} />
			</Route>
		</Routes>
	);
}

export function Root() {
	const sessionQuery = useQuery(sessionQueryOptions());
	const activeProject = sessionQuery.data?.activeProject;
	const activeProjectScope = getProjectQueryScope(activeProject);
	const hasActiveProject = Boolean(activeProject);
	const configQuery = useQuery({
		...configFileQueryOptions(activeProjectScope),
		enabled: sessionQuery.isSuccess && hasActiveProject,
	});
	const systemsQuery = useQuery({
		...systemsQueryOptions(activeProjectScope),
		enabled: configQuery.isSuccess,
	});
	const projectDataReady =
		hasActiveProject && configQuery.isSuccess && systemsQuery.isSuccess;
	useProjectFileEvents(activeProjectScope, projectDataReady);
	const projectSystems = projectDataReady ? systemsQuery.data.systems : [];
	const syncController = useTailwindSyncController(
		projectSystems,
		activeProjectScope,
	);
	const systemAttention = useMemo(
		() =>
			getSystemAttentionSummary(syncController.systems, syncController.results),
		[syncController.systems, syncController.results],
	);
	const attentionToastIds = useMemo(
		() => getSystemAttentionToastIds(activeProjectScope),
		[activeProjectScope],
	);
	const previousAttentionToastIdsRef = useRef(attentionToastIds);
	const visibleAttentionToastIdsRef = useRef<{
		issues?: string;
		review?: string;
	}>({});

	useEffect(() => {
		const previous = previousAttentionToastIdsRef.current;
		if (
			previous.issues !== attentionToastIds.issues ||
			previous.review !== attentionToastIds.review
		) {
			if (visibleAttentionToastIdsRef.current.issues) {
				toast.dismiss(visibleAttentionToastIdsRef.current.issues);
			}
			if (visibleAttentionToastIdsRef.current.review) {
				toast.dismiss(visibleAttentionToastIdsRef.current.review);
			}
			visibleAttentionToastIdsRef.current = {};
			previousAttentionToastIdsRef.current = attentionToastIds;
		}
	}, [attentionToastIds]);

	useEffect(() => {
		if (!projectDataReady) {
			return;
		}

		if (!systemAttention.issueKey) {
			if (visibleAttentionToastIdsRef.current.issues) {
				toast.dismiss(visibleAttentionToastIdsRef.current.issues);
				visibleAttentionToastIdsRef.current.issues = undefined;
			}
			return;
		}

		const issueNames = systemAttention.issueKey.split("\0");
		toast.warning("Your systems need attention", {
			id: attentionToastIds.issues,
			description:
				issueNames.length === 1
					? `${issueNames[0]} has issues syncing tokens`
					: "Some design systems have issues syncing tokens",
		});
		visibleAttentionToastIdsRef.current.issues = attentionToastIds.issues;
	}, [attentionToastIds.issues, projectDataReady, systemAttention.issueKey]);

	useEffect(() => {
		if (!projectDataReady) {
			return;
		}

		if (!systemAttention.reviewKey) {
			if (visibleAttentionToastIdsRef.current.review) {
				toast.dismiss(visibleAttentionToastIdsRef.current.review);
				visibleAttentionToastIdsRef.current.review = undefined;
			}
			return;
		}

		const reviewNames = systemAttention.reviewKey.split("\0");
		toast.info("Your systems need attention", {
			id: attentionToastIds.review,
			description:
				reviewNames.length === 1
					? `${reviewNames[0]} has token changes to review`
					: "Some design systems have token changes to review",
		});
		visibleAttentionToastIdsRef.current.review = attentionToastIds.review;
	}, [attentionToastIds.review, projectDataReady, systemAttention.reviewKey]);

	if (sessionQuery.isPending) {
		return (
			<div className="pointer-events-none absolute left-3 top-3 z-30 bg-slate-500 px-2 py-1 text-xs text-white">
				Loading project data...
			</div>
		);
	}

	if (sessionQuery.isError) {
		const errorMessage = (sessionQuery.error as Error | null)?.message;
		return (
			<div className="absolute left-3 top-3 z-30 bg-red-500 px-2 py-1 text-xs text-white">
				Failed to load session: {errorMessage}
			</div>
		);
	}

	if (!hasActiveProject) {
		return <HomeRoutes />;
	}

	if (configQuery.isPending || systemsQuery.isPending) {
		return (
			<div className="pointer-events-none absolute left-3 top-3 z-30 bg-slate-500 px-2 py-1 text-xs text-white">
				Loading project data...
			</div>
		);
	}

	if (configQuery.isError) {
		if (
			configQuery.error instanceof HttpError &&
			configQuery.error.status === 404
		) {
			return <HomeRoutes />;
		}

		const errorMessage = (configQuery.error as Error | null)?.message;
		return (
			<div className="absolute left-3 top-3 z-30 bg-red-500 px-2 py-1 text-xs text-white">
				Failed to load project data: {errorMessage}
			</div>
		);
	}

	if (systemsQuery.isError) {
		const errorMessage = (systemsQuery.error as Error | null)?.message;
		return (
			<div className="absolute left-3 top-3 z-30 bg-red-500 px-2 py-1 text-xs text-white">
				Failed to load system data: {errorMessage}
			</div>
		);
	}

	const effectiveConfig = configQuery.data;
	if (!effectiveConfig) {
		return <HomeRoutes />;
	}

	return (
		<ProjectScopeContext.Provider value={activeProjectScope}>
			<ProjectConfigContext.Provider value={effectiveConfig}>
				<ProjectSystemsContext.Provider value={projectSystems}>
					<TailwindSyncControllerContext.Provider value={syncController}>
						<main
							key={activeProjectScope}
							className="isolate relative h-screen w-screen overflow-hidden bg-slate-50 text-slate-950"
							data-project-name={effectiveConfig.name}
						>
							<Routes>
								<Route index element={<Project />} />
								<Route path="design/:uuid" element={<Design />} />
								<Route path="system/:systemId" element={<SystemEditor />} />
								<Route path="new" element={<Navigate to="/" replace />} />
							</Routes>
						</main>
					</TailwindSyncControllerContext.Provider>
				</ProjectSystemsContext.Provider>
			</ProjectConfigContext.Provider>
		</ProjectScopeContext.Provider>
	);
}
