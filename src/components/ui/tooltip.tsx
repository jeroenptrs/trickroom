import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import { tv } from "tailwind-variants";

const tooltip = tv({
	slots: {
		positioner: "z-50",
		popup:
			"max-w-64 rounded-none bg-slate-950 px-2 py-1 text-xs text-slate-50 shadow-lg shadow-slate-900/20 transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0",
	},
});

const { positioner, popup } = tooltip();

/**
 * Wraps one focusable trigger. The tooltip opens on hover and on keyboard
 * focus. One fact per line; never the only copy of essential detail, because
 * tooltips do not open on touch. An icon-only trigger still needs its own
 * `aria-label`.
 */
function Tooltip({
	content,
	children,
	side = "top",
	delay = 400,
}: {
	content: ReactNode;
	children: ReactElement;
	side?: "top" | "bottom" | "left" | "right";
	delay?: number;
}) {
	if (content === null || content === undefined || content === "") {
		return children;
	}
	return (
		<TooltipPrimitive.Root>
			<TooltipPrimitive.Trigger delay={delay} render={children} />
			<TooltipPrimitive.Portal>
				<TooltipPrimitive.Positioner
					side={side}
					sideOffset={6}
					className={positioner()}
				>
					<TooltipPrimitive.Popup className={popup()}>
						{content}
					</TooltipPrimitive.Popup>
				</TooltipPrimitive.Positioner>
			</TooltipPrimitive.Portal>
		</TooltipPrimitive.Root>
	);
}

export { Tooltip };
