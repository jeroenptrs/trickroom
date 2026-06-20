import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

// Sibling of Badge: same footprint, but mono + lowercase for Tailwind class
// names and token values (Badge forces uppercase tracking-wider).
const chip = tv({
	base: "inline-flex max-w-full items-center gap-1 rounded-none px-1 py-0.5 font-mono text-xs",
	variants: {
		tone: {
			base: "bg-slate-100 text-slate-600",
			scope: "bg-cyan-50 text-cyan-700",
			ghost: "border border-dashed border-slate-300 text-slate-400",
			struck: "bg-white text-slate-400 line-through",
		},
	},
	defaultVariants: {
		tone: "base",
	},
});

function Chip({
	tone,
	className,
	children,
	...props
}: ComponentProps<"span"> & {
	tone?: "base" | "scope" | "ghost" | "struck";
}) {
	return (
		<span data-slot="chip" className={chip({ tone, className })} {...props}>
			{children}
		</span>
	);
}

export { Chip };
