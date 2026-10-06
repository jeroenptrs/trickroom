import { Search, X } from "lucide-react";
import { type RefObject, useMemo } from "react";
import type { LintSeverity } from "../../../lint/config";
import type { LintFinding, LintReport } from "../../../lint/report";
import {
	emptyLintFindingsFilter,
	type LintFindingsFilter,
	type LintSelection,
	selectLintItem,
	setLintFindingsFilter,
	useLintFindingsFilter,
} from "../../../stores/lint-dashboard-store";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { Chip } from "../../ui/chip";
import { Input } from "../../ui/input";
import { Segmented } from "../../ui/segmented";
import { Text } from "../../ui/text";
import { SectionHeading, SeverityBadge } from "./LintParts";
import {
	filterFindings,
	findingKey,
	formatFindingLocation,
	isFindingsFilterActive,
	type LintDesignNames,
} from "./lint-dashboard-model";
import { useVirtualRows } from "./useVirtualRows";

const SIDE_OPTIONS = [
	{ value: "code", label: "Code" },
	{ value: "design", label: "Design" },
] as const;

const SEVERITY_OPTIONS = [
	{ value: "error", label: "Errors" },
	{ value: "warning", label: "Warnings" },
	{ value: "info", label: "Info" },
] as const;

const selectClassName =
	"min-w-0 border-none bg-white px-2 py-1.5 text-xs text-slate-950 inset-shadow-[0_0_0_1px_#e2e8f0] focus:outline-none focus:inset-shadow-[0_0_0_1px_#06b6d4]";

function FindingRow({
	finding,
	isSelected,
	designNames,
	onSelect,
}: {
	finding: LintFinding;
	isSelected: boolean;
	designNames: LintDesignNames;
	onSelect: () => void;
}) {
	const location = formatFindingLocation(finding, designNames);
	return (
		<button
			type="button"
			data-lint-finding={finding.rule}
			data-selected={isSelected}
			className="flex w-full flex-col gap-1 border-b border-slate-100 px-3 py-2 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500 data-[selected=true]:bg-cyan-50"
			onClick={onSelect}
		>
			<span className="flex min-w-0 items-center gap-2">
				<SeverityBadge severity={finding.severity} />
				<span className="min-w-0 truncate font-mono text-[11px] text-slate-600">
					{finding.rule}
				</span>
				{finding.component ? (
					<Chip tone="scope" className="text-[10px]">
						{finding.component}
					</Chip>
				) : null}
			</span>
			<span className="line-clamp-2 text-xs text-slate-900">
				{finding.message}
			</span>
			{location ? (
				<span className="truncate font-mono text-[10px] text-slate-500">
					{location}
				</span>
			) : null}
		</button>
	);
}

function ActiveFilterChip({
	label,
	onClear,
}: {
	label: string;
	onClear: () => void;
}) {
	return (
		<span className="inline-flex items-center gap-1 bg-cyan-50 py-0.5 pl-1.5 pr-0.5 font-mono text-[11px] text-cyan-800">
			{label}
			<button
				type="button"
				className="flex size-4 items-center justify-center hover:bg-cyan-100"
				onClick={onClear}
				aria-label={`Clear ${label}`}
			>
				<X className="size-3" aria-hidden="true" />
			</button>
		</span>
	);
}

