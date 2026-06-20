import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

const row = tv({
	base: "flex w-full items-stretch rounded-none",
	variants: {
		state: {
			default: "hover:bg-slate-100",
			selected: "bg-cyan-100 text-cyan-900 hover:bg-cyan-100",
		},
	},
	defaultVariants: {
		state: "default",
	},
});

function Row({
	state,
	className,
	children,
	...props
}: ComponentProps<"div"> & {
	state?: "default" | "selected";
}) {
	return (
		<div
			data-slot="row"
			className={row({ state, className })}
			{...props}
		>
			{children}
		</div>
	);
}

export { Row };
