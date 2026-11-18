import { Search } from "lucide-react";
import { type RefObject, useMemo, useState } from "react";
import type { LintConfig } from "../../../lint/config";
import type { LintReport } from "../../../lint/report";
import {
	type LintCoverageFilter,
	type LintSelection,
	selectLintItem,
	setLintCoverageFilter,
	useLintCoverageFilter,
} from "../../../stores/lint-dashboard-store";
import { Card } from "../../ui/card";
import { Input } from "../../ui/input";
import { Segmented } from "../../ui/segmented";
import { StateCell } from "../../ui/state-cell";
import { Text } from "../../ui/text";
import { MetricDelta, SectionHeading } from "./LintParts";
import {
	compareLintMetric,
	countCoverage,
	coverageCellState,
	filterCoverage,
	LINT_COVERAGE_STATES,
	thresholdForMetric,
} from "./lint-dashboard-model";
import { useVirtualRows } from "./useVirtualRows";

const FILTER_OPTIONS: Array<{ value: LintCoverageFilter; label: string }> = [
	{ value: "all", label: "All" },
	{ value: "gaps", label: "Any gap" },
	...LINT_COVERAGE_STATES.map((state) => ({
		value: state.key as LintCoverageFilter,
		label: state.gap,
	})),
];

function CoverageStrip({
	component,
}: {
	component: LintReport["components"][number];
}) {
	return (
		<span className="inline-flex shrink-0 items-center gap-0.5">
			{LINT_COVERAGE_STATES.map((state) => {
				const cell = coverageCellState(component, state.key);
				const label =
					cell === "met"
						? state.label
						: cell === "gap"
							? state.gap
							: `${state.label}: unknown`;
				return (
					<StateCell
						key={state.key}
						state={cell}
						title={label}
						aria-label={label}
					>
						{state.short}
					</StateCell>
				);
			})}
		</span>
	);
}

/** A row with one line of gaps; rows whose gaps wrap are measured. */
const ROW_ESTIMATE = 49;

