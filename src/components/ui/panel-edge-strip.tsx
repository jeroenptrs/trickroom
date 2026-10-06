import type { ComponentProps } from "react";
import { tv } from "tailwind-variants";

const panelEdgeStrip = tv({
	base: "flex min-h-0 w-8 shrink-0 flex-col items-center gap-1 border-slate-200 bg-white py-2 focus-visible:outline-none",
	variants: {
		side: {
			left: "border-r",
			right: "border-l",
		},
	},
});

/**
 * Narrow vertical strip left in place of a collapsed side panel, so the
 * panel can always be reopened with the mouse. Children are the reopen
 * controls, stacked from the top.
 */
function PanelEdgeStrip({
	side,
	className,
	...props
}: ComponentProps<"aside"> & { side: "left" | "right" }) {
	return (
		<aside
			data-slot="panel-edge-strip"
			className={panelEdgeStrip({ side, className })}
			{...props}
		/>
	);
}

export { PanelEdgeStrip, panelEdgeStrip };
