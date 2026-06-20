import type { ReactNode } from "react";
import { Text } from "../ui/text";
import { SystemDiffChips } from "./SystemDiffChips";
import {
	SystemStatusBadge,
	type SystemStatusBadgeState,
} from "./SystemStatusBadge";
import { SystemTabBar } from "./SystemTabBar";

export function SystemHeaderChrome({
	title,
	status,
	subline,
	diff,
	primaryAction,
	errors,
}: {
	title: ReactNode;
	status: SystemStatusBadgeState;
	subline: string;
	diff: {
		added: number;
		overridden: number;
		removed: number;
	};
	primaryAction?: ReactNode;
	errors?: ReactNode;
}) {
	const isSyncing = status === "syncing";

	return (
		<header className="relative">
			{isSyncing ? (
				<div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-cyan-100/70">
					<div className="h-full w-full animate-pulse bg-cyan-500" />
				</div>
			) : null}
			<div className="flex items-start justify-between gap-4 px-10 pt-8 pb-5">
				<div className="flex min-w-0 flex-1 flex-col gap-2">
					<Text variant="eyebrow" className="text-amber-700">
						System
					</Text>
					<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
						{title}
						<SystemStatusBadge state={status} />
					</div>
					<p className="truncate font-mono text-[11px] text-slate-500">
						{subline}
					</p>
					<SystemDiffChips
						added={diff.added}
						overridden={diff.overridden}
						removed={diff.removed}
					/>
					{errors}
				</div>
				{primaryAction ? (
					<div className="flex shrink-0 items-center gap-2">
						{primaryAction}
					</div>
				) : null}
			</div>
			<div className="px-10">
				<SystemTabBar />
			</div>
		</header>
	);
}
