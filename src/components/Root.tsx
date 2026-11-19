import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { useProjectFileEvents } from "../hooks/useProjectFileEvents";
import { useTailwindSyncController } from "../hooks/useTailwindSyncController";
import { useWorkspaceEvents } from "../hooks/useWorkspaceEvents";
import { configFileQueryOptions } from "../queries/config-file";
import { getProjectQueryScope } from "../queries/project-scope";
import {
	closeProject,
	sessionQueryKey,
	sessionQueryOptions,
} from "../queries/projects";
import { systemsQueryOptions } from "../queries/systems";
import { HttpError } from "../utils/readJsonOrThrow";
import {
	getCheckoutUrl,
	getTabPath,
	tabLocationId,
} from "../utils/tab-location";
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
import { getSystemEditorPath } from "./project/SystemDetailPane";
import {
	getSystemAttentionSummary,
	getSystemAttentionToastCopy,
	getSystemAttentionToastIds,
} from "./system-attention-toasts";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/empty-state";
import { Skeleton } from "./ui/skeleton";

// The system editor is large and unused by the design view, so it loads on
// first visit to a system route.
const SystemEditor = lazy(() =>
	import("./SystemEditor").then((module) => ({ default: module.SystemEditor })),
);

/** The system editor's rail and workspace while its code loads. */
function SystemEditorFallback() {
	return (
		<div
			className="absolute inset-0 z-10 flex min-h-0 bg-slate-100"
			aria-busy="true"
		>
			<aside className="flex min-h-0 w-[300px] shrink-0 flex-col border-r border-slate-200 bg-white">
				<div className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
					<Skeleton className="h-3 w-32" />
				</div>
				<div className="flex flex-col gap-3 p-3">
					<Skeleton className="h-7 w-full" />
					<Skeleton className="h-4 w-40" />
					<Skeleton className="h-4 w-48" />
				</div>
			</aside>
			<div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
				<Skeleton className="h-6 w-48" />
				<Skeleton className="h-32 w-full" />
			</div>
		</div>
	);
}

