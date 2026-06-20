import { FilePlus2, Palette, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { TailwindSyncResult } from "../../hooks/useTailwindSyncController";
import { useTailwindSyncController } from "../contexts";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Separator } from "../ui/separator";
import { CreateSystemDialog } from "./CreateSystemDialog";
import { pluralize } from "./project-view-utils";
import { useScrollSelectedIntoView } from "./useScrollSelectedIntoView";
import {
	SystemStatusBadge,
	type SystemStatusBadgeState,
} from "./SystemStatusBadge";

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

function getSystemStatusDotClassName(
	system: TailwindSyncResult,
	reviewRequired: boolean,
) {
	if (system.status === "error") {
		return "bg-red-500";
	}

	if (system.status === "idle") {
		return "bg-slate-300";
	}

	if (reviewRequired) {
		return "bg-amber-500";
	}

	return "bg-green-500";
}

function SystemStatusIndicator({
	system,
	reviewRequired,
}: {
	system: TailwindSyncResult;
	reviewRequired: boolean;
}) {
	if (system.status === "pending") {
		return (
			<RefreshCw
				className="size-3 animate-spin text-cyan-500"
				aria-hidden="true"
			/>
		);
	}

	return (
		<span
			className={`size-2 shrink-0 rounded-full ${getSystemStatusDotClassName(system, reviewRequired)}`}
		/>
	);
}

function System({
	system,
	systemId,
	isSelected,
	onSelect,
	selectedItemRef,
}: {
	system: TailwindSyncResult;
	systemId: string;
	isSelected: boolean;
	onSelect: () => void;
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
			className="flex w-full items-center gap-2 px-4 py-3 text-left"
		>
			<SystemStatusIndicator system={system} reviewRequired={reviewRequired} />
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm">{displayedSystemName}</div>
				<div className="truncate font-mono text-[11px] text-slate-500">
					{metaSubtitle}
				</div>
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
	const systemEntries = Object.entries(systems.statusBySystem);
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const setSelectedItemRef = useScrollSelectedIntoView(selectedSystemId);
	return (
		<>
			<section className="flex flex-col flex-1 min-h-0 border-t border-slate-200">
				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-baseline gap-2">
						<div className="text-sm font-bold">Systems</div>
						<div className="font-mono text-xs text-slate-500">
							{systemEntries.length}
						</div>
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
						<div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
							<div className="flex size-10 items-center justify-center bg-slate-50">
								<Palette className="size-5 text-slate-400" aria-hidden="true" />
							</div>
							<div className="flex flex-col gap-1">
								<p className="text-sm font-medium text-slate-700">
									No systems yet
								</p>
								<p className="max-w-[16rem] text-xs text-slate-500 text-balance">
									Press ⌘⇧N or use + New above to connect a tokens file or
									Tailwind config.
								</p>
							</div>
						</div>
					) : (
						<div className="divide-y divide-slate-100">
							{systemEntries.map(([systemId, status]) => (
								<System
									key={systemId}
									systemId={systemId}
									system={systems.results[systemId] ?? { status }}
									isSelected={selectedSystemId === systemId}
									onSelect={() => onSelectSystem(systemId)}
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
