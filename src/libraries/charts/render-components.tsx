import { type ComponentProps, type ElementType, lazy, Suspense } from "react";
import { ChartBox, pickBoxProps } from "./chart-box";
import type { ChartsComponents } from "./components";

/**
 * The chart library loads through these lazy entries, so a board without a
 * chart never downloads it. The map's chunk and its topology are separate
 * again: only a board with a map fetches them.
 */
const LazyChartElement = lazy(() =>
	import("./chart-element").then((module) => ({
		default: module.ChartElement,
	})),
);

const LazyMapElement = lazy(() =>
	import("./map-element").then((module) => ({ default: module.MapElement })),
);

const loadTopology = () =>
	import("world-atlas/countries-110m.json").then((module) => module.default);

function ChartLoading({ props }: { props: Record<string, unknown> }) {
	return <ChartBox box={pickBoxProps(props)} state="loading" />;
}

function Chart(props: ComponentProps<typeof LazyChartElement>) {
	return (
		<Suspense fallback={<ChartLoading props={props} />}>
			<LazyChartElement {...props} />
		</Suspense>
	);
}

function WorldMap(
	props: Omit<ComponentProps<typeof LazyMapElement>, "loadTopology">,
) {
	return (
		<Suspense fallback={<ChartLoading props={props} />}>
			<LazyMapElement {...props} loadTopology={loadTopology} />
		</Suspense>
	);
}

export const chartsRenderComponents = {
	chart: Chart,
	map: WorldMap,
} satisfies Record<ChartsComponents, ElementType>;
