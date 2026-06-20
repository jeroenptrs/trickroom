import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { tv } from "tailwind-variants";
import { Button } from "./button";
import { Separator } from "./separator";

const alertDialog = tv({
	slots: {
		backdrop:
			"fixed inset-0 min-h-dvh bg-slate-950 opacity-20 transition-all duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 dark:opacity-70 supports-[-webkit-touch-callout:none]:absolute",
		popup:
			"flex flex-col fixed top-1/2 left-1/2 -mt-8 w-96 w-full max-w-xs md:max-w-md -translate-x-1/2 -translate-y-1/2 rounded-none bg-white text-slate-900 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 shadow-xl shadow-slate-900/10 transition-all duration-150 data-[ending-style]:scale-90 data-[ending-style]:opacity-0 data-[starting-style]:scale-90 data-[starting-style]:opacity-0",
		title: "p-2",
		description: "px-2 mb-4",
	},
});

const { backdrop, popup, title, description } = alertDialog();

const confirmationDialog = tv({
	slots: {
		popup:
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
	popup: confirmationPopup,
	header: confirmationHeader,
	titleGroup: confirmationTitleGroup,
	icon: confirmationIcon,
	closeIcon: confirmationCloseIcon,
	body: confirmationBody,
	footer: confirmationFooter,
	cancelButton: confirmationCancelButton,
	actionButton: confirmationActionButton,
} = confirmationDialog();

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
	return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
	return (
		<AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
	);
}

function AlertDialogBackdrop({
	className,
	...props
}: AlertDialogPrimitive.Backdrop.Props & { className?: string }) {
	return (
		<AlertDialogPrimitive.Backdrop
			data-slot="alert-dialog-backdrop"
			className={backdrop({ className })}
			{...props}
		/>
	);
}

function AlertDialogViewport({
	className,
	...props
}: AlertDialogPrimitive.Viewport.Props & { className?: string }) {
	return (
		<AlertDialogPrimitive.Viewport
			data-slot="alert-dialog-viewport"
			className={className}
			{...props}
		/>
	);
}

function AlertDialogPopup({
	className,
	...props
}: AlertDialogPrimitive.Popup.Props & { className?: string }) {
	return (
		<AlertDialogPrimitive.Popup
			data-slot="alert-dialog-popup"
			className={popup({ className })}
			{...props}
		/>
	);
}

function AlertDialogTitle({
	className,
	...props
}: AlertDialogPrimitive.Title.Props & { className?: string }) {
	return (
		<AlertDialogPrimitive.Title
			data-slot="alert-dialog-title"
			className={title({ className })}
			{...props}
		/>
	);
}

function AlertDialogDescription({
	className,
	...props
}: AlertDialogPrimitive.Description.Props & { className?: string }) {
	return (
		<AlertDialogPrimitive.Description
			data-slot="alert-dialog-description"
			className={description({ className })}
			{...props}
		/>
	);
}

function AlertDialogClose({ ...props }: AlertDialogPrimitive.Close.Props) {
	return (
		<AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />
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
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogPortal>
				<AlertDialogBackdrop />
				<AlertDialogViewport>
					<AlertDialogPopup
						initialFocus={false}
						className={confirmationPopup()}
					>
						<div className={confirmationHeader()}>
							<div className={confirmationTitleGroup()}>
								<span
									className={confirmationIcon({ tone })}
									aria-hidden="true"
								>
									{icon}
								</span>
								<AlertDialogTitle className="p-0 text-sm font-medium text-slate-900">
									{title}
								</AlertDialogTitle>
							</div>
							<AlertDialogClose className="border-none bg-transparent p-1 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500">
								<span className="sr-only">Close</span>
								<X className={confirmationCloseIcon()} aria-hidden="true" />
							</AlertDialogClose>
						</div>
						<Separator />
						{description ? (
							<AlertDialogDescription className={confirmationBody()}>
								{description}
							</AlertDialogDescription>
						) : null}
						{children}
						<Separator />
						<div className={confirmationFooter()}>
							<AlertDialogClose
								render={
									<Button
										type="button"
										variant="block"
										className={confirmationCancelButton()}
									/>
								}
							>
								{cancelLabel}
							</AlertDialogClose>
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
					</AlertDialogPopup>
				</AlertDialogViewport>
			</AlertDialogPortal>
		</AlertDialog>
	);
}

export {
	AlertDialog,
	AlertDialogBackdrop,
	AlertDialogClose,
	AlertDialogDescription,
	AlertDialogPopup,
	AlertDialogPortal,
	AlertDialogTitle,
	AlertDialogViewport,
	ConfirmationDialog,
};
