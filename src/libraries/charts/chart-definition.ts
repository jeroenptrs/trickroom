import {
	areaY,
	barY,
	type DomChartDefinition,
	defineChart,
	lineY,
	rect,
	ruleX,
	ruleY,
} from "@tanstack/charts";
import { d3Curve } from "@tanstack/charts/d3/shape";
import { focusDisabled } from "@tanstack/charts/focus/disabled";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scaleTime } from "d3-scale";
import { curveLinear, curveMonotoneX } from "d3-shape";
import {
	CHART_AXIS,
	CHART_GRID,
	CHART_LIMIT,
	CHART_LIMIT_WARNING,
	CHART_PARTIAL,
	CHART_SURFACE,
	chartSeriesColor,
} from "./colors";
import {
	type ChartCell,
	type ChartCurve,
	type ChartFill,
	type ChartForm,
	type ChartLimit,
	type ChartTable,
	cellTime,
	roundTicks,
	timeTickFormatter,
} from "./spec";

export type ChartSpec = {
	form: ChartForm;
	table: ChartTable;
	limits: ChartLimit[];
	markers: ChartCell[];
	curve: ChartCurve;
	fill: ChartFill;
	yMax: number;
	yPrefix: string;
	ySuffix: string;
	yAxis: boolean;
	partial: boolean;
	colors: string[];
	/** Prefix for ids inside the SVG, unique per chart in a document. */
	idPrefix: string;
};

const AXIS_FONT_SIZE = 11;
const LINE_WIDTH = 2;
const SPARKLINE_WIDTH = 1.5;
const FLAT_FILL_OPACITY = 0.12;
const MAX_BAR_PX = 32;
const BAR_FRACTION = 0.8;

type Row = { x: ChartCell; time: number; values: (number | null)[] };

type Series = { name: string; index: number; color: string };

/** Marks of different datum types share one list, which the overloads cannot express. */
const defineLooseChart = defineChart as unknown as (
	definition: unknown,
) => DomChartDefinition;

const axisChrome = {
	line: false,
	tickLabels: { fontSize: AXIS_FONT_SIZE },
} as const;

const theme = {
	foreground: CHART_AXIS,
	muted: CHART_AXIS,
	grid: CHART_GRID,
};

const median = (values: number[]): number => {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
};

const readRows = (table: ChartTable): Row[] =>
	table.rows.map((row) => ({
		x: row[0],
		time: cellTime(row[0]) ?? 0,
		values: row
			.slice(1)
			.map((cell) => (typeof cell === "number" ? cell : null)),
	}));

const readSeries = (spec: ChartSpec): Series[] =>
	spec.table.columns.slice(1).map((name, index) => ({
		name,
		index,
		color: spec.colors[index] ?? chartSeriesColor(index),
	}));

const peakOf = (rows: Row[], stacked: boolean): number => {
	let peak = 0;
	for (const row of rows) {
		let total = 0;
		for (const value of row.values) {
			if (value === null) continue;
			peak = Math.max(peak, value);
			total += Math.max(0, value);
		}
		if (stacked) peak = Math.max(peak, total);
	}
	return peak;
};

const formatValue = (spec: ChartSpec) => (value: number) =>
	`${spec.yPrefix}${value}${spec.ySuffix}`;

const yScaleConfig = (spec: ChartSpec, rows: Row[]) => {
	const peak = peakOf(rows, spec.form === "stacked-bar");
	const limit = spec.limits.reduce((top, l) => Math.max(top, l.value), 0);
	const ticks =
		spec.yMax > 0
			? roundTicks(spec.yMax).filter((tick) => tick <= spec.yMax)
			: roundTicks(Math.max(peak, limit) * 1.05);
	const top = spec.yMax > 0 ? spec.yMax : (ticks.at(-1) ?? 1);
	const scale = scaleLinear().domain([0, top]);
	return spec.yAxis
		? {
				scale,
				grid: { stroke: CHART_GRID, strokeOpacity: 1 },
				axis: {
					...axisChrome,
					ticks: { size: 0, values: ticks, format: formatValue(spec) },
				},
			}
		: { scale, axis: false as const };
};

