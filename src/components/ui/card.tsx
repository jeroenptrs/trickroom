import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

const card = tv({
	base: "rounded-none bg-white",
	variants: {
		edge: {
			inset: "inset-shadow-[0_0_0_1px] inset-shadow-slate-200",
			border: "border border-slate-200",
		},
		tone: {
			default: "",
			danger: "bg-red-50 text-red-900",
			warning: "bg-amber-50 text-amber-900",
		},
	},
	compoundVariants: [
		{ edge: "inset", tone: "danger", class: "inset-shadow-red-300" },
		{ edge: "inset", tone: "warning", class: "inset-shadow-amber-300" },
		{ edge: "border", tone: "danger", class: "border-red-200" },
		{ edge: "border", tone: "warning", class: "border-amber-200" },
	],
	defaultVariants: {
		edge: "inset",
		tone: "default",
	},
});

function Card({
	edge,
	tone,
	className,
	children,
	...props
}: ComponentProps<"div"> & {
	edge?: "inset" | "border";
	tone?: "default" | "danger" | "warning";
}) {
	return (
		<div data-slot="card" className={card({ edge, tone, className })} {...props}>
			{children}
		</div>
	);
}

export { Card };
