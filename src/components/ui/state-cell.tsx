import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

// One square cell of a state strip (lint coverage: published, generated,
// bound, used in app, used in designs). `met` is solid, `gap` is a stamped
// amber frame that reads as something to act on rather than an error, and
// `unknown` is a dashed outline for states the report could not determine.
const stateCell = tv({
	base: "inline-flex size-5 shrink-0 items-center justify-center rounded-none font-mono text-[10px] font-semibold",
	variants: {
		state: {
			met: "bg-slate-900 text-slate-50",
			gap: "bg-amber-50 text-amber-800 inset-shadow-[0_0_0_1px] inset-shadow-amber-400",
			unknown: "border border-dashed border-slate-300 text-slate-400",
		},
	},
	defaultVariants: {
		state: "unknown",
	},
});

function StateCell({
	state,
	className,
	children,
	...props
}: ComponentProps<"span"> & {
	state: "met" | "gap" | "unknown";
}) {
	return (
		<span
			data-slot="state-cell"
			data-state={state}
			className={stateCell({ state, className })}
			{...props}
		>
			{children}
		</span>
	);
}

export { StateCell };
