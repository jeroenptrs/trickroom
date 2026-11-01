/**
 * Chart props as a board stores them, and the pure parsing of those props.
 *
 * Element props are JSON primitives, so a chart keeps its rows in a JSON string
 * prop (`data`) and its reference lines in their own props. Everything here is
 * free of React and of the chart library, because the MCP server validates
 * these strings without loading either. Documented in docs/design-model.md.
 */

export const CHART_FORMS = [
	"line",
	"area",
	"bar",
	"stacked-bar",
	"monthly-bar",
	"sparkline",
] as const;
export type ChartForm = (typeof CHART_FORMS)[number];

export const CHART_CURVES = ["monotone", "linear"] as const;
export type ChartCurve = (typeof CHART_CURVES)[number];

export const CHART_FILLS = ["flat", "gradient"] as const;
export type ChartFill = (typeof CHART_FILLS)[number];

export const MAP_VIEWS = ["world", "europe"] as const;
export type MapView = (typeof MAP_VIEWS)[number];

export type ChartCell = number | string | null;

/** Rows of a chart: the first column is the x value, the rest are series. */
export type ChartTable = {
	columns: string[];
	rows: ChartCell[][];
};

export type ChartLimit = { value: number; tone: "limit" | "warning" };

export type ParseResult<T> =
	| { ok: true; value: T }
	| { ok: false; message: string };

const failure = (message: string): ParseResult<never> => ({
	ok: false,
	message,
});