const referenceMarks = (spec: ChartSpec) =>
	spec.limits.map((limit, index) =>
		ruleY([limit.value], {
			id: `limit-${index}`,
			stroke: limit.tone === "warning" ? CHART_LIMIT_WARNING : CHART_LIMIT,
			strokeDasharray: "4 4",
			strokeWidth: 1.5,
		}),
	);

const markerMarks = (spec: ChartSpec, toX: (cell: ChartCell) => Date) =>
	spec.markers.length === 0
		? []
		: [
				ruleX(spec.markers.map(toX), {
					id: "markers",
					stroke: CHART_AXIS,
					strokeDasharray: "2 3",
					strokeWidth: 1,
				}),
			];

const timeDomain = (rows: Row[], pad: number): [Date, Date] => {
	const times = rows.map((row) => row.time);
	return [
		new Date(Math.min(...times) - pad),
		new Date(Math.max(...times) + pad),
	];
};

const timeAxis = (rows: Row[], pad: number) => {
	const domain = timeDomain(rows, pad);
	const format = timeTickFormatter(+domain[1] - +domain[0] - 2 * pad);
	return {
		scale: scaleTime().domain(domain),
		axis: { ...axisChrome, ticks: { size: 0, format } },
	};
};

const lineMarks = (spec: ChartSpec, rows: Row[], width: number) => {
	const curve = d3Curve(spec.curve === "linear" ? curveLinear : curveMonotoneX);
	const x = (row: Row) => new Date(row.time);
	return readSeries(spec).flatMap((series) => {
		const y = (row: Row) => row.values[series.index];
		const gradientId = `${spec.idPrefix}-fill-${series.index}`;
		const area =
			spec.form === "area"
				? [
						areaY(rows, {
							id: `fill-${series.index}`,
							x,
							y,
							curve,
							fill:
								spec.fill === "gradient" ? `url(#${gradientId})` : series.color,
							fillOpacity: spec.fill === "gradient" ? 1 : FLAT_FILL_OPACITY,
						}),
					]
				: [];
		return [
			...area,
			lineY(rows, {
				id: `line-${series.index}`,
				x,
				y,
				curve,
				stroke: series.color,
				strokeWidth: width,
			}),
		];
	});
};

const gradients = (spec: ChartSpec) =>
	spec.form === "area" && spec.fill === "gradient"
		? readSeries(spec).map((series) => ({
				id: `${spec.idPrefix}-fill-${series.index}`,
				x1: 0,
				y1: 0,
				x2: 0,
				y2: 1,
				stops: [
					{ offset: 0, color: series.color, opacity: 0.35 },
					{ offset: 1, color: series.color, opacity: 0.05 },
				],
			}))
		: [];

type Segment = {
	time: number;
	series: number;
	y1: number;
	y2: number;
	top: boolean;
};

/**
 * Bars as explicit intervals: 80% of the median gap, capped at 32px for the
 * plot's width. The chart library's own width follows the smallest gap, which
 * turns irregular samples into hairlines.
 */
