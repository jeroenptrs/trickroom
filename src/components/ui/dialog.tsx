import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { tv } from "tailwind-variants";
import { Alert } from "./alert";
import { Separator } from "./separator";

/**
 * Shared dialog surface. `AlertDialog` reuses these slots, so a dialog and a
 * confirmation dialog share one backdrop, one frame, and one set of parts.
 * The app is light-only: the backdrop has a single opacity on every OS theme.
 */
const dialog = tv({
	slots: {
		backdrop:
			"fixed inset-0 min-h-dvh bg-slate-950 opacity-20 transition-all duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute",
		content:
			"flex flex-col fixed top-1/2 left-1/2 -mt-8 w-full max-w-xs md:max-w-md -translate-x-1/2 -translate-y-1/2 rounded-none bg-white text-slate-900 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 shadow-xl shadow-slate-900/10 transition-all duration-150 data-ending-style:scale-90 data-ending-style:opacity-0 data-starting-style:scale-90 data-starting-style:opacity-0",
		header: "flex items-center justify-between gap-2 px-4 py-3",
		titleGroup: "flex min-w-0 items-center gap-2",
		icon: "flex size-4 shrink-0 items-center justify-center text-slate-500 [&_svg]:size-4",
		title: "m-0 min-w-0 truncate text-sm font-medium text-slate-900",
		close:
			"flex shrink-0 items-center justify-center border-none bg-transparent p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500",
		body: "flex flex-col gap-4 px-4 py-4 text-sm leading-relaxed text-slate-900",
		error: "px-4 pb-4",
		footer: "flex items-center justify-end gap-2 px-4 py-3",
	},
	variants: {
		tone: {
			default: {},
			destructive: { icon: "text-red-600" },
		},
	},
});

const dialogSlots = dialog();

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
	return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
	className,
	...props
}: DialogPrimitive.Backdrop.Props & { className?: string }) {
	return (
		<DialogPrimitive.Backdrop
			data-slot="dialog-overlay"
			className={dialogSlots.backdrop({ className })}
			{...props}
		/>
	);
}

function DialogContent({
	className,
	...props
}: DialogPrimitive.Popup.Props & { className?: string }) {
	return (
		<DialogPrimitive.Popup
			data-slot="dialog-content"
			className={dialogSlots.content({ className })}
			{...props}
		/>
	);
}

function DialogTitle({
	className,
	...props
}: DialogPrimitive.Title.Props & { className?: string }) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={dialogSlots.title({ className })}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props & { className?: string }) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={className}
			{...props}
		/>
	);
}

/**
 * Dialog header: optional icon, the title, and a close button, followed by
 * one divider. Works inside both `Dialog` and `AlertDialog`.
 */
function DialogHeader({
	icon,
	title,
	tone = "default",
	closeLabel = "Close",
	showClose = true,
}: {
	icon?: ReactNode;
	title: ReactNode;
	tone?: "default" | "destructive";
	closeLabel?: string;
	showClose?: boolean;
}) {
	return (
		<>
			<div data-slot="dialog-header" className={dialogSlots.header()}>
				<div className={dialogSlots.titleGroup()}>
					{icon ? (
						<span className={dialogSlots.icon({ tone })} aria-hidden="true">
							{icon}
						</span>
					) : null}
					<DialogTitle>{title}</DialogTitle>
				</div>
				{showClose ? (
					<DialogClose className={dialogSlots.close()}>
						<span className="sr-only">{closeLabel}</span>
						<X className="size-4" aria-hidden="true" />
					</DialogClose>
				) : null}
			</div>
			<Separator />
		</>
	);
}

/** Padded dialog body in the default ink. */
function DialogBody({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="dialog-body"
			className={dialogSlots.body({ className })}
			{...props}
		/>
	);
}

/**
 * A backend error inside the dialog, above the footer. Renders nothing
 * without a message, so the dialog keeps its layout when the error clears.
 */
function DialogError({
	children,
	className,
}: {
	children?: ReactNode;
	className?: string;
}) {
	if (children === null || children === undefined || children === "") {
		return null;
	}
	return (
		<div data-slot="dialog-error" className={dialogSlots.error({ className })}>
			<Alert variant="panel" tone="danger">
				{children}
			</Alert>
		</div>
	);
}

/**
 * Dialog footer: one divider, then buttons aligned right. Order the buttons
 * Cancel, secondary, primary.
 */
function DialogFooter({ className, ...props }: ComponentProps<"div">) {
	return (
		<>
			<Separator />
			<div
				data-slot="dialog-footer"
				className={dialogSlots.footer({ className })}
				{...props}
			/>
		</>
	);
}

export {
	Dialog,
	DialogBody,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogError,
	DialogFooter,
	DialogHeader,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
	dialogSlots,
};
