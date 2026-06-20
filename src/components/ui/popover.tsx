import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { tv } from "tailwind-variants";

const popover = tv({
	slots: {
		positioner: "outline-none",
		popup:
			"flex flex-col rounded-none bg-white p-1 text-slate-900 inset-shadow-[0_0_0_1px] inset-shadow-slate-300 shadow-md shadow-slate-900/10 transition-all duration-150 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
		title: "px-2 py-1 text-xs font-semibold text-slate-700",
	},
});

const { positioner, popup, title } = popover();

function Popover({ ...props }: PopoverPrimitive.Root.Props) {
	return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
	return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
	return <PopoverPrimitive.Close data-slot="popover-close" {...props} />;
}

function PopoverTitle({
	className,
	...props
}: PopoverPrimitive.Title.Props & { className?: string }) {
	return (
		<PopoverPrimitive.Title
			data-slot="popover-title"
			className={title({ className })}
			{...props}
		/>
	);
}

/** Portal + Positioner + Popup in one piece; positioning props live here. */
function PopoverContent({
	className,
	side,
	align,
	sideOffset = 4,
	alignOffset,
	...props
}: PopoverPrimitive.Popup.Props & {
	className?: string;
	side?: PopoverPrimitive.Positioner.Props["side"];
	align?: PopoverPrimitive.Positioner.Props["align"];
	sideOffset?: PopoverPrimitive.Positioner.Props["sideOffset"];
	alignOffset?: PopoverPrimitive.Positioner.Props["alignOffset"];
}) {
	return (
		<PopoverPrimitive.Portal>
			<PopoverPrimitive.Positioner
				side={side}
				align={align}
				sideOffset={sideOffset}
				alignOffset={alignOffset}
				className={positioner()}
			>
				<PopoverPrimitive.Popup
					data-slot="popover-content"
					className={popup({ className })}
					{...props}
				/>
			</PopoverPrimitive.Positioner>
		</PopoverPrimitive.Portal>
	);
}

export { Popover, PopoverClose, PopoverContent, PopoverTitle, PopoverTrigger };
