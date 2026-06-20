import { PreviewCard } from "@base-ui/react/preview-card";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { useFrame } from "react-frame-component";
import { renderFallback } from "./render-fallback";

type PreviewCardRootProps = ComponentPropsWithoutRef<typeof PreviewCard.Root>;
type PreviewCardTriggerProps = ComponentPropsWithoutRef<
	typeof PreviewCard.Trigger
>;
type PreviewCardPortalProps = ComponentPropsWithoutRef<
	typeof PreviewCard.Portal
>;
type PreviewCardBackdropProps = ComponentPropsWithoutRef<
	typeof PreviewCard.Backdrop
>;
type PreviewCardPositionerProps = ComponentPropsWithoutRef<
	typeof PreviewCard.Positioner
>;
type PreviewCardPopupProps = ComponentPropsWithoutRef<typeof PreviewCard.Popup>;
type PreviewCardArrowProps = ComponentPropsWithoutRef<typeof PreviewCard.Arrow>;
type PreviewCardViewportProps = ComponentPropsWithoutRef<
	typeof PreviewCard.Viewport
>;
type PreviewCardRenderMode = "base" | "fallback" | null;

const PreviewCardRootRenderContext = createContext(false);
const PreviewCardPortalRenderContext =
	createContext<PreviewCardRenderMode>(null);
const PreviewCardPositionerRenderContext =
	createContext<PreviewCardRenderMode>(null);
const PreviewCardPopupRenderContext =
	createContext<PreviewCardRenderMode>(null);

export const PreviewCardRoot = forwardRef<HTMLDivElement, PreviewCardRootProps>(
	function PreviewCardRoot({ children, ...props }, _ref) {
		return (
			<PreviewCardRootRenderContext.Provider value={true}>
				<PreviewCard.Root {...props}>{children}</PreviewCard.Root>
			</PreviewCardRootRenderContext.Provider>
		);
	},
);

export const PreviewCardTrigger = forwardRef<
	HTMLAnchorElement,
	PreviewCardTriggerProps
>(function PreviewCardTrigger(props, ref) {
	const isInsidePreviewCardRoot = useContext(PreviewCardRootRenderContext);

	if (isInsidePreviewCardRoot) {
		return <PreviewCard.Trigger {...props} ref={ref} />;
	}

	return renderFallback("a", props, ref, [
		"closeDelay",
		"delay",
		"handle",
		"payload",
	]);
});

export const PreviewCardPortal = forwardRef<
	HTMLDivElement,
	PreviewCardPortalProps
>(function PreviewCardPortal({ children, ...props }, ref) {
	const isInsidePreviewCardRoot = useContext(PreviewCardRootRenderContext);
	const { document: frameDocument } = useFrame();

	if (isInsidePreviewCardRoot) {
		const { container, ...portalProps } = props;
		const resolvedContainer =
			container === undefined ? frameDocument?.body : container;

		return (
			<PreviewCardPortalRenderContext.Provider value="base">
				<PreviewCard.Portal
					{...portalProps}
					container={resolvedContainer}
					ref={ref}
				>
					{children}
				</PreviewCard.Portal>
			</PreviewCardPortalRenderContext.Provider>
		);
	}

	const { container: _container, keepMounted: _keepMounted } = props;

	return (
		<PreviewCardPortalRenderContext.Provider value="fallback">
			<div ref={ref} data-trickroom-preview-card-portal="">
				{children}
			</div>
		</PreviewCardPortalRenderContext.Provider>
	);
});

export const PreviewCardBackdrop = forwardRef<
	HTMLDivElement,
	PreviewCardBackdropProps
>(function PreviewCardBackdrop(props, ref) {
	const isInsidePreviewCardRoot = useContext(PreviewCardRootRenderContext);
	const previewCardPortalRenderMode = useContext(
		PreviewCardPortalRenderContext,
	);

	if (isInsidePreviewCardRoot && previewCardPortalRenderMode === "base") {
		return <PreviewCard.Backdrop {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref);
});

export const PreviewCardPositioner = forwardRef<
	HTMLDivElement,
	PreviewCardPositionerProps
>(function PreviewCardPositioner(props, ref) {
	const isInsidePreviewCardRoot = useContext(PreviewCardRootRenderContext);
	const previewCardPortalRenderMode = useContext(
		PreviewCardPortalRenderContext,
	);

	if (isInsidePreviewCardRoot && previewCardPortalRenderMode === "base") {
		return (
			<PreviewCardPositionerRenderContext.Provider value="base">
				<PreviewCard.Positioner {...props} ref={ref} />
			</PreviewCardPositionerRenderContext.Provider>
		);
	}

	return (
		<PreviewCardPositionerRenderContext.Provider value="fallback">
			{renderFallback("div", props, ref, [
				"align",
				"alignOffset",
				"anchor",
				"arrowPadding",
				"collisionAvoidance",
				"collisionBoundary",
				"collisionPadding",
				"disableAnchorTracking",
				"positionMethod",
				"side",
				"sideOffset",
				"sticky",
			])}
		</PreviewCardPositionerRenderContext.Provider>
	);
});

export const PreviewCardPopup = forwardRef<
	HTMLDivElement,
	PreviewCardPopupProps
>(function PreviewCardPopup(props, ref) {
	const isInsidePreviewCardRoot = useContext(PreviewCardRootRenderContext);
	const previewCardPositionerRenderMode = useContext(
		PreviewCardPositionerRenderContext,
	);

	if (isInsidePreviewCardRoot && previewCardPositionerRenderMode === "base") {
		return (
			<PreviewCardPopupRenderContext.Provider value="base">
				<PreviewCard.Popup {...props} ref={ref} />
			</PreviewCardPopupRenderContext.Provider>
		);
	}

	return (
		<PreviewCardPopupRenderContext.Provider value="fallback">
			{renderFallback("div", props, ref)}
		</PreviewCardPopupRenderContext.Provider>
	);
});

export const PreviewCardArrow = forwardRef<
	HTMLDivElement,
	PreviewCardArrowProps
>(function PreviewCardArrow(props, ref) {
	const isInsidePreviewCardRoot = useContext(PreviewCardRootRenderContext);
	const previewCardPopupRenderMode = useContext(PreviewCardPopupRenderContext);

	if (isInsidePreviewCardRoot && previewCardPopupRenderMode === "base") {
		return <PreviewCard.Arrow {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref);
});

export const PreviewCardViewport = forwardRef<
	HTMLDivElement,
	PreviewCardViewportProps
>(function PreviewCardViewport(props, ref) {
	const isInsidePreviewCardRoot = useContext(PreviewCardRootRenderContext);
	const previewCardPopupRenderMode = useContext(PreviewCardPopupRenderContext);

	if (isInsidePreviewCardRoot && previewCardPopupRenderMode === "base") {
		return <PreviewCard.Viewport {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref);
});