const isCell = (value: unknown): value is ChartCell =>
	value === null ||
	typeof value === "string" ||
	(typeof value === "number" && Number.isFinite(value));

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (raw: string, prop: string): ParseResult<unknown> => {
	try {
		return { ok: true, value: JSON.parse(raw) };
	} catch (error) {
		return failure(
			`${prop} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

const tableFromColumns = (
	columns: unknown,
	rows: unknown,
): ParseResult<ChartTable> => {
	if (
		!Array.isArray(columns) ||
		columns.length < 2 ||
		!columns.every((column) => typeof column === "string" && column !== "")
	) {
		return failure(
			'data.columns must list the x column and at least one series, such as ["t", "cpu"].',
		);
	}
	if (new Set(columns).size !== columns.length) {
		return failure("data.columns has a duplicate column name.");
	}
	if (!Array.isArray(rows)) {
		return failure("data.rows must be an array of rows.");
	}
	for (const [index, row] of rows.entries()) {
		if (!Array.isArray(row) || row.length !== columns.length) {
			return failure(
				`data.rows[${index}] must have ${columns.length} values, one per column.`,
			);
		}
		if (!row.every(isCell)) {
			return failure(
				`data.rows[${index}] may hold only numbers, strings, and null.`,
			);
		}
	}
	return { ok: true, value: { columns, rows } };
};

/** Wide rows as code holds them: `[{ "t": 1, "cpu": 40 }]`. The x column is `xKey`, or the first key. */
const tableFromObjects = (
	rows: unknown[],
	xKey: unknown,
): ParseResult<ChartTable> => {
	const columns: string[] = [];
	for (const [index, row] of rows.entries()) {
		if (!isRecord(row)) {
			return failure(`data[${index}] must be an object.`);
		}
		for (const key of Object.keys(row)) {
			if (!columns.includes(key)) columns.push(key);
		}
	}
	if (typeof xKey === "string") {
		if (!columns.includes(xKey)) {
			return failure(`data has no column "${xKey}".`);
		}
		columns.splice(columns.indexOf(xKey), 1);
		columns.unshift(xKey);
	}
	return tableFromColumns(
		columns,
		rows.map((row) =>
			columns.map((column) => (row as Record<string, unknown>)[column] ?? null),
		),
	);
};

/**
 * Reads a `data` prop. The stored shape is `{ "columns": [...], "rows": [[...]] }`,
 * which keeps numbers free of escaped quotes. An array of objects is accepted
 * too, so rows can be pasted from code.
 */
export const parseChartTable = (raw: string): ParseResult<ChartTable> => {
	const parsed = parseJson(raw, "data");
	if (!parsed.ok) return parsed;
	const value = parsed.value;
	if (Array.isArray(value)) return tableFromObjects(value, undefined);
	if (isRecord(value)) return tableFromColumns(value.columns, value.rows);
	return failure('data must be { "columns": [...], "rows": [[...]] }.');
};

export const parseChartLimits = (raw: string): ParseResult<ChartLimit[]> => {
	if (raw.trim() === "") return { ok: true, value: [] };
	const parsed = parseJson(raw, "limits");
	if (!parsed.ok) return parsed;
	if (!Array.isArray(parsed.value)) {
		return failure('limits must be an array, such as [{ "value": 90 }].');
	}
	const limits: ChartLimit[] = [];
	for (const [index, entry] of parsed.value.entries()) {
		const limit = typeof entry === "number" ? { value: entry } : entry;
		if (
			!isRecord(limit) ||
			typeof limit.value !== "number" ||
			!Number.isFinite(limit.value)
		) {
			return failure(`limits[${index}] needs a numeric value.`);
		}
		if (
			limit.tone !== undefined &&
			limit.tone !== "limit" &&
			limit.tone !== "warning"
		) {
			return failure(`limits[${index}].tone must be "limit" or "warning".`);
		}
		limits.push({ value: limit.value, tone: limit.tone ?? "limit" });
	}
	return { ok: true, value: limits };
};

/** Event rules on the x axis, in the x column's own values. */
export const parseChartMarkers = (raw: string): ParseResult<ChartCell[]> => {
	if (raw.trim() === "") return { ok: true, value: [] };
	const parsed = parseJson(raw, "markers");
	if (!parsed.ok) return parsed;
	if (!Array.isArray(parsed.value) || !parsed.value.every(isCell)) {
		return failure("markers must be an array of x values.");
	}
	return { ok: true, value: parsed.value };
};

export type MapPoint = { lon: number; lat: number; value: number };

export const parseMapPoints = (raw: string): ParseResult<MapPoint[]> => {
	if (raw.trim() === "") return { ok: true, value: [] };
	const parsed = parseJson(raw, "points");
	if (!parsed.ok) return parsed;
	if (!Array.isArray(parsed.value)) {
		return failure(
			'points must be an array, such as [{ "lon": 4.4, "lat": 50.8, "value": 12 }].',
		);
	}
	const points: MapPoint[] = [];
	for (const [index, entry] of parsed.value.entries()) {
		if (
			!isRecord(entry) ||
			typeof entry.lon !== "number" ||
			typeof entry.lat !== "number" ||
			typeof entry.value !== "number"
		) {
			return failure(`points[${index}] needs numeric lon, lat, and value.`);
		}
		points.push({ lon: entry.lon, lat: entry.lat, value: entry.value });
	}
	return { ok: true, value: points };
};

/** Ascending upper bounds for the map's colour steps, such as "10 50 150 400". */
export const parseMapSteps = (raw: string): ParseResult<number[]> => {
	const steps = raw
		.trim()
		.split(/[\s,]+/u)
		.filter(Boolean)
		.map(Number);
	if (steps.some((step) => !Number.isFinite(step))) {
		return failure("steps must be numbers, such as 10 50 150 400.");
	}
	if (steps.some((step, index) => index > 0 && step <= steps[index - 1])) {
		return failure("steps must ascend.");
	}
	if (steps.length > 4) {
		return failure(
			"steps takes at most 4 numbers: the map has 5 colour steps.",
		);
	}
	return { ok: true, value: steps };
};

/** West, south, east, north in degrees, such as "-12 34 32 72". */
export const parseMapBounds = (
	raw: string,
): ParseResult<[number, number, number, number] | null> => {
	if (raw.trim() === "") return { ok: true, value: null };
	const bounds = raw
		.trim()
		.split(/[\s,]+/u)
		.map(Number);
	if (bounds.length !== 4 || bounds.some((value) => !Number.isFinite(value))) {
		return failure("bounds must be four numbers: west south east north.");
	}
	return { ok: true, value: bounds as [number, number, number, number] };
};

/** The colour step of a value: 0 for no value, then 1 up to `steps.length + 1`. */
export const mapStep = (
	value: number | null | undefined,
	steps: readonly number[],
): number => {
	if (value === null || value === undefined) return 0;
	const index = steps.findIndex((step) => value < step);
	return index === -1 ? steps.length + 1 : index + 1;
};

const STEP_FACTORS = [1, 2, 2.5, 5, 10];

/**
 * Round Y ticks from 0: 1, 2, 2.5, or 5 times a power of ten, at most
 * `maxIntervals` steps, with a ceiling at or above `top`.
 */
export const roundTicks = (top: number, maxIntervals = 4): number[] => {
	if (!Number.isFinite(top) || top <= 0) return [0, 1];
	const magnitude = 10 ** Math.floor(Math.log10(top / maxIntervals));
	const factor =
		STEP_FACTORS.find(
			(candidate) =>
				Math.ceil((top - 1e-9) / (candidate * magnitude)) <= maxIntervals,
		) ?? 10;
	const step = factor * magnitude;
	const intervals = Math.ceil((top - 1e-9) / step);
	return Array.from({ length: intervals + 1 }, (_, index) =>
		Number((index * step).toPrecision(12)),
	);
};

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Axis labels for a time span, in the viewer's time zone. */
export const timeTickFormatter = (spanMs: number): ((date: Date) => string) => {
	const options: Intl.DateTimeFormatOptions =
		spanMs <= 2 * MINUTE_MS
			? { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }
			: spanMs <= DAY_MS
				? { hour: "2-digit", minute: "2-digit", hour12: false }
				: { day: "numeric", month: "short" };
	const format = new Intl.DateTimeFormat("en-GB", options);
	return (date) => format.format(date);
};

/**
 * The x value of a cell as a time, or null when it is a category. Numbers are
 * epoch milliseconds. Strings count as times only in ISO form, so "May" stays
 * a category.
 */
export const cellTime = (cell: ChartCell): number | null => {
	if (typeof cell === "number") return cell;
	if (typeof cell === "string" && /^\d{4}-\d{2}-\d{2}/u.test(cell)) {
		const time = Date.parse(cell);
		return Number.isNaN(time) ? null : time;
	}
	return null;
};

type PropParser = (raw: string) => ParseResult<unknown>;

const PROP_PARSERS: Record<"chart" | "map", Record<string, PropParser>> = {
	chart: {
		data: parseChartTable,
		limits: parseChartLimits,
		markers: parseChartMarkers,
	},
	map: {
		data: parseChartTable,
		points: parseMapPoints,
		bounds: parseMapBounds,
		steps: parseMapSteps,
	},
};

/** What is wrong with a stored prop value, or null when it is fine. */
export const validateChartProp = (
	format: "chart" | "map",
	prop: string,
	value: unknown,
): string | null => {
	if (typeof value !== "string") return null;
	const result = PROP_PARSERS[format][prop]?.(value);
	return result && !result.ok ? result.message : null;
};
