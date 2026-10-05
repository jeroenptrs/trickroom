import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { Navigate, Route, Routes, useParams } from "react-router";
import { toast } from "sonner";
import { useProjectFileEvents } from "../hooks/useProjectFileEvents";
import { useTailwindSyncController } from "../hooks/useTailwindSyncController";
import { configFileQueryOptions } from "../queries/config-file";
import { getProjectQueryScope } from "../queries/project-scope";
import { sessionQueryOptions } from "../queries/projects";
import { systemsQueryOptions } from "../queries/systems";
import { HttpError } from "../utils/readJsonOrThrow";
import { Capture, ComponentCapture } from "./Capture";
import { CreateProjectPanel } from "./CreateProjectPanel";
import {
	ProjectConfigContext,
	ProjectScopeContext,
	ProjectSystemsContext,
	TailwindSyncControllerContext,
} from "./contexts";
import { Design } from "./Design";
import { EditorChannel } from "./EditorChannel";
import { HomeShell } from "./HomeShell";
import { OpenProjectPanel } from "./OpenProjectPanel";
import { Project } from "./Project";
import {
	getSystemAttentionSummary,
	getSystemAttentionToastIds,
} from "./system-attention-toasts";

// The system editor is large and unused by the design view, so it loads on
// first visit to a system route.
const SystemEditor = lazy(() =>
	import("./SystemEditor").then((module) => ({ default: module.SystemEditor })),
);

function SystemEditorFallback() {
	return (
		<div
			role="status"
			className="pointer-events-none absolute left-3 top-3 z-30 flex items-center gap-2 bg-slate-950 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-slate-50"
		>
			<span className="size-1.5 animate-pulse bg-cyan-400" aria-hidden="true" />
			Loading system editor
		</div>
	);
}

// One editor instance per design: its stage iframe, the hooks bound to it and
// the stage view state belong to that design. Without the key, moving from one
// design to another (a focus request, extracting a subtree) kept the stage
// hooks bound to the previous design's iframe.
function DesignRoute() {
	const { uuid } = useParams<{ uuid: string }>();
	return <Design key={uuid} />;
}

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
							<EditorChannel
								enabled={projectDataReady}
								projectId={activeProject?.projectId || null}
							/>
							<Routes>
								<Route index element={<Project />} />
								<Route path="capture/:design/:board?" element={<Capture />} />
								<Route
									path="capture/component/:system/:component"
									element={<ComponentCapture />}
								/>
								<Route path="design/:uuid" element={<DesignRoute />} />
								<Route
									path="system/:systemId"
									element={
										<Suspense fallback={<SystemEditorFallback />}>
											<SystemEditor />
										</Suspense>
									}
								/>
								<Route path="new" element={<Navigate to="/" replace />} />
							</Routes>
						</main>
					</TailwindSyncControllerContext.Provider>
				</ProjectSystemsContext.Provider>
			</ProjectConfigContext.Provider>
		</ProjectScopeContext.Provider>
	);
}
