import { Dialog } from "@base-ui/react/dialog";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import {
	CANVAS_OVERLAY_ROOT_PROPS,
	useCanvasPopupProps,
	useIsCanvasBoard,
	useStagePortalContainer,
} from "../stage-portal";
import { renderFallback } from "./render-fallback";

type DialogRootProps = ComponentPropsWithoutRef<typeof Dialog.Root>;
type DialogTriggerProps = ComponentPropsWithoutRef<typeof Dialog.Trigger>;
type DialogPortalProps = ComponentPropsWithoutRef<typeof Dialog.Portal>;
type DialogBackdropProps = ComponentPropsWithoutRef<typeof Dialog.Backdrop>;
type DialogViewportProps = ComponentPropsWithoutRef<typeof Dialog.Viewport>;
type DialogPopupProps = ComponentPropsWithoutRef<typeof Dialog.Popup>;
type DialogTitleProps = ComponentPropsWithoutRef<typeof Dialog.Title>;
type DialogDescriptionProps = ComponentPropsWithoutRef<
	typeof Dialog.Description
>;
type DialogCloseProps = ComponentPropsWithoutRef<typeof Dialog.Close>;
type DialogRenderMode = "base" | "fallback" | null;

const DialogRootRenderContext = createContext(false);
const DialogPortalRenderContext = createContext<DialogRenderMode>(null);

export function DialogRoot({ children, ...props }: DialogRootProps) {
	const canvas = useIsCanvasBoard();

	return (
		<DialogRootRenderContext.Provider value={true}>
			<Dialog.Root {...props} {...(canvas ? CANVAS_OVERLAY_ROOT_PROPS : {})}>
				{children}
			</Dialog.Root>
		</DialogRootRenderContext.Provider>
	);
}

export const DialogTrigger = forwardRef<HTMLButtonElement, DialogTriggerProps>(
	function DialogTrigger(props, ref) {
		const isInsideDialogRoot = useContext(DialogRootRenderContext);

		if (isInsideDialogRoot) {
			return <Dialog.Trigger {...props} ref={ref} />;
		}

		return renderFallback("button", props, ref, [
			"handle",
			"nativeButton",
			"payload",
		]);
	},
);

export const DialogPortal = forwardRef<HTMLDivElement, DialogPortalProps>(
	function DialogPortal({ children, ...props }, ref) {
		const isInsideDialogRoot = useContext(DialogRootRenderContext);
		const resolvedContainer = useStagePortalContainer(
			props.container,
			isInsideDialogRoot,
		);

		if (isInsideDialogRoot) {
			const { container: _container, ...portalProps } = props;

			return (
				<DialogPortalRenderContext.Provider value="base">
					<Dialog.Portal
						{...portalProps}
						container={resolvedContainer}
						ref={ref}
					>
						{children}
					</Dialog.Portal>
				</DialogPortalRenderContext.Provider>
			);
		}

		return (
			<DialogPortalRenderContext.Provider value="fallback">
				<div ref={ref} data-trickroom-dialog-portal="">
					{children}
				</div>
			</DialogPortalRenderContext.Provider>
		);
	},
);

export const DialogBackdrop = forwardRef<HTMLDivElement, DialogBackdropProps>(
	function DialogBackdrop(props, ref) {
		const isInsideDialogRoot = useContext(DialogRootRenderContext);

		if (isInsideDialogRoot) {
			return <Dialog.Backdrop {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref, ["forceRender"]);
	},
);

// Base UI's Viewport and Popup throw without a Dialog.Portal ancestor, so they
// only render through Base UI when a real portal wraps them.
export const DialogViewport = forwardRef<HTMLDivElement, DialogViewportProps>(
	function DialogViewport(props, ref) {
		const isInsideDialogRoot = useContext(DialogRootRenderContext);
		const dialogPortalRenderMode = useContext(DialogPortalRenderContext);

		if (isInsideDialogRoot && dialogPortalRenderMode === "base") {
			return <Dialog.Viewport {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const DialogPopup = forwardRef<HTMLDivElement, DialogPopupProps>(
	function DialogPopup(props, ref) {
		const isInsideDialogRoot = useContext(DialogRootRenderContext);
		const dialogPortalRenderMode = useContext(DialogPortalRenderContext);
		const popupProps = useCanvasPopupProps(props);

		if (isInsideDialogRoot && dialogPortalRenderMode === "base") {
			return <Dialog.Popup {...popupProps} ref={ref} />;
		}

		return renderFallback("div", props, ref, ["finalFocus", "initialFocus"]);
	},
);

export const DialogTitle = forwardRef<HTMLHeadingElement, DialogTitleProps>(
	function DialogTitle(props, ref) {
		const isInsideDialogRoot = useContext(DialogRootRenderContext);

		if (isInsideDialogRoot) {
			return <Dialog.Title {...props} ref={ref} />;
		}

		return renderFallback("h2", props, ref);
	},
);

export const DialogDescription = forwardRef<
	HTMLParagraphElement,
	DialogDescriptionProps
>(function DialogDescription(props, ref) {
	const isInsideDialogRoot = useContext(DialogRootRenderContext);

	if (isInsideDialogRoot) {
		return <Dialog.Description {...props} ref={ref} />;
	}

	return renderFallback("p", props, ref);
});

export const DialogClose = forwardRef<HTMLButtonElement, DialogCloseProps>(
	function DialogClose(props, ref) {
		const isInsideDialogRoot = useContext(DialogRootRenderContext);

		if (isInsideDialogRoot) {
			return <Dialog.Close {...props} ref={ref} />;
		}

		return renderFallback("button", props, ref, ["nativeButton"]);
	},
);
