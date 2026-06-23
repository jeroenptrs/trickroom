import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const sheet = tv({
	slots: {
		backdrop:
			"fixed inset-0 z-40 bg-slate-950/20 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
		content:
			"fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-slate-50 text-slate-950 inset-shadow-[1px_0_0_0] inset-shadow-slate-200 shadow-xl shadow-slate-900/10 transition-transform duration-200 data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full",
	},
});

const { backdrop, content } = sheet();

function Sheet(props: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

/**
 * Right-anchored modal sheet (drawer) built on the Base UI Dialog. Square-edged
 * and slate-framed to match the brutalist chrome; slides in from the right.
 */
function SheetContent({
	className,
	children,
	...props
}: DialogPrimitive.Popup.Props & { className?: string; children: ReactNode }) {
	return (
		<DialogPrimitive.Portal data-slot="sheet-portal">
			<DialogPrimitive.Backdrop
				data-slot="sheet-overlay"
				className={backdrop()}
			/>
			<DialogPrimitive.Popup
				data-slot="sheet-content"
				className={content({ className })}
				{...props}
			>
				{children}
			</DialogPrimitive.Popup>
		</DialogPrimitive.Portal>
	);
}

export { Sheet, SheetClose, SheetContent, SheetTrigger };
