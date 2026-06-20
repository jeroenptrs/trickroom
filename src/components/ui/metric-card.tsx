import type { ReactNode } from "react";
import { tv } from "tailwind-variants";
import { Card } from "./card";
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

/**
 * A labelled metric tile for detail-pane overview grids: label header, large
 * value, faint detail line. Optional `action` sits beside the value (e.g. a
 * copy button); optional `footer` renders below the detail line.
 */
function MetricCard({
	label,
	value,
	detail,
	mono,
	action,
	footer,
	className,
}: {
	label: string;
	value: string;
	detail: string;
	mono?: boolean;
	action?: ReactNode;
	footer?: ReactNode;
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
				<div className="flex min-w-0 items-center gap-2">
					<Text className={metricValue({ mono })} title={value}>
						{value}
					</Text>
					{action}
				</div>
				<Text tone="faint" className="truncate text-xs">
					{detail}
				</Text>
				{footer}
			</div>
		</Card>
	);
}

export { MetricCard };
