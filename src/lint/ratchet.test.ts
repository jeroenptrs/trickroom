import { describe, expect, it } from "vitest";
import {
	collectTrackedNumbers,
	compareLintRatchet,
	nextRatchetBaseline,
} from "./ratchet";
import type { LintComponentCoverage, LintSideSummary } from "./report";

const summary = (
	errors: number,
	warnings: number,
	rules: Record<string, [number, number]> = {},
): LintSideSummary => ({
	findings: { errors, warnings, info: 0 },
	rules: Object.fromEntries(
		Object.entries(rules).map(([id, [e, w]]) => [
			id,
			{ errors: e, warnings: w, info: 0 },
		]),
	),
	scanned: 3,
});

const coverage = (
	overrides: Partial<LintComponentCoverage>,
): LintComponentCoverage => ({
	slug: "x",
	componentId: "cmp_x",
	name: "x",
	published: true,
	generated: true,
	bound: false,
	usedInApp: null,
	usedInDesigns: null,
	wrappers: [],
	usages: 0,
	...overrides,
});

describe("ratchet", () => {
	it("collects tracked numbers from the summary and coverage", () => {
		expect(
			collectTrackedNumbers({
				summary: {
					code: summary(2, 1, {
						"code.variants-file-stale": [2, 0],
						"code.variants-file-orphaned": [0, 1],
					}),
					design: null,
				},
				components: [
					coverage({ bound: true, usedInApp: true }),
					coverage({ published: false, generated: false }),
				],
			}),
		).toEqual({
			"code.errors": 2,
			"code.warnings": 1,
			"coverage.bound": 1,
			"coverage.generated": 1,
			"coverage.published": 1,
			"coverage.usedInApp": 1,
			"coverage.usedInDesigns": 0,
			"design.errors": 0,
			"design.warnings": 0,
			"rule.code.variants-file-orphaned": 1,
			"rule.code.variants-file-stale": 2,
		});
	});

	it("passes a first run and fails what got worse or breaks a threshold", () => {
		const first = compareLintRatchet({
			numbers: { "code.errors": 1, "coverage.bound": 2 },
			baseline: null,
			thresholds: {},
		});
		expect(first).toMatchObject({
			status: "pass",
			baseline: null,
			regressions: [],
			breaches: [],
		});

		const baseline = {
			generatedAt: "2026-01-01T00:00:00.000Z",
			numbers: { "code.errors": 1, "rule.code.x": 1, "coverage.bound": 2 },
		};
		expect(
			compareLintRatchet({
				numbers: { "code.errors": 1, "rule.code.x": 0, "coverage.bound": 2 },
				baseline,
				thresholds: {},
			}).status,
		).toBe("pass");
		const worse = compareLintRatchet({
			numbers: { "code.errors": 2, "coverage.bound": 1, "rule.code.y": 1 },
			baseline,
			thresholds: {
				code: { errors: 1 },
				rules: { "code.y": 0 },
				coverage: { bound: 2 },
			},
		});
		expect(worse.status).toBe("fail");
		expect(worse.regressions).toEqual([
			{ metric: "code.errors", baseline: 1, current: 2 },
			{ metric: "coverage.bound", baseline: 2, current: 1 },
			{ metric: "rule.code.y", baseline: 0, current: 1 },
		]);
		expect(worse.breaches).toEqual([
			{ metric: "code.errors", kind: "max", limit: 1, current: 2 },
			{ metric: "coverage.bound", kind: "min", limit: 2, current: 1 },
			{ metric: "rule.code.y", kind: "max", limit: 0, current: 1 },
		]);
	});

	it("moves the baseline only on a pass", () => {
		const previous = {
			generatedAt: "2026-01-01T00:00:00.000Z",
			numbers: { "code.errors": 1 },
		};
		const pass = compareLintRatchet({
			numbers: { "code.errors": 0 },
			baseline: previous,
			thresholds: {},
		});
		expect(
			nextRatchetBaseline({
				result: pass,
				generatedAt: "2026-02-01T00:00:00.000Z",
				previous,
			}),
		).toEqual({
			generatedAt: "2026-02-01T00:00:00.000Z",
			numbers: { "code.errors": 0 },
		});
		const fail = compareLintRatchet({
			numbers: { "code.errors": 3 },
			baseline: previous,
			thresholds: {},
		});
		expect(
			nextRatchetBaseline({
				result: fail,
				generatedAt: "2026-02-01T00:00:00.000Z",
				previous,
			}),
		).toBe(previous);
		expect(
			nextRatchetBaseline({
				result: fail,
				generatedAt: "2026-02-01T00:00:00.000Z",
				previous: null,
			}),
		).toEqual({
			generatedAt: "2026-02-01T00:00:00.000Z",
			numbers: { "code.errors": 3 },
		});
	});

	describe("adopting kinds the baseline predates", () => {
		const current = {
			code: summary(1, 7, {
				"code.old": [1, 2],
				"code.new": [0, 5],
			}),
			design: summary(0, 3, { "design.new": [0, 3] }),
		};
		const numbers = collectTrackedNumbers({
			summary: current,
			components: [],
		});
		const baseline = {
			generatedAt: "2026-01-01T00:00:00.000Z",
			numbers: {
				"code.errors": 1,
				"code.warnings": 2,
				"design.errors": 0,
				"design.warnings": 0,
				"rule.code.old": 3,
			},
			kinds: ["code.old"],
		};

		it("adopts a kind the baseline does not list and compares the aggregates without it", () => {
			const result = compareLintRatchet({
				numbers,
				baseline,
				thresholds: {},
				summary: current,
			});
			expect(result.status).toBe("pass");
			expect(result.regressions).toEqual([]);
			expect(result.adopted).toEqual([
				{ metric: "rule.code.new", current: 5, reason: "new-kind" },
				{ metric: "rule.design.new", current: 3, reason: "new-kind" },
			]);
			expect(result.baseline).toEqual({
				generatedAt: "2026-01-01T00:00:00.000Z",
				numbers: {
					"code.errors": 1,
					"code.warnings": 7,
					"design.errors": 0,
					"design.warnings": 3,
					"rule.code.new": 5,
					"rule.code.old": 3,
					"rule.design.new": 3,
				},
				kinds: ["code.old"],
			});
			// Without the per-kind counts nothing is adopted.
			expect(
				compareLintRatchet({ numbers, baseline, thresholds: {} }).regressions,
			).toEqual([
				{ metric: "code.warnings", baseline: 2, current: 7 },
				{ metric: "design.warnings", baseline: 0, current: 3 },
				{ metric: "rule.code.new", baseline: 0, current: 5 },
				{ metric: "rule.design.new", baseline: 0, current: 3 },
			]);
		});

		it("still fails a known kind that got worse, and its aggregate", () => {
			const worse = {
				...current,
				code: summary(2, 7, { "code.old": [2, 2], "code.new": [0, 5] }),
			};
			const result = compareLintRatchet({
				numbers: collectTrackedNumbers({ summary: worse, components: [] }),
				baseline,
				thresholds: {},
				summary: worse,
			});
			expect(result.status).toBe("fail");
			expect(result.adopted).toHaveLength(2);
			expect(result.regressions).toEqual([
				{ metric: "code.errors", baseline: 1, current: 2 },
				{ metric: "rule.code.old", baseline: 3, current: 4 },
			]);
		});

		it("compares a listed kind without a number, one switched off when the baseline was written, as usual", () => {
			const result = compareLintRatchet({
				numbers,
				baseline: {
					...baseline,
					kinds: ["code.new", "code.old", "design.new"],
				},
				thresholds: {},
				summary: current,
			});
			expect(result.adopted).toEqual([]);
			expect(result.regressions).toEqual([
				{ metric: "code.warnings", baseline: 2, current: 7 },
				{ metric: "design.warnings", baseline: 0, current: 3 },
				{ metric: "rule.code.new", baseline: 0, current: 5 },
				{ metric: "rule.design.new", baseline: 0, current: 3 },
			]);
		});

		it("takes the kinds without a number as new in a baseline without kinds", () => {
			const { kinds: _kinds, ...legacy } = baseline;
			const result = compareLintRatchet({
				numbers,
				baseline: {
					...legacy,
					numbers: { ...legacy.numbers, "rule.code.new": 4 },
				},
				thresholds: {},
				summary: current,
			});
			expect(result.adopted).toEqual([
				{ metric: "rule.design.new", current: 3, reason: "new-kind" },
			]);
			expect(result.regressions).toEqual([
				{ metric: "code.warnings", baseline: 2, current: 7 },
				{ metric: "rule.code.new", baseline: 4, current: 5 },
			]);
			expect(result.baseline).not.toHaveProperty("kinds");
		});

		describe("explicitly (--adopt)", () => {
			const known = {
				...baseline,
				kinds: ["code.new", "code.old", "design.new"],
			};

			it("adopts a known kind that got worse, and passes", () => {
				const result = compareLintRatchet({
					numbers,
					baseline: {
						...known,
						numbers: {
							...known.numbers,
							"design.warnings": 1,
							"rule.design.new": 1,
						},
					},
					thresholds: {},
					summary: current,
					adopt: ["code.new", "design.new"],
				});
				expect(result.status).toBe("pass");
				expect(result.regressions).toEqual([]);
				expect(result.adopted).toEqual([
					{
						metric: "rule.code.new",
						current: 5,
						reason: "explicit",
						baseline: 0,
					},
					{
						metric: "rule.design.new",
						current: 3,
						reason: "explicit",
						baseline: 1,
					},
				]);
				// Each aggregate rises by what its kind rose.
				expect(result.baseline?.numbers).toMatchObject({
					"code.errors": 1,
					"code.warnings": 7,
					"design.warnings": 3,
					"rule.code.new": 5,
					"rule.design.new": 3,
				});
			});

			it("still fails a second kind that got worse", () => {
				const result = compareLintRatchet({
					numbers,
					baseline: known,
					thresholds: {},
					summary: current,
					adopt: ["code.new"],
				});
				expect(result.status).toBe("fail");
				expect(result.adopted).toEqual([
					{
						metric: "rule.code.new",
						current: 5,
						reason: "explicit",
						baseline: 0,
					},
				]);
				expect(result.regressions).toEqual([
					{ metric: "design.warnings", baseline: 0, current: 3 },
					{ metric: "rule.design.new", baseline: 0, current: 3 },
				]);
			});

			it("adds a rise to the aggregate of the kind's severity and never lowers one", () => {
				const errors = {
					code: summary(4, 2, { "code.old": [4, 0], "code.new": [0, 2] }),
					design: null,
				};
				const result = compareLintRatchet({
					numbers: collectTrackedNumbers({ summary: errors, components: [] }),
					baseline: {
						...known,
						numbers: {
							...known.numbers,
							"rule.code.old": 1,
							"rule.code.new": 6,
							"code.warnings": 8,
						},
					},
					thresholds: {},
					summary: errors,
					adopt: ["code.old", "code.new"],
				});
				expect(result.status).toBe("pass");
				expect(result.baseline?.numbers).toMatchObject({
					"code.errors": 4,
					"code.warnings": 8,
					"rule.code.new": 2,
					"rule.code.old": 4,
				});
				expect(result.adopted).toEqual([
					{
						metric: "rule.code.new",
						current: 2,
						reason: "explicit",
						baseline: 6,
					},
					{
						metric: "rule.code.old",
						current: 4,
						reason: "explicit",
						baseline: 1,
					},
				]);
			});

			it("records a kind the baseline predates as new, even when named", () => {
				const result = compareLintRatchet({
					numbers,
					baseline,
					thresholds: {},
					summary: current,
					adopt: ["code.new"],
				});
				expect(result.status).toBe("pass");
				expect(result.adopted).toEqual([
					{ metric: "rule.code.new", current: 5, reason: "new-kind" },
					{ metric: "rule.design.new", current: 3, reason: "new-kind" },
				]);
			});
		});

		it("adopts nothing on a first run and keeps thresholds absolute", () => {
			const first = compareLintRatchet({
				numbers,
				baseline: null,
				thresholds: { code: { warnings: 6 } },
				summary: current,
			});
			expect(first.adopted).toEqual([]);
			const adopted = compareLintRatchet({
				numbers,
				baseline,
				thresholds: { code: { warnings: 6 } },
				summary: current,
			});
			expect(adopted.regressions).toEqual([]);
			expect(adopted.breaches).toEqual([
				{ metric: "code.warnings", kind: "max", limit: 6, current: 7 },
			]);
		});

		it("only grows the kinds: a previous baseline's kinds stay when this run knows fewer", () => {
			const result = compareLintRatchet({
				numbers,
				baseline,
				thresholds: {},
				summary: current,
			});
			const previous = { ...baseline, kinds: ["code.gone", "code.old"] };
			expect(
				nextRatchetBaseline({
					result,
					generatedAt: "2026-02-01T00:00:00.000Z",
					previous,
					kinds: ["code.old"],
				}).kinds,
			).toEqual(["code.gone", "code.old"]);
			// A failing run keeps the previous baseline as it is.
			expect(
				nextRatchetBaseline({
					result: { ...result, status: "fail" },
					generatedAt: "2026-02-01T00:00:00.000Z",
					previous,
					kinds: ["code.new"],
				}),
			).toBe(previous);
		});

		it("records the shipped kinds in the next baseline", () => {
			const result = compareLintRatchet({
				numbers,
				baseline,
				thresholds: {},
				summary: current,
			});
			expect(
				nextRatchetBaseline({
					result,
					generatedAt: "2026-02-01T00:00:00.000Z",
					previous: baseline,
					kinds: ["design.new", "code.old", "code.new"],
				}),
			).toEqual({
				generatedAt: "2026-02-01T00:00:00.000Z",
				numbers,
				kinds: ["code.new", "code.old", "design.new"],
			});
		});
	});
});
