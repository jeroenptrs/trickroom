import { Popover } from "@base-ui/react/popover";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	type Ref,
	useContext,
} from "react";
import { useFrame } from "react-frame-component";

type PopoverRootProps = ComponentPropsWithoutRef<typeof Popover.Root>;
type PopoverTriggerProps = ComponentPropsWithoutRef<typeof Popover.Trigger>;
type PopoverPortalProps = ComponentPropsWithoutRef<typeof Popover.Portal>;
type PopoverBackdropProps = ComponentPropsWithoutRef<typeof Popover.Backdrop>;
type PopoverPositionerProps = ComponentPropsWithoutRef<
	typeof Popover.Positioner
>;
type PopoverPopupProps = ComponentPropsWithoutRef<typeof Popover.Popup>;
type PopoverArrowProps = ComponentPropsWithoutRef<typeof Popover.Arrow>;
type PopoverViewportProps = ComponentPropsWithoutRef<typeof Popover.Viewport>;
type PopoverTitleProps = ComponentPropsWithoutRef<typeof Popover.Title>;
type PopoverDescriptionProps = ComponentPropsWithoutRef<
	typeof Popover.Description
>;
type PopoverCloseProps = ComponentPropsWithoutRef<typeof Popover.Close>;
type PopoverRenderMode = "base" | "fallback" | null;

const PopoverRootRenderContext = createContext(false);
const PopoverPortalRenderContext = createContext<PopoverRenderMode>(null);
const PopoverPositionerRenderContext = createContext<PopoverRenderMode>(null);
const PopoverPopupRenderContext = createContext<PopoverRenderMode>(null);

export const PopoverRoot = forwardRef<HTMLDivElement, PopoverRootProps>(
	function PopoverRoot({ children, ...props }, _ref) {
		return (
			<PopoverRootRenderContext.Provider value={true}>
				<Popover.Root {...props}>{children}</Popover.Root>
			</PopoverRootRenderContext.Provider>
		);
	},
);

export const PopoverTrigger = forwardRef<HTMLElement, PopoverTriggerProps>(
	function PopoverTrigger(props, ref) {
		const isInsidePopoverRoot = useContext(PopoverRootRenderContext);

		if (isInsidePopoverRoot) {
			return <Popover.Trigger {...props} ref={ref} />;
		}

		const {
			closeDelay: _closeDelay,
			delay: _delay,
			handle: _handle,
			nativeButton: _nativeButton,
			openOnHover: _openOnHover,
			payload: _payload,
			render: _render,
			...buttonProps
		} = props;

		return (
			<button
				{...(buttonProps as ComponentPropsWithoutRef<"button">)}
				ref={ref as Ref<HTMLButtonElement>}
			/>
		);
	},
);

export const PopoverPortal = forwardRef<HTMLDivElement, PopoverPortalProps>(
	function PopoverPortal({ children, ...props }, ref) {
		const isInsidePopoverRoot = useContext(PopoverRootRenderContext);
		const { document: frameDocument } = useFrame();

		if (isInsidePopoverRoot) {
			const { container, ...portalProps } = props;
			const resolvedContainer =
				container === undefined ? frameDocument?.body : container;

			return (
				<PopoverPortalRenderContext.Provider value="base">
					<Popover.Portal
						{...portalProps}
						container={resolvedContainer}
						ref={ref}
					>
						{children}
					</Popover.Portal>
				</PopoverPortalRenderContext.Provider>
			);
		}

		const { container: _container, keepMounted: _keepMounted } = props;

		return (
			<PopoverPortalRenderContext.Provider value="fallback">
				<div ref={ref} data-trickroom-popover-portal="">
					{children}
				</div>
			</PopoverPortalRenderContext.Provider>
		);
	},
);

export const PopoverBackdrop = forwardRef<HTMLDivElement, PopoverBackdropProps>(
	function PopoverBackdrop(props, ref) {
		const isInsidePopoverRoot = useContext(PopoverRootRenderContext);
		const popoverPortalRenderMode = useContext(PopoverPortalRenderContext);

		if (isInsidePopoverRoot && popoverPortalRenderMode === "base") {
			return <Popover.Backdrop {...props} ref={ref} />;
		}

		const { render: _render, ...divProps } = props;

		return <div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />;
	},
);

export const PopoverPositioner = forwardRef<
	HTMLDivElement,
	PopoverPositionerProps
