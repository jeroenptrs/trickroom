import type { LintConfig, LintSeverity } from "../../../lint/config";
import type { LintReport, LintSideSummary } from "../../../lint/report";
import type { LintRuleKindSummary } from "../../../lint/rule-catalogue";
import { showLintFindings } from "../../../stores/lint-dashboard-store";
import { formatRelativeTime } from "../../project/project-view-utils";
import { Badge } from "../../ui/badge";
import { Card } from "../../ui/card";
import { Text } from "../../ui/text";
import {
	CountTriplet,
	MetricDelta,
	SectionHeading,
	SeverityBadge,
} from "./LintParts";
import {
	compareLintMetric,
	type LintSide,
	ruleRowSeverity,
	ruleRowsForSide,
	thresholdForMetric,
} from "./lint-dashboard-model";

const SIDE_LABEL: Record<LintSide, string> = { code: "Code", design: "Design" };

function RatchetOutcome({ report }: { report: LintReport }) {
	const { ratchet } = report;
	const problems = ratchet.regressions.length + ratchet.breaches.length;
	return (
		<Card
			edge="inset"
			tone={ratchet.status === "fail" ? "danger" : "default"}
			className="flex flex-col gap-2 px-4 py-3"
		>
			<div className="flex flex-wrap items-center gap-2">
				{ratchet.status === "fail" ? (
					<Badge tone="danger" edge="stamped">
						Failed
					</Badge>
				) : null}
				<Text className="text-xs text-slate-700">
					{ratchet.baseline
						? `Compared with the baseline from ${formatRelativeTime(ratchet.baseline.generatedAt)}. ${
								problems > 0
									? `${ratchet.regressions.length} regressed, ${ratchet.breaches.length} past a threshold.`
									: "No number got worse."
							}`
						: "First run. These numbers are the baseline."}
				</Text>
			</div>
			{problems > 0 ? (
				<ul className="flex flex-col gap-1 font-mono text-[11px]">
					{ratchet.regressions.map((entry) => (
						<li key={`r:${entry.metric}`} className="text-red-800">
							{entry.metric}: {entry.baseline} to {entry.current}
						</li>
					))}
					{ratchet.breaches.map((entry) => (
						<li key={`b:${entry.metric}`} className="text-red-800">
							{entry.metric}: {entry.current}{" "}
							{entry.kind === "max" ? "above max" : "below min"} {entry.limit}
						</li>
					))}
				</ul>
			) : null}
			{ratchet.adopted.length > 0 ? (
				<div className="flex flex-col gap-1">
					<Text className="text-xs text-slate-700">
						Rules adopted into the baseline as they are:
					</Text>
					<ul className="flex flex-col gap-1 font-mono text-xs text-slate-800">
						{ratchet.adopted.map((entry) => (
							<li key={`a:${entry.metric}`}>
								{entry.reason === "explicit"
									? `${entry.metric}: ${entry.baseline ?? 0} to ${entry.current} (--adopt)`
									: `${entry.metric}: ${entry.current} (new rule)`}
							</li>
						))}
					</ul>
				</div>
			) : null}
		</Card>
	);
}

function SideCount({
	label,
	report,
	metric,
	value,
	thresholds,
	tracked,
}: {
	label: string;
	report: LintReport;
	metric: string;
	value: number;
	thresholds: LintConfig["thresholds"];
	tracked: boolean;
}) {
	const threshold = tracked ? thresholdForMetric(thresholds, metric) : null;
	return (
		<div className="flex min-w-24 flex-1 flex-col gap-1 border-t border-slate-100 px-4 py-3">
			<Text variant="section-header">{label}</Text>
			<span className="font-mono text-2xl font-medium text-slate-950">
				{value}
			</span>
			<div className="flex flex-wrap items-center gap-2">
				{tracked ? (
					<MetricDelta comparison={compareLintMetric(report.ratchet, metric)} />
				) : (
					<Text variant="meta">Not tracked</Text>
				)}
				{threshold ? (
					<span className="font-mono text-[11px] text-slate-500">
						{threshold.kind} {threshold.limit}
					</span>
				) : null}
			</div>
		</div>
	);
}

function SideCard({
	side,
	summary,
	report,
	thresholds,
}: {
	side: LintSide;
	summary: LintSideSummary | null;
	report: LintReport;
	thresholds: LintConfig["thresholds"];
}) {
	return (
		<Card
			edge="inset"
			className="flex min-w-72 flex-1 flex-col"
			data-lint-side={side}
		>
			<div className="flex items-baseline justify-between gap-3 px-4 py-3">
				<Text variant="subtitle">{SIDE_LABEL[side]}</Text>
				{summary ? (
					<Text variant="meta">
						{summary.scanned.toLocaleString()}{" "}
						{side === "code" ? "source files" : "designs"} scanned
					</Text>
				) : null}
			</div>
			{summary ? (
				<div className="flex flex-row flex-wrap">
					<SideCount
						label="Errors"
						report={report}
						metric={`${side}.errors`}
						value={summary.findings.errors}
						thresholds={thresholds}
						tracked
					/>
					<SideCount
						label="Warnings"
						report={report}
						metric={`${side}.warnings`}
						value={summary.findings.warnings}
						thresholds={thresholds}
						tracked
					/>
					<SideCount
						label="Info"
						report={report}
						metric={`${side}.info`}
						value={summary.findings.info}
						thresholds={thresholds}
						tracked={false}
					/>
				</div>
			) : (
				<div className="flex flex-col gap-1 border-t border-dashed border-slate-200 px-4 py-6">
					<Text className="text-sm font-medium text-slate-700">
						No design results in this report
					</Text>
					<Text variant="meta">Run lint to include designs.</Text>
				</div>
			)}
		</Card>
	);
}