/** The project screen's header and sidebar while project data loads. */
function ProjectShellSkeleton() {
	return (
		<div
			className="flex h-screen w-screen flex-col bg-slate-50"
			aria-busy="true"
		>
			<div className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
				<Skeleton className="size-6" />
				<Skeleton className="h-5 w-40" />
				<div className="flex-1" />
				<Skeleton className="h-8 w-24" />
				<Skeleton className="h-8 w-32" />
				<Skeleton className="h-8 w-48" />
			</div>
			<div className="flex min-h-0 flex-1">
				<div className="flex w-72 shrink-0 flex-col border-r border-slate-200 bg-white">
					<div className="flex flex-col gap-2 px-4 py-3">
						<div className="flex items-center justify-between">
							<Skeleton className="h-3 w-16" />
							<Skeleton className="h-6 w-14" />
						</div>
						<Skeleton className="h-7 w-full" />
					</div>
					{["a", "b", "c"].map((key) => (
						<div
							key={key}
							className="flex items-center gap-3 border-t border-slate-100 px-4 py-3"
						>
							<Skeleton className="size-10" />
							<div className="flex min-w-0 flex-1 flex-col gap-2">
								<Skeleton className="h-3 w-1/2" />
								<Skeleton className="h-2 w-1/3" />
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

/**
 * A failed root load: what failed, the reason, a retry, and (when a project
 * is open) a way to close it and pick another one.
 */
function RootLoadError({
	title,
	error,
	onRetry,
	isRetrying,
	canCloseProject,
}: {
	title: string;
	error: unknown;
	onRetry: () => void;
	isRetrying: boolean;
	canCloseProject: boolean;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const closeMutation = useMutation({
		mutationFn: closeProject,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: sessionQueryKey });
			if (tabLocationId) {
				// Leave the checkout this tab is pinned to.
				window.location.assign("/");
				return;
			}
			navigate("/", { replace: true });
		},
	});
	const reason = error instanceof Error ? error.message : undefined;
	const closeError =
		closeMutation.error instanceof Error ? closeMutation.error.message : null;

	return (
		<main className="flex h-screen w-screen items-center justify-center bg-slate-50 text-slate-950">
			<EmptyState
				icon={TriangleAlert}
				title={title}
				description={
					<span role="alert">
						{reason}
						{closeError ? (
							<>
								<br />
								Could not close the project: {closeError}
							</>
						) : null}
					</span>
				}
				action={
					<div className="flex items-center gap-2">
						{canCloseProject ? (
							<Button
								type="button"
								variant="outlined"
								disabled={closeMutation.isPending}
								onClick={() => closeMutation.mutate()}
							>
								{closeMutation.isPending ? "Closing…" : "Close project"}
							</Button>
						) : null}
						<Button
							type="button"
							variant="filled"
							disabled={isRetrying}
							onClick={onRetry}
						>
							{isRetrying ? "Retrying…" : "Retry"}
						</Button>
					</div>
				}
			/>
		</main>
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

/**
 * A pinned tab with nothing to show: the checkout's folder is gone, or the
 * branch checked out in it has no Trickroom project.
 */
function CheckoutGone({ reason }: { reason: "removed" | "no-project" }) {
	return (
		<main className="flex h-screen w-screen items-center justify-center bg-slate-50 text-slate-950">
			<EmptyState
				icon={TriangleAlert}
				title={
					reason === "removed"
						? "This checkout is no longer on this machine"
						: "No Trickroom project in this checkout"
				}
				description={
					reason === "removed"
						? "Its folder was removed, for example when a worktree was cleaned up."
						: "The branch checked out in this folder has no .trickroom config."
				}
				action={
					<Button
						type="button"
						variant="filled"
						onClick={() => window.location.assign("/")}
					>
						Show projects
					</Button>
				}
			/>
		</main>
	);
}

// The capture pages photograph the server's active project and are never
// pinned by the screenshot service's own URLs.
const isUnpinnedCapturePage =
	!tabLocationId && getTabPath().startsWith("/capture/");
/**
 * A tab that is not pinned shows the home screen. Only as it loads does it
 * move to the server's active project (`trickroom serve <path>`, an old
 * link); a project another tab opens later does not take it over.
 */
let unpinnedLoadSettled = false;

export function Root() {
	const navigate = useNavigate();
	const sessionQuery = useQuery(sessionQueryOptions());
	// Follows the server: another tab switching projects, worktrees coming
	// and going.
	useWorkspaceEvents();
	const sessionProject = sessionQuery.data?.activeProject;
	const showsSessionProject = Boolean(tabLocationId) || isUnpinnedCapturePage;
	const activeProject = showsSessionProject ? sessionProject : null;
	const redirectLocationId =
		!showsSessionProject &&
		!unpinnedLoadSettled &&
		sessionQuery.isSuccess &&
		sessionProject &&
		getTabPath() !== "/new"
			? sessionProject.locationId
			: null;
	useEffect(() => {
		if (showsSessionProject || !sessionQuery.isSuccess) {
			return;
		}
		if (redirectLocationId) {
			window.location.replace(
				`${getCheckoutUrl(redirectLocationId, window.location.pathname)}${window.location.search}`,
			);
			return;
		}
		unpinnedLoadSettled = true;
	}, [redirectLocationId, sessionQuery.isSuccess, showsSessionProject]);
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
	// One system to review: the toast opens its token review. Several: the
	// project sidebar marks each one.
	const reviewSystemId =
		systemAttention.reviewSystemIds.length === 1
			? systemAttention.reviewSystemIds[0]
			: null;
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

		const copy = getSystemAttentionToastCopy(
			"issues",
			systemAttention.issueKey.split("\0"),
		);
		toast.warning(copy.title, {
			id: attentionToastIds.issues,
			description: copy.description,
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

		const copy = getSystemAttentionToastCopy(
			"review",
			systemAttention.reviewKey.split("\0"),
		);
		toast.info(copy.title, {
			id: attentionToastIds.review,
			description: copy.description,
			action: reviewSystemId
				? {
						label: "Review",
						onClick: () =>
							navigate(getSystemEditorPath(reviewSystemId, { tab: "tokens" })),
					}
				: undefined,
		});
		visibleAttentionToastIdsRef.current.review = attentionToastIds.review;
	}, [
		attentionToastIds.review,
		navigate,
		projectDataReady,
		reviewSystemId,
		systemAttention.reviewKey,
	]);

	if (sessionQuery.isPending) {
		return <ProjectShellSkeleton />;
	}

	if (sessionQuery.isError) {
		return (
			<RootLoadError
				title="Could not load your projects"
				error={sessionQuery.error}
				onRetry={() => void sessionQuery.refetch()}
				isRetrying={sessionQuery.isFetching}
				canCloseProject={false}
			/>
		);
	}

	if (redirectLocationId) {
		return <ProjectShellSkeleton />;
	}

	if (!hasActiveProject) {
		return tabLocationId ? <CheckoutGone reason="removed" /> : <HomeRoutes />;
	}

	if (
		configQuery.isPending ||
		(configQuery.isSuccess && systemsQuery.isPending)
	) {
		return <ProjectShellSkeleton />;
	}

	if (configQuery.isError) {
		if (
			configQuery.error instanceof HttpError &&
			configQuery.error.status === 404
		) {
			return tabLocationId ? (
				<CheckoutGone reason="no-project" />
			) : (
				<HomeRoutes />
			);
		}

		return (
			<RootLoadError
				title={`Could not load ${activeProject?.name ?? "the project"}`}
				error={configQuery.error}
				onRetry={() => void configQuery.refetch()}
				isRetrying={configQuery.isFetching}
				canCloseProject
			/>
		);
	}

	if (systemsQuery.isError) {
		return (
			<RootLoadError
				title={`Could not load systems for ${activeProject?.name ?? "the project"}`}
				error={systemsQuery.error}
				onRetry={() => void systemsQuery.refetch()}
				isRetrying={systemsQuery.isFetching}
				canCloseProject
			/>
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
