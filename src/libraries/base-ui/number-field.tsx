import { NumberField } from "@base-ui/react/number-field";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { renderFallback } from "./render-fallback";

type NumberFieldRootProps = ComponentPropsWithoutRef<typeof NumberField.Root>;
type NumberFieldGroupProps = ComponentPropsWithoutRef<typeof NumberField.Group>;
type NumberFieldDecrementProps = ComponentPropsWithoutRef<
	typeof NumberField.Decrement
>;
type NumberFieldInputProps = ComponentPropsWithoutRef<typeof NumberField.Input>;
type NumberFieldIncrementProps = ComponentPropsWithoutRef<
	typeof NumberField.Increment
>;
type NumberFieldScrubAreaProps = ComponentPropsWithoutRef<
	typeof NumberField.ScrubArea
>;
type NumberFieldScrubAreaCursorProps = ComponentPropsWithoutRef<
	typeof NumberField.ScrubAreaCursor
>;

const NumberFieldRootRenderContext = createContext(false);
const NumberFieldScrubAreaRenderContext = createContext(false);

export const NumberFieldRoot = forwardRef<HTMLDivElement, NumberFieldRootProps>(
	function NumberFieldRoot(props, ref) {
		return (
			<NumberFieldRootRenderContext.Provider value={true}>
				<NumberField.Root {...props} ref={ref} />
			</NumberFieldRootRenderContext.Provider>
		);
	},
);

export const NumberFieldGroup = forwardRef<
	HTMLDivElement,
	NumberFieldGroupProps
>(function NumberFieldGroup(props, ref) {
	const isInsideNumberFieldRoot = useContext(NumberFieldRootRenderContext);

	if (isInsideNumberFieldRoot) {
		return <NumberField.Group {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref);
});

export const NumberFieldDecrement = forwardRef<
	HTMLButtonElement,
	NumberFieldDecrementProps
>(function NumberFieldDecrement(props, ref) {
	const isInsideNumberFieldRoot = useContext(NumberFieldRootRenderContext);

	if (isInsideNumberFieldRoot) {
		return <NumberField.Decrement {...props} ref={ref} />;
	}

	return renderFallback("button", props, ref, ["nativeButton"]);
});

export const NumberFieldInput = forwardRef<
	HTMLInputElement,
	NumberFieldInputProps
>(function NumberFieldInput(props, ref) {
	const isInsideNumberFieldRoot = useContext(NumberFieldRootRenderContext);

	if (isInsideNumberFieldRoot) {
		return <NumberField.Input {...props} ref={ref} />;
	}

	return renderFallback("input", props, ref);
});

export const NumberFieldIncrement = forwardRef<
	HTMLButtonElement,
	NumberFieldIncrementProps
>(function NumberFieldIncrement(props, ref) {
	const isInsideNumberFieldRoot = useContext(NumberFieldRootRenderContext);

	if (isInsideNumberFieldRoot) {
		return <NumberField.Increment {...props} ref={ref} />;
	}

	return renderFallback("button", props, ref, ["nativeButton"]);
});

export const NumberFieldScrubArea = forwardRef<
	HTMLSpanElement,
	NumberFieldScrubAreaProps
>(function NumberFieldScrubArea(props, ref) {
	const isInsideNumberFieldRoot = useContext(NumberFieldRootRenderContext);

	if (isInsideNumberFieldRoot) {
		return (
			<NumberFieldScrubAreaRenderContext.Provider value={true}>
				<NumberField.ScrubArea {...props} ref={ref} />
			</NumberFieldScrubAreaRenderContext.Provider>
		);
	}

	return renderFallback("span", props, ref, [
		"direction",
		"pixelSensitivity",
		"teleportDistance",
	]);
});

export const NumberFieldScrubAreaCursor = forwardRef<
	HTMLSpanElement,
	NumberFieldScrubAreaCursorProps
>(function NumberFieldScrubAreaCursor(props, ref) {
	const isInsideNumberFieldScrubArea = useContext(
		NumberFieldScrubAreaRenderContext,
	);

	if (isInsideNumberFieldScrubArea) {
		return <NumberField.ScrubAreaCursor {...props} ref={ref} />;
	}

	return renderFallback("span", props, ref);
});
