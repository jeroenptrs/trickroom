import { type DomChartDefinition, defineChart } from "@tanstack/charts";
import { focusDisabled } from "@tanstack/charts/focus/disabled";
import { geoShape } from "@tanstack/charts/geo";
import { geoEqualEarth, geoMercator } from "d3-geo";
import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { MAP_LINE, MAP_SURFACE, mapStepColor } from "./colors";
import { type ChartTable, type MapPoint, type MapView, mapStep } from "./spec";

export type CountryFeature = Feature<Geometry, GeoJsonProperties>;

export type MapSpec = {
	table: ChartTable;
	points: MapPoint[];
	view: MapView;
	bounds: [number, number, number, number] | null;
	steps: number[];
};

const EUROPE_BOUNDS: [number, number, number, number] = [-11, 35, 32, 70];

const boundsShape = ([west, south, east, north]: [
	number,
	number,
	number,
	number,
]) => ({
	type: "MultiPoint" as const,
	coordinates: [
		[west, south],
		[east, south],
		[west, north],
		[east, north],
	],
});

const countryValues = (table: ChartTable) => {
	const values = new Map<string, number>();
	for (const row of table.rows) {
		if (typeof row[1] === "number") values.set(String(row[0]), row[1]);
	}
	return values;
};

/** Marks of different datum types share one list, which the overloads cannot express. */
const defineLooseChart = defineChart as unknown as (
	definition: unknown,
) => DomChartDefinition;

export const buildMapDefinition = (
	spec: MapSpec,
	countries: readonly CountryFeature[],
	width: number,
) => {
	const land = countries.filter(
		(country) => country.properties?.name !== "Antarctica",
	);
	const values = countryValues(spec.table);
	const countryValue = (country: CountryFeature) =>
		values.get(String(country.properties?.name)) ??
		values.get(String(country.id));
	const bounds = spec.bounds ?? (spec.view === "europe" ? EUROPE_BOUNDS : null);
	const projection = bounds
		? { type: geoMercator, fit: boundsShape(bounds), inset: 2 }
		: {
				type: geoEqualEarth,
				fit: { type: "FeatureCollection" as const, features: land },
				inset: 2,
			};
	const dots = spec.points.map((point) => ({
		type: "Point" as const,
		coordinates: [point.lon, point.lat],
		properties: { value: point.value },
	}));

	return defineLooseChart({
		marks: [
			geoShape(land, {
				id: "land",
				projection,
				key: (country) => String(country.id ?? country.properties?.name),
				fill: (country) =>
					mapStepColor(mapStep(countryValue(country), spec.steps)),
				stroke: MAP_LINE,
				strokeWidth: 0.5,
			}),
			...(dots.length > 0
				? [
						geoShape(dots, {
							id: "points",
							projection,
							r: width > 800 ? 4 : 3,
							fill: (dot) =>
								mapStepColor(mapStep(dot.properties.value, spec.steps)),
							stroke: MAP_SURFACE,
							strokeWidth: 1,
						}),
					]
				: []),
		],
		scales: { x: null, y: null },
		focus: focusDisabled,
		keyboard: false,
	});
};
