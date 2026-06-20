import { useHotkey } from "@tanstack/react-hotkeys";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { systemsQueryOptions } from "../queries/systems";
import {
	selectTemplateNode,
	useComponentDraftComponentId,
	useComponentDraftSelectedPath,
} from "../stores/component-draft-store";
import { useProjectScope, useTailwindSyncController } from "./contexts";
import {
	SystemStatusBadge,
	type SystemStatusBadgeState,
} from "./project/SystemStatusBadge";
import { SystemEditorAssetsPanel } from "./system-editor/SystemEditorAssetsPanel";
import {
	SystemEditorComponentsPanel,
	SystemEditorComponentsRail,
} from "./system-editor/SystemEditorComponentsPanel";
import {
	SystemEditorIconFoldersRail,
	SystemEditorIconsPanel,
} from "./system-editor/SystemEditorIconsPanel";
import { SystemEditorInspector } from "./system-editor/SystemEditorInspector";
import { SystemEditorTokensPanel } from "./system-editor/SystemEditorTokensPanel";
import type { SystemEditorPage } from "./system-editor/types";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";
import { Tabs, TabsList, TabsPanel, TabsTab } from "./ui/tabs";
import { Text } from "./ui/text";
import {
	focusEditorRegion,
	getKey,
	useWindowKeyDown,
} from "../utils/editor-shortcuts";

const SYSTEM_EDITOR_PAGES: Array<{ value: SystemEditorPage; label: string }> = [
	{ value: "components", label: "Components" },
	{ value: "tokens", label: "Tokens" },
	{ value: "assets", label: "Assets" },
	{ value: "icons", label: "Icons" },
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

function getInitialSystemEditorPage(
	tab: string | null,
	componentId: string | null,
): SystemEditorPage {
	if (componentId) {
		return "components";
	}

	if (tab === "tokens" || tab === "assets" || tab === "icons") {
		return tab;
	}

	return "components";
}

function SystemLeftSidebar({
	systemName,
	systemId,
	systemStatus,
	onClose,
	collapseChrome = false,
	children,
}: {
	systemName: string;
	systemId: string;
	systemStatus: SystemStatusBadgeState;
	onClose: () => void;
	collapseChrome?: boolean;
	children?: ReactNode;
}) {
	return (
		<aside
			data-editor-region="rail"
			tabIndex={-1}
			className="flex min-h-0 w-[300px] shrink-0 flex-col border-r border-slate-200 bg-slate-50 text-xs"
			data-system-id={systemId}
		>
			{collapseChrome ? null : (
				<>
					<header className="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 px-3">
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
					</header>
					<nav className="px-2" aria-label="System editor sections">
						<TabsList variant="block" className="w-full flex-row border-b-0">
							{SYSTEM_EDITOR_PAGES.map((page) => (
								<TabsTab
									key={page.value}
									value={page.value}
									variant="block"
									className="px-3 py-2"
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
		getInitialSystemEditorPage(
			searchParams.get("tab"),
			searchParams.get("component"),
		),
	);
	const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
	const [selectedIconId, setSelectedIconId] = useState<string | null>(null);
	const selectedTemplatePath = useComponentDraftSelectedPath();
	const draftComponentId = useComponentDraftComponentId();

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

	const handlePageChange = useCallback((nextPage: string) => {
		setActivePage(nextPage as SystemEditorPage);
		setSelectedComponentId(null);
		setSelectedAssetId(null);
		setSelectedIconId(null);
	}, []);

	const isComponentContext =
		activePage === "components" && selectedComponentId !== null;
	const hasComponentLayerInspector =
		isComponentContext &&
		draftComponentId === selectedComponentId &&
		selectedTemplatePath !== null;
	const hasInspectorContext =
		hasComponentLayerInspector ||
		(activePage === "assets" && selectedAssetId !== null) ||
		(activePage === "icons" && selectedIconId !== null);
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
		}
	}, [activePage]);

	useHotkey("Escape", closeInspector, { enabled: hasInspectorContext });

	const handleSystemEditorShortcut = useCallback(
		(event: KeyboardEvent) => {
			if (
				(event.metaKey || event.ctrlKey) &&
				!event.altKey &&
				!event.shiftKey &&
				event.key === "["
			) {
				if (isComponentContext) {
					setSelectedComponentId(null);
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
				focusEditorRegion("rail");
			} else if (key === "2") {
				focusEditorRegion("workspace");
			} else if (key === "3") {
				focusEditorRegion("inspector");
			} else {
				return;
			}

			event.preventDefault();
		},
		[activePage, handlePageChange, isComponentContext, navigate],
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
		<div className="absolute inset-0 z-10 flex min-h-0 bg-slate-100 text-xs text-slate-950">
			<Tabs
				value={activePage}
				onValueChange={handlePageChange}
				className="flex min-h-0 flex-1 flex-row gap-0"
			>
				<SystemLeftSidebar
					systemName={selectedSystem.systemName}
					systemId={systemId}
					systemStatus={systemStatus}
					onClose={() => navigate("/")}
					collapseChrome={isComponentContext}
				>
					{activePage === "components" ? (
						<SystemEditorComponentsRail
							systemId={systemId}
							projectScope={projectScope}
							selectedComponentId={selectedComponentId}
							onSelectComponent={setSelectedComponentId}
						/>
					) : activePage === "icons" ? (
						<SystemEditorIconFoldersRail
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
					<ScrollArea
						className="flex min-h-0 flex-1"
						viewportRef={workspaceScrollRef}
					>
						<div className="flex min-h-full flex-col">
							<TabsPanel value="components" className="flex min-h-0 flex-1">
								<SystemEditorComponentsPanel
									systemId={systemId}
									projectScope={projectScope}
									selectedComponentId={selectedComponentId}
									onSelectComponent={setSelectedComponentId}
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
						</div>
					</ScrollArea>
				</main>
				{hasInspectorContext ? (
					<SystemEditorInspector
						page={activePage}
						systemId={systemId}
						projectScope={projectScope}
						selectedComponentId={selectedComponentId}
						selectedAssetId={selectedAssetId}
						selectedIconId={selectedIconId}
						onClose={closeInspector}
					/>
				) : null}
			</Tabs>
		</div>
	);
}
