import { RefreshCw } from "lucide-react";
import { Badge } from "../ui/badge";
import { StatusDot } from "../ui/status-dot";

export type SystemStatusBadgeState =
	| "idle"
	| "synced"
	| "review"
	| "syncing"
	| "error";

const STATES: Record<
	SystemStatusBadgeState,
	{ label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }
> = {
	idle: { label: "Not synced", tone: "neutral" },
	synced: { label: "Synced", tone: "success" },
	review: { label: "Review required", tone: "warning" },
	syncing: { label: "Syncing…", tone: "info" },
	error: { label: "Sync failed", tone: "danger" },
};

export function systemStatusLabel(state: SystemStatusBadgeState) {
	return STATES[state].label;
}

/**
 * A system's sync state. At rest (synced) it is only the dot, with the word
 * for screen readers; any other state shows its word. Pass `showDot={false}`
 * where the row already draws a status dot.
 */
export function SystemStatusBadge({
	state,
	showDot = true,
}: {
	state: SystemStatusBadgeState;
	showDot?: boolean;
}) {
	const { label, tone } = STATES[state];

	if (state === "synced") {
		return (
			<StatusDot
				tone="synced"
				shape="square"
				className="size-1.5 shrink-0"
				label={label}
			/>
		);
	}

	return (
		<Badge tone={tone} edge="stamped" className="shrink-0 gap-1.5">
			{state === "syncing" ? (
				<RefreshCw className="size-3 animate-spin" aria-hidden="true" />
			) : showDot ? (
				<StatusDot
					tone={state}
					shape="square"
					className="size-1.5"
					decorative
				/>
			) : null}
			{label}
		</Badge>
	);
}
