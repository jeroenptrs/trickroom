import { Select } from "@base-ui/react/select";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { useFrame } from "react-frame-component";
import { renderFallback } from "./render-fallback";

type SelectRootProps = ComponentPropsWithoutRef<typeof Select.Root>;
type SelectLabelProps = ComponentPropsWithoutRef<typeof Select.Label>;
type SelectTriggerProps = ComponentPropsWithoutRef<typeof Select.Trigger>;
type SelectValueProps = ComponentPropsWithoutRef<typeof Select.Value>;
type SelectIconProps = ComponentPropsWithoutRef<typeof Select.Icon>;
type SelectPortalProps = ComponentPropsWithoutRef<typeof Select.Portal>;
type SelectBackdropProps = ComponentPropsWithoutRef<typeof Select.Backdrop>;
type SelectPositionerProps = ComponentPropsWithoutRef<typeof Select.Positioner>;
type SelectPopupProps = ComponentPropsWithoutRef<typeof Select.Popup>;
type SelectListProps = ComponentPropsWithoutRef<typeof Select.List>;
type SelectItemProps = ComponentPropsWithoutRef<typeof Select.Item>;
type SelectItemIndicatorProps = ComponentPropsWithoutRef<
	typeof Select.ItemIndicator
>;
type SelectItemTextProps = ComponentPropsWithoutRef<typeof Select.ItemText>;
type SelectArrowProps = ComponentPropsWithoutRef<typeof Select.Arrow>;
type SelectScrollArrowProps = ComponentPropsWithoutRef<
	typeof Select.ScrollDownArrow
>;
type SelectGroupProps = ComponentPropsWithoutRef<typeof Select.Group>;
type SelectGroupLabelProps = ComponentPropsWithoutRef<typeof Select.GroupLabel>;
type SelectSeparatorProps = ComponentPropsWithoutRef<typeof Select.Separator>;

const SelectRootRenderContext = createContext(false);
const SelectPortalRenderContext = createContext(false);
const SelectPositionerRenderContext = createContext(false);
const SelectItemRenderContext = createContext(false);
const SelectGroupRenderContext = createContext(false);

export const SelectRoot = forwardRef<HTMLDivElement, SelectRootProps>(
	function SelectRoot({ children, ...props }, _ref) {
		return (
			<SelectRootRenderContext.Provider value={true}>
				<Select.Root {...props}>{children}</Select.Root>
			</SelectRootRenderContext.Provider>
		);
	},
);

