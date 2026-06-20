import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { tv } from "tailwind-variants";
import { Button } from "./button";
import { Separator } from "./separator";

const dialog = tv({
	slots: {
		backdrop:
			"fixed inset-0 min-h-dvh bg-slate-950 opacity-20 transition-all duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 dark:opacity-70 supports-[-webkit-touch-callout:none]:absolute",
		content:
			"flex flex-col fixed top-1/2 left-1/2 -mt-8 w-96 w-full max-w-xs md:max-w-md -translate-x-1/2 -translate-y-1/2 rounded-none bg-white text-slate-900 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 shadow-xl shadow-slate-900/10 transition-all duration-150 data-[ending-style]:scale-90 data-[ending-style]:opacity-0 data-[starting-style]:scale-90 data-[starting-style]:opacity-0",
		title: "p-2",
		description: "px-2 mb-4",
	},
});

const { backdrop, content, title, description } = dialog();

const confirmationDialog = tv({
	slots: {
		content:
			"w-[calc(100vw-2rem)] max-w-[26rem] gap-0 overflow-hidden rounded-none",
		header: "flex items-center justify-between px-4 py-3",
		titleGroup: "flex min-w-0 items-center gap-2",
		icon: "size-4 shrink-0 text-slate-500",
		closeIcon: "size-4 text-slate-500",
		body: "px-4 py-4 text-sm leading-relaxed text-slate-700",
		footer: "flex items-center justify-end gap-2 px-4 py-3",
		cancelButton: "",
		actionButton: "flex items-center justify-center gap-2",
	},
	variants: {
		tone: {
			default: {
				icon: "text-slate-500",
			},
			destructive: {
				icon: "text-red-600",
			},
		},
	},
});

const {
	content: confirmationContent,
	header: confirmationHeader,
	titleGroup: confirmationTitleGroup,
	icon: confirmationIcon,
	closeIcon: confirmationCloseIcon,
	body: confirmationBody,
	footer: confirmationFooter,
	cancelButton: confirmationCancelButton,
	actionButton: confirmationActionButton,
} = confirmationDialog();

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
			className={backdrop({ className })}
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
			className={content({ className })}
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
			className={title({ className })}
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
			className={description({ className })}
			{...props}
		/>
	);
}

function ConfirmationDialog({
	open,
	onOpenChange,
	title,
	description,
	icon,
	actionIcon,
	actionLabel,
	cancelLabel = "Cancel",
	tone = "default",
	actionDisabled,
	actionType = "button",
	actionForm,
	onAction,
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: ReactNode;
	description?: ReactNode;
	icon: ReactNode;
	actionIcon?: ReactNode;
	actionLabel: ReactNode;
	cancelLabel?: ReactNode;
	tone?: "default" | "destructive";
	actionDisabled?: boolean;
	actionType?: ComponentProps<"button">["type"];
	actionForm?: string;
	onAction?: ComponentProps<"button">["onClick"];
	children?: ReactNode;
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogPortal>
				<DialogOverlay />
				<DialogContent
					initialFocus={false}
					className={confirmationContent()}
				>
					<div className={confirmationHeader()}>
						<div className={confirmationTitleGroup()}>
							<span className={confirmationIcon({ tone })} aria-hidden="true">
								{icon}
							</span>
							<DialogTitle className="p-0 text-sm font-medium text-slate-900">
								{title}
							</DialogTitle>
						</div>
						<DialogClose className="border-none bg-transparent p-1 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500">
							<span className="sr-only">Close</span>
							<X className={confirmationCloseIcon()} aria-hidden="true" />
						</DialogClose>
					</div>
					<Separator />
					{description ? (
						<DialogDescription className={confirmationBody()}>
							{description}
						</DialogDescription>
					) : null}
					{children}
					<Separator />
					<div className={confirmationFooter()}>
						<DialogClose
							render={
								<Button
									type="button"
									variant="block"
									className={confirmationCancelButton()}
								/>
							}
						>
							{cancelLabel}
						</DialogClose>
						<Button
							type={actionType}
							form={actionForm}
							variant={tone === "destructive" ? "outlined" : "filled"}
							flavor={tone === "destructive" ? "warning" : undefined}
							className={confirmationActionButton()}
							disabled={actionDisabled}
							onClick={onAction}
						>
							{actionIcon}
							{actionLabel}
						</Button>
					</div>
				</DialogContent>
			</DialogPortal>
		</Dialog>
	);
}

export {
	ConfirmationDialog,
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
