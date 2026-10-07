import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Play, ShieldCheck } from "lucide-react";
import { type RefObject, useEffect, useMemo, useState } from "react";
import type { ProjectQueryScope } from "../../queries/project-scope";
import {
	invalidateSystemLint,
	runSystemLint,
	SystemLintRequestError,
	type SystemLintRunResponse,
	systemLintQueryKey,
} from "../../queries/system-lint";
import {
	LINT_DASHBOARD_VIEWS,
	type LintDashboardView,
	setLintDashboardView,
	useLintDashboardView,
	useLintSelection,
} from "../../stores/lint-dashboard-store";
import { formatRelativeTime } from "../project/project-view-utils";
import { Alert } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { Tabs, TabsList, TabsTab } from "../ui/tabs";
import { Text } from "../ui/text";
import { LintAdherenceView } from "./lint/LintAdherenceView";
import { LintConfigEditor } from "./lint/LintConfigEditor";
import { LintCoverageView } from "./lint/LintCoverageView";
import { LintFindingsView } from "./lint/LintFindingsView";
import {
	LintDesignHeatMapView,
	LintFileHeatMapView,
} from "./lint/LintHeatMapView";
import { useDesignNames, useSystemLint } from "./lint/LintParts";
import { countCoverage, isReportStale } from "./lint/lint-dashboard-model";

export {
	SystemEditorLintInspector,
	SystemEditorLintRail,
} from "./lint/LintRailAndInspector";

