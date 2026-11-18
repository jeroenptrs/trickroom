import type { ReactNode } from "react";
import { tv } from "tailwind-variants";
import { Button } from "./button";
import { Card } from "./card";
import { Skeleton } from "./skeleton";
import { Text } from "./text";

const metricValue = tv({
	base: "min-w-0 flex-1 truncate font-medium text-slate-950",
	variants: {
		mono: {
			true: "font-mono text-lg",
			false: "text-2xl",
		},
	},
	defaultVariants: {
		mono: false,
	},
});

type MetricCardState =
	| { status: "ready" }
	| { status: "loading" }
	| { status: "empty"; message: string }
	| { status: "error"; message: string; onRetry?: () => void };

/**
 * A labelled metric tile for detail-pane overview grids: label header, large
 * value, optional faint detail line. Optional `action` sits beside the value
 * (e.g. a copy button); optional `footer` renders below the detail line.
 * `state` swaps the value for a skeleton, a no-data line, or an error with a
 * retry, in the same footprint.
 */
function MetricCard({
	label,
	value,
	detail,
	mono,
	action,
	footer,
	state = { status: "ready" },
	className,
}: {
	label: string;
	value?: string;
	detail?: string;
	mono?: boolean;
	action?: ReactNode;
	footer?: ReactNode;
	state?: MetricCardState;
	className?: string;
}) {
	return (
		<Card
			edge="inset"
			className={["flex min-h-32 min-w-0 flex-col", className]
				.filter(Boolean)
				.join(" ")}
		>
			<div className="flex items-center justify-between gap-3 px-4 py-3">
				<Text variant="subtitle">{label}</Text>
			</div>
			<div className="flex min-w-0 flex-1 flex-col justify-end gap-1 border-t border-slate-100 px-4 py-3">
				{state.status === "loading" ? (
					<div className="flex flex-col gap-2" aria-busy="true">
						<Skeleton className={mono ? "h-7 w-40" : "h-8 w-16"} />
						{detail ? <Skeleton className="h-4 w-32" /> : null}
					</div>
				) : state.status === "error" ? (
					<div className="flex min-w-0 items-center justify-between gap-2">
						<Text tone="danger" className="min-w-0 text-xs" role="alert">
							{state.message}
						</Text>
						{state.onRetry ? (
							<Button
								type="button"
								variant="outlined"
								className="shrink-0 px-2 py-1 text-xs"
								onClick={state.onRetry}
							>
								Retry
							</Button>
						) : null}
					</div>
				) : state.status === "empty" ? (
					<Text className="text-sm">{state.message}</Text>
				) : (
					<>
						<div className="flex min-w-0 items-center gap-2">
							<Text className={metricValue({ mono })} title={value}>
								{value}
							</Text>
							{action}
						</div>
						{detail ? (
							<Text tone="faint" className="truncate text-xs">
								{detail}
							</Text>
						) : null}
						{footer}
					</>
				)}
			</div>
		</Card>
	);
}

export { MetricCard };
