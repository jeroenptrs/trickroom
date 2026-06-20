import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

const badge = tv({
	base: "inline-flex items-center gap-1 rounded-none px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
	variants: {
		tone: {
			neutral: "bg-slate-100 text-slate-600",
			info: "bg-cyan-100 text-cyan-800",
			success: "bg-emerald-100 text-emerald-800",
			warning: "bg-amber-100 text-amber-900",
			danger: "bg-red-100 text-red-800",
		},
		edge: {
			solid: "",
			// Stamped 1px frame over a -50 wash, for status chips on white.
			stamped: "inset-shadow-[0_0_0_1px]",
		},
	},
	compoundVariants: [
		{
			edge: "stamped",
			tone: "neutral",
			class: "bg-slate-100 text-slate-600 inset-shadow-slate-200",
		},
		{
			edge: "stamped",
			tone: "info",
			class: "bg-cyan-50 text-cyan-700 inset-shadow-cyan-200",
		},
		{
			edge: "stamped",
			tone: "success",
			class: "bg-emerald-50 text-emerald-700 inset-shadow-emerald-200",
		},
		{
			edge: "stamped",
			tone: "warning",
			class: "bg-amber-50 text-amber-700 inset-shadow-amber-200",
		},
		{
			edge: "stamped",
			tone: "danger",
			class: "bg-red-50 text-red-700 inset-shadow-red-200",
		},
	],
	defaultVariants: {
		tone: "neutral",
		edge: "solid",
	},
});

function Badge({
	tone,
	edge,
	className,
	children,
	...props
}: ComponentProps<"span"> & {
	tone?: "neutral" | "info" | "success" | "warning" | "danger";
	edge?: "solid" | "stamped";
}) {
	return (
		<span
			data-slot="badge"
			className={badge({ tone, edge, className })}
			{...props}
		>
			{children}
		</span>
	);
}

export { Badge };
