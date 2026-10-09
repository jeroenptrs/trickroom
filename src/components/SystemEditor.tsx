import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	useLocation,
	useNavigate,
	useParams,
	useSearchParams,
} from "react-router";
import { StagePreviewDarkModeProvider } from "../preview/stage-preview-dark-mode";
import { systemComponentQueryOptions } from "../queries/system-components";
import { systemsQueryOptions } from "../queries/systems";
import {
	componentDraftStore,
	selectTemplateNode,
	useComponentDraftComponentId,
	useComponentDraftSelectedPath,
} from "../stores/component-draft-store";
import {
	handleEditorChromeShortcut,
	useEditorPanelOpen,
} from "../stores/editor-chrome-store";
import {
	resetLintDashboard,
	selectLintItem,
	useLintSelection,
} from "../stores/lint-dashboard-store";
import {
	focusEditorRegion,
	getKey,
	useWindowKeyDown,
} from "../utils/editor-shortcuts";
import {
	buildSystemComponentSearch,
	buildSystemTabSearch,
	readSystemComponentDeepLinkNode,
} from "../utils/system-deep-link";
import { useProjectScope, useTailwindSyncController } from "./contexts";
import {
	SystemStatusBadge,
	type SystemStatusBadgeState,
} from "./project/SystemStatusBadge";
import { SystemEditorAssetsPanel } from "./system-editor/SystemEditorAssetsPanel";
import {
	CollapsedComponentContextHeader,
	SystemEditorComponentsPanel,
	SystemEditorComponentsRail,
} from "./system-editor/SystemEditorComponentsPanel";
import {
	SystemEditorIconFoldersRail,
	SystemEditorIconsPanel,
} from "./system-editor/SystemEditorIconsPanel";
import { SystemEditorInspector } from "./system-editor/SystemEditorInspector";
import {
	SystemEditorLintPanel,
	SystemEditorLintRail,
} from "./system-editor/SystemEditorLintPanel";
import { SystemEditorTokensPanel } from "./system-editor/SystemEditorTokensPanel";
import {
	revealSystemPanel,
	SystemPanelToggle,
} from "./system-editor/SystemPanelToggle";
import {
	getSystemEditorPage,
	type SystemEditorPage,
} from "./system-editor/types";
import {
	discardOpenComponentDraft,
	useGuardedComponentLocation,
} from "./system-editor/useGuardedComponentLocation";
import { Button } from "./ui/button";
import { FloatingPanel, FloatingPanelHeader } from "./ui/floating-panel";
import { PanelEdgeStrip } from "./ui/panel-edge-strip";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";
import { Tabs, TabsList, TabsPanel, TabsTab } from "./ui/tabs";
import { Text } from "./ui/text";

const SYSTEM_EDITOR_PAGES: Array<{ value: SystemEditorPage; label: string }> = [
	{ value: "components", label: "Components" },
	{ value: "tokens", label: "Tokens" },
	{ value: "assets", label: "Assets" },
	{ value: "icons", label: "Icons" },
	{ value: "lint", label: "Lint" },
];

function getSystemBadgeState(
	systemStatus: "idle" | "pending" | "success" | "updated" | "error",
	reviewRequired: boolean,
): SystemStatusBadgeState {
	if (systemStatus === "error") {
		return "error";
	}

	if (systemStatus === "pending") {
		return "syncing";
	}

	if (systemStatus === "idle") {
		return "idle";
	}

	if (reviewRequired) {
		return "review";
	}

	return "synced";
}

/**
 * System header row: back to the project, the system name and its sync
 * state, then the rail toggle. Shared by the rail and the floating panel
 * left in its place when the rail is collapsed.
 */
function SystemHeaderContent({
	systemName,
	systemStatus,
	onClose,
}: {
	systemName: string;
	systemStatus: SystemStatusBadgeState;
	onClose: () => void;
}) {
	return (
		<>
			<Button
				type="button"
				variant="block"
				className="flex size-7 shrink-0 items-center justify-center p-0"
				onClick={onClose}
				title="Back to project"
			>
				<ArrowLeft className="size-4 text-slate-500" />
			</Button>
			<div className="min-w-0 flex-1">
				<Text
					variant="label"
					className="block truncate text-[12px] font-medium text-slate-900"
				>
					{systemName}
				</Text>
			</div>
			<SystemStatusBadge state={systemStatus} />
			<SystemPanelToggle panel="rail" />
		</>
	);
}

