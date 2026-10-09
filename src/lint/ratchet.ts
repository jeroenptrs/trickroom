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
 * kind switched off never fails a run.
 *
 * A kind the baseline predates is adopted instead of compared: its
 * `rule.<id>` count enters the baseline as is, and the side aggregates are
 * compared with its counts left out. The baseline predates a kind when its
 * `kinds` (every kind id its writers knew: the ledger, the registry and
 * the previous baseline's `kinds`, enabled or not) does not list it; a
 * baseline without `kinds` (written before they were recorded) predates
 * the kinds it has no `rule.<id>` number for, since every run writes one
 * for each kind it ran.
 *
 * A run can also adopt kinds the baseline knows, explicitly (`--adopt`):
 * for a kind switched on with findings, or one whose scope a Trickroom
 * upgrade widened. Its `rule.<id>` number is taken as this run's, and the
 * side aggregate of its severity rises by what the kind rose, so every
 * other kind still ratchets. Documented in docs/lint.md.
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

/** A kind whose count entered the baseline as is. */
export type LintRatchetAdoption = {
	/** `rule.<kind id>`. */
	metric: string;
	current: number;
	/**
	 * `new-kind`: the baseline predates the kind. `explicit`: the run was
	 * asked to adopt it (`--adopt`). Reports from before explicit adoption
	 * have no reason; they read as `new-kind`.
	 */
	reason: "new-kind" | "explicit";
	/** For an explicit adoption, the baseline's number it replaced. */
	baseline?: number;
};

export type LintRatchetResult = {
	status: "pass" | "fail";
	/**
	 * The baseline compared against, with its numbers; null on a first run.
	 * Adopted kinds are folded in: their `rule.<id>` number is this run's,
	 * and their errors and warnings are added to the side aggregates.
	 */
	baseline: LintRatchetBaseline | null;
	regressions: LintRatchetRegression[];
	breaches: LintRatchetBreach[];
	/**
	 * Kinds the baseline predates and kinds adopted explicitly, not
	 * compared; empty on a first run.
	 */
	adopted: LintRatchetAdoption[];
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

/** Whether the baseline was written before the kind shipped. */
const baselinePredatesKind = (baseline: LintRatchetBaseline, kind: string) =>
	baseline.kinds
		? !baseline.kinds.includes(kind)
		: !Object.hasOwn(baseline.numbers, `rule.${kind}`);

/**
 * The baseline with the adopted kinds folded in: their `rule.<id>` number
 * set to this run's and what they rose by added to the side aggregate, so
 * they compare equal and every other kind ratchets as before. A kind the
 * baseline predates counts as risen by all of it (its errors and warnings
 * are added); an explicit kind by its count minus the baseline's number,
 * added to the aggregate of the severity it has now (a kind's findings
 * share one severity), never lowering one.
 */
const adoptKinds = (
	baseline: LintRatchetBaseline,
	summary: LintReport["summary"],
	explicit: ReadonlySet<string>,
): { baseline: LintRatchetBaseline; adopted: LintRatchetAdoption[] } => {
	const numbers = { ...baseline.numbers };
	const adopted: LintRatchetAdoption[] = [];
	for (const side of ["code", "design"] as const) {
		for (const [kind, counts] of Object.entries(summary[side]?.rules ?? {})) {
			const metric = `rule.${kind}`;
			const current = counts.errors + counts.warnings;
			if (baselinePredatesKind(baseline, kind)) {
				adopted.push({ metric, current, reason: "new-kind" });
				numbers[`${side}.errors`] =
					(numbers[`${side}.errors`] ?? 0) + counts.errors;
				numbers[`${side}.warnings`] =
					(numbers[`${side}.warnings`] ?? 0) + counts.warnings;
			} else if (explicit.has(kind)) {
				const before = baseline.numbers[metric] ?? 0;
				adopted.push({ metric, current, reason: "explicit", baseline: before });
				const aggregate = `${side}.${counts.errors > 0 ? "errors" : "warnings"}`;
				numbers[aggregate] =
					(numbers[aggregate] ?? 0) + Math.max(0, current - before);
			} else {
				continue;
			}
			numbers[metric] = current;
		}
	}
	adopted.sort((left, right) =>
		left.metric < right.metric ? -1 : left.metric > right.metric ? 1 : 0,
	);
	return adopted.length === 0
		? { baseline, adopted }
		: { baseline: { ...baseline, numbers }, adopted };
};

export const compareLintRatchet = ({
	numbers,
	baseline: stored,
	thresholds,
	summary,
	adopt = [],
}: {
	numbers: LintTrackedNumbers;
	baseline: LintRatchetBaseline | null;
	thresholds: LintThresholds;
	/** This run's per-kind counts; without them no kind is adopted. */
	summary?: LintReport["summary"];
	/** Kind ids to adopt explicitly; only kinds in `summary` are. */
	adopt?: readonly string[];
}): LintRatchetResult => {
	const { baseline, adopted } =
		stored && summary
			? adoptKinds(stored, summary, new Set(adopt))
			: { baseline: stored, adopted: [] };
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
			? {
					generatedAt: baseline.generatedAt,
					numbers: { ...baseline.numbers },
					...(baseline.kinds ? { kinds: [...baseline.kinds] } : {}),
				}
			: null,
		regressions,
		breaches,
		adopted,
		numbers,
	};
};

/** The baseline the next run compares against, given this run's outcome. */
export const nextRatchetBaseline = ({
	result,
	generatedAt,
	previous,
	kinds,
}: {
	result: LintRatchetResult;
	generatedAt: string;
	previous: LintRatchetBaseline | null;
	/**
	 * Every kind id this Trickroom knows: the ledger and the registry.
	 * Merged with the previous baseline's, so the list only grows and a
	 * kind removed or missing from an older Trickroom is never new again.
	 */
	kinds?: readonly string[];
}): LintRatchetBaseline => {
	if (result.status !== "pass" && previous !== null) return previous;
	const known =
		kinds || previous?.kinds
			? [...new Set([...(previous?.kinds ?? []), ...(kinds ?? [])])].sort()
			: null;
	return {
		generatedAt,
		numbers: result.numbers,
		...(known ? { kinds: known } : {}),
	};
};
