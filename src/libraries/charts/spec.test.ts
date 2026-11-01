import { describe, expect, it } from "vitest";
import {
	cellTime,
	mapStep,
	parseChartLimits,
	parseChartMarkers,
	parseChartTable,
	parseMapBounds,
	parseMapPoints,
	parseMapSteps,
	roundTicks,
	timeTickFormatter,
	validateChartProp,
} from "./spec";

describe("parseChartTable", () => {
	it("reads the stored columns and rows", () => {
		expect(
			parseChartTable('{"columns":["t","cpu"],"rows":[[1,2],[3,null]]}'),
		).toEqual({
			ok: true,
			value: {
				columns: ["t", "cpu"],
				rows: [
					[1, 2],
					[3, null],
				],
			},
		});
	});

	it("reads rows pasted from code, with a missing value as null", () => {
		expect(parseChartTable('[{"t":1,"a":2},{"t":3,"b":4}]')).toEqual({
			ok: true,
			value: {
				columns: ["t", "a", "b"],
				rows: [
					[1, 2, null],
					[3, null, 4],
				],
			},
		});
	});

	it.each([
		["not json", "not valid JSON"],
		['{"columns":["t"],"rows":[]}', "at least one series"],
		['{"columns":["t","t"],"rows":[]}', "duplicate"],
		['{"columns":["t","a"],"rows":[[1]]}', "data.rows[0] must have 2"],
		['{"columns":["t","a"],"rows":[[1,true]]}', "only numbers"],
		["42", "must be"],
	])("names the problem in %s", (raw, expected) => {
		const result = parseChartTable(raw);
		expect(result.ok).toBe(false);
		expect(result.ok ? "" : result.message).toContain(expected);
	});
});

describe("reference lines", () => {
	it("defaults a limit's tone and accepts bare numbers", () => {
		expect(parseChartLimits('[90,{"value":70,"tone":"warning"}]')).toEqual({
			ok: true,
			value: [
				{ value: 90, tone: "limit" },
				{ value: 70, tone: "warning" },
			],
		});
	});

	it("treats an empty prop as no lines", () => {
		expect(parseChartLimits("")).toEqual({ ok: true, value: [] });
		expect(parseChartMarkers("")).toEqual({ ok: true, value: [] });
	});

	it("refuses an unknown tone and a missing value", () => {
		expect(parseChartLimits('[{"value":1,"tone":"x"}]').ok).toBe(false);
		expect(parseChartLimits('[{"tone":"limit"}]').ok).toBe(false);
	});
});

describe("map props", () => {
	it("splits values over the steps, with 0 for no value", () => {
		const steps = [10, 50, 150, 400];
		expect(
			[undefined, 0, 10, 149, 400, 9000].map((v) => mapStep(v, steps)),
		).toEqual([0, 1, 2, 3, 5, 5]);
	});

	it("refuses steps that do not ascend or do not fit five colours", () => {
		expect(parseMapSteps("10 5").ok).toBe(false);
		expect(parseMapSteps("1 2 3 4 5").ok).toBe(false);
		expect(parseMapSteps("1 2, 3")).toEqual({ ok: true, value: [1, 2, 3] });
	});

	it("reads bounds and points", () => {
		expect(parseMapBounds("-12 34 32 72")).toEqual({
			ok: true,
			value: [-12, 34, 32, 72],
		});
		expect(parseMapBounds("1 2").ok).toBe(false);
		expect(parseMapPoints('[{"lon":1,"lat":2}]').ok).toBe(false);
	});
});

describe("roundTicks", () => {
	it.each([
		[100, [0, 25, 50, 75, 100]],
		[105, [0, 50, 100, 150]],
		[640, [0, 200, 400, 600, 800]],
		[3, [0, 1, 2, 3]],
		[0, [0, 1]],
	])("rounds up from %d", (top, ticks) => {
		expect(roundTicks(top)).toEqual(ticks);
	});

	it("never exceeds four intervals, and always reaches the top", () => {
		for (const top of [1, 7, 33, 99, 101, 1234, 0.37]) {
			const ticks = roundTicks(top);
			expect(ticks.length).toBeLessThanOrEqual(5);
			expect(ticks.at(-1)).toBeGreaterThanOrEqual(top);
		}
	});
});

describe("the x axis", () => {
	it("treats numbers and ISO dates as times, other strings as categories", () => {
		expect(cellTime(1000)).toBe(1000);
		expect(cellTime("2026-10-31T12:00:00Z")).toBe(Date.UTC(2026, 9, 31, 12));
		expect(cellTime("May")).toBeNull();
		expect(cellTime(null)).toBeNull();
	});

	it("labels by span: seconds, then hours, then days", () => {
		const at = new Date(2026, 9, 31, 9, 5, 7);
		expect(timeTickFormatter(60_000)(at)).toBe("09:05:07");
		expect(timeTickFormatter(3_600_000)(at)).toBe("09:05");
		expect(timeTickFormatter(3 * 86_400_000)(at)).toBe("31 Oct");
	});
});

describe("validateChartProp", () => {
	it("checks only the props the format knows", () => {
		expect(validateChartProp("chart", "data", "x")).toContain("not valid JSON");
		expect(validateChartProp("map", "steps", "b")).toContain("numbers");
		expect(validateChartProp("chart", "form", "x")).toBeNull();
		expect(validateChartProp("chart", "data", undefined)).toBeNull();
	});
});
