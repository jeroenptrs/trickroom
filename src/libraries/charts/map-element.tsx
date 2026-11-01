import { Chart } from "@tanstack/charts/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import { ChartBox, pickBoxProps, useBoxSize } from "./chart-box";
import { buildMapDefinition, type CountryFeature } from "./map-definition";
import {
	MAP_VIEWS,
	type MapView,
	parseChartTable,
	parseMapBounds,
	parseMapPoints,
	parseMapSteps,
} from "./spec";

/** Loads the world-atlas countries topology. The host decides where from. */
export type LoadTopology = () => Promise<unknown>;

export type MapElementProps = {
	className?: string;
	data?: string;
	points?: string;
	view?: string;
	bounds?: string;
	steps?: string;
	"aria-label"?: string;
	loadTopology: LoadTopology;
	[attribute: `data-${string}`]: unknown;
};

const readSpec = (
	props: Pick<MapElementProps, "data" | "points" | "view" | "bounds" | "steps">,
) => {
	const table = parseChartTable(props.data ?? "");
	if (!table.ok) return table;
	const points = parseMapPoints(props.points ?? "");
	if (!points.ok) return points;
	const bounds = parseMapBounds(props.bounds ?? "");
	if (!bounds.ok) return bounds;
	const steps = parseMapSteps(props.steps ?? "10 50 150 400");
	if (!steps.ok) return steps;
	return {
		ok: true as const,
		spec: {
			table: table.value,
			points: points.value,
			bounds: bounds.value,
			steps: steps.value,
			view: (MAP_VIEWS.includes(props.view as MapView)
				? props.view
				: "world") as MapView,
		},
	};
};

const toCountries = (topology: unknown): CountryFeature[] => {
	const atlas = topology as Topology;
	const collection = feature(atlas, atlas.objects.countries);
	return "features" in collection ? collection.features : [collection];
};

export function MapElement(props: MapElementProps) {
	const box = pickBoxProps(props);
	const { loadTopology } = props;
	const { ref, size } = useBoxSize();
	const width = size?.width ?? 0;
	const [countries, setCountries] = useState<CountryFeature[] | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [painted, setPainted] = useState(false);
	const onRender = useCallback(() => setPainted(true), []);

	useEffect(() => {
		let cancelled = false;
		loadTopology()
			.then((topology) => {
				if (!cancelled) setCountries(toCountries(topology));
			})
			.catch((error: unknown) => {
				if (!cancelled) {
					setLoadError(error instanceof Error ? error.message : String(error));
				}
			});
		return () => {
			cancelled = true;
		};
	}, [loadTopology]);

	const { data, points, view, bounds, steps } = props;
	const parsed = useMemo(
		() => readSpec({ data, points, view, bounds, steps }),
		[data, points, view, bounds, steps],
	);
	const definition = useMemo(
		() =>
			parsed.ok && countries
				? buildMapDefinition(parsed.spec, countries, width)
				: null,
		[parsed, countries, width],
	);

	const message = !parsed.ok ? parsed.message : loadError;
	if (message) {
		return <ChartBox boxRef={ref} box={box} state="error" message={message} />;
	}
	return (
		<ChartBox boxRef={ref} box={box} state={painted ? "ready" : "loading"}>
			{definition && size ? (
				<Chart
					ariaLabel={props["aria-label"] || "World map"}
					definition={definition}
					height={size.height}
					onRender={onRender}
				/>
			) : null}
		</ChartBox>
	);
}