const barMarks = (
	spec: ChartSpec,
	rows: Row[],
	step: number,
	domainMs: number,
	plotWidth: number,
) => {
	const maxWidth =
		plotWidth > 0
			? (MAX_BAR_PX * domainMs) / plotWidth
			: Number.POSITIVE_INFINITY;
	const half = Math.min(step * BAR_FRACTION, maxWidth) / 2;
	const stacked = spec.form === "stacked-bar";
	const series = readSeries(spec);
	const slot = stacked ? 1 : series.length;
	const slotWidth = (half * 2) / slot;
	const segments: Segment[] = [];
	for (const row of rows) {
		let base = 0;
		let last: Segment | null = null;
		for (const { index } of series) {
			const value = row.values[index];
			if (value === null || value <= 0) continue;
			const segment = {
				time: row.time,
				series: index,
				y1: stacked ? base : 0,
				y2: (stacked ? base : 0) + value,
				top: !stacked,
			};
			segments.push(segment);
			if (stacked) {
				base += value;
				last = segment;
			}
		}
		if (last) last.top = true;
	}
	return series.map((entry) => {
		const offset = stacked ? 0 : entry.index * slotWidth;
		return rect(
			segments.filter((segment) => segment.series === entry.index),
			{
				id: `bar-${entry.index}`,
				x1: (segment: Segment) => new Date(segment.time - half + offset),
				x2: (segment: Segment) =>
					new Date(segment.time - half + offset + slotWidth),
				y1: "y1",
				y2: "y2",
				fill: entry.color,
				inset: 0,
				radius: (segment: Segment) => (segment.top ? [2, 2, 0, 0] : 0),
				...(stacked ? { stroke: CHART_SURFACE, strokeWidth: 1 } : {}),
			},
		);
	});
};

const monthlyLabel = (cell: ChartCell): string => {
	const time = typeof cell === "number" ? cell : null;
	return time === null
		? String(cell ?? "")
		: new Intl.DateTimeFormat("en-GB", { month: "short" }).format(time);
};

const monthlyDefinition = (spec: ChartSpec, rows: Row[]) => {
	const last = rows.length - 1;
	const color = spec.colors[0] ?? chartSeriesColor(0);
	const data = rows.map((row, index) => ({
		label: monthlyLabel(row.x),
		value: row.values[0] ?? 0,
		partial: spec.partial && index === last,
	}));
	return defineLooseChart({
		marks: [
			barY(data, {
				x: "label",
				y: "value",
				fill: (row) => (row.partial ? CHART_PARTIAL : color),
				maxThickness: MAX_BAR_PX,
				radius: { end: 4 },
			}),
			...referenceMarks(spec),
		],
		scales: {
			x: {
				scale: () => scaleBand<string>().padding(0.3),
				axis: { ...axisChrome, ticks: { size: 0 } },
			},
			y: yScaleConfig(spec, rows),
		},
		theme,
		focus: focusDisabled,
		keyboard: false,
	});
};

const sparklineDefinition = (spec: ChartSpec, rows: Row[]) =>
	defineLooseChart({
		marks: lineMarks(spec, rows, SPARKLINE_WIDTH),
		scales: {
			x: { scale: scaleTime().domain(timeDomain(rows, 0)), axis: false },
			y: {
				scale: scaleLinear().domain([0, peakOf(rows, false) || 1]),
				axis: false,
			},
		},
		margin: 2,
		focus: focusDisabled,
		keyboard: false,
	});

/**
 * Turns the stored props into a chart definition. `plotWidth` is the box width
 * in px, for the bar cap; 0 until the box has been measured.
 */
export const buildChartDefinition = (spec: ChartSpec, plotWidth: number) => {
	const rows = readRows(spec.table);
	if (spec.form === "monthly-bar") return monthlyDefinition(spec, rows);
	if (spec.form === "sparkline") return sparklineDefinition(spec, rows);

	const isBars = spec.form === "bar" || spec.form === "stacked-bar";
	const gaps = rows
		.slice(1)
		.map((row, index) => row.time - rows[index].time)
		.filter((gap) => gap > 0);
	const step = median(gaps) || 60_000;
	const pad = isBars ? step / 2 : 0;
	const x = timeAxis(rows, pad);
	const [from, to] = timeDomain(rows, pad);
	const toX = (cell: ChartCell) => new Date(cellTime(cell) ?? 0);

	return defineLooseChart({
		gradients: gradients(spec),
		marks: [
			...(isBars
				? barMarks(spec, rows, step, +to - +from, plotWidth)
				: lineMarks(spec, rows, LINE_WIDTH)),
			...referenceMarks(spec),
			...markerMarks(spec, toX),
		],
		scales: { x, y: yScaleConfig(spec, rows) },
		theme,
		focus: focusDisabled,
		keyboard: false,
	});
};
