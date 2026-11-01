import {
	type CSSProperties,
	type ReactNode,
	type Ref,
	useEffect,
	useRef,
	useState,
} from "react";

/** Carried by every chart's box; capture waits while it says `loading`. */
export const CHART_STATE_ATTRIBUTE = "data-trickroom-chart";
export type ChartPaintState = "loading" | "ready" | "error";

/** The props of a chart that belong on its box: classes and the stage's data attributes. */
export const pickBoxProps = (props: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries(props).filter(
			([key]) => key === "className" || key.startsWith("data-"),
		),
	);

const BOX_STYLE: CSSProperties = { position: "relative", overflow: "hidden" };

const MESSAGE_STYLE: CSSProperties = {
	position: "absolute",
	inset: 0,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	padding: 8,
	fontSize: 11,
	textAlign: "center",
	color: "var(--chart-axis, #6b7280)",
};

/** The element a chart fills. */
export function ChartBox({
	state,
	box,
	boxRef,
	message,
	children,
}: {
	state: ChartPaintState;
	box: Record<string, unknown>;
	boxRef?: Ref<HTMLDivElement>;
	/** Shown instead of a plot: no data, or what is wrong with the data. */
	message?: string;
	children?: ReactNode;
}) {
	return (
		<div
			{...box}
			ref={boxRef}
			style={BOX_STYLE}
			{...{ [CHART_STATE_ATTRIBUTE]: state }}
		>
			{message ? <div style={MESSAGE_STYLE}>{message}</div> : children}
		</div>
	);
}

/** The box's size in px, which the plot takes on. Null until measured. */
export function useBoxSize() {
	const ref = useRef<HTMLDivElement | null>(null);
	const [size, setSize] = useState<{ width: number; height: number } | null>(
		null,
	);
	useEffect(() => {
		const element = ref.current;
		const View = element?.ownerDocument.defaultView;
		if (!element || !View) return;
		const observer = new View.ResizeObserver(([entry]) => {
			if (!entry) return;
			const width = Math.round(entry.contentRect.width);
			const height = Math.round(entry.contentRect.height);
			setSize((current) =>
				current?.width === width && current.height === height
					? current
					: width > 0 && height > 0
						? { width, height }
						: current,
			);
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return { ref, size };
}
