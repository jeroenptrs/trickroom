import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

const statusDot = tv({
	base: "inline-block size-2",
	variants: {
		tone: {
			idle: "bg-slate-400",
			synced: "bg-emerald-500",
			review: "bg-amber-500",
			syncing: "bg-cyan-500",
			error: "bg-red-500",
		},
		shape: {
			round: "rounded-full",
			square: "rounded-none",
		},
	},
	defaultVariants: {
		tone: "idle",
		shape: "round",
	},
});

function StatusDot({
	tone,
	shape,
	className,
	...props
}: ComponentProps<"span"> & {
	tone?: "idle" | "synced" | "review" | "syncing" | "error";
	shape?: "round" | "square";
}) {
	return (
		<span
			data-slot="status-dot"
			className={statusDot({ tone, shape, className })}
			{...props}
		/>
	);
}

export { StatusDot };
