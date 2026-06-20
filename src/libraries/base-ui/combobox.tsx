import { Combobox } from "@base-ui/react/combobox";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { useFrame } from "react-frame-component";
import { renderFallback } from "./render-fallback";

type ComboboxRootProps = ComponentPropsWithoutRef<typeof Combobox.Root>;
type ComboboxLabelProps = ComponentPropsWithoutRef<typeof Combobox.Label>;
type ComboboxValueProps = ComponentPropsWithoutRef<typeof Combobox.Value>;
type ComboboxInputProps = ComponentPropsWithoutRef<typeof Combobox.Input>;
type ComboboxInputGroupProps = ComponentPropsWithoutRef<
	typeof Combobox.InputGroup
>;
type ComboboxTriggerProps = ComponentPropsWithoutRef<typeof Combobox.Trigger>;
type ComboboxListProps = ComponentPropsWithoutRef<typeof Combobox.List>;
type ComboboxStatusProps = ComponentPropsWithoutRef<typeof Combobox.Status>;
type ComboboxPortalProps = ComponentPropsWithoutRef<typeof Combobox.Portal>;
type ComboboxBackdropProps = ComponentPropsWithoutRef<typeof Combobox.Backdrop>;
type ComboboxPositionerProps = ComponentPropsWithoutRef<
	typeof Combobox.Positioner
>;
type ComboboxPopupProps = ComponentPropsWithoutRef<typeof Combobox.Popup>;
type ComboboxArrowProps = ComponentPropsWithoutRef<typeof Combobox.Arrow>;
type ComboboxIconProps = ComponentPropsWithoutRef<typeof Combobox.Icon>;
type ComboboxGroupProps = ComponentPropsWithoutRef<typeof Combobox.Group>;
type ComboboxGroupLabelProps = ComponentPropsWithoutRef<
	typeof Combobox.GroupLabel
>;
type ComboboxItemProps = ComponentPropsWithoutRef<typeof Combobox.Item>;
type ComboboxItemIndicatorProps = ComponentPropsWithoutRef<
	typeof Combobox.ItemIndicator
>;
type ComboboxChipsProps = ComponentPropsWithoutRef<typeof Combobox.Chips>;
type ComboboxChipProps = ComponentPropsWithoutRef<typeof Combobox.Chip>;
type ComboboxChipRemoveProps = ComponentPropsWithoutRef<
	typeof Combobox.ChipRemove
>;
type ComboboxRowProps = ComponentPropsWithoutRef<typeof Combobox.Row>;
type ComboboxEmptyProps = ComponentPropsWithoutRef<typeof Combobox.Empty>;
type ComboboxClearProps = ComponentPropsWithoutRef<typeof Combobox.Clear>;
type ComboboxSeparatorProps = ComponentPropsWithoutRef<
	typeof Combobox.Separator
>;

const ComboboxRootRenderContext = createContext(false);
const ComboboxPortalRenderContext = createContext(false);
const ComboboxPositionerRenderContext = createContext(false);
const ComboboxItemRenderContext = createContext(false);
const ComboboxGroupRenderContext = createContext(false);
const ComboboxChipsRenderContext = createContext(false);
const ComboboxChipRenderContext = createContext(false);

export const ComboboxRoot = forwardRef<HTMLDivElement, ComboboxRootProps>(
	function ComboboxRoot({ children, ...props }, _ref) {
		return (
			<ComboboxRootRenderContext.Provider value={true}>
				<Combobox.Root {...props}>{children}</Combobox.Root>
			</ComboboxRootRenderContext.Provider>
		);
	},
);

