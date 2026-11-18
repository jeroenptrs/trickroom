import { useHotkey } from "@tanstack/react-hotkeys";
import { FilePlus2, Palette, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import type { TailwindSyncResult } from "../../hooks/useTailwindSyncController";
import { getTokenReviewCounts } from "../../utils/tailwind-token-review";
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
	systemStatusLabel,
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

/**
 * The facts on a system row's meta line, in order. Each renders as its own
 * span, so no separator characters live in the strings.
 */
export function getSystemMetadata(
	system: TailwindSyncResult,
	cssPath?: string,
): string[] {
	const cssBasename = getCssBasename(system.data?.cssPath ?? cssPath);
	const file = cssBasename ? [cssBasename] : [];
	const baselineDiff = system.data?.baselineDiff;

	// A review counts what the tokens panel counts: the changes since the
	// last confirmed review, or before the first one the theme's diff.
	if (system.data?.reviewRequired) {
		const counts = getTokenReviewCounts({
			reviewChanges: system.data.reviewChanges,
			baselineDiffs: system.data.baselineDiffs ?? { color: baselineDiff },
		});
		const stylesheets = `${counts.stylesheets} ${pluralize(counts.stylesheets, "stylesheet")} changed`;
		if (
			counts.sinceLastReview &&
			counts.total === 0 &&
			counts.stylesheets > 0
		) {
			return [`${stylesheets} since last review`];
		}
		const label = `+${counts.added} ~${counts.changed} -${counts.removed}`;
		if (!counts.sinceLastReview) {
			return [label];
		}
		return counts.stylesheets > 0
			? [label, `${stylesheets} since last review`]
			: [`${label} since last review`];
	}

	// An empty diff says nothing; the token count does.
	if (
		baselineDiff &&
		(baselineDiff.added.length > 0 || baselineDiff.removed.length > 0)
	) {
		return [
			...file,
			`+${baselineDiff.added.length} / -${baselineDiff.removed.length}`,
		];
	}

	const tokenCount = system.data?.tokens?.length;
	if (tokenCount === undefined) {
		return [...file, "Not synced"];
	}

	return [...file, `${tokenCount} ${pluralize(tokenCount, "token")}`];
}

function SystemStatusIndicator({ state }: { state: SystemStatusBadgeState }) {
	if (state === "syncing") {
		return (
			<RefreshCw
				className="size-3 shrink-0 animate-spin text-cyan-500"
				role="img"
				aria-label={systemStatusLabel(state)}
			/>
		);
	}

	return (
		<StatusDot
			tone={state}
			shape="square"
			className="shrink-0"
			label={systemStatusLabel(state)}
		/>
	);
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
	// The row's dot or spinner always shows the state; a word joins it only
	// when the system needs the user.
	const actionBadgeState =
		status === "review" || status === "error" ? status : null;
	const metaFacts = getSystemMetadata(system, target?.cssPath);
	const displayedSystemName =
		system.data?.systemName ?? target?.systemName ?? "Unnamed system";

	return (
		<Button
			ref={isSelected ? selectedItemRef : undefined}
			variant="block"
			flavor={reviewRequired ? "danger" : undefined}
			isSelected={isSelected}
			onClick={onSelect}
			onDoubleClick={onOpen}
			className="flex w-full items-center gap-2 px-4 py-3 text-left"
		>
			<SystemStatusIndicator state={status} />
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<Text className="block max-w-full truncate">{displayedSystemName}</Text>
				<Text variant="meta" className="flex max-w-full gap-2 truncate">
					{metaFacts.map((fact) => (
						<span key={fact} className="truncate">
							{fact}
						</span>
					))}
				</Text>
			</div>
			{actionBadgeState ? (
				<SystemStatusBadge state={actionBadgeState} showDot={false} />
			) : null}
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
						<Text variant="section-header">Systems</Text>
						<Text variant="section-header">{systemEntries.length}</Text>
					</div>
					<Button
						variant="block"
						className="flex items-center gap-1 px-2 py-1 text-xs"
						aria-label="Add system"
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
							description="Add one to use your tokens."
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
