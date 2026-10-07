import type { LintThresholds } from "./config";
import type { LintRatchetBaseline, LintReport } from "./report";

/**
 * The ratchet: a run passes when no tracked number is worse than the
 * committed baseline and none breaks a threshold from `lint.json`.
 *
 * Tracked numbers (lower is better unless noted):
 * - `code.errors`, `code.warnings`, `design.errors`, `design.warnings`
 * - `rule.<kind id>`: errors plus warnings of that kind (info is not tracked)
 * - `coverage.published`, `coverage.generated`, `coverage.bound`,
 *   `coverage.usedInApp`, `coverage.usedInDesigns`: components in that
 *   state (higher is better; a null state counts as 0)
 *
 * A number missing on one side of the comparison counts as 0, so a rule
 * kind switched off or not yet shipped never fails a run. Documented in
 * docs/lint.md.
 */

export type LintTrackedNumbers = Record<string, number>;

const COVERAGE_KEYS = [
	"published",
	"generated",
	"bound",
	"usedInApp",
	"usedInDesigns",
] as const;

const isHigherBetter = (metric: string) => metric.startsWith("coverage.");

export const collectTrackedNumbers = (
	report: Pick<LintReport, "summary" | "components">,
): LintTrackedNumbers => {
	const numbers: LintTrackedNumbers = {};
	for (const side of ["code", "design"] as const) {
		const summary = report.summary[side];
		numbers[`${side}.errors`] = summary?.findings.errors ?? 0;
		numbers[`${side}.warnings`] = summary?.findings.warnings ?? 0;
		for (const [rule, counts] of Object.entries(summary?.rules ?? {})) {
			numbers[`rule.${rule}`] = counts.errors + counts.warnings;
		}
	}
	for (const key of COVERAGE_KEYS) {
		numbers[`coverage.${key}`] = report.components.filter(
			(component) => component[key] === true,
		).length;
	}
	return Object.fromEntries(
		Object.entries(numbers).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		),
	);
};

export type LintRatchetRegression = {
	metric: string;
	baseline: number;
	current: number;
};

export type LintRatchetBreach = {
	metric: string;
	/** `max`: current may not exceed `limit`; `min`: may not fall under it. */
	kind: "max" | "min";
	limit: number;
	current: number;
};

export type LintRatchetResult = {
	status: "pass" | "fail";
	/** The baseline compared against, with its numbers; null on a first run. */
	baseline: LintRatchetBaseline | null;
	regressions: LintRatchetRegression[];
	breaches: LintRatchetBreach[];
	/** This run's tracked numbers. */
	numbers: LintTrackedNumbers;
};

const thresholdLimits = (thresholds: LintThresholds): LintRatchetBreach[] => {
	const limits: LintRatchetBreach[] = [];
	for (const side of ["code", "design"] as const) {
		const sideThresholds = thresholds[side];
		if (sideThresholds?.errors !== undefined) {
			limits.push({
				metric: `${side}.errors`,
				kind: "max",
				limit: sideThresholds.errors,
				current: 0,
			});
		}
		if (sideThresholds?.warnings !== undefined) {
			limits.push({
				metric: `${side}.warnings`,
				kind: "max",
				limit: sideThresholds.warnings,
				current: 0,
			});
		}
	}
	for (const [rule, limit] of Object.entries(thresholds.rules ?? {})) {
		limits.push({ metric: `rule.${rule}`, kind: "max", limit, current: 0 });
	}
	for (const key of COVERAGE_KEYS) {
		const limit = thresholds.coverage?.[key];
		if (limit !== undefined) {
			limits.push({
				metric: `coverage.${key}`,
				kind: "min",
				limit,
				current: 0,
			});
		}
	}
	return limits;
};

export const compareLintRatchet = ({
	numbers,
	baseline,
	thresholds,
}: {
	numbers: LintTrackedNumbers;
	baseline: LintRatchetBaseline | null;
	thresholds: LintThresholds;
}): LintRatchetResult => {
	const regressions: LintRatchetRegression[] = [];
	if (baseline) {
		const metrics = new Set([
			...Object.keys(numbers),
			...Object.keys(baseline.numbers),
		]);
		for (const metric of [...metrics].sort()) {
			const before = baseline.numbers[metric] ?? 0;
			const current = numbers[metric] ?? 0;
			const worse = isHigherBetter(metric)
				? current < before
				: current > before;
			if (worse) {
				regressions.push({ metric, baseline: before, current });
			}
		}
	}
	const breaches = thresholdLimits(thresholds)
		.map((limit) => ({ ...limit, current: numbers[limit.metric] ?? 0 }))
		.filter((limit) =>
			limit.kind === "max"
				? limit.current > limit.limit
				: limit.current < limit.limit,
		)
		.sort((left, right) =>
			left.metric < right.metric ? -1 : left.metric > right.metric ? 1 : 0,
		);
	return {
		status: regressions.length === 0 && breaches.length === 0 ? "pass" : "fail",
		baseline: baseline
			? { generatedAt: baseline.generatedAt, numbers: { ...baseline.numbers } }
			: null,
		regressions,
		breaches,
		numbers,
	};
};

/** The baseline the next run compares against, given this run's outcome. */
export const nextRatchetBaseline = ({
	result,
	generatedAt,
	previous,
}: {
	result: LintRatchetResult;
	generatedAt: string;
	previous: LintRatchetBaseline | null;
}): LintRatchetBaseline =>
	result.status === "pass" || previous === null
		? { generatedAt, numbers: result.numbers }
		: previous;
