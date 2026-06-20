import { Checkbox } from "@base-ui/react/checkbox";
import { CheckboxGroup as BaseCheckboxGroup } from "@base-ui/react/checkbox-group";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { renderFallback } from "./render-fallback";

type CheckboxRootProps = ComponentPropsWithoutRef<typeof Checkbox.Root>;
type CheckboxIndicatorProps = ComponentPropsWithoutRef<
	typeof Checkbox.Indicator
>;
type CheckboxGroupProps = ComponentPropsWithoutRef<typeof BaseCheckboxGroup>;

const CheckboxRootRenderContext = createContext(false);

export const CheckboxRoot = forwardRef<HTMLSpanElement, CheckboxRootProps>(
	function CheckboxRoot(props, ref) {
		return (
			<CheckboxRootRenderContext.Provider value={true}>
				<Checkbox.Root {...props} ref={ref} />
			</CheckboxRootRenderContext.Provider>
		);
	},
);

export const CheckboxIndicator = forwardRef<
	HTMLSpanElement,
	CheckboxIndicatorProps
>(function CheckboxIndicator(props, ref) {
	const isInsideCheckboxRoot = useContext(CheckboxRootRenderContext);

	if (isInsideCheckboxRoot) {
		return <Checkbox.Indicator {...props} ref={ref} />;
	}

	return renderFallback("span", props, ref, ["keepMounted"]);
});

export const CheckboxGroup = forwardRef<HTMLDivElement, CheckboxGroupProps>(
	function CheckboxGroup(props, ref) {
		return <BaseCheckboxGroup {...props} ref={ref} />;
	},
);
