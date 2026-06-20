import { Progress } from "@base-ui/react/progress";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { renderFallback } from "./render-fallback";

type ProgressRootProps = ComponentPropsWithoutRef<typeof Progress.Root>;
type ProgressLabelProps = ComponentPropsWithoutRef<typeof Progress.Label>;
type ProgressTrackProps = ComponentPropsWithoutRef<typeof Progress.Track>;
type ProgressIndicatorProps = ComponentPropsWithoutRef<
	typeof Progress.Indicator
>;
type ProgressValueProps = ComponentPropsWithoutRef<typeof Progress.Value>;

const ProgressRootRenderContext = createContext(false);

export const ProgressRoot = forwardRef<HTMLDivElement, ProgressRootProps>(
	function ProgressRoot(props, ref) {
		return (
			<ProgressRootRenderContext.Provider value={true}>
				<Progress.Root {...props} ref={ref} />
			</ProgressRootRenderContext.Provider>
		);
	},
);

export const ProgressLabel = forwardRef<HTMLSpanElement, ProgressLabelProps>(
	function ProgressLabel(props, ref) {
		const isInsideProgressRoot = useContext(ProgressRootRenderContext);

		if (isInsideProgressRoot) {
			return <Progress.Label {...props} ref={ref} />;
		}

		return renderFallback("span", props, ref);
	},
);

export const ProgressTrack = forwardRef<HTMLDivElement, ProgressTrackProps>(
	function ProgressTrack(props, ref) {
		const isInsideProgressRoot = useContext(ProgressRootRenderContext);

		if (isInsideProgressRoot) {
			return <Progress.Track {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const ProgressIndicator = forwardRef<
	HTMLDivElement,
	ProgressIndicatorProps
>(function ProgressIndicator(props, ref) {
	const isInsideProgressRoot = useContext(ProgressRootRenderContext);

	if (isInsideProgressRoot) {
		return <Progress.Indicator {...props} ref={ref} />;
	}

	return renderFallback("div", props, ref);
});

export const ProgressValue = forwardRef<HTMLSpanElement, ProgressValueProps>(
	function ProgressValue(props, ref) {
		const isInsideProgressRoot = useContext(ProgressRootRenderContext);

		if (isInsideProgressRoot) {
			return <Progress.Value {...props} ref={ref} />;
		}

		return renderFallback("span", props, ref);
	},
);
