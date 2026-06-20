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
	syncing: { label: "Syncing", tone: "info" },
	error: { label: "Error", tone: "danger" },
};

export function SystemStatusBadge({
	state,
}: {
	state: SystemStatusBadgeState;
}) {
	const { label, tone } = STATES[state];

	return (
		<Badge tone={tone} edge="stamped" className="shrink-0 gap-1.5">
			{state === "syncing" ? (
				<RefreshCw className="size-3 animate-spin" aria-hidden="true" />
			) : (
				<StatusDot tone={state} shape="square" className="size-1.5" />
			)}
			{label}
		</Badge>
	);
}