>(function PopoverPositioner(props, ref) {
	const isInsidePopoverRoot = useContext(PopoverRootRenderContext);
	const popoverPortalRenderMode = useContext(PopoverPortalRenderContext);

	if (isInsidePopoverRoot && popoverPortalRenderMode === "base") {
		return (
			<PopoverPositionerRenderContext.Provider value="base">
				<Popover.Positioner {...props} ref={ref} />
			</PopoverPositionerRenderContext.Provider>
		);
	}

	const {
		align: _align,
		alignOffset: _alignOffset,
		anchor: _anchor,
		arrowPadding: _arrowPadding,
		collisionAvoidance: _collisionAvoidance,
		collisionBoundary: _collisionBoundary,
		collisionPadding: _collisionPadding,
		disableAnchorTracking: _disableAnchorTracking,
		positionMethod: _positionMethod,
		render: _render,
		side: _side,
		sideOffset: _sideOffset,
		sticky: _sticky,
		...divProps
	} = props;

	return (
		<PopoverPositionerRenderContext.Provider value="fallback">
			<div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />
		</PopoverPositionerRenderContext.Provider>
	);
});

export const PopoverPopup = forwardRef<HTMLDivElement, PopoverPopupProps>(
	function PopoverPopup(props, ref) {
		const isInsidePopoverRoot = useContext(PopoverRootRenderContext);
		const popoverPositionerRenderMode = useContext(
			PopoverPositionerRenderContext,
		);

		if (isInsidePopoverRoot && popoverPositionerRenderMode === "base") {
			return (
				<PopoverPopupRenderContext.Provider value="base">
					<Popover.Popup {...props} ref={ref} />
				</PopoverPopupRenderContext.Provider>
			);
		}

		const {
			finalFocus: _finalFocus,
			initialFocus: _initialFocus,
			render: _render,
			...divProps
		} = props;

		return (
			<PopoverPopupRenderContext.Provider value="fallback">
				<div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />
			</PopoverPopupRenderContext.Provider>
		);
	},
);

export const PopoverArrow = forwardRef<HTMLDivElement, PopoverArrowProps>(
	function PopoverArrow(props, ref) {
		const isInsidePopoverRoot = useContext(PopoverRootRenderContext);
		const popoverPopupRenderMode = useContext(PopoverPopupRenderContext);

		if (isInsidePopoverRoot && popoverPopupRenderMode === "base") {
			return <Popover.Arrow {...props} ref={ref} />;
		}

		const { render: _render, ...divProps } = props;

		return <div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />;
	},
);

export const PopoverViewport = forwardRef<HTMLDivElement, PopoverViewportProps>(
	function PopoverViewport(props, ref) {
		const isInsidePopoverRoot = useContext(PopoverRootRenderContext);
		const popoverPopupRenderMode = useContext(PopoverPopupRenderContext);

		if (isInsidePopoverRoot && popoverPopupRenderMode === "base") {
			return <Popover.Viewport {...props} ref={ref} />;
		}

		const { render: _render, ...divProps } = props;

		return <div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />;
	},
);

export const PopoverTitle = forwardRef<HTMLHeadingElement, PopoverTitleProps>(
	function PopoverTitle(props, ref) {
		const isInsidePopoverRoot = useContext(PopoverRootRenderContext);
		const popoverPopupRenderMode = useContext(PopoverPopupRenderContext);

		if (isInsidePopoverRoot && popoverPopupRenderMode === "base") {
			return <Popover.Title {...props} ref={ref} />;
		}

		const { render: _render, ...headingProps } = props;

		return (
			<h2 {...(headingProps as ComponentPropsWithoutRef<"h2">)} ref={ref} />
		);
	},
);

export const PopoverDescription = forwardRef<
	HTMLParagraphElement,
	PopoverDescriptionProps
>(function PopoverDescription(props, ref) {
	const isInsidePopoverRoot = useContext(PopoverRootRenderContext);
	const popoverPopupRenderMode = useContext(PopoverPopupRenderContext);

	if (isInsidePopoverRoot && popoverPopupRenderMode === "base") {
		return <Popover.Description {...props} ref={ref} />;
	}

	const { render: _render, ...paragraphProps } = props;

	return <p {...(paragraphProps as ComponentPropsWithoutRef<"p">)} ref={ref} />;
});

export const PopoverClose = forwardRef<HTMLElement, PopoverCloseProps>(
	function PopoverClose(props, ref) {
		const isInsidePopoverRoot = useContext(PopoverRootRenderContext);
		const popoverPopupRenderMode = useContext(PopoverPopupRenderContext);

		if (isInsidePopoverRoot && popoverPopupRenderMode === "base") {
			return <Popover.Close {...props} ref={ref} />;
		}

		const {
			nativeButton: _nativeButton,
			render: _render,
			...buttonProps
		} = props;

		return (
			<button
				{...(buttonProps as ComponentPropsWithoutRef<"button">)}
				ref={ref as Ref<HTMLButtonElement>}
			/>
		);
	},
);