export function LintCoverageView({
	report,
	config,
	selection,
	scrollElementRef,
}: {
	report: LintReport;
	config: LintConfig | null;
	selection: LintSelection | null;
	scrollElementRef: RefObject<HTMLDivElement | null>;
}) {
	const filter = useLintCoverageFilter();
	const [search, setSearch] = useState("");
	const counts = useMemo(
		() => countCoverage(report.components),
		[report.components],
	);
	const rows = useMemo(
		() => filterCoverage(report.components, filter, search),
		[report.components, filter, search],
	);
	const total = report.components.length;
	const { containerRef, virtualizer, scrollMargin } = useVirtualRows({
		count: rows.length,
		estimateSize: ROW_ESTIMATE,
		scrollElementRef,
		getItemKey: (index) => rows[index]?.slug ?? String(index),
		measure: true,
	});
	const selectedSlug = selection?.kind === "component" ? selection.slug : null;

	return (
		<div className="flex flex-col gap-6" data-lint-view="coverage">
			<div className="flex flex-row flex-wrap gap-3">
				{LINT_COVERAGE_STATES.map((state) => {
					const metric = `coverage.${state.key}`;
					const stateCounts = counts.states[state.key];
					const threshold = thresholdForMetric(config?.thresholds, metric);
					const allUnknown = stateCounts.unknown === total && total > 0;
					return (
						<Card
							key={state.key}
							edge="inset"
							className="flex min-w-40 flex-1 flex-col gap-1 px-4 py-3"
						>
							<Text variant="section-header">{state.label}</Text>
							<span className="font-mono text-lg font-medium text-slate-950">
								{allUnknown ? "Unknown" : `${stateCounts.met}/${total}`}
							</span>
							<div className="flex flex-wrap items-center gap-2">
								{allUnknown ? null : (
									<MetricDelta
										comparison={compareLintMetric(report.ratchet, metric)}
									/>
								)}
								{threshold ? (
									<span className="font-mono text-[11px] text-slate-500">
										min {threshold.limit}
									</span>
								) : null}
								{stateCounts.gap > 0 ? (
									<span className="font-mono text-[11px] text-amber-700">
										{stateCounts.gap} {stateCounts.gap === 1 ? "gap" : "gaps"}
									</span>
								) : null}
							</div>
						</Card>
					);
				})}
			</div>

			<section className="flex flex-col gap-3" aria-label="Component coverage">
				<SectionHeading
					title="Components"
					detail={`${counts.withGaps} of ${total} ${total === 1 ? "component has" : "components have"} a gap.`}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<Segmented
						ariaLabel="Filter by gap"
						options={FILTER_OPTIONS}
						value={filter}
						onChange={(next) => setLintCoverageFilter(next ?? "all")}
						className="flex-none [&_button]:whitespace-nowrap"
					/>
					<div className="relative min-w-48 flex-1">
						<Search
							className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500"
							aria-hidden="true"
						/>
						<Input
							variant="formCompact"
							className="w-full px-7"
							aria-label="Search components"
							placeholder="Search components"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
					{LINT_COVERAGE_STATES.map((state) => (
						<span key={state.key} className="inline-flex items-center gap-1">
							<span className="font-mono text-slate-900">{state.short}</span>
							{state.label}
						</span>
					))}
					<span className="inline-flex items-center gap-1">
						<StateCell state="gap" className="size-3" /> Gap
					</span>
					<span className="inline-flex items-center gap-1">
						<StateCell state="unknown" className="size-3" /> Unknown
					</span>
				</div>
				<Card edge="inset" className="flex flex-col">
					<div className="flex items-center gap-3 border-b border-slate-100 px-3 py-2">
						<Text variant="group-label" className="min-w-0 flex-1">
							Component
						</Text>
						<Text variant="group-label" className="w-[108px] shrink-0">
							States
						</Text>
						<Text variant="group-label" className="w-48 shrink-0">
							Wrapper
						</Text>
						<Text variant="group-label" className="w-14 shrink-0 text-right">
							Usages
						</Text>
					</div>
					{rows.length === 0 ? (
						<Text variant="meta" render={<p />} className="px-3 py-4">
							{total === 0
								? "No published components. Publish one, then run lint."
								: "No components match this filter."}
						</Text>
					) : null}
					<div
						ref={containerRef}
						className="relative w-full"
						style={{ height: virtualizer.getTotalSize() }}
					>
						{virtualizer.getVirtualItems().map((item) => {
							const component = rows[item.index];
							if (!component) return null;
							return (
								<button
									key={item.key}
									ref={virtualizer.measureElement}
									data-index={item.index}
									type="button"
									data-lint-component={component.slug}
									data-selected={selectedSlug === component.slug}
									data-last={item.index === rows.length - 1}
									className="absolute inset-x-0 top-0 flex items-center gap-3 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500 data-[last=true]:border-b-0 data-[selected=true]:bg-cyan-50"
									style={{
										transform: `translateY(${item.start - scrollMargin}px)`,
									}}
									onClick={() =>
										selectLintItem({ kind: "component", slug: component.slug })
									}
								>
									<span className="flex min-w-0 flex-1 flex-col">
										<span className="truncate text-xs font-medium text-slate-900">
											{component.name}
										</span>
										<span className="truncate font-mono text-[10px] text-slate-500">
											{component.slug}
										</span>
									</span>
									<span className="w-[108px] shrink-0">
										<CoverageStrip component={component} />
									</span>
									<span
										className="w-48 shrink-0 truncate font-mono text-[11px] text-slate-600"
										title={component.wrappers.join("\n")}
									>
										{component.wrappers[0] ?? null}
										{component.wrappers.length > 1
											? ` +${component.wrappers.length - 1}`
											: ""}
									</span>
									<span className="w-14 shrink-0 text-right font-mono text-xs text-slate-900">
										{component.usages}
									</span>
								</button>
							);
						})}
					</div>
				</Card>
			</section>
		</div>
	);
}
