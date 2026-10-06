import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

// Square, discrete heat steps for the lint heat maps: step 0 is an empty
// framed square, steps 1 to 4 deepen one hue per scale. No gradients.
const heatSwatch = tv({
	base: "inline-block size-3 shrink-0 rounded-none",
	variants: {
		scale: {
			usage: "",
			findings: "",
		},
		step: {
			0: "bg-white inset-shadow-[0_0_0_1px] inset-shadow-slate-300",
			1: "",
			2: "",
			3: "",
			4: "",
		},
	},
	compoundVariants: [
		{ scale: "usage", step: 1, class: "bg-cyan-100" },
		{ scale: "usage", step: 2, class: "bg-cyan-300" },
		{ scale: "usage", step: 3, class: "bg-cyan-500" },
		{ scale: "usage", step: 4, class: "bg-cyan-800" },
		{ scale: "findings", step: 1, class: "bg-red-100" },
		{ scale: "findings", step: 2, class: "bg-red-300" },
		{ scale: "findings", step: 3, class: "bg-red-500" },
		{ scale: "findings", step: 4, class: "bg-red-800" },
	],
	defaultVariants: {
		scale: "usage",
		step: 0,
	},
});

function HeatSwatch({
	scale,
	step,
	className,
	...props
}: ComponentProps<"span"> & {
	scale: "usage" | "findings";
	step: 0 | 1 | 2 | 3 | 4;
}) {
	return (
		<span
			data-slot="heat-swatch"
			data-step={step}
			className={heatSwatch({ scale, step, className })}
			{...props}
		/>
	);
}

export { HeatSwatch };
