import { Tooltip } from "@base-ui/react/tooltip";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	type Ref,
	useContext,
} from "react";
import { useFrame } from "react-frame-component";

type TooltipProviderProps = ComponentPropsWithoutRef<typeof Tooltip.Provider>;
type TooltipRootProps = ComponentPropsWithoutRef<typeof Tooltip.Root>;
type TooltipTriggerProps = ComponentPropsWithoutRef<typeof Tooltip.Trigger>;
type TooltipPortalProps = ComponentPropsWithoutRef<typeof Tooltip.Portal>;
type TooltipPositionerProps = ComponentPropsWithoutRef<
	typeof Tooltip.Positioner
>;
type TooltipPopupProps = ComponentPropsWithoutRef<typeof Tooltip.Popup>;
type TooltipArrowProps = ComponentPropsWithoutRef<typeof Tooltip.Arrow>;

const TooltipRootRenderContext = createContext(false);
const TooltipPortalRenderContext = createContext(false);
const TooltipPositionerRenderContext = createContext(false);

export function TooltipProvider(props: TooltipProviderProps) {
	return <Tooltip.Provider {...props} />;
}

export const TooltipRoot = forwardRef<HTMLDivElement, TooltipRootProps>(
	function TooltipRoot({ children, ...props }, _ref) {
		return (
			<TooltipRootRenderContext.Provider value={true}>
				<Tooltip.Root {...props}>{children}</Tooltip.Root>
			</TooltipRootRenderContext.Provider>
		);
	},
);

export const TooltipTrigger = forwardRef<HTMLElement, TooltipTriggerProps>(
	function TooltipTrigger(props, ref) {
		const isInsideTooltipRoot = useContext(TooltipRootRenderContext);

		if (isInsideTooltipRoot) {
			return <Tooltip.Trigger {...props} ref={ref} />;
		}

		const {
			closeDelay: _closeDelay,
			closeOnClick: _closeOnClick,
			delay: _delay,
			handle: _handle,
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

export const TooltipPortal = forwardRef<HTMLDivElement, TooltipPortalProps>(
	function TooltipPortal({ children, ...props }, ref) {
		const isInsideTooltipRoot = useContext(TooltipRootRenderContext);
		const { document: frameDocument } = useFrame();

		if (isInsideTooltipRoot) {
			const { container, ...portalProps } = props;
			const resolvedContainer =
				container === undefined ? frameDocument?.body : container;

			return (
				<TooltipPortalRenderContext.Provider value={true}>
					<Tooltip.Portal
						{...portalProps}
						container={resolvedContainer}
						ref={ref}
					>
						{children}
					</Tooltip.Portal>
				</TooltipPortalRenderContext.Provider>
			);
		}

		const { container: _container, keepMounted: _keepMounted } = props;

		return (
			<TooltipPortalRenderContext.Provider value={true}>
				<div ref={ref} data-trickroom-tooltip-portal="">
					{children}
				</div>
			</TooltipPortalRenderContext.Provider>
		);
	},
);

export const TooltipPositioner = forwardRef<
	HTMLDivElement,
	TooltipPositionerProps
>(function TooltipPositioner(props, ref) {
	const isInsideTooltipRoot = useContext(TooltipRootRenderContext);
	const isInsideTooltipPortal = useContext(TooltipPortalRenderContext);

	if (isInsideTooltipRoot && isInsideTooltipPortal) {
		return (
			<TooltipPositionerRenderContext.Provider value={true}>
				<Tooltip.Positioner {...props} ref={ref} />
			</TooltipPositionerRenderContext.Provider>
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
		<TooltipPositionerRenderContext.Provider value={true}>
			<div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />
		</TooltipPositionerRenderContext.Provider>
	);
});

export const TooltipPopup = forwardRef<HTMLDivElement, TooltipPopupProps>(
	function TooltipPopup(props, ref) {
		const isInsideTooltipRoot = useContext(TooltipRootRenderContext);
		const isInsideTooltipPositioner = useContext(
			TooltipPositionerRenderContext,
		);

		if (isInsideTooltipRoot && isInsideTooltipPositioner) {
			return <Tooltip.Popup {...props} ref={ref} />;
		}

		const { render: _render, ...divProps } = props;

		return <div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />;
	},
);

export const TooltipArrow = forwardRef<HTMLDivElement, TooltipArrowProps>(
	function TooltipArrow(props, ref) {
		const isInsideTooltipRoot = useContext(TooltipRootRenderContext);
		const isInsideTooltipPositioner = useContext(
			TooltipPositionerRenderContext,
		);

		if (isInsideTooltipRoot && isInsideTooltipPositioner) {
			return <Tooltip.Arrow {...props} ref={ref} />;
		}

		const { render: _render, ...divProps } = props;

		return <div {...(divProps as ComponentPropsWithoutRef<"div">)} ref={ref} />;
	},
);