export const ComboboxLabel = forwardRef<HTMLDivElement, ComboboxLabelProps>(
	function ComboboxLabel(props, ref) {
		const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);

		if (isInsideComboboxRoot) {
			return <Combobox.Label {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const ComboboxValue = forwardRef<HTMLSpanElement, ComboboxValueProps>(
	function ComboboxValue(props, ref) {
		const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);

		if (isInsideComboboxRoot) {
			return <Combobox.Value {...props} ref={ref} />;
		}

		return renderFallback("span", props, ref);
	},
);

export const ComboboxInput = forwardRef<HTMLInputElement, ComboboxInputProps>(
	function ComboboxInput(props, ref) {
		const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);

		if (isInsideComboboxRoot) {
			return <Combobox.Input {...props} ref={ref} />;
		}

		return renderFallback("input", props, ref);
	},
);

export const ComboboxInputGroup = forwardRef<
	HTMLDivElement,
	ComboboxInputGroupProps
>(function ComboboxInputGroup(props, ref) {
	const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);

	if (isInsideComboboxRoot) {
		return <Combobox.InputGroup {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref);
});

export const ComboboxTrigger = forwardRef<HTMLElement, ComboboxTriggerProps>(
	function ComboboxTrigger(props, ref) {
		const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);

		if (isInsideComboboxRoot) {
			return <Combobox.Trigger {...props} ref={ref} />;
		}

		return renderFallback("button", props, ref, ["nativeButton"]);
	},
);

