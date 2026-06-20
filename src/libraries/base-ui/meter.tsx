import { Meter } from "@base-ui/react/meter";
import {
	type ComponentPropsWithoutRef,
	createContext,
	forwardRef,
	useContext,
} from "react";
import { renderFallback } from "./render-fallback";

type MeterRootProps = ComponentPropsWithoutRef<typeof Meter.Root>;
type MeterLabelProps = ComponentPropsWithoutRef<typeof Meter.Label>;
type MeterTrackProps = ComponentPropsWithoutRef<typeof Meter.Track>;
type MeterIndicatorProps = ComponentPropsWithoutRef<typeof Meter.Indicator>;
type MeterValueProps = ComponentPropsWithoutRef<typeof Meter.Value>;

const MeterRootRenderContext = createContext(false);

export const MeterRoot = forwardRef<HTMLDivElement, MeterRootProps>(
	function MeterRoot(props, ref) {
		return (
			<MeterRootRenderContext.Provider value={true}>
				<Meter.Root {...props} ref={ref} />
			</MeterRootRenderContext.Provider>
		);
	},
);

export const MeterLabel = forwardRef<HTMLDivElement, MeterLabelProps>(
	function MeterLabel(props, ref) {
		const isInsideMeterRoot = useContext(MeterRootRenderContext);

		if (isInsideMeterRoot) {
			return <Meter.Label {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const MeterTrack = forwardRef<HTMLDivElement, MeterTrackProps>(
	function MeterTrack(props, ref) {
		return <Meter.Track {...props} ref={ref} />;
	},
);

export const MeterIndicator = forwardRef<HTMLDivElement, MeterIndicatorProps>(
	function MeterIndicator(props, ref) {
		const isInsideMeterRoot = useContext(MeterRootRenderContext);

		if (isInsideMeterRoot) {
			return <Meter.Indicator {...props} ref={ref} />;
		}

		return renderFallback("div", props, ref);
	},
);

export const MeterValue = forwardRef<HTMLOutputElement, MeterValueProps>(
	function MeterValue(props, ref) {
		const isInsideMeterRoot = useContext(MeterRootRenderContext);

		if (isInsideMeterRoot) {
			return <Meter.Value {...props} ref={ref} />;
		}

		return renderFallback("output", props, ref);
	},
);
