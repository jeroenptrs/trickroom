import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

/**
 * A native select in the input styles. Native keeps keyboard and screen
 * reader behaviour for free; the variants match `Input`.
 */
const select = tv({
	base: "w-full min-w-0 rounded-none border-none text-xs text-slate-950 inset-shadow-[0_0_0_1px] focus-visible:outline-none disabled:opacity-50 aria-invalid:inset-shadow-red-500",
	variants: {
		variant: {
			// Dense inspector rails.
			block:
				"bg-slate-200/60 px-1 py-0.5 inset-shadow-transparent focus-visible:inset-shadow-cyan-500",
			// Forms and dialogs.
			outlined:
				"bg-white px-2 py-1.5 inset-shadow-slate-200 focus-visible:inset-shadow-cyan-500",
		},
	},
	defaultVariants: { variant: "block" },
});

function Select({
	className,
	variant,
	...props
}: ComponentProps<"select"> & { variant?: "block" | "outlined" }) {
	return (
		<select
			data-slot="select"
			className={select({ variant, className })}
			{...props}
		/>
	);
}

export { Select };