export const ComboboxList = forwardRef<HTMLDivElement, ComboboxListProps>(
	function ComboboxList(props, ref) {
		const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);

		if (isInsideComboboxRoot) {
			return <Combobox.List {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const ComboboxStatus = forwardRef<HTMLDivElement, ComboboxStatusProps>(
	function ComboboxStatus(props, ref) {
		return <Combobox.Status {...props} ref={ref} />;
	},
);

export const ComboboxPortal = forwardRef<HTMLDivElement, ComboboxPortalProps>(
	function ComboboxPortal({ children, ...props }, ref) {
		const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);
		const { document: frameDocument } = useFrame();

		if (isInsideComboboxRoot) {
			const { container, ...portalProps } = props;
			const resolvedContainer =
				container === undefined ? frameDocument?.body : container;

			return (
				<ComboboxPortalRenderContext.Provider value={true}>
					<Combobox.Portal
						{...portalProps}
						container={resolvedContainer}
						ref={ref}
					>
						{children}
					</Combobox.Portal>
				</ComboboxPortalRenderContext.Provider>
			);
		}

		return (
			<ComboboxPortalRenderContext.Provider value={true}>
				<div ref={ref} data-trickroom-combobox-portal="">
					{children}
				</div>
			</ComboboxPortalRenderContext.Provider>
		);
	},
);

export const ComboboxBackdrop = forwardRef<
	HTMLDivElement,
	ComboboxBackdropProps
>(function ComboboxBackdrop(props, ref) {
	const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);

	if (isInsideComboboxRoot) {
		return <Combobox.Backdrop {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref);
});

export const ComboboxPositioner = forwardRef<
	HTMLDivElement,
	ComboboxPositionerProps
>(function ComboboxPositioner(props, ref) {
	const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);
	const isInsideComboboxPortal = useContext(ComboboxPortalRenderContext);

	if (isInsideComboboxRoot && isInsideComboboxPortal) {
		return (
			<ComboboxPositionerRenderContext.Provider value={true}>
				<Combobox.Positioner {...props} ref={ref} />
			</ComboboxPositionerRenderContext.Provider>
		);
	}

	return (
		<ComboboxPositionerRenderContext.Provider value={true}>
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
		</ComboboxPositionerRenderContext.Provider>
	);
});

export const ComboboxPopup = forwardRef<HTMLDivElement, ComboboxPopupProps>(
	function ComboboxPopup(props, ref) {
		const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);
		const isInsideComboboxPositioner = useContext(
			ComboboxPositionerRenderContext,
		);

		if (isInsideComboboxRoot && isInsideComboboxPositioner) {
			return <Combobox.Popup {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref, ["finalFocus"]);
	},
);

export const ComboboxArrow = forwardRef<HTMLDivElement, ComboboxArrowProps>(
	function ComboboxArrow(props, ref) {
		const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);
		const isInsideComboboxPositioner = useContext(
			ComboboxPositionerRenderContext,
		);

		if (isInsideComboboxRoot && isInsideComboboxPositioner) {
			return <Combobox.Arrow {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const ComboboxIcon = forwardRef<HTMLSpanElement, ComboboxIconProps>(
	function ComboboxIcon(props, ref) {
		return <Combobox.Icon {...props} ref={ref} />;
	},
);

export const ComboboxGroup = forwardRef<HTMLDivElement, ComboboxGroupProps>(
	function ComboboxGroup(props, ref) {
		return (
			<ComboboxGroupRenderContext.Provider value={true}>
				<Combobox.Group {...props} ref={ref} />
			</ComboboxGroupRenderContext.Provider>
		);
	},
);

export const ComboboxGroupLabel = forwardRef<
	HTMLDivElement,
	ComboboxGroupLabelProps
>(function ComboboxGroupLabel(props, ref) {
	const isInsideComboboxGroup = useContext(ComboboxGroupRenderContext);

	if (isInsideComboboxGroup) {
		return <Combobox.GroupLabel {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref);
});

export const ComboboxItem = forwardRef<HTMLDivElement, ComboboxItemProps>(
	function ComboboxItem(props, ref) {
		const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);

		if (isInsideComboboxRoot) {
			return (
				<ComboboxItemRenderContext.Provider value={true}>
					<Combobox.Item {...props} ref={ref} />
				</ComboboxItemRenderContext.Provider>
			);
		}

		return renderFallback("div", props, ref);
	},
);

export const ComboboxItemIndicator = forwardRef<
	HTMLSpanElement,
	ComboboxItemIndicatorProps
>(function ComboboxItemIndicator(props, ref) {
	const isInsideComboboxItem = useContext(ComboboxItemRenderContext);

	if (isInsideComboboxItem) {
		return <Combobox.ItemIndicator {...props} ref={ref} />;
	}

	return renderFallback("span", props, ref, ["keepMounted"]);
});

export const ComboboxChips = forwardRef<HTMLDivElement, ComboboxChipsProps>(
	function ComboboxChips(props, ref) {
		const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);

		if (isInsideComboboxRoot) {
			return (
				<ComboboxChipsRenderContext.Provider value={true}>
					<Combobox.Chips {...props} ref={ref} />
				</ComboboxChipsRenderContext.Provider>
			);
		}

		return renderFallback("div", props, ref);
	},
);

export const ComboboxChip = forwardRef<HTMLDivElement, ComboboxChipProps>(
	function ComboboxChip(props, ref) {
		const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);
		const isInsideComboboxChips = useContext(ComboboxChipsRenderContext);

		if (isInsideComboboxRoot && isInsideComboboxChips) {
			return (
				<ComboboxChipRenderContext.Provider value={true}>
					<Combobox.Chip {...props} ref={ref} />
				</ComboboxChipRenderContext.Provider>
			);
		}

		return renderFallback("div", props, ref);
	},
);

export const ComboboxChipRemove = forwardRef<
	HTMLButtonElement,
	ComboboxChipRemoveProps
>(function ComboboxChipRemove(props, ref) {
	const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);
	const isInsideComboboxChip = useContext(ComboboxChipRenderContext);

	if (isInsideComboboxRoot && isInsideComboboxChip) {
		return <Combobox.ChipRemove {...props} ref={ref} />;
	}

	return renderFallback("button", props, ref, ["nativeButton"]);
});

export const ComboboxRow = forwardRef<HTMLDivElement, ComboboxRowProps>(
	function ComboboxRow(props, ref) {
		return <Combobox.Row {...props} ref={ref} />;
	},
);

export const ComboboxEmpty = forwardRef<HTMLDivElement, ComboboxEmptyProps>(
	function ComboboxEmpty(props, ref) {
		const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);

		if (isInsideComboboxRoot) {
			return <Combobox.Empty {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const ComboboxClear = forwardRef<HTMLButtonElement, ComboboxClearProps>(
	function ComboboxClear(props, ref) {
		const isInsideComboboxRoot = useContext(ComboboxRootRenderContext);

		if (isInsideComboboxRoot) {
			return <Combobox.Clear {...props} ref={ref} />;
		}

		return renderFallback("button", props, ref, ["nativeButton"]);
	},
);

export const ComboboxSeparator = forwardRef<
	HTMLDivElement,
	ComboboxSeparatorProps
>(function ComboboxSeparator(props, ref) {
	return <Combobox.Separator {...props} ref={ref} />;
});
