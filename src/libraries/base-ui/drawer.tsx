import { Drawer } from "@base-ui/react/drawer";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { useFrame } from "react-frame-component";
import { renderFallback } from "./render-fallback";

type DrawerProviderProps = ComponentPropsWithoutRef<typeof Drawer.Provider>;
type DrawerRootProps = ComponentPropsWithoutRef<typeof Drawer.Root>;
type DrawerTriggerProps = ComponentPropsWithoutRef<typeof Drawer.Trigger>;
type DrawerPortalProps = ComponentPropsWithoutRef<typeof Drawer.Portal>;
type DrawerBackdropProps = ComponentPropsWithoutRef<typeof Drawer.Backdrop>;
type DrawerViewportProps = ComponentPropsWithoutRef<typeof Drawer.Viewport>;
type DrawerPopupProps = ComponentPropsWithoutRef<typeof Drawer.Popup>;
type DrawerContentProps = ComponentPropsWithoutRef<typeof Drawer.Content>;
type DrawerTitleProps = ComponentPropsWithoutRef<typeof Drawer.Title>;
type DrawerDescriptionProps = ComponentPropsWithoutRef<
	typeof Drawer.Description
>;
type DrawerCloseProps = ComponentPropsWithoutRef<typeof Drawer.Close>;
type DrawerSwipeAreaProps = ComponentPropsWithoutRef<typeof Drawer.SwipeArea>;
type DrawerIndentProps = ComponentPropsWithoutRef<typeof Drawer.Indent>;
type DrawerIndentBackgroundProps = ComponentPropsWithoutRef<
	typeof Drawer.IndentBackground
>;

const DrawerRootRenderContext = createContext(false);
const DrawerPortalRenderContext = createContext(false);
const DrawerViewportRenderContext = createContext(false);

export function DrawerProvider(props: DrawerProviderProps) {
	return <Drawer.Provider {...props} />;
}

export function DrawerRoot({ children, ...props }: DrawerRootProps) {
	return (
		<DrawerRootRenderContext.Provider value={true}>
			<Drawer.Root {...props}>{children}</Drawer.Root>
		</DrawerRootRenderContext.Provider>
	);
}

export const DrawerTrigger = forwardRef<HTMLElement, DrawerTriggerProps>(
	function DrawerTrigger(props, ref) {
		const isInsideDrawerRoot = useContext(DrawerRootRenderContext);

		if (isInsideDrawerRoot) {
			return <Drawer.Trigger {...props} ref={ref} />;
		}

		return renderFallback("button", props, ref, ["nativeButton", "handle"]);
	},
);

export const DrawerPortal = forwardRef<HTMLDivElement, DrawerPortalProps>(
	function DrawerPortal({ children, ...props }, ref) {
		const isInsideDrawerRoot = useContext(DrawerRootRenderContext);
		const { document: frameDocument } = useFrame();

		if (isInsideDrawerRoot) {
			const { container, ...portalProps } = props;
			const resolvedContainer =
				container === undefined ? frameDocument?.body : container;

			return (
				<DrawerPortalRenderContext.Provider value={true}>
					<Drawer.Portal
						{...portalProps}
						container={resolvedContainer}
						ref={ref}
					>
						{children}
					</Drawer.Portal>
				</DrawerPortalRenderContext.Provider>
			);
		}

		return (
			<DrawerPortalRenderContext.Provider value={true}>
				<div ref={ref} data-trickroom-drawer-portal="">
					{children}
				</div>
			</DrawerPortalRenderContext.Provider>
		);
	},
);

export const DrawerBackdrop = forwardRef<HTMLDivElement, DrawerBackdropProps>(
	function DrawerBackdrop(props, ref) {
		const isInsideDrawerRoot = useContext(DrawerRootRenderContext);

		if (isInsideDrawerRoot) {
			return <Drawer.Backdrop {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const DrawerViewport = forwardRef<HTMLDivElement, DrawerViewportProps>(
	function DrawerViewport(props, ref) {
		const isInsideDrawerRoot = useContext(DrawerRootRenderContext);
		const isInsideDrawerPortal = useContext(DrawerPortalRenderContext);

		if (isInsideDrawerRoot && isInsideDrawerPortal) {
			return (
				<DrawerViewportRenderContext.Provider value={true}>
					<Drawer.Viewport {...props} ref={ref} />
				</DrawerViewportRenderContext.Provider>
			);
		}

		return (
			<DrawerViewportRenderContext.Provider value={true}>
				{renderFallback("div", props, ref)}
			</DrawerViewportRenderContext.Provider>
		);
	},
);

export const DrawerPopup = forwardRef<HTMLDivElement, DrawerPopupProps>(
	function DrawerPopup(props, ref) {
		const isInsideDrawerRoot = useContext(DrawerRootRenderContext);

		if (isInsideDrawerRoot) {
			return <Drawer.Popup {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref, [
			"finalFocus",
			"initialFocus",
			"modal",
		]);
	},
);

export const DrawerContent = forwardRef<HTMLDivElement, DrawerContentProps>(
	function DrawerContent(props, ref) {
		return <Drawer.Content {...props} ref={ref} />;
	},
);

export const DrawerTitle = forwardRef<HTMLHeadingElement, DrawerTitleProps>(
	function DrawerTitle(props, ref) {
		const isInsideDrawerRoot = useContext(DrawerRootRenderContext);

		if (isInsideDrawerRoot) {
			return <Drawer.Title {...props} ref={ref} />;
		}

		return renderFallback("h2", props, ref);
	},
);

export const DrawerDescription = forwardRef<
	HTMLParagraphElement,
	DrawerDescriptionProps
>(function DrawerDescription(props, ref) {
	const isInsideDrawerRoot = useContext(DrawerRootRenderContext);

	if (isInsideDrawerRoot) {
		return <Drawer.Description {...props} ref={ref} />;
	}

	return renderFallback("p", props, ref);
});

export const DrawerClose = forwardRef<HTMLButtonElement, DrawerCloseProps>(
	function DrawerClose(props, ref) {
		const isInsideDrawerRoot = useContext(DrawerRootRenderContext);

		if (isInsideDrawerRoot) {
			return <Drawer.Close {...props} ref={ref} />;
		}

		return renderFallback("button", props, ref, ["nativeButton"]);
	},
);

export const DrawerSwipeArea = forwardRef<HTMLDivElement, DrawerSwipeAreaProps>(
	function DrawerSwipeArea(props, ref) {
		const isInsideDrawerRoot = useContext(DrawerRootRenderContext);
		const isInsideDrawerViewport = useContext(DrawerViewportRenderContext);

		if (isInsideDrawerRoot && isInsideDrawerViewport) {
			return <Drawer.SwipeArea {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const DrawerIndent = forwardRef<HTMLDivElement, DrawerIndentProps>(
	function DrawerIndent(props, ref) {
		return <Drawer.Indent {...props} ref={ref} />;
	},
);

export const DrawerIndentBackground = forwardRef<
	HTMLDivElement,
	DrawerIndentBackgroundProps
>(function DrawerIndentBackground(props, ref) {
	return <Drawer.IndentBackground {...props} ref={ref} />;
});