function SystemLeftSidebar({
	systemName,
	systemId,
	systemStatus,
	onClose,
	collapseChrome = false,
	collapsed = false,
	children,
}: {
	systemName: string;
	systemId: string;
	systemStatus: SystemStatusBadgeState;
	onClose: () => void;
	collapseChrome?: boolean;
	collapsed?: boolean;
	children?: ReactNode;
}) {
	return (
		<aside
			data-editor-region={collapsed ? undefined : "rail"}
			tabIndex={-1}
			className={`${collapsed ? "hidden" : "flex"} min-h-0 w-[300px] shrink-0 flex-col border-r border-slate-200 bg-white text-xs`}
			data-system-id={systemId}
		>
			{collapseChrome ? null : (
				<>
					<header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
						<SystemHeaderContent
							systemName={systemName}
							systemStatus={systemStatus}
							onClose={onClose}
						/>
					</header>
					<nav className="px-2" aria-label="System editor sections">
						<TabsList variant="block" className="w-full flex-row border-b-0">
							{SYSTEM_EDITOR_PAGES.map((page) => (
								<TabsTab
									key={page.value}
									value={page.value}
									variant="block"
									className="flex-1 px-1.5 py-2"
								>
									{page.label}
								</TabsTab>
							))}
						</TabsList>
					</nav>
					<Separator />
				</>
			)}
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				{children}
			</div>
		</aside>
	);
}