const quoteArgument = (value: string) =>
	/^[\w.-]+$/u.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`;

/** Elapsed seconds while a run is in flight. */
function useElapsedSeconds(active: boolean) {
	const [seconds, setSeconds] = useState(0);
	useEffect(() => {
		if (!active) {
			setSeconds(0);
			return;
		}
		const started = Date.now();
		const timer = window.setInterval(
			() => setSeconds(Math.floor((Date.now() - started) / 1000)),
			500,
		);
		return () => window.clearInterval(timer);
	}, [active]);
	return seconds;
}

function RunOutcome({
	result,
	onDismiss,
}: {
	result: SystemLintRunResponse;
	onDismiss: () => void;
}) {
	const { ratchet } = result;
	const warnings = result.diagnostics.filter(
		(diagnostic) => diagnostic.severity === "warning",
	);
	return (
		<Card
			edge="inset"
			tone={result.status === "fail" ? "danger" : "default"}
			className="flex flex-col gap-2 px-4 py-3"
			data-lint-run-outcome={result.status}
		>
			<div className="flex items-center gap-2">
				<Badge
					tone={result.status === "pass" ? "success" : "danger"}
					edge="stamped"
				>
					Run {result.status}
				</Badge>
				<Text className="min-w-0 flex-1 text-xs text-slate-800">
					{result.status === "pass"
						? ratchet.baseline
							? "Nothing got worse than the baseline; the report is the new baseline."
							: "First run: the report is the baseline."
						: `${ratchet.regressions.length} regressed, ${ratchet.breaches.length} over a threshold. The failing report was written so you can inspect it; its baseline was kept, so do not commit lint-report.json as it is.`}
				</Text>
				<Button
					type="button"
					variant="ghost"
					className="px-2 py-1 text-xs"
					onClick={onDismiss}
				>
					Dismiss
				</Button>
			</div>
			{ratchet.regressions.length + ratchet.breaches.length > 0 ? (
				<ul className="flex flex-col gap-1 font-mono text-[11px] text-red-800">
					{ratchet.regressions.map((entry) => (
						<li key={`r:${entry.metric}`}>
							{entry.metric}: {entry.baseline} → {entry.current}
						</li>
					))}
					{ratchet.breaches.map((entry) => (
						<li key={`b:${entry.metric}`}>
							{entry.metric}: {entry.current}{" "}
							{entry.kind === "max" ? "above max" : "below min"} {entry.limit}
						</li>
					))}
				</ul>
			) : null}
			{warnings.length > 0 ? (
				<details className="text-[11px] text-slate-700">
					<summary className="cursor-pointer font-mono text-slate-500">
						{warnings.length} {warnings.length === 1 ? "warning" : "warnings"}
					</summary>
					<ul className="mt-1 flex flex-col gap-1">
						{warnings.map((diagnostic) => (
							<li
								key={`${diagnostic.code}:${diagnostic.path ?? ""}:${diagnostic.message}`}
							>
								<span className="font-mono text-amber-800">
									{diagnostic.code}
								</span>{" "}
								{diagnostic.message}
							</li>
						))}
					</ul>
				</details>
			) : null}
		</Card>
	);
}

function RunError({ error }: { error: Error }) {
	const diagnostics =
		error instanceof SystemLintRequestError ? error.diagnostics : [];
	return (
		<Card edge="inset" tone="danger" className="flex flex-col gap-2 px-4 py-3">
			<Alert tone="danger">Lint could not complete: {error.message}</Alert>
			{diagnostics.length > 0 ? (
				<ul className="flex flex-col gap-1 text-[11px]">
					{diagnostics.map((diagnostic) => (
						<li
							key={`${diagnostic.code}:${diagnostic.path ?? ""}:${diagnostic.message}`}
						>
							<span className="font-mono">{diagnostic.code}</span>{" "}
							{diagnostic.message}
						</li>
					))}
				</ul>
			) : null}
		</Card>
	);
}

export function SystemEditorLintPanel({
	systemId,
	systemName,
	projectScope,
	scrollElementRef,
}: {
	systemId: string;
	systemName: string;
	projectScope?: ProjectQueryScope;
	scrollElementRef: RefObject<HTMLDivElement | null>;
}) {
	const queryClient = useQueryClient();
	const view = useLintDashboardView();
	const selection = useLintSelection();
	const { reportQuery, configQuery, report, currentContractHash, hasNoReport } =
		useSystemLint(systemId, projectScope);
	const designNames = useDesignNames(
		Boolean(report?.designs?.length),
		projectScope,
	);
	const runMutation = useMutation({
		mutationFn: () => runSystemLint(systemId),
		onSuccess: async (result) => {
			queryClient.setQueryData(systemLintQueryKey(systemId, projectScope), {
				systemId: result.systemId,
				systemName: result.systemName,
				report: result.report,
				current: { contractHash: result.report.contract.hash },
			});
			await invalidateSystemLint(queryClient, systemId, projectScope);
		},
	});
	const elapsed = useElapsedSeconds(runMutation.isPending);
	const stale = report ? isReportStale(report, currentContractHash) : false;
	const componentSlugs = useMemo(
		() => report?.components.map((component) => component.slug) ?? [],
		[report],
	);
	const gapCount = useMemo(
		() => (report ? countCoverage(report.components).withGaps : 0),
		[report],
	);

	const runButton = (
		<Button
			type="button"
			variant="filled"
			className="flex shrink-0 items-center gap-1.5 px-3 py-2"
			disabled={runMutation.isPending}
			onClick={() => runMutation.mutate()}
		>
			{runMutation.isPending ? (
				<LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
			) : (
				<Play className="size-3.5" aria-hidden="true" />
			)}
			{runMutation.isPending ? `Running… ${elapsed}s` : "Run lint"}
		</Button>
	);

	const cliCommand = `trickroom lint --system ${quoteArgument(systemName)}`;

	let body: React.ReactNode;
	if (view === "config") {
		body = configQuery.data ? (
			<LintConfigEditor
				systemId={systemId}
				projectScope={projectScope}
				data={configQuery.data}
				componentSlugs={componentSlugs}
			/>
		) : configQuery.isError ? (
			<Alert tone="danger">{(configQuery.error as Error).message}</Alert>
		) : (
			<Text tone="faint">Loading lint.json…</Text>
		);
	} else if (reportQuery.isPending) {
		body = <Text tone="faint">Loading the lint report…</Text>;
	} else if (hasNoReport) {
		body = (
			<EmptyState
				icon={ShieldCheck}
				title="No lint report yet"
				description="Lint checks how this system is used in the app and in Designs. Run it here, or from a terminal; the report it writes is committed and becomes the baseline the next run compares against."
			>
				<div className="flex flex-col items-center gap-3">
					<code className="bg-slate-900 px-3 py-2 font-mono text-xs text-slate-50">
						{cliCommand}
					</code>
					{runButton}
				</div>
			</EmptyState>
		);
	} else if (reportQuery.isError || !report) {
		body = (
			<Alert tone="danger">
				The lint report could not be read:{" "}
				{(reportQuery.error as Error | null)?.message ?? "unknown error"}. Run
				lint to write a new one.
			</Alert>
		);
	} else if (view === "adherence") {
		body = (
			<LintAdherenceView
				report={report}
				config={configQuery.data?.config ?? null}
				ruleKinds={configQuery.data?.ruleKinds ?? []}
				showRatchet={
					runMutation.data?.report.generatedAt !== report.generatedAt
				}
			/>
		);
	} else if (view === "coverage") {
		body = (
			<LintCoverageView
				report={report}
				config={configQuery.data?.config ?? null}
				selection={selection}
			/>
		);
	} else if (view === "files") {
		body = (
			<LintFileHeatMapView
				report={report}
				selection={selection}
				scrollElementRef={scrollElementRef}
			/>
		);
	} else if (view === "designs") {
		body = (
			<LintDesignHeatMapView
				report={report}
				selection={selection}
				scrollElementRef={scrollElementRef}
				designNames={designNames}
			/>
		);
	} else {
		body = (
			<LintFindingsView
				report={report}
				selection={selection}
				scrollElementRef={scrollElementRef}
				designNames={designNames}
			/>
		);
	}

	const tabCount = (value: LintDashboardView) => {
		if (!report) return null;
		if (value === "findings") return report.findings.length;
		if (value === "coverage") return gapCount;
		return null;
	};

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col" data-lint-panel>
			<header className="border-b border-slate-200 bg-white">
				<div className="flex items-start justify-between gap-6 px-10 pt-8 pb-4">
					<div className="flex min-w-0 flex-1 flex-col gap-1">
						<Text variant="eyebrow" className="text-slate-400">
							Design system
						</Text>
						<div className="flex min-w-0 flex-wrap items-center gap-3">
							<h1 className="min-w-0 truncate text-2xl font-semibold text-slate-900">
								{systemName} Lint
							</h1>
							{report ? (
								<Badge
									tone={report.status === "pass" ? "success" : "danger"}
									edge="stamped"
								>
									{report.status}
								</Badge>
							) : null}
							{stale ? (
								<Badge
									tone="warning"
									edge="stamped"
									title="The system's components, tokens or codegen settings changed since this report was generated. Run lint to refresh it."
									data-lint-stale
								>
									Stale
								</Badge>
							) : null}
						</div>
						{report ? (
							<span className="font-mono text-[11px] text-slate-500">
								generated {formatRelativeTime(report.generatedAt)} ·{" "}
								{report.contract.components}{" "}
								{report.contract.components === 1 ? "component" : "components"}{" "}
								· {report.summary.code.scanned.toLocaleString()} files scanned ·{" "}
								{report.config.present ? "lint.json" : "default rules"} ·{" "}
								<span title={report.contract.hash}>
									{report.contract.hash.slice(0, 15)}…
								</span>
							</span>
						) : null}
					</div>
					{hasNoReport && view !== "config" ? null : runButton}
				</div>
				<Tabs
					value={view}
					onValueChange={(next) =>
						setLintDashboardView(next as LintDashboardView)
					}
				>
					<TabsList className="gap-0 border-b-0 px-8" aria-label="Lint views">
						{LINT_DASHBOARD_VIEWS.map((entry) => {
							const count = tabCount(entry.value);
							return (
								<TabsTab
									key={entry.value}
									value={entry.value}
									className="flex items-center gap-1.5 px-3 py-2"
								>
									{entry.label}
									{count ? (
										<span className="bg-slate-200 px-1 font-mono text-[10px] text-slate-600">
											{count.toLocaleString()}
										</span>
									) : null}
								</TabsTab>
							);
						})}
					</TabsList>
				</Tabs>
			</header>
			<div className="flex min-w-0 flex-col gap-4 px-10 py-6">
				{stale ? (
					<Alert tone="warning">
						The system changed since this report was generated (its contract
						hash differs). The numbers below describe the previous state; run
						lint to refresh them.
					</Alert>
				) : null}
				{runMutation.data ? (
					<RunOutcome
						result={runMutation.data}
						onDismiss={() => runMutation.reset()}
					/>
				) : null}
				{runMutation.error ? <RunError error={runMutation.error} /> : null}
				{body}
			</div>
		</div>
	);
}
