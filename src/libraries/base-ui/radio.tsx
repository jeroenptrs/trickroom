import { Radio } from "@base-ui/react/radio";
import { RadioGroup as BaseRadioGroup } from "@base-ui/react/radio-group";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";

type RadioGroupProps = ComponentPropsWithoutRef<typeof BaseRadioGroup>;
type RadioRootProps = ComponentPropsWithoutRef<typeof Radio.Root>;
type RadioIndicatorProps = ComponentPropsWithoutRef<typeof Radio.Indicator>;

const RadioGroupRenderContext = createContext(false);
const RadioRootRenderContext = createContext(false);

export const RadioGroup = forwardRef<HTMLDivElement, RadioGroupProps>(
	function RadioGroup(props, ref) {
		return (
			<RadioGroupRenderContext.Provider value={true}>
				<BaseRadioGroup {...props} ref={ref} />
			</RadioGroupRenderContext.Provider>
		);
	},
);

export const RadioRoot = forwardRef<HTMLSpanElement, RadioRootProps>(
	function RadioRoot(props, ref) {
		const isInsideRadioGroup = useContext(RadioGroupRenderContext);

		if (isInsideRadioGroup) {
			return (
				<RadioRootRenderContext.Provider value={true}>
					<Radio.Root {...props} ref={ref} />
				</RadioRootRenderContext.Provider>
			);
		}

		const {
			inputRef: _inputRef,
			nativeButton: _nativeButton,
			render: _render,
			...spanProps
		} = props;

		return (
			<span {...(spanProps as ComponentPropsWithoutRef<"span">)} ref={ref} />
		);
	},
);

export const RadioIndicator = forwardRef<
	HTMLSpanElement,
	RadioIndicatorProps
>(function RadioIndicator(props, ref) {
	const isInsideRadioRoot = useContext(RadioRootRenderContext);

	if (isInsideRadioRoot) {
		return <Radio.Indicator {...props} ref={ref} />;
	}

	const { keepMounted: _keepMounted, render: _render, ...spanProps } = props;

	return (
		<span {...(spanProps as ComponentPropsWithoutRef<"span">)} ref={ref} />
	);
});
