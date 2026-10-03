import { AlertDialog } from "@base-ui/react/alert-dialog";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { useFrame } from "react-frame-component";
import { renderFallback } from "./render-fallback";

type AlertDialogRootProps = ComponentPropsWithoutRef<typeof AlertDialog.Root>;
type AlertDialogTriggerProps = ComponentPropsWithoutRef<
	typeof AlertDialog.Trigger
>;
type AlertDialogPortalProps = ComponentPropsWithoutRef<
	typeof AlertDialog.Portal
>;
type AlertDialogBackdropProps = ComponentPropsWithoutRef<
	typeof AlertDialog.Backdrop
>;
type AlertDialogViewportProps = ComponentPropsWithoutRef<
	typeof AlertDialog.Viewport
>;
type AlertDialogPopupProps = ComponentPropsWithoutRef<typeof AlertDialog.Popup>;
type AlertDialogTitleProps = ComponentPropsWithoutRef<typeof AlertDialog.Title>;
type AlertDialogDescriptionProps = ComponentPropsWithoutRef<
	typeof AlertDialog.Description
>;
type AlertDialogCloseProps = ComponentPropsWithoutRef<typeof AlertDialog.Close>;
type AlertDialogRenderMode = "base" | "fallback" | null;

const AlertDialogRootRenderContext = createContext(false);
const AlertDialogPortalRenderContext =
	createContext<AlertDialogRenderMode>(null);

export function AlertDialogRoot({ children, ...props }: AlertDialogRootProps) {
	return (
		<AlertDialogRootRenderContext.Provider value={true}>
			<AlertDialog.Root {...props}>{children}</AlertDialog.Root>
		</AlertDialogRootRenderContext.Provider>
	);
}

export const AlertDialogTrigger = forwardRef<
	HTMLButtonElement,
	AlertDialogTriggerProps
>(function AlertDialogTrigger(props, ref) {
	const isInsideAlertDialogRoot = useContext(AlertDialogRootRenderContext);

	if (isInsideAlertDialogRoot) {
		return <AlertDialog.Trigger {...props} ref={ref} />;
	}

	return renderFallback("button", props, ref, [
		"handle",
		"nativeButton",
		"payload",
	]);
});

export const AlertDialogPortal = forwardRef<
	HTMLDivElement,
	AlertDialogPortalProps
>(function AlertDialogPortal({ children, ...props }, ref) {
	const isInsideAlertDialogRoot = useContext(AlertDialogRootRenderContext);
	const { document: frameDocument } = useFrame();

	if (isInsideAlertDialogRoot) {
		const { container, ...portalProps } = props;
		const resolvedContainer =
			container === undefined ? frameDocument?.body : container;

		return (
			<AlertDialogPortalRenderContext.Provider value="base">
				<AlertDialog.Portal
					{...portalProps}
					container={resolvedContainer}
					ref={ref}
				>
					{children}
				</AlertDialog.Portal>
			</AlertDialogPortalRenderContext.Provider>
		);
	}

	return (
		<AlertDialogPortalRenderContext.Provider value="fallback">
			<div ref={ref} data-trickroom-alert-dialog-portal="">
				{children}
			</div>
		</AlertDialogPortalRenderContext.Provider>
	);
});

export const AlertDialogBackdrop = forwardRef<
	HTMLDivElement,
	AlertDialogBackdropProps
>(function AlertDialogBackdrop(props, ref) {
	const isInsideAlertDialogRoot = useContext(AlertDialogRootRenderContext);

	if (isInsideAlertDialogRoot) {
		return <AlertDialog.Backdrop {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref, ["forceRender"]);
});

// Base UI's Viewport and Popup throw without an AlertDialog.Portal ancestor, so they
// only render through Base UI when a real portal wraps them.
export const AlertDialogViewport = forwardRef<
	HTMLDivElement,
	AlertDialogViewportProps
>(function AlertDialogViewport(props, ref) {
	const isInsideAlertDialogRoot = useContext(AlertDialogRootRenderContext);
	const alertDialogPortalRenderMode = useContext(
		AlertDialogPortalRenderContext,
	);

	if (isInsideAlertDialogRoot && alertDialogPortalRenderMode === "base") {
		return <AlertDialog.Viewport {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref);
});

export const AlertDialogPopup = forwardRef<
	HTMLDivElement,
	AlertDialogPopupProps
>(function AlertDialogPopup(props, ref) {
	const isInsideAlertDialogRoot = useContext(AlertDialogRootRenderContext);
	const alertDialogPortalRenderMode = useContext(
		AlertDialogPortalRenderContext,
	);

	if (isInsideAlertDialogRoot && alertDialogPortalRenderMode === "base") {
		return <AlertDialog.Popup {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref, ["finalFocus", "initialFocus"]);
});

export const AlertDialogTitle = forwardRef<
	HTMLHeadingElement,
	AlertDialogTitleProps
>(function AlertDialogTitle(props, ref) {
	const isInsideAlertDialogRoot = useContext(AlertDialogRootRenderContext);

	if (isInsideAlertDialogRoot) {
		return <AlertDialog.Title {...props} ref={ref} />;
	}

	return renderFallback("h2", props, ref);
});

export const AlertDialogDescription = forwardRef<
	HTMLParagraphElement,
	AlertDialogDescriptionProps
>(function AlertDialogDescription(props, ref) {
	const isInsideAlertDialogRoot = useContext(AlertDialogRootRenderContext);

	if (isInsideAlertDialogRoot) {
		return <AlertDialog.Description {...props} ref={ref} />;
	}

	return renderFallback("p", props, ref);
});

export const AlertDialogClose = forwardRef<
	HTMLButtonElement,
	AlertDialogCloseProps
>(function AlertDialogClose(props, ref) {
	const isInsideAlertDialogRoot = useContext(AlertDialogRootRenderContext);

	if (isInsideAlertDialogRoot) {
		return <AlertDialog.Close {...props} ref={ref} />;
	}

	return renderFallback("button", props, ref, ["nativeButton"]);
});
