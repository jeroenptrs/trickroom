import { Slider } from "@base-ui/react/slider";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { renderFallback } from "./render-fallback";

type SliderRootProps = ComponentPropsWithoutRef<typeof Slider.Root>;
type SliderLabelProps = ComponentPropsWithoutRef<typeof Slider.Label>;
type SliderValueProps = ComponentPropsWithoutRef<typeof Slider.Value>;
type SliderControlProps = ComponentPropsWithoutRef<typeof Slider.Control>;
type SliderTrackProps = ComponentPropsWithoutRef<typeof Slider.Track>;
type SliderThumbProps = ComponentPropsWithoutRef<typeof Slider.Thumb>;
type SliderIndicatorProps = ComponentPropsWithoutRef<typeof Slider.Indicator>;

const SliderRootRenderContext = createContext(false);
const SliderControlRenderContext = createContext(false);

export const SliderRoot = forwardRef<HTMLDivElement, SliderRootProps>(
	function SliderRoot(props, ref) {
		return (
			<SliderRootRenderContext.Provider value={true}>
				<Slider.Root {...props} ref={ref} />
			</SliderRootRenderContext.Provider>
		);
	},
);

export const SliderLabel = forwardRef<HTMLLabelElement, SliderLabelProps>(
	function SliderLabel(props, ref) {
		const isInsideSliderRoot = useContext(SliderRootRenderContext);

		if (isInsideSliderRoot) {
			return <Slider.Label {...props} ref={ref} />;
		}

		return renderFallback("span", props, ref);
	},
);

export const SliderValue = forwardRef<HTMLOutputElement, SliderValueProps>(
	function SliderValue(props, ref) {
		const isInsideSliderRoot = useContext(SliderRootRenderContext);

		if (isInsideSliderRoot) {
			return <Slider.Value {...props} ref={ref} />;
		}

		return renderFallback("output", props, ref);
	},
);

export const SliderControl = forwardRef<HTMLDivElement, SliderControlProps>(
	function SliderControl(props, ref) {
		const isInsideSliderRoot = useContext(SliderRootRenderContext);

		if (isInsideSliderRoot) {
			return (
				<SliderControlRenderContext.Provider value={true}>
					<Slider.Control {...props} ref={ref} />
				</SliderControlRenderContext.Provider>
			);
		}

		return (
			<SliderControlRenderContext.Provider value={true}>
				{renderFallback("div", props, ref)}
			</SliderControlRenderContext.Provider>
		);
	},
);

export const SliderTrack = forwardRef<HTMLDivElement, SliderTrackProps>(
	function SliderTrack(props, ref) {
		const isInsideSliderRoot = useContext(SliderRootRenderContext);
		const isInsideSliderControl = useContext(SliderControlRenderContext);

		if (isInsideSliderRoot && isInsideSliderControl) {
			return <Slider.Track {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const SliderThumb = forwardRef<HTMLDivElement, SliderThumbProps>(
	function SliderThumb(props, ref) {
		const isInsideSliderRoot = useContext(SliderRootRenderContext);
		const isInsideSliderControl = useContext(SliderControlRenderContext);

		if (isInsideSliderRoot && isInsideSliderControl) {
			return <Slider.Thumb {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref, ["index"]);
	},
);

export const SliderIndicator = forwardRef<HTMLDivElement, SliderIndicatorProps>(
	function SliderIndicator(props, ref) {
		const isInsideSliderRoot = useContext(SliderRootRenderContext);
		const isInsideSliderControl = useContext(SliderControlRenderContext);

		if (isInsideSliderRoot && isInsideSliderControl) {
			return <Slider.Indicator {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);
