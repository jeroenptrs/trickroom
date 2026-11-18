import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { Info } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { tv } from "tailwind-variants";

const popover = tv({
	slots: {
		positioner: "z-50",
		popup:
			"flex max-h-(--available-height) max-w-80 flex-col gap-2 overflow-y-auto rounded-none bg-white p-3 text-xs text-slate-900 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 shadow-lg shadow-slate-900/10 outline-none transition-opacity duration-100 data-ending-style:opacity-0 data-starting-style:opacity-0",
		title: "m-0 text-xs font-semibold text-slate-950",
		infoButton:
			"inline-flex size-5 shrink-0 items-center justify-center border-none bg-transparent p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500 data-popup-open:bg-cyan-100 data-popup-open:text-cyan-900 [&_svg]:size-3.5",
	},
});

const slots = popover();

/**
 * A click-opened popover anchored to its trigger. Use it for secondary detail
 * that does not earn a place in a header or row.
 */
function Popover({
	trigger,
	title,
	children,
	side = "bottom",
	align = "start",
}: {
	trigger: ReactElement;
	title?: ReactNode;
	children: ReactNode;
	side?: "top" | "bottom" | "left" | "right";
	align?: "start" | "center" | "end";
}) {
	return (
		<PopoverPrimitive.Root>
			<PopoverPrimitive.Trigger render={trigger} />
			<PopoverPrimitive.Portal>
				<PopoverPrimitive.Positioner
					side={side}
					align={align}
					sideOffset={6}
					className={slots.positioner()}
				>
					<PopoverPrimitive.Popup className={slots.popup()}>
						{title ? (
							<PopoverPrimitive.Title className={slots.title()}>
								{title}
							</PopoverPrimitive.Title>
						) : null}
						{children}
					</PopoverPrimitive.Popup>
				</PopoverPrimitive.Positioner>
			</PopoverPrimitive.Portal>
		</PopoverPrimitive.Root>
	);
}

/** An info icon button that opens a popover on click. */
function InfoButton({
	label,
	title,
	children,
	side,
	align,
}: {
	/** Accessible name, for example "About this design". */
	label: string;
	title?: ReactNode;
	children: ReactNode;
	side?: "top" | "bottom" | "left" | "right";
	align?: "start" | "center" | "end";
}) {
	return (
		<Popover
			side={side}
			align={align}
			title={title}
			trigger={
				<button type="button" aria-label={label} className={slots.infoButton()}>
					<Info aria-hidden="true" />
				</button>
			}
		>
			{children}
		</Popover>
	);
}

export { InfoButton, Popover };
