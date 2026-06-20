import type { ReactNode } from "react";
import { tv } from "tailwind-variants";
import { Card } from "./card";
import { Text } from "./text";

const detailSectionBody = tv({
	base: "flex flex-col gap-3 border-t px-4 py-3",
	variants: {
		tone: {
			default: "border-slate-100",
			danger: "border-red-200",
		},
	},
	defaultVariants: {
		tone: "default",
	},
});

/**
 * A titled settings/detail block: subtitle header row over a divided body.
 * `tone="danger"` renders the danger-zone treatment.
 */
function DetailSection({
	title,
	tone = "default",
	className,
	children,
}: {
	title: string;
	tone?: "default" | "danger";
	className?: string;
	children: ReactNode;
}) {
	return (
		<Card
			edge="border"
			tone={tone}
			className={["flex flex-col", className].filter(Boolean).join(" ")}
		>
			<div className="flex items-baseline px-4 py-3">
				<Text variant="subtitle">{title}</Text>
			</div>
			<div className={detailSectionBody({ tone })}>{children}</div>
		</Card>
	);
}

/**
 * A title + description row with a trailing action, for use inside
 * `DetailSection` (e.g. danger-zone delete/disconnect rows).
 */
function DetailSectionRow({
	title,
	description,
	action,
}: {
	title: string;
	description: string;
	action?: ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-4">
			<div className="flex min-w-0 flex-col gap-1">
				<Text className="text-sm font-medium text-slate-800">{title}</Text>
				<Text tone="muted" className="text-xs">
					{description}
				</Text>
			</div>
			{action ? (
				<div className="flex shrink-0 items-center">{action}</div>
			) : null}
		</div>
	);
}

export { DetailSection, DetailSectionRow };
