import { ContextMenu } from "@base-ui/react/context-menu";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { useFrame } from "react-frame-component";
import { renderFallback } from "./render-fallback";

type ContextMenuRootProps = ComponentPropsWithoutRef<typeof ContextMenu.Root>;
type ContextMenuTriggerProps = ComponentPropsWithoutRef<
	typeof ContextMenu.Trigger
>;
type ContextMenuPortalProps = ComponentPropsWithoutRef<
	typeof ContextMenu.Portal
>;
type ContextMenuPositionerProps = ComponentPropsWithoutRef<
	typeof ContextMenu.Positioner
>;
type ContextMenuPopupProps = ComponentPropsWithoutRef<typeof ContextMenu.Popup>;
type ContextMenuItemProps = ComponentPropsWithoutRef<typeof ContextMenu.Item>;
type ContextMenuSeparatorProps = ComponentPropsWithoutRef<
	typeof ContextMenu.Separator
>;
type ContextMenuRenderMode = "base" | "fallback" | null;

const ContextMenuRootRenderContext = createContext(false);
const ContextMenuPortalRenderContext =
	createContext<ContextMenuRenderMode>(null);
const ContextMenuPositionerRenderContext =
	createContext<ContextMenuRenderMode>(null);
const ContextMenuPopupRenderContext =
	createContext<ContextMenuRenderMode>(null);

export const ContextMenuRoot = forwardRef<HTMLDivElement, ContextMenuRootProps>(
	function ContextMenuRoot({ children, ...props }, _ref) {
		return (
			<ContextMenuRootRenderContext.Provider value={true}>
				<ContextMenu.Root {...props}>{children}</ContextMenu.Root>
			</ContextMenuRootRenderContext.Provider>
		);
	},
);

export const ContextMenuTrigger = forwardRef<
	HTMLDivElement,
	ContextMenuTriggerProps
>(function ContextMenuTrigger(props, ref) {
	const isInsideContextMenuRoot = useContext(ContextMenuRootRenderContext);

	if (isInsideContextMenuRoot) {
		return <ContextMenu.Trigger {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref);
});

export const ContextMenuPortal = forwardRef<
	HTMLDivElement,
	ContextMenuPortalProps
>(function ContextMenuPortal({ children, ...props }, ref) {
	const isInsideContextMenuRoot = useContext(ContextMenuRootRenderContext);
	const { document: frameDocument } = useFrame();

	if (isInsideContextMenuRoot) {
		const { container, ...portalProps } = props;
		const resolvedContainer =
			container === undefined ? frameDocument?.body : container;

		return (
			<ContextMenuPortalRenderContext.Provider value="base">
				<ContextMenu.Portal
					{...portalProps}
					container={resolvedContainer}
					ref={ref}
				>
					{children}
				</ContextMenu.Portal>
			</ContextMenuPortalRenderContext.Provider>
		);
	}

	const { container: _container, keepMounted: _keepMounted } = props;

	return (
		<ContextMenuPortalRenderContext.Provider value="fallback">
			<div ref={ref} data-trickroom-context-menu-portal="">
				{children}
			</div>
		</ContextMenuPortalRenderContext.Provider>
	);
});

export const ContextMenuPositioner = forwardRef<
	HTMLDivElement,
	ContextMenuPositionerProps
>(function ContextMenuPositioner(props, ref) {
	const isInsideContextMenuRoot = useContext(ContextMenuRootRenderContext);
	const contextMenuPortalRenderMode = useContext(
		ContextMenuPortalRenderContext,
	);

	if (isInsideContextMenuRoot && contextMenuPortalRenderMode === "base") {
		return (
			<ContextMenuPositionerRenderContext.Provider value="base">
				<ContextMenu.Positioner {...props} ref={ref} />
			</ContextMenuPositionerRenderContext.Provider>
		);
	}

	return (
		<ContextMenuPositionerRenderContext.Provider value="fallback">
			{renderFallback("div", props, ref, [
				"align",
				"alignItemWithTrigger",
				"alignOffset",
				"anchor",
				"arrowPadding",
				"avoidCollisions",
				"collisionBoundary",
				"collisionPadding",
				"hideWhenDetached",
				"positionMethod",
				"side",
				"sideOffset",
				"sticky",
				"trackAnchor",
			])}
		</ContextMenuPositionerRenderContext.Provider>
	);
});

export const ContextMenuPopup = forwardRef<
	HTMLDivElement,
	ContextMenuPopupProps
>(function ContextMenuPopup(props, ref) {
	const isInsideContextMenuRoot = useContext(ContextMenuRootRenderContext);
	const contextMenuPositionerRenderMode = useContext(
		ContextMenuPositionerRenderContext,
	);

	if (isInsideContextMenuRoot && contextMenuPositionerRenderMode === "base") {
		return (
			<ContextMenuPopupRenderContext.Provider value="base">
				<ContextMenu.Popup {...props} ref={ref} />
			</ContextMenuPopupRenderContext.Provider>
		);
	}

	return (
		<ContextMenuPopupRenderContext.Provider value="fallback">
			{renderFallback("div", props, ref, ["finalFocus"])}
		</ContextMenuPopupRenderContext.Provider>
	);
});

export const ContextMenuItem = forwardRef<HTMLDivElement, ContextMenuItemProps>(
	function ContextMenuItem(props, ref) {
		const isInsideContextMenuRoot = useContext(ContextMenuRootRenderContext);
		const contextMenuPopupRenderMode = useContext(
			ContextMenuPopupRenderContext,
		);

		if (isInsideContextMenuRoot && contextMenuPopupRenderMode === "base") {
			return <ContextMenu.Item {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref, ["closeOnClick", "label"]);
	},
);

export const ContextMenuSeparator = forwardRef<
	HTMLDivElement,
	ContextMenuSeparatorProps
>(function ContextMenuSeparator(props, ref) {
	const isInsideContextMenuRoot = useContext(ContextMenuRootRenderContext);
	const contextMenuPopupRenderMode = useContext(ContextMenuPopupRenderContext);

	if (isInsideContextMenuRoot && contextMenuPopupRenderMode === "base") {
		return <ContextMenu.Separator {...props} ref={ref} />;
	}

	const { render: _render, orientation = "horizontal", ...divProps } = props;

	return (
		<div
			{...(divProps as ComponentPropsWithoutRef<"div">)}
			ref={ref}
			data-orientation={orientation}
		/>
	);
});
