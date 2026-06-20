import { useHotkey } from "@tanstack/react-hotkeys";
import { FilePlus2, Palette, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { TailwindSyncResult } from "../../hooks/useTailwindSyncController";
import { useTailwindSyncController } from "../contexts";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { StatusDot } from "../ui/status-dot";
import { Text } from "../ui/text";
import { CreateSystemDialog } from "./CreateSystemDialog";
import { pluralize } from "./project-view-utils";
import { getSystemEditorPath } from "./SystemDetailPane";
import {
	SystemStatusBadge,
	type SystemStatusBadgeState,
} from "./SystemStatusBadge";
import { useScrollSelectedIntoView } from "./useScrollSelectedIntoView";

function getCssBasename(cssPath: string | undefined) {
	if (!cssPath) {
		return null;
	}

	return cssPath.split(/[\\/]/).pop() || cssPath;
}

function getSystemBadgeState(
	system: TailwindSyncResult,
	reviewRequired: boolean,
): SystemStatusBadgeState {
	if (system.status === "error") {
		return "error";
	}

	if (system.status === "pending") {
		return "syncing";
	}

	if (system.status === "idle") {
		return "idle";
	}

	if (reviewRequired) {
		return "review";
	}

	return "synced";
}

export function getSystemMetadata(
	system: TailwindSyncResult,
	cssPath?: string,
) {
	const cssBasename = getCssBasename(system.data?.cssPath ?? cssPath);
	const prefix = cssBasename ? `${cssBasename} · ` : "";
	const baselineDiff = system.data?.baselineDiff;

	if (baselineDiff) {
		const added = baselineDiff.added.length;
		const removed = baselineDiff.removed.length;
		const diffLabel = `+${added} / -${removed}`;

		return system.data?.reviewRequired ? diffLabel : `${prefix}${diffLabel}`;
	}

	if (system.data?.reviewRequired) {
		return "+0 / -0";
	}

	const tokenCount = system.data?.tokens?.length;
	if (tokenCount === undefined) {
		return `${prefix}no token data`;
	}

	return `${prefix}${tokenCount} ${pluralize(tokenCount, "token")}`;
}

function SystemStatusIndicator({ state }: { state: SystemStatusBadgeState }) {
	if (state === "syncing") {
		return (
			<RefreshCw
				className="size-3 shrink-0 animate-spin text-cyan-500"
				aria-hidden="true"
			/>
		);
	}

	return <StatusDot tone={state} shape="square" className="shrink-0" />;
}

function System({
	system,
	systemId,
	isSelected,
	onSelect,
	onOpen,
	selectedItemRef,
}: {
	system: TailwindSyncResult;
	systemId: string;
	isSelected: boolean;
	onSelect: () => void;
	onOpen: () => void;
	selectedItemRef?: (element: HTMLElement | null) => void;
}) {
	const systems = useTailwindSyncController();
	const target = systems.targetsById[systemId];
	const reviewRequired = Boolean(system.data?.reviewRequired);
	const status = getSystemBadgeState(system, reviewRequired);
	const actionBadgeState =
		status === "review" || status === "error" || status === "syncing"
			? status
			: null;
	const metaSubtitle = getSystemMetadata(system, target?.cssPath);
	const displayedSystemName =
		system.data?.systemName ?? target?.systemName ?? "Unnamed system";

	return (
		<Button
			ref={isSelected ? selectedItemRef : undefined}
			variant="block"
			flavor={reviewRequired ? "warning" : undefined}
			isSelected={isSelected}
			onClick={onSelect}
			onDoubleClick={onOpen}
			className="flex w-full items-center gap-2 px-4 py-3 text-left"
		>
			<SystemStatusIndicator state={status} />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<Text className="block max-w-full truncate">{displayedSystemName}</Text>
				<Text
					tone="muted"
					className="block max-w-full truncate font-mono text-[10px]"
				>
					{metaSubtitle}
				</Text>
			</div>
			{actionBadgeState ? <SystemStatusBadge state={actionBadgeState} /> : null}
		</Button>
	);
}

export function Systems({
	selectedSystemId,
	onSelectSystem,
}: {
	selectedSystemId: string | null;
	onSelectSystem: (systemId: string | null) => void;
}) {
	const systems = useTailwindSyncController();
	const navigate = useNavigate();
	const systemEntries = Object.entries(systems.statusBySystem);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const setSelectedItemRef = useScrollSelectedIntoView(selectedSystemId);
	const getOpenPath = (systemId: string) => {
		const reviewRequired = Boolean(
			systems.results[systemId]?.data?.reviewRequired,
		);
		return getSystemEditorPath(
			systemId,
			reviewRequired ? { tab: "tokens" } : undefined,
		);
	};

	useHotkey(
		"Enter",
		() => {
			if (selectedSystemId) {
				navigate(getOpenPath(selectedSystemId));
			}
		},
		{ enabled: selectedSystemId !== null },
	);

	return (
		<>
			<section className="flex flex-col flex-1 min-h-0 border-t border-slate-200">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-baseline gap-2">
						<Text variant="section-header">systems</Text>
						<Text tone="faint" className="font-mono text-[11px]">
							{systemEntries.length}
						</Text>
					</div>
					<Button
						variant="block"
						className="flex items-center gap-1 px-2 py-1 text-xs"
						onClick={() => setCreateDialogOpen(true)}
					>
						<FilePlus2 className="size-3.5" aria-hidden="true" />
						New
					</Button>
				</div>
				<Separator />
				<ScrollArea className="flex-1 min-h-0">
					{systemEntries.length === 0 ? (
						<EmptyState
							icon={Palette}
							size="sm"
							title="No systems yet"
							description="Press ⌘⇧N or use + New above to connect a tokens file or Tailwind config."
						/>
					) : (
						<div className="divide-y divide-slate-100">
							{systemEntries.map(([systemId, status]) => (
								<System
									key={systemId}
									systemId={systemId}
									system={systems.results[systemId] ?? { status }}
									isSelected={selectedSystemId === systemId}
									onSelect={() => onSelectSystem(systemId)}
									onOpen={() => navigate(getOpenPath(systemId))}
									selectedItemRef={setSelectedItemRef}
								/>
							))}
						</div>
					)}
				</ScrollArea>
			</section>
			<CreateSystemDialog
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
				onCreated={(system) => onSelectSystem(system.systemId)}
			/>
		</>
	);
}