export const SelectLabel = forwardRef<HTMLDivElement, SelectLabelProps>(
	function SelectLabel(props, ref) {
		const isInsideSelectRoot = useContext(SelectRootRenderContext);

		if (isInsideSelectRoot) {
			return <Select.Label {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const SelectTrigger = forwardRef<HTMLElement, SelectTriggerProps>(
	function SelectTrigger(props, ref) {
		const isInsideSelectRoot = useContext(SelectRootRenderContext);

		if (isInsideSelectRoot) {
			return <Select.Trigger {...props} ref={ref} />;
		}

		return renderFallback("button", props, ref, ["nativeButton"]);
	},
);

export const SelectValue = forwardRef<HTMLSpanElement, SelectValueProps>(
	function SelectValue(props, ref) {
		const isInsideSelectRoot = useContext(SelectRootRenderContext);

		if (isInsideSelectRoot) {
			return <Select.Value {...props} ref={ref} />;
		}

		return renderFallback("span", props, ref, ["placeholder"]);
	},
);

export const SelectIcon = forwardRef<HTMLSpanElement, SelectIconProps>(
	function SelectIcon(props, ref) {
		const isInsideSelectRoot = useContext(SelectRootRenderContext);

		if (isInsideSelectRoot) {
			return <Select.Icon {...props} ref={ref} />;
		}

		return renderFallback("span", props, ref);
	},
);

export const SelectPortal = forwardRef<HTMLDivElement, SelectPortalProps>(
	function SelectPortal({ children, ...props }, ref) {
		const isInsideSelectRoot = useContext(SelectRootRenderContext);
		const { document: frameDocument } = useFrame();

		if (isInsideSelectRoot) {
			// Base UI 1.5 dropped keepMounted on Select.Portal; strip the stale
			// persisted prop so it doesn't spread onto the portal div.
			const {
				container,
				keepMounted: _keepMounted,
				...portalProps
			} = props as SelectPortalProps & { keepMounted?: boolean };
			const resolvedContainer =
				container === undefined ? frameDocument?.body : container;

			return (
				<SelectPortalRenderContext.Provider value={true}>
					<Select.Portal
						{...portalProps}
						container={resolvedContainer}
						ref={ref}
					>
						{children}
					</Select.Portal>
				</SelectPortalRenderContext.Provider>
			);
		}

		return (
			<SelectPortalRenderContext.Provider value={true}>
				<div ref={ref} data-trickroom-select-portal="">
					{children}
				</div>
			</SelectPortalRenderContext.Provider>
		);
	},
);

export const SelectBackdrop = forwardRef<HTMLDivElement, SelectBackdropProps>(
	function SelectBackdrop(props, ref) {
		const isInsideSelectRoot = useContext(SelectRootRenderContext);

		if (isInsideSelectRoot) {
			return <Select.Backdrop {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const SelectPositioner = forwardRef<
	HTMLDivElement,
	SelectPositionerProps
>(function SelectPositioner(props, ref) {
	const isInsideSelectRoot = useContext(SelectRootRenderContext);
	const isInsideSelectPortal = useContext(SelectPortalRenderContext);

	if (isInsideSelectRoot && isInsideSelectPortal) {
		return (
			<SelectPositionerRenderContext.Provider value={true}>
				<Select.Positioner {...props} ref={ref} />
			</SelectPositionerRenderContext.Provider>
		);
	}

	return (
		<SelectPositionerRenderContext.Provider value={true}>
			{renderFallback("div", props, ref, [
				"align",
				"alignItemWithTrigger",
				"alignOffset",
				"anchor",
				"arrowPadding",
				"collisionBoundary",
				"collisionPadding",
				"collisionAvoidance",
				"hideWhenDetached",
				"positionMethod",
				"side",
				"sideOffset",
				"sticky",
			])}
		</SelectPositionerRenderContext.Provider>
	);
});

export const SelectPopup = forwardRef<HTMLDivElement, SelectPopupProps>(
	function SelectPopup(props, ref) {
		const isInsideSelectRoot = useContext(SelectRootRenderContext);
		const isInsideSelectPositioner = useContext(SelectPositionerRenderContext);

		if (isInsideSelectRoot && isInsideSelectPositioner) {
			return <Select.Popup {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref, ["finalFocus"]);
	},
);

export const SelectList = forwardRef<HTMLDivElement, SelectListProps>(
	function SelectList(props, ref) {
		const isInsideSelectRoot = useContext(SelectRootRenderContext);

		if (isInsideSelectRoot) {
			return <Select.List {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(
	function SelectItem(props, ref) {
		const isInsideSelectRoot = useContext(SelectRootRenderContext);

		if (isInsideSelectRoot) {
			return (
				<SelectItemRenderContext.Provider value={true}>
					<Select.Item {...props} ref={ref} />
				</SelectItemRenderContext.Provider>
			);
		}

		return renderFallback("div", props, ref, ["closeOnClick"]);
	},
);

export const SelectItemIndicator = forwardRef<
	HTMLSpanElement,
	SelectItemIndicatorProps
>(function SelectItemIndicator(props, ref) {
	const isInsideSelectItem = useContext(SelectItemRenderContext);

	if (isInsideSelectItem) {
		return <Select.ItemIndicator {...props} ref={ref} />;
	}

	return renderFallback("span", props, ref, ["keepMounted"]);
});

export const SelectItemText = forwardRef<HTMLSpanElement, SelectItemTextProps>(
	function SelectItemText(props, ref) {
		const isInsideSelectItem = useContext(SelectItemRenderContext);

		if (isInsideSelectItem) {
			return <Select.ItemText {...props} ref={ref} />;
		}

		return renderFallback("span", props, ref);
	},
);

export const SelectArrow = forwardRef<HTMLDivElement, SelectArrowProps>(
	function SelectArrow(props, ref) {
		const isInsideSelectRoot = useContext(SelectRootRenderContext);
		const isInsideSelectPositioner = useContext(SelectPositionerRenderContext);

		if (isInsideSelectRoot && isInsideSelectPositioner) {
			return <Select.Arrow {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const SelectScrollDownArrow = forwardRef<
	HTMLDivElement,
	SelectScrollArrowProps
>(function SelectScrollDownArrow(props, ref) {
	const isInsideSelectRoot = useContext(SelectRootRenderContext);

	if (isInsideSelectRoot) {
		return <Select.ScrollDownArrow {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref, ["keepMounted"]);
});

export const SelectScrollUpArrow = forwardRef<
	HTMLDivElement,
	SelectScrollArrowProps
>(function SelectScrollUpArrow(props, ref) {
	const isInsideSelectRoot = useContext(SelectRootRenderContext);

	if (isInsideSelectRoot) {
		return <Select.ScrollUpArrow {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref, ["keepMounted"]);
});

export const SelectGroup = forwardRef<HTMLDivElement, SelectGroupProps>(
	function SelectGroup(props, ref) {
		return (
			<SelectGroupRenderContext.Provider value={true}>
				<Select.Group {...props} ref={ref} />
			</SelectGroupRenderContext.Provider>
		);
	},
);

export const SelectGroupLabel = forwardRef<
	HTMLDivElement,
	SelectGroupLabelProps
>(function SelectGroupLabel(props, ref) {
	const isInsideSelectGroup = useContext(SelectGroupRenderContext);

	if (isInsideSelectGroup) {
		return <Select.GroupLabel {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref);
});

export const SelectSeparator = forwardRef<HTMLDivElement, SelectSeparatorProps>(
	function SelectSeparator(props, ref) {
		return <Select.Separator {...props} ref={ref} />;
	},
);