export function LintFindingsView({
	report,
	selection,
	scrollElementRef,
	designNames,
}: {
	report: LintReport;
	selection: LintSelection | null;
	scrollElementRef: RefObject<HTMLDivElement | null>;
	designNames: LintDesignNames;
}) {
	const filter = useLintFindingsFilter();
	const findings = useMemo(
		() => filterFindings(report.findings, filter),
		[report.findings, filter],
	);
	const keys = useMemo(() => findings.map(findingKey), [findings]);
	const rules = useMemo(
		() => [...new Set(report.findings.map((finding) => finding.rule))].sort(),
		[report.findings],
	);
	const components = useMemo(
		() =>
			[
				...new Set(
					report.findings.flatMap((finding) =>
						finding.component ? [finding.component] : [],
					),
				),
			].sort(),
		[report.findings],
	);
	const { containerRef, virtualizer, scrollMargin } = useVirtualRows({
		count: findings.length,
		estimateSize: 64,
		scrollElementRef,
		getItemKey: (index) => keys[index] ?? String(index),
		measure: true,
	});
	const selectedKey = selection?.kind === "finding" ? selection.key : null;
	const update = (patch: Partial<LintFindingsFilter>) =>
		setLintFindingsFilter(patch);

	return (
		<div className="flex flex-col gap-4" data-lint-view="findings">
			<SectionHeading
				title="findings"
				detail={`${findings.length.toLocaleString()} of ${report.findings.length.toLocaleString()} findings`}
				actions={
					isFindingsFilterActive(filter) ? (
						<Button
							type="button"
							variant="ghost"
							className="px-2 py-1 text-xs"
							onClick={() => setLintFindingsFilter(emptyLintFindingsFilter())}
						>
							Clear filters
						</Button>
					) : null
				}
			/>
			<div className="flex flex-wrap items-center gap-2">
				<Segmented
					ariaLabel="Side"
					options={SIDE_OPTIONS}
					value={filter.side}
					onChange={(side) => update({ side })}
					className="flex-none"
				/>
				<Segmented
					ariaLabel="Severity"
					options={SEVERITY_OPTIONS}
					value={filter.severity}
					onChange={(severity) =>
						update({ severity: severity as LintSeverity | null })
					}
					className="flex-none"
				/>
				<select
					aria-label="Rule"
					className={selectClassName}
					value={filter.rule ?? ""}
					onChange={(event) => update({ rule: event.target.value || null })}
				>
					<option value="">All rules</option>
					{rules.map((rule) => (
						<option key={rule} value={rule}>
							{rule}
						</option>
					))}
				</select>
				<select
					aria-label="Component"
					className={selectClassName}
					value={filter.component ?? ""}
					onChange={(event) =>
						update({ component: event.target.value || null })
					}
				>
					<option value="">All components</option>
					{components.map((component) => (
						<option key={component} value={component}>
							{component}
						</option>
					))}
				</select>
				<div className="relative min-w-48 flex-1">
					<Search
						className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500"
						aria-hidden="true"
					/>
					<Input
						variant="formCompact"
						className="w-full px-7"
						aria-label="Search findings"
						placeholder="Search messages and locations"
						value={filter.text}
						onChange={(event) => update({ text: event.target.value })}
					/>
				</div>
			</div>
			{filter.file || filter.design ? (
				<div className="flex flex-wrap items-center gap-2">
					{filter.file ? (
						<ActiveFilterChip
							label={`in ${filter.file}`}
							onClear={() => update({ file: null })}
						/>
					) : null}
					{filter.design ? (
						<ActiveFilterChip
							label={`in ${designNames.get(filter.design) ?? filter.design}${filter.board ? ` › ${filter.board}` : ""}`}
							onClear={() => update({ design: null, board: null })}
						/>
					) : null}
				</div>
			) : null}
			{findings.length === 0 ? (
				<Card edge="inset" className="px-4 py-6">
					<Text tone="faint" className="text-xs">
						{report.findings.length === 0
							? "This report has no findings."
							: "No findings match the filters."}
					</Text>
				</Card>
			) : (
				<Card edge="inset" className="flex flex-col">
					<ul
						ref={containerRef}
						className="relative w-full"
						style={{ height: virtualizer.getTotalSize() }}
						aria-label="Findings"
					>
						{virtualizer.getVirtualItems().map((item) => {
							const finding = findings[item.index];
							const key = keys[item.index];
							if (!finding || !key) return null;
							return (
								<li
									key={item.key}
									ref={virtualizer.measureElement}
									data-index={item.index}
									className="absolute inset-x-0 top-0"
									style={{
										transform: `translateY(${item.start - scrollMargin}px)`,
									}}
								>
									<FindingRow
										finding={finding}
										isSelected={selectedKey === key}
										designNames={designNames}
										onSelect={() => selectLintItem({ kind: "finding", key })}
									/>
								</li>
							);
						})}
					</ul>
				</Card>
			)}
		</div>
	);
}
