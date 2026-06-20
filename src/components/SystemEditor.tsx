import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { systemsQueryOptions } from "../queries/systems";
import { useProjectScope, useTailwindSyncController } from "./contexts";
import {
	SystemStatusBadge,
	type SystemStatusBadgeState,
} from "./project/SystemStatusBadge";
import { SystemEditorAssetsPanel } from "./system-editor/SystemEditorAssetsPanel";
import { SystemEditorComponentsPanel } from "./system-editor/SystemEditorComponentsPanel";
import { SystemEditorIconsPanel } from "./system-editor/SystemEditorIconsPanel";
import { SystemEditorInspector } from "./system-editor/SystemEditorInspector";
import { SystemEditorTokensPanel } from "./system-editor/SystemEditorTokensPanel";
import type { SystemEditorPage } from "./system-editor/types";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Tabs, TabsList, TabsPanel, TabsTab } from "./ui/tabs";

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

function SystemLeftSidebar({
	systemName,
	systemId,
	systemStatus,
	onClose,
}: {
	systemName: string;
	systemId: string;
	systemStatus: SystemStatusBadgeState;
	onClose: () => void;
}) {
	return (
		<aside className="flex min-h-0 w-[264px] shrink-0 flex-col border-r border-slate-200 bg-slate-50 text-xs">
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
					<div className="truncate text-[13px] font-medium">{systemName}</div>
					<span className="truncate text-[10px] text-slate-500">
						{systemId}
					</span>
				</div>
				<SystemStatusBadge state={systemStatus} />
			</header>
			<nav className="mt-2 px-3 pb-3">
				<TabsList variant="block" className="w-full flex-row border-b-0">
					<TabsTab value="components" variant="block">
						Components
					</TabsTab>
					<TabsTab value="tokens" variant="block">
						Tokens
					</TabsTab>
					<TabsTab value="assets" variant="block">
						Assets
					</TabsTab>
					<TabsTab value="icons" variant="block">
						Icons
					</TabsTab>
				</TabsList>
			</nav>
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
	const [activePage, setActivePage] = useState<SystemEditorPage>("components");
	const [selectedComponentId, setSelectedComponentId] = useState<string | null>(
		() => searchParams.get("component"),
	);
	const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
	const [selectedIconId, setSelectedIconId] = useState<string | null>(null);

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
				className="flex min-h-0 flex-1 flex-row"
			>
				<SystemLeftSidebar
					systemName={selectedSystem.systemName}
					systemId={systemId}
					systemStatus={systemStatus}
					onClose={() => navigate("/")}
				/>
				<main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-100">
					<ScrollArea className="flex min-h-0 flex-1" viewportRef={workspaceScrollRef}>
						<div className="flex h-full min-h-0 flex-col">
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
									systemId={systemId}
									projectScope={projectScope}
								/>
							</TabsPanel>
							<TabsPanel value="assets" className="flex min-h-0 flex-1">
								<SystemEditorAssetsPanel
									systemId={systemId}
									projectScope={projectScope}
									scrollElementRef={workspaceScrollRef}
									selectedAssetId={selectedAssetId}
									onSelectAsset={setSelectedAssetId}
								/>
							</TabsPanel>
							<TabsPanel value="icons" className="flex min-h-0 flex-1">
								<SystemEditorIconsPanel
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
				<SystemEditorInspector
					page={activePage}
					systemId={systemId}
					projectScope={projectScope}
					selectedComponentId={selectedComponentId}
					selectedAssetId={selectedAssetId}
					selectedIconId={selectedIconId}
				/>
			</Tabs>
		</div>
	);
}