function RuleTable({
	side,
	report,
	config,
	ruleKinds,
}: {
	side: LintSide;
	report: LintReport;
	config: LintConfig | null;
	ruleKinds: readonly LintRuleKindSummary[];
}) {
	const rows = ruleRowsForSide(report, side);
	if (rows === null) {
		return null;
	}
	const listed = new Set(rows.map((row) => row.id));
	const disabled = ruleKinds.filter(
		(kind) => kind.side === side && !listed.has(kind.id),
	);
	const kindById = new Map(ruleKinds.map((kind) => [kind.id, kind]));
	const configuredSeverity = (id: string): LintSeverity | null =>
		config?.rules?.[id]?.severity ?? kindById.get(id)?.defaultSeverity ?? null;

	return (
		<section
			className="flex flex-col gap-2"
			aria-label={`${SIDE_LABEL[side]} rules`}
		>
			<SectionHeading title={`${SIDE_LABEL[side]} rules`} />
			<Card edge="inset" className="flex flex-col">
				<div className="flex items-center gap-3 border-b border-slate-100 px-3 py-2">
					<Text variant="group-label" className="min-w-0 flex-1">
						Rule
					</Text>
					<Text variant="group-label" className="w-16 shrink-0">
						Severity
					</Text>
					<Text variant="group-label" className="w-28 shrink-0">
						Findings
					</Text>
					<Text variant="group-label" className="w-40 shrink-0">
						Change
					</Text>
					<Text variant="group-label" className="w-12 shrink-0 text-right">
						Max
					</Text>
				</div>
				{rows.length === 0 && disabled.length === 0 ? (
					<Text variant="meta" render={<p />} className="px-3 py-3">
						No rules on this side.
					</Text>
				) : null}
				{rows.map((row) => {
					const severity = ruleRowSeverity(
						row.counts,
						configuredSeverity(row.id),
					);
					const threshold = thresholdForMetric(
						config?.thresholds,
						`rule.${row.id}`,
					);
					const total =
						row.counts.errors + row.counts.warnings + row.counts.info;
					return (
						<button
							key={row.id}
							type="button"
							data-lint-rule={row.id}
							className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"
							onClick={() => showLintFindings({ rule: row.id, side })}
							title={kindById.get(row.id)?.description}
						>
							<span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-900">
								{row.id}
							</span>
							<span className="w-16 shrink-0">
								{severity ? (
									<span title={severity.title}>
										{severity.fromReport ? (
											<SeverityBadge severity={severity.severity} />
										) : (
											<Badge tone="neutral">{severity.severity}</Badge>
										)}
									</span>
								) : null}
							</span>
							<span className="w-28 shrink-0">
								{total === 0 ? (
									<Text variant="meta">Clean</Text>
								) : (
									<CountTriplet {...row.counts} />
								)}
							</span>
							<span className="w-40 shrink-0">
								<MetricDelta comparison={row.comparison} />
							</span>
							<span className="w-12 shrink-0 text-right font-mono text-[11px] text-slate-500">
								{threshold ? threshold.limit : null}
							</span>
						</button>
					);
				})}
				{disabled.map((kind) => (
					<div
						key={kind.id}
						className="flex items-center gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0"
						title={kind.description}
					>
						<span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-400">
							{kind.id}
						</span>
						<Text variant="meta" className="text-slate-400">
							Disabled in lint.json
						</Text>
					</div>
				))}
			</Card>
		</section>
	);
}

export function LintAdherenceView({
	report,
	config,
	ruleKinds,
	showRatchet = true,
}: {
	report: LintReport;
	config: LintConfig | null;
	ruleKinds: readonly LintRuleKindSummary[];
	/** False right after a run, whose outcome is already shown above. */
	showRatchet?: boolean;
}) {
	const thresholds = config?.thresholds;
	return (
		<div className="flex flex-col gap-6" data-lint-view="adherence">
			{showRatchet &&
			(report.ratchet.status === "fail" ||
				!report.ratchet.baseline ||
				report.ratchet.adopted.length > 0) ? (
				<RatchetOutcome report={report} />
			) : null}
			<div className="flex flex-row flex-wrap gap-4">
				<SideCard
					side="code"
					summary={report.summary.code}
					report={report}
					thresholds={thresholds}
				/>
				<SideCard
					side="design"
					summary={report.summary.design}
					report={report}
					thresholds={thresholds}
				/>
			</div>
			<RuleTable
				side="code"
				report={report}
				config={config}
				ruleKinds={ruleKinds}
			/>
			<RuleTable
				side="design"
				report={report}
				config={config}
				ruleKinds={ruleKinds}
			/>
		</div>
	);
}