export function SystemEditor() {
	const { systemId: rawSystemId } = useParams<{ systemId: string }>();
	const [searchParams] = useSearchParams();
	const location = useLocation();
	const navigate = useNavigate();
	const projectScope = useProjectScope();
	const syncController = useTailwindSyncController();
	const systemsQuery = useQuery(systemsQueryOptions(projectScope));
	const workspaceScrollRef = useRef<HTMLDivElement>(null);
	const normalizedSystemId = rawSystemId?.trim();
	const systems = systemsQuery.data?.systems ?? [];
	const selectedSystem = useMemo(() => {
		if (!normalizedSystemId) {
			return null;
		}

		return (
			systems.find(
				(system) =>
					system.systemId === normalizedSystemId ||
					system.systemName === normalizedSystemId,
			) ?? null
		);
	}, [normalizedSystemId, systems]);
	const [selectedComponentId, setSelectedComponentId] = useState<string | null>(
		() => searchParams.get("component"),
	);
	const [activePage, setActivePage] = useState<SystemEditorPage>(() =>
		getSystemEditorPage(searchParams.get("tab"), searchParams.get("component")),
	);
	const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
	const [selectedIconId, setSelectedIconId] = useState<string | null>(null);
	const selectedTemplatePath = useComponentDraftSelectedPath();
	const draftComponentId = useComponentDraftComponentId();
	// A template node a deep link asked for, selected once its draft has loaded.
	const [pendingNode, setPendingNode] = useState(() =>
		readSystemComponentDeepLinkNode(searchParams),
	);
	const lintSelection = useLintSelection();
	const selectedSystemId = selectedSystem?.systemId ?? null;

	// The lint dashboard's view, filters and selection belong to one system.
	useEffect(() => {
		if (selectedSystemId) {
			resetLintDashboard();
		}
	}, [selectedSystemId]);

	const systemStatus = useMemo(() => {
		if (!selectedSystem) {
			return "idle" as SystemStatusBadgeState;
		}

		const syncStatus =
			syncController.statusBySystem[selectedSystem.systemId] ?? "idle";
		const reviewRequired = Boolean(
			syncController.results[selectedSystem.systemId]?.data?.reviewRequired,
		);

		return getSystemBadgeState(syncStatus, reviewRequired);
	}, [selectedSystem, syncController]);

	// The URL is the single way the open view changes: links ("Go to component"),
	// Back and Forward, tab clicks, and the component list and back button (via
	// `openComponent`). Every navigation has its own key, so following the same
	// link twice works too.
	const openComponentIdRef = useRef<string | null>(null);
	openComponentIdRef.current =
		activePage === "components" ? selectedComponentId : null;
	const applyLocationSearch = useCallback((search: string) => {
		const params = new URLSearchParams(search);
		const componentId = params.get("component");
		const page = getSystemEditorPage(params.get("tab"), componentId);
		const opensOther =
			componentId !== null &&
			componentId !== componentDraftStore.get().componentId;
		const backToList =
			componentId === null &&
			page === "components" &&
			openComponentIdRef.current !== null;
		if (opensOther || backToList) {
			discardOpenComponentDraft();
		}
		setActivePage(page);
		setSelectedComponentId(componentId);
		setSelectedAssetId(null);
		setSelectedIconId(null);
		selectLintItem(null);
		setPendingNode(readSystemComponentDeepLinkNode(params));
	}, []);
	const leaveDialog = useGuardedComponentLocation({
		systemId: selectedSystem?.systemId ?? "",
		projectScope,
		onApply: applyLocationSearch,
		getOpenComponentId: () => openComponentIdRef.current,
	});
	// The component list and the back button navigate (push) like a link, so
	// they get the same unsaved-changes question.
	const openComponent = useCallback(
		(componentId: string | null) => {
			if (componentId === openComponentIdRef.current) {
				return;
			}
			navigate({
				pathname: location.pathname,
				search: buildSystemComponentSearch(componentId),
			});
		},
		[navigate, location.pathname],
	);

	const pendingRecordQuery = useQuery({
		...systemComponentQueryOptions(
			selectedSystem?.systemId ?? "",
			pendingNode?.componentId ?? "",
			projectScope,
		),
		enabled: selectedSystem !== null && pendingNode !== null,
	});
	const pendingRecord = pendingRecordQuery.data?.record;
	useEffect(() => {
		if (!pendingNode) {
			return;
		}
		if (pendingNode.componentId !== selectedComponentId) {
			setPendingNode(null);
			return;
		}
		if (draftComponentId !== pendingNode.componentId) {
			// Not loaded yet; a component without a draft keeps waiting harmlessly.
			return;
		}
		// A finding names a published version; the loaded draft shows the same
		// template only while it is made over that version. Drafts from before
		// `baseVersion` are over the component's current version.
		const { baseVersion } = componentDraftStore.get();
		if (
			baseVersion === undefined &&
			pendingNode.version !== null &&
			!pendingRecord
		) {
			return;
		}
		setPendingNode(null);
		const draftIsOver = baseVersion ?? pendingRecord?.published?.currentVersion;
		if (pendingNode.version === null || pendingNode.version === draftIsOver) {
			selectTemplateNode(pendingNode.path);
		}
	}, [pendingNode, pendingRecord, selectedComponentId, draftComponentId]);

	// Tabs live in the URL (`tab=`), so Back from a component reached through a
	// link returns to the tab it was followed from. A tab click replaces the
	// current entry instead of adding one.
	const handlePageChange = useCallback(
		(nextPage: string) => {
			navigate(
				{ pathname: location.pathname, search: buildSystemTabSearch(nextPage) },
				{ replace: true },
			);
		},
		[navigate, location.pathname],
	);

	const isComponentContext =
		activePage === "components" && selectedComponentId !== null;
	const hasComponentLayerInspector =
		isComponentContext &&
		draftComponentId === selectedComponentId &&
		selectedTemplatePath !== null;
	const hasInspectorContext =
		hasComponentLayerInspector ||
		(activePage === "assets" && selectedAssetId !== null) ||
		(activePage === "icons" && selectedIconId !== null) ||
		(activePage === "lint" && lintSelection !== null);
	const closeInspector = useCallback(() => {
		if (activePage === "components") {
			selectTemplateNode(null);
			return;
		}
		if (activePage === "assets") {
			setSelectedAssetId(null);
			return;
		}
		if (activePage === "icons") {
			setSelectedIconId(null);
			return;
		}
		if (activePage === "lint") {
			selectLintItem(null);
		}
	}, [activePage]);

	useHotkey("Escape", closeInspector, { enabled: hasInspectorContext });

	const isRailOpen = useEditorPanelOpen("system", "rail");
	const isInspectorOpen = useEditorPanelOpen("system", "inspector");

	// A delete finishes later than it starts, and the rail that started it may
	// have been remounted: what is open when it completes decides.
	const handleComponentDeleted = useCallback(
		(componentId: string) => {
			if (openComponentIdRef.current === componentId) {
				// The draft belongs to a component that no longer exists: nothing to
				// ask about.
				discardOpenComponentDraft();
				openComponent(null);
			}
		},
		[openComponent],
	);

	const handleSystemEditorShortcut = useCallback(
		(event: KeyboardEvent) => {
			if (handleEditorChromeShortcut(event, "system")) {
				return;
			}

			if (
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				!event.shiftKey &&
				event.key === "["
			) {
				if (isComponentContext) {
					openComponent(null);
				} else {
					navigate("/");
				}
				event.preventDefault();
				return;
			}

			if (
				event.ctrlKey &&
				!event.metaKey &&
				!event.altKey &&
				event.key === "Tab"
			) {
				if (isComponentContext) {
					return;
				}

				const currentIndex = SYSTEM_EDITOR_PAGES.findIndex(
					(page) => page.value === activePage,
				);
				const direction = event.shiftKey ? -1 : 1;
				const nextIndex =
					(currentIndex + direction + SYSTEM_EDITOR_PAGES.length) %
					SYSTEM_EDITOR_PAGES.length;
				handlePageChange(SYSTEM_EDITOR_PAGES[nextIndex]?.value ?? "components");
				event.preventDefault();
				return;
			}

			if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
				return;
			}

			const key = getKey(event);
			if (key === "1") {
				revealSystemPanel("rail");
				focusEditorRegion("rail");
			} else if (key === "2") {
				focusEditorRegion("workspace");
			} else if (key === "3") {
				if (hasInspectorContext) {
					revealSystemPanel("inspector");
				}
				focusEditorRegion("inspector");
			} else {
				return;
			}

			event.preventDefault();
		},
		[
			activePage,
			handlePageChange,
			hasInspectorContext,
			isComponentContext,
			navigate,
			openComponent,
		],
	);

	useWindowKeyDown(handleSystemEditorShortcut);

	if (!normalizedSystemId) {
		return (
			<div className="absolute left-3 top-3 z-30 bg-red-500 px-2 py-1 text-xs text-white">
				Missing system id
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

	if (systemsQuery.isPending) {
		return (
			<div className="pointer-events-none absolute left-3 top-3 z-30 bg-slate-500 px-2 py-1 text-xs text-white">
				Loading system data...
			</div>
		);
	}

	if (!selectedSystem) {
		return (
			<div className="absolute left-3 top-3 z-30 bg-red-500 px-2 py-1 text-xs text-white">
				No system found for “{normalizedSystemId}”.
			</div>
		);
	}

	const systemId = selectedSystem.systemId;
	return (
		<StagePreviewDarkModeProvider key={selectedComponentId ?? "none"}>
			<div className="absolute inset-0 z-10 flex min-h-0 bg-slate-100 text-xs text-slate-950">
				{leaveDialog}
				<Tabs
					value={activePage}
					onValueChange={handlePageChange}
					className="flex min-h-0 flex-1 flex-row gap-0"
				>
					{/* A collapsed rail stays mounted but hidden: in the component
					    context it owns the draft sync and the layer shortcuts. */}
					<SystemLeftSidebar
						systemName={selectedSystem.systemName}
						systemId={systemId}
						systemStatus={systemStatus}
						onClose={() => navigate("/")}
						collapseChrome={isComponentContext}
						collapsed={!isRailOpen}
					>
						{activePage === "components" ? (
							<SystemEditorComponentsRail
								systemId={systemId}
								projectScope={projectScope}
								selectedComponentId={selectedComponentId}
								onSelectComponent={openComponent}
								onComponentDeleted={handleComponentDeleted}
								headerActions={<SystemPanelToggle panel="rail" />}
							/>
						) : activePage === "icons" ? (
							<SystemEditorIconFoldersRail
								systemId={systemId}
								projectScope={projectScope}
							/>
						) : activePage === "lint" ? (
							<SystemEditorLintRail
								systemId={systemId}
								projectScope={projectScope}
							/>
						) : null}
					</SystemLeftSidebar>
					<main
						data-editor-region="workspace"
						tabIndex={-1}
						className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-100 focus-visible:outline-none"
					>
						{isRailOpen ? null : (
							// Alt+1 focuses this header while the rail is collapsed.
							<FloatingPanel
								className="w-[288px]"
								data-editor-region="rail"
								tabIndex={-1}
							>
								<FloatingPanelHeader>
									{isComponentContext && selectedComponentId !== null ? (
										<CollapsedComponentContextHeader
											systemId={systemId}
											projectScope={projectScope}
											componentId={selectedComponentId}
											onSelectComponent={openComponent}
											actions={<SystemPanelToggle panel="rail" />}
										/>
									) : (
										<SystemHeaderContent
											systemName={selectedSystem.systemName}
											systemStatus={systemStatus}
											onClose={() => navigate("/")}
										/>
									)}
								</FloatingPanelHeader>
							</FloatingPanel>
						)}
						<ScrollArea
							className="flex min-h-0 flex-1"
							viewportRef={workspaceScrollRef}
						>
							{/* Clear the floating header so page titles, filters and the
							    draft stage's top edge are not hidden under it. */}
							<div
								className={`flex min-h-full flex-col ${isRailOpen ? "" : "pt-12"}`}
							>
								<TabsPanel value="components" className="flex min-h-0 flex-1">
									<SystemEditorComponentsPanel
										systemId={systemId}
										projectScope={projectScope}
										selectedComponentId={selectedComponentId}
										onSelectComponent={openComponent}
									/>
								</TabsPanel>
								<TabsPanel value="tokens" className="flex min-h-0 flex-1">
									<SystemEditorTokensPanel
										isActive={activePage === "tokens"}
										systemId={systemId}
										projectScope={projectScope}
									/>
								</TabsPanel>
								<TabsPanel value="assets" className="flex min-h-0 flex-1">
									<SystemEditorAssetsPanel
										isActive={activePage === "assets"}
										systemId={systemId}
										projectScope={projectScope}
										scrollElementRef={workspaceScrollRef}
										selectedAssetId={selectedAssetId}
										onSelectAsset={setSelectedAssetId}
									/>
								</TabsPanel>
								<TabsPanel value="icons" className="flex min-h-0 flex-1">
									<SystemEditorIconsPanel
										isActive={activePage === "icons"}
										systemId={systemId}
										projectScope={projectScope}
										scrollElementRef={workspaceScrollRef}
										selectedIconId={selectedIconId}
										onSelectIcon={setSelectedIconId}
									/>
								</TabsPanel>
								<TabsPanel value="lint" className="flex min-h-0 flex-1">
									<SystemEditorLintPanel
										systemId={systemId}
										systemName={selectedSystem.systemName}
										projectScope={projectScope}
										scrollElementRef={workspaceScrollRef}
									/>
								</TabsPanel>
							</div>
						</ScrollArea>
					</main>
					{!hasInspectorContext ? null : isInspectorOpen ? (
						<SystemEditorInspector
							page={activePage}
							systemId={systemId}
							projectScope={projectScope}
							selectedComponentId={selectedComponentId}
							selectedAssetId={selectedAssetId}
							selectedIconId={selectedIconId}
							onClose={closeInspector}
						/>
					) : (
						<PanelEdgeStrip
							side="right"
							data-editor-region="inspector"
							tabIndex={-1}
						>
							<SystemPanelToggle panel="inspector" />
						</PanelEdgeStrip>
					)}
				</Tabs>
			</div>
		</StagePreviewDarkModeProvider>
	);
}
