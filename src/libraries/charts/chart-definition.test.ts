import {
	createChartScene,
	renderChartSvg,
	type StaticChartDefinition,
} from "@tanstack/charts";
import { describe, expect, it } from "vitest";
import { buildChartDefinition, type ChartSpec } from "./chart-definition";
import { buildMapDefinition, type CountryFeature } from "./map-definition";
import type { ChartForm, ChartTable } from "./spec";

const HOUR = 3_600_000;
const table: ChartTable = {
	columns: ["t", "a", "b"],
	rows: [
		[0, 10, 20],
		[HOUR, null, 30],
		[2 * HOUR, 30, 40],
		[3 * HOUR, 40, 10],
	],
};

const spec = (
	overrides: Partial<ChartSpec> & { form: ChartForm },
): ChartSpec => ({
	table,
	limits: [],
	markers: [],
	curve: "monotone",
	fill: "flat",
	yMax: 0,
	yPrefix: "",
	ySuffix: "",
	yAxis: true,
	partial: false,
	colors: [],
	idPrefix: "t",
	...overrides,
});

const svgOf = (chart: ChartSpec, width = 640, height = 160) =>
	renderChartSvg(
		createChartScene(
			buildChartDefinition(chart, width) as StaticChartDefinition,
			{ width, height },
		),
		{ ariaLabel: "chart", idPrefix: "t" },
	);

describe("buildChartDefinition", () => {
	it.each([
		"line",
		"area",
		"bar",
		"stacked-bar",
		"sparkline",
	] as const)("renders %s from the system's variables", (form) => {
		const svg = svgOf(spec({ form }));
		expect(svg).toContain("--chart-series-1");
		expect(svg).toContain("--chart-series-2");
		expect(svg).not.toMatch(/stroke="#|fill="#/u);
	});

	it("renders monthly bars from categories, with a lighter open period", () => {
		const svg = svgOf(
			spec({
				form: "monthly-bar",
				partial: true,
				table: {
					columns: ["month", "cost"],
					rows: [
						["Oct", 402],
						["Nov", 18],
					],
				},
			}),
		);
		expect(svg).toContain("Oct");
		expect(svg).toContain("--chart-partial");
	});

	it("draws limits as dashed 4 4 on the line, area, and bar forms", () => {
		for (const form of ["line", "area", "bar", "stacked-bar"] as const) {
			const svg = svgOf(
				spec({
					form,
					limits: [
						{ value: 90, tone: "limit" },
						{ value: 70, tone: "warning" },
					],
				}),
			);
			expect(svg).toContain("--chart-limit,");
			expect(svg).toContain("--chart-limit-warning");
			expect(svg).toContain('stroke-dasharray="4 4"');
		}
	});

	it("keeps a limit above the data inside the Y axis", () => {
		const svg = svgOf(
			spec({ form: "line", limits: [{ value: 400, tone: "limit" }] }),
		);
		expect(svg).toContain(">400<");
	});

	it("draws a flat 12% fill, or a gradient on request", () => {
		expect(svgOf(spec({ form: "area" }))).toContain('fill-opacity="0.12"');
		expect(svgOf(spec({ form: "line" }))).not.toContain('fill-opacity="0.12"');
		expect(svgOf(spec({ form: "area", fill: "gradient" }))).toContain(
			"linearGradient",
		);
	});

	it("drops the axis and the grid for a strip plot", () => {
		const svg = svgOf(spec({ form: "bar", yAxis: false, ySuffix: "%" }));
		expect(svg).not.toContain("%<");
		expect(svg).not.toContain("--chart-grid");
	});

	it("decorates the Y axis", () => {
		const svg = svgOf(spec({ form: "line", yPrefix: "€", ySuffix: " GB" }));
		expect(svg).toContain(">€40 GB<");
	});

	it("uses authored colours instead of the slots", () => {
		const svg = svgOf(spec({ form: "line", colors: ["#123456"] }));
		expect(svg).toContain("#123456");
		expect(svg).toContain("--chart-series-2");
	});

	it("draws a marker on the time axis", () => {
		const svg = svgOf(spec({ form: "bar", markers: [HOUR] }));
		expect(svg).toContain('stroke-dasharray="2 3"');
	});
});

describe("buildMapDefinition", () => {
	const square = (name: string, id: string, x: number): CountryFeature => ({
		type: "Feature",
		id,
		properties: { name },
		geometry: {
			type: "Polygon",
			coordinates: [
				[
					[x, 10],
					[x, 20],
					[x + 10, 20],
					[x + 10, 10],
					[x, 10],
				],
			],
		},
	});
	const countries = [
		square("Belgium", "056", 0),
		square("Germany", "276", 20),
		square("Antarctica", "010", 40),
	];
	const render = (overrides = {}) =>
		renderChartSvg(
			createChartScene(
				buildMapDefinition(
					{
						table: {
							columns: ["country", "value"],
							rows: [
								["Belgium", 640],
								["276", 12],
							],
						},
						points: [],
						view: "world",
						bounds: null,
						steps: [10, 50, 150, 400],
						...overrides,
					},
					countries,
					640,
				) as StaticChartDefinition,
				{ width: 640, height: 300 },
			),
			{ ariaLabel: "map", idPrefix: "m" },
		);

	it("shades countries by name or id, and leaves out Antarctica", () => {
		const svg = render();
		expect(svg).toContain("--map-5");
		expect(svg).toContain("--map-2");
		expect(svg.match(/<path/gu)?.length).toBe(2);
	});

	it("draws points on top of the land", () => {
		const svg = render({ points: [{ lon: 5, lat: 15, value: 18 }] });
		expect(svg).toContain("--map-surface");
	});
});
