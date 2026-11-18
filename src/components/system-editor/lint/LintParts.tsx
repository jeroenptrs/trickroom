import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { LintSeverity } from "../../../lint/config";
import type { LintReport } from "../../../lint/report";
import {
	designFileQueryOptions,
	designSummariesQueryOptions,
} from "../../../queries/design-file";
import type { ProjectQueryScope } from "../../../queries/project-scope";
import {
	systemLintConfigQueryOptions,
	systemLintQueryOptions,
} from "../../../queries/system-lint";
import { Alert } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { HeatSwatch } from "../../ui/heat-swatch";
import { Skeleton } from "../../ui/skeleton";
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

/** The ids of the designs a report has rows or findings for. */
const reportDesignIds = (report: LintReport | null) => {
	const ids = new Set<string>();
	for (const entry of report?.designs ?? []) {
		ids.add(entry.design);
	}
	for (const finding of report?.findings ?? []) {
		if (finding.location?.kind === "design") {
			ids.add(finding.location.design);
		}
	}
	return [...ids].sort();
};

type NamedNode = { id: string; props: object; children: unknown };

const collectLayerNames = (
	nodes: readonly NamedNode[],
	names: Map<string, string>,
) => {
	for (const node of nodes) {
		const name = (node.props as { "data-trickroom-name"?: unknown })[
			"data-trickroom-name"
		];
		if (typeof name === "string" && name.trim()) {
			names.set(node.id, name);
		}
		if (Array.isArray(node.children)) {
			collectLayerNames(node.children as NamedNode[], names);
		}
	}
};

const combineLayerNames = (
	results: readonly { data?: { design: { boards: NamedNode[] } } }[],
) => {
	const names = new Map<string, string>();
	for (const result of results) {
		if (result.data) {
			collectLayerNames(result.data.design.boards, names);
		}
	}
	return names;
};

/**
 * Names for the design, board and layer ids a report points at, fetched only
 * for the designs it lists. An id whose design could not be read has no
 * entry, so callers fall back to the id.
 */
export function useDesignNames(
	report: LintReport | null,
	projectScope?: ProjectQueryScope,
): ReadonlyMap<string, string> {
	const designIds = useMemo(() => reportDesignIds(report), [report]);
	const summariesQuery = useQuery({
		...designSummariesQueryOptions(projectScope),
		enabled: designIds.length > 0,
	});
	const layerNames = useQueries({
		queries: designIds.map((designId) =>
			designFileQueryOptions(designId, projectScope),
		),
		combine: combineLayerNames,
	});
	return useMemo(() => {
		const names = new Map(layerNames);
		for (const summary of summariesQuery.data ?? []) {
			names.set(summary.uuid, summary.name);
		}
		return names;
	}, [layerNames, summariesQuery.data]);
}

/** A failed read: what could not load, the reason, and a retry. */
export function LintLoadError({
	title,
	error,
	hint,
	onRetry,
}: {
	title: string;
	error: unknown;
	/** What else fixes it, after the reason. */
	hint?: string;
	onRetry: () => void;
}) {
	return (
		<div className="flex flex-wrap items-start gap-2">
			<Alert tone="danger" className="min-w-0 flex-1">
				<span className="block font-medium">{title}</span>
				{error instanceof Error ? (
					<span className="block">{error.message}</span>
				) : null}
				{hint ? <span className="block">{hint}</span> : null}
			</Alert>
			<Button
				type="button"
				variant="outlined"
				className="px-3 py-1.5 text-xs"
				onClick={onRetry}
			>
				Retry
			</Button>
		</div>
	);
}

/** Stands in for a lint view while its report or config loads. */
export function LintViewSkeleton() {
	return (
		<div className="flex flex-col gap-4" aria-busy="true">
			<div className="flex flex-wrap gap-4">
				<Skeleton className="h-28 min-w-64 flex-1" />
				<Skeleton className="h-28 min-w-64 flex-1" />
			</div>
			<Skeleton className="h-4 w-32" />
			<div className="flex flex-col gap-px">
				{Array.from({ length: 6 }, (_, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows.
					<Skeleton key={index} className="h-8 w-full" />
				))}
			</div>
		</div>
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
	const label = `${errors} ${errors === 1 ? "error" : "errors"}, ${warnings} ${warnings === 1 ? "warning" : "warnings"}, ${info} info`;
	return (
		<span
			className="inline-flex items-center gap-2 font-mono text-[11px]"
			title={label}
			role="img"
			aria-label={label}
		>
			<span className={errors > 0 ? "text-red-700" : "text-slate-900"}>
				{errors}E
			</span>
			<span className={warnings > 0 ? "text-amber-700" : "text-slate-900"}>
				{warnings}W
			</span>
			<span className={info > 0 ? "text-cyan-700" : "text-slate-900"}>
				{info}I
			</span>
		</span>
	);
}
