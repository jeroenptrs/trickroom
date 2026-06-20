import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { tv } from "tailwind-variants";

const dialog = tv({
	slots: {
		backdrop:
			"fixed inset-0 min-h-dvh bg-black opacity-20 transition-all duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 dark:opacity-70 supports-[-webkit-touch-callout:none]:absolute",
		content:
			"flex flex-col fixed top-1/2 left-1/2 -mt-8 w-96 w-full max-w-xs md:max-w-md -translate-x-1/2 -translate-y-1/2 rounded-none bg-gray-50 text-gray-900 inset-shadow-[0_0_0_1px] inset-shadow-gray-200 transition-all duration-150 data-[ending-style]:scale-90 data-[ending-style]:opacity-0 data-[starting-style]:scale-90 data-[starting-style]:opacity-0",
		title: "p-2",
		description: "px-2 mb-4",
	},
});

const { backdrop, content, title, description } = dialog();

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

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogOverlay,
	DialogPortal,
	DialogTitle,
	DialogTrigger,
};
