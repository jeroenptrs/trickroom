import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { LintSeverity } from "../../../lint/config";
import { designSummariesQueryOptions } from "../../../queries/design-file";
import type { ProjectQueryScope } from "../../../queries/project-scope";
import {
	systemLintConfigQueryOptions,
	systemLintQueryOptions,
} from "../../../queries/system-lint";
import { Badge } from "../../ui/badge";
import { HeatSwatch } from "../../ui/heat-swatch";
import { Text } from "../../ui/text";
import {
	formatDelta,
	type LintHeatScale,
	type LintMetricComparison,
	severityTone,
} from "./lint-dashboard-model";

/** The report and config queries every lint view reads. */
export function useSystemLint(
	systemId: string,
	projectScope?: ProjectQueryScope,
) {
	const reportQuery = useQuery(systemLintQueryOptions(systemId, projectScope));
	const configQuery = useQuery(
		systemLintConfigQueryOptions(systemId, projectScope),
	);
	return {
		reportQuery,
		configQuery,
		report: reportQuery.data?.report ?? null,
		currentContractHash: reportQuery.data?.current?.contractHash ?? null,
		/** The 404 before the first run, as opposed to a real failure. */
		hasNoReport:
			reportQuery.isError &&
			(reportQuery.error as { status?: number } | null)?.status === 404,
	};
}

/** Design ids to names, fetched only when the report has design data. */
export function useDesignNames(
	enabled: boolean,
	projectScope?: ProjectQueryScope,
): ReadonlyMap<string, string> {
	const summariesQuery = useQuery({
		...designSummariesQueryOptions(projectScope),
		enabled,
	});
	return useMemo(
		() =>
			new Map(
				(summariesQuery.data ?? []).map((design) => [design.uuid, design.name]),
			),
		[summariesQuery.data],
	);
}

export function SeverityBadge({ severity }: { severity: LintSeverity }) {
	return (
		<Badge tone={severityTone(severity)} edge="stamped">
			{severity}
		</Badge>
	);
}

/**
 * The delta of a tracked number against the baseline the run compared with,
 * plus the regression and threshold breach the run flagged for it.
 */
export function MetricDelta({
	comparison,
}: {
	comparison: LintMetricComparison;
}) {
	const tone =
		comparison.delta === null || comparison.delta === 0
			? "text-slate-500"
			: comparison.worse
				? "text-red-700"
				: "text-emerald-700";
	return (
		<span className="inline-flex items-center gap-1.5">
			<span
				className={`font-mono text-[11px] ${tone}`}
				title={
					comparison.baseline === null
						? "No baseline: this was the first run"
						: `Baseline ${comparison.baseline}, now ${comparison.current}`
				}
			>
				{formatDelta(comparison.delta)}
			</span>
			{comparison.regressed ? (
				<Badge tone="danger" edge="stamped">
					Regressed
				</Badge>
			) : null}
			{comparison.breach ? (
				<Badge tone="danger" edge="stamped">
					{comparison.breach.kind === "max" ? "Over max" : "Under min"}{" "}
					{comparison.breach.limit}
				</Badge>
			) : null}
		</span>
	);
}

export function SectionHeading({
	title,
	detail,
	actions,
}: {
	title: string;
	detail?: string;
	actions?: React.ReactNode;
}) {
	return (
		<div className="flex min-w-0 items-end justify-between gap-3">
			<div className="flex min-w-0 flex-col gap-0.5">
				<Text variant="section-header">{title}</Text>
				{detail ? (
					<Text tone="muted" className="text-xs">
						{detail}
					</Text>
				) : null}
			</div>
			{actions ? (
				<div className="flex shrink-0 items-center gap-2">{actions}</div>
			) : null}
		</div>
	);
}

export function HeatLegend({
	label,
	scale,
	kind,
}: {
	label: string;
	scale: LintHeatScale;
	kind: "usage" | "findings";
}) {
	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
			<Text variant="section-header">{label}</Text>
			{scale.legend.map((entry) => (
				<span
					key={entry.step}
					className="inline-flex items-center gap-1 font-mono text-[10px] text-slate-600"
				>
					<HeatSwatch scale={kind} step={entry.step} />
					{entry.label}
				</span>
			))}
		</div>
	);
}

export function CountTriplet({
	errors,
	warnings,
	info,
}: {
	errors: number;
	warnings: number;
	info: number;
}) {
	return (
		<span className="inline-flex items-center gap-2 font-mono text-[11px]">
			<span className={errors > 0 ? "text-red-700" : "text-slate-400"}>
				{errors}E
			</span>
			<span className={warnings > 0 ? "text-amber-700" : "text-slate-400"}>
				{warnings}W
			</span>
			<span className={info > 0 ? "text-cyan-700" : "text-slate-400"}>
				{info}I
			</span>
		</span>
	);
}
