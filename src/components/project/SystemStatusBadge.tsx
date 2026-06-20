import { RefreshCw } from "lucide-react";

export type SystemStatusBadgeState =
	| "idle"
	| "synced"
	| "review"
	| "syncing"
	| "error";

export function SystemStatusBadge({
	state,
}: {
	state: SystemStatusBadgeState;
}) {
	const badgeStyles = {
		idle: {
			label: "Not synced",
			className:
				"bg-slate-100 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 text-slate-600",
			iconClassName: "bg-slate-400",
		},
		synced: {
			label: "Synced",
			className:
				"bg-emerald-50 inset-shadow-[0_0_0_1px] inset-shadow-emerald-200 text-emerald-700",
			iconClassName: "bg-emerald-500",
		},
		review: {
			label: "Review required",
			className:
				"bg-amber-50 inset-shadow-[0_0_0_1px] inset-shadow-amber-200 text-amber-700",
			iconClassName: "bg-amber-500",
		},
		syncing: {
			label: "Syncing",
			className:
				"bg-cyan-50 inset-shadow-[0_0_0_1px] inset-shadow-cyan-200 text-cyan-700",
			iconClassName: "text-cyan-600",
		},
		error: {
			label: "Error",
			className:
				"bg-red-50 inset-shadow-[0_0_0_1px] inset-shadow-red-200 text-red-700",
			iconClassName: "bg-red-500",
		},
	};

	const config = badgeStyles[state];

	return (
		<span
			className={`inline-flex shrink-0 items-center gap-1.5 px-2 py-0.5 text-[10px] font-semibold tracking-wider ${config.className}`}
		>
			{state === "syncing" ? (
				<RefreshCw
					className={`size-3 ${config.iconClassName} animate-spin`}
					aria-hidden="true"
				/>
			) : (
				<span className={`size-1.5 ${config.iconClassName}`} />
			)}
			{config.label}
		</span>
	);
}
