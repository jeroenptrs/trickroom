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

type StatusDotProps = ComponentProps<"span"> & {
	tone?: "idle" | "synced" | "review" | "syncing" | "error";
	shape?: "round" | "square";
} & (
		| {
				/** Read by screen readers in place of the colour. */
				label: string;
				decorative?: never;
		  }
		| {
				label?: never;
				/** The dot sits next to a visible word that says the same. */
				decorative: true;
		  }
	);

function StatusDot({
	tone,
	shape,
	className,
	label,
	decorative,
	...props
}: StatusDotProps) {
	return (
		<span
			data-slot="status-dot"
			className={statusDot({ tone, shape, className })}
			aria-hidden={decorative ? true : undefined}
			{...props}
		>
			{label ? <span className="sr-only">{label}</span> : null}
		</span>
	);
}

export { StatusDot };
