import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { type ComponentProps, type ReactNode, useRef } from "react";
import { tv } from "tailwind-variants";
import { Button } from "./button";
import {
	DialogBody,
	DialogError,
	DialogFooter,
	DialogHeader,
	dialogSlots,
} from "./dialog";

const confirmationDialog = tv({
	slots: {
		popup: "w-[calc(100vw-2rem)] max-w-104 gap-0 overflow-hidden rounded-none",
		actionButton: "flex items-center justify-center gap-2",
	},
});

const { popup: confirmationPopup, actionButton: confirmationActionButton } =
	confirmationDialog();

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
			className={dialogSlots.backdrop({ className })}
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
			className={dialogSlots.content({ className })}
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
			className={dialogSlots.title({ className })}
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
			className={className}
			{...props}
		/>
	);
}

function AlertDialogClose({ ...props }: AlertDialogPrimitive.Close.Props) {
	return (
		<AlertDialogPrimitive.Close data-slot="alert-dialog-close" {...props} />
	);
}

/**
 * A confirm dialog: header, body, an optional backend error, and a footer of
 * Cancel, an optional secondary action, and the primary action. Focus opens
 * on Cancel so Enter never commits a destructive action by accident.
 */
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
	onCancel,
	secondaryAction,
	error,
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
	onCancel?: ComponentProps<"button">["onClick"];
	/** A third button between Cancel and the primary action. */
	secondaryAction?: {
		label: ReactNode;
		onClick: ComponentProps<"button">["onClick"];
		disabled?: boolean;
		tone?: "default" | "destructive";
	};
	/** A backend error, shown inside the dialog above the footer. */
	error?: ReactNode;
	children?: ReactNode;
}) {
	const cancelRef = useRef<HTMLButtonElement>(null);
	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogPortal>
				<AlertDialogBackdrop />
				<AlertDialogViewport>
					<AlertDialogPopup
						initialFocus={cancelRef}
						className={confirmationPopup()}
					>
						<DialogHeader icon={icon} title={title} tone={tone} />
						{description ? (
							<AlertDialogDescription render={<DialogBody />}>
								{description}
							</AlertDialogDescription>
						) : null}
						{children}
						<DialogError>{error}</DialogError>
						<DialogFooter>
							<AlertDialogClose
								ref={cancelRef}
								render={
									<Button type="button" variant="ghost" onClick={onCancel} />
								}
							>
								{cancelLabel}
							</AlertDialogClose>
							{secondaryAction ? (
								<Button
									type="button"
									variant="outlined"
									flavor={
										secondaryAction.tone === "destructive"
											? "danger"
											: undefined
									}
									disabled={secondaryAction.disabled}
									onClick={secondaryAction.onClick}
								>
									{secondaryAction.label}
								</Button>
							) : null}
							<Button
								type={actionType}
								form={actionForm}
								variant={tone === "destructive" ? "outlined" : "filled"}
								flavor={tone === "destructive" ? "danger" : undefined}
								className={confirmationActionButton()}
								disabled={actionDisabled}
								onClick={onAction}
							>
								{actionIcon}
								{actionLabel}
							</Button>
						</DialogFooter>
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
