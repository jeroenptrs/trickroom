import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import type { Ref } from "react";
import { tv } from "tailwind-variants/lite";

const scrollarea = tv({
	slots: {
		root: "relative w-full",
		viewport: "size-full transition-[color,box-shadow] outline-none",
		scrollbar:
			"m-2 relative flex rounded-none bg-slate-200 opacity-0 transition-opacity pointer-events-none before:absolute before:content-[''] data-[orientation=vertical]:mr-0.5 data-[orientation=vertical]:w-1 data-[orientation=vertical]:before:h-full data-[orientation=vertical]:before:w-5 data-[orientation=vertical]:before:left-1/2 data-[orientation=vertical]:before:-translate-x-1/2 data-[orientation=horizontal]:mb-0.5 data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:before:h-5 data-[orientation=horizontal]:before:w-full data-[orientation=horizontal]:before:left-0 data-[orientation=horizontal]:before:right-0 data-[orientation=horizontal]:before:-bottom-2 data-[hovering]:pointer-events-auto data-[hovering]:opacity-100 data-[hovering]:delay-0 data-[scrolling]:pointer-events-auto data-[scrolling]:opacity-100 data-[scrolling]:duration-0",
		thumb: "relative flex-1 rounded-none bg-slate-400",
	},
});

const { root, viewport, thumb, scrollbar } = scrollarea();

export function ScrollArea({
	children,
	className,
	ref,
	viewportRef,
	...props
}: ScrollAreaPrimitive.Root.Props & {
	ref?: Ref<HTMLDivElement>;
	viewportRef?: Ref<HTMLDivElement>;
}) {
	return (
		<ScrollAreaPrimitive.Root
			ref={ref}
			data-slot="scroll-area"
			className={root({ className: className as string })}
			{...props}
		>
			<ScrollAreaPrimitive.Viewport
				ref={viewportRef}
				data-slot="scroll-area-viewport"
				className={viewport()}
			>
				{children}
			</ScrollAreaPrimitive.Viewport>
			<ScrollAreaPrimitive.Scrollbar
				data-slot="scroll-area-scrollbar-vertical"
				data-orientation="vertical"
				orientation="vertical"
				className={scrollbar()}
			>
				<ScrollAreaPrimitive.Thumb
					data-slot="scroll-area-thumb"
					className={thumb()}
				/>
			</ScrollAreaPrimitive.Scrollbar>
			<ScrollAreaPrimitive.Scrollbar
				data-slot="scroll-area-scrollbar-horizontal"
				data-orientation="horizontal"
				orientation="horizontal"
				className={scrollbar()}
			>
				<ScrollAreaPrimitive.Thumb
					data-slot="scroll-area-thumb"
					className={thumb()}
				/>
			</ScrollAreaPrimitive.Scrollbar>
			<ScrollAreaPrimitive.Corner />
		</ScrollAreaPrimitive.Root>
	);
}
