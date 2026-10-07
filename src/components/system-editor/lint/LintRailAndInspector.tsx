import { ExternalLink } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router";
import type { LintFinding, LintReport } from "../../../lint/report";
import type { ProjectQueryScope } from "../../../queries/project-scope";
import {
	LINT_DASHBOARD_VIEWS,
	type LintSelection,
	setLintDashboardView,
	showLintFindings,
	useLintDashboardView,
	useLintSelection,
} from "../../../stores/lint-dashboard-store";
import { buildDesignPath } from "../../../utils/design-deep-link";
import { formatRelativeTime } from "../../project/project-view-utils";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { StateCell } from "../../ui/state-cell";
import { Text } from "../../ui/text";
import {
	CountTriplet,
	SeverityBadge,
	useDesignNames,
	useSystemLint,
} from "./LintParts";
import {
	countCoverage,
	countReportDesigns,
	coverageCellState,
	findingKey,
	formatFindingLocation,
	isReportStale,
	isUnderPath,
	LINT_COVERAGE_STATES,
	type LintDesignNames,
	totalFindings,
} from "./lint-dashboard-model";

const MAX_LISTED_FINDINGS = 50;

/** Rail content of the lint page: the views, with what each holds. */
export function SystemEditorLintRail({
	systemId,
	projectScope,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
}) {
	const view = useLintDashboardView();
	const { report, currentContractHash, hasNoReport } = useSystemLint(
		systemId,
		projectScope,
	);
	const gapCount = useMemo(
		() => (report ? countCoverage(report.components).withGaps : null),
		[report],
	);
	const detail = (value: (typeof LINT_DASHBOARD_VIEWS)[number]["value"]) => {
		if (!report) return null;
		switch (value) {
			case "adherence": {
				const total = totalFindings(report.summary);
				return `${total.errors}E ${total.warnings}W`;
			}
			case "coverage":
				return `${gapCount ?? 0} gaps`;
			case "files":
				return `${report.files.length} files`;
			case "designs":
				return report.designs
					? `${countReportDesigns(report.designs)} designs`
					: "n/a";
			case "findings":
				return String(report.findings.length);
			default:
				return null;
		}
	};
	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 py-3">
			<nav className="flex flex-col gap-px" aria-label="Lint views">
				{LINT_DASHBOARD_VIEWS.map((entry) => (
					<Button
						key={entry.value}
						type="button"
						variant="block"
						isSelected={view === entry.value}
						className="flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs"
						onClick={() => setLintDashboardView(entry.value)}
					>
						<span>{entry.label}</span>
						<span className="font-mono text-[10px] text-slate-500">
							{detail(entry.value)}
						</span>
					</Button>
				))}
			</nav>
			<div className="flex flex-col gap-1 border-t border-slate-200 px-2 pt-3">
				<Text variant="section-header">report</Text>
				{report ? (
					<>
						<div className="flex items-center gap-2">
							<Badge
								tone={report.status === "pass" ? "success" : "danger"}
								edge="stamped"
							>
								{report.status}
							</Badge>
							{isReportStale(report, currentContractHash) ? (
								<Badge tone="warning" edge="stamped">
									Stale
								</Badge>
							) : null}
						</div>
						<Text tone="faint" className="font-mono text-[10px]">
							generated {formatRelativeTime(report.generatedAt)}
						</Text>
					</>
				) : (
					<Text tone="faint" className="text-[11px]">
						{hasNoReport ? "Not run yet." : "Loading…"}
					</Text>
				)}
			</div>
		</div>
	);
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-3 py-1">
			<span className="shrink-0 text-slate-500">{label}</span>
			<span className="min-w-0 truncate text-right font-mono text-[11px] text-slate-900">
				{value}
			</span>
		</div>
	);
}

function FindingList({
	findings,
	designNames,
	showLocation = true,
}: {
	findings: readonly LintFinding[];
	designNames: LintDesignNames;
	showLocation?: boolean;
}) {
	if (findings.length === 0) {
		return (
			<Text tone="faint" className="text-xs">
				No findings.
			</Text>
		);
	}
	return (
		<ul className="flex flex-col gap-2">
			{findings.slice(0, MAX_LISTED_FINDINGS).map((finding) => (
				<li key={findingKey(finding)} className="flex flex-col gap-0.5">
					<span className="flex items-center gap-1.5">
						<SeverityBadge severity={finding.severity} />
						<span className="truncate font-mono text-[10px] text-slate-500">
							{finding.rule}
						</span>
					</span>
					<span className="text-xs text-slate-900">{finding.message}</span>
					{showLocation ? (
						<span className="font-mono text-[10px] text-slate-500">
							{formatFindingLocation(finding, designNames)}
						</span>
					) : null}
				</li>
			))}
			{findings.length > MAX_LISTED_FINDINGS ? (
				<li>
					<Text tone="faint" className="text-[11px]">
						and {findings.length - MAX_LISTED_FINDINGS} more
					</Text>
				</li>
			) : null}
		</ul>
	);
}

function OpenInEditorLink({
	design,
	board,
	element,
}: {
	design: string;
	board?: string | null;
	element?: string | null;
}) {
	return (
		<Link
			to={buildDesignPath(design, { boardId: board, layerId: element })}
			className="inline-flex items-center gap-1.5 self-start px-2 py-1.5 text-xs font-medium text-slate-950 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 hover:bg-slate-100"
		>
			<ExternalLink className="size-3.5" aria-hidden="true" />
			Open in editor
		</Link>
	);
}

function ShowFindingsButton({
	label,
	onClick,
}: {
	label: string;
	onClick: () => void;
}) {
	return (
		<Button
			type="button"
			variant="outlined"
			className="self-start px-2 py-1.5 text-xs"
			onClick={onClick}
		>
			{label}
		</Button>
	);
}

function FindingInspector({
	finding,
	designNames,
}: {
	finding: LintFinding;
	designNames: LintDesignNames;
}) {
	const location = finding.location;
	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center gap-2">
				<SeverityBadge severity={finding.severity} />
				<Badge tone="neutral">{finding.side}</Badge>
			</div>
			<Text className="text-sm text-slate-900">{finding.message}</Text>
			<div className="flex flex-col">
				<Field label="Rule" value={finding.rule} />
				{finding.component ? (
					<Field label="Component" value={finding.component} />
				) : null}
				{location?.kind === "code" ? (
					<>
						<Field label="File" value={location.file} />
						{location.line !== undefined ? (
							<Field
								label="Line"
								value={`${location.line}${location.column !== undefined ? `:${location.column}` : ""}`}
							/>
						) : null}
					</>
				) : null}
				{location?.kind === "design" ? (
					<>
						<Field
							label="Design"
							value={designNames.get(location.design) ?? location.design}
						/>
						{location.board ? (
							<Field label="Board" value={location.board} />
						) : null}
						{location.element ? (
							<Field label="Element" value={location.element} />
						) : null}
						{location.path ? (
							<Field label="Path" value={location.path} />
						) : null}
					</>
				) : null}
				{location === null ? <Field label="Location" value="none" /> : null}
			</div>
			{location?.kind === "design" ? (
				<OpenInEditorLink
					design={location.design}
					board={location.board}
					element={location.element}
				/>
			) : null}
			<div className="flex flex-wrap gap-2">
				<ShowFindingsButton
					label="All findings of this rule"
					onClick={() =>
						showLintFindings({ rule: finding.rule, side: finding.side })
					}
				/>
				{location?.kind === "code" ? (
					<ShowFindingsButton
						label="All in this file"
						onClick={() => showLintFindings({ file: location.file })}
					/>
				) : null}
			</div>
		</div>
	);
}

function FileInspector({
	report,
	path,
	isFolder,
	designNames,
}: {
	report: LintReport;
	path: string;
	isFolder: boolean;
	designNames: LintDesignNames;
}) {
	const files = report.files.filter((file) =>
		isFolder ? isUnderPath(file.file, path) : file.file === path,
	);
	const file = isFolder ? null : (files[0] ?? null);
	const totals = files.reduce(
		(sum, entry) => ({
			usages: sum.usages + entry.usages,
			errors: sum.errors + entry.findings.errors,
			warnings: sum.warnings + entry.findings.warnings,
			info: sum.info + entry.findings.info,
		}),
		{ usages: 0, errors: 0, warnings: 0, info: 0 },
	);
	const findings = report.findings.filter(
		(finding) =>
			finding.location?.kind === "code" &&
			isUnderPath(finding.location.file, path),
	);
	return (
		<div className="flex flex-col gap-3">
			<Text className="break-all font-mono text-xs text-slate-900">{path}</Text>
			<div className="flex flex-col">
				{isFolder ? <Field label="Files" value={files.length} /> : null}
				{file?.role ? <Field label="Role" value={file.role} /> : null}
				{file?.component ? (
					<Field label="Component" value={file.component} />
				) : null}
				<Field label="Usages" value={totals.usages} />
				<Field
					label="Findings"
					value={
						<CountTriplet
							errors={totals.errors}
							warnings={totals.warnings}
							info={totals.info}
						/>
					}
				/>
			</div>
			{findings.length > 0 ? (
				<ShowFindingsButton
					label={`Show ${findings.length} in findings`}
					onClick={() => showLintFindings({ file: path })}
				/>
			) : null}
			<FindingList
				findings={findings}
				designNames={designNames}
				showLocation={isFolder}
			/>
		</div>
	);
}

function ComponentInspector({
	report,
	slug,
	designNames,
}: {
	report: LintReport;
	slug: string;
	designNames: LintDesignNames;
}) {
	const component = report.components.find((entry) => entry.slug === slug);
	if (!component) {
		return (
			<Text tone="faint" className="text-xs">
				This component is not in the current report.
			</Text>
		);
	}
	const findings = report.findings.filter(
		(finding) => finding.component === slug,
	);
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col">
				<Text className="text-sm font-medium text-slate-900">
					{component.name}
				</Text>
				<Text tone="faint" className="font-mono text-[11px]">
					{component.slug} · {component.componentId}
				</Text>
			</div>
			<ul className="flex flex-col gap-2">
				{LINT_COVERAGE_STATES.map((state) => {
					const cell = coverageCellState(component, state.key);
					return (
						<li
							key={state.key}
							className="flex items-start gap-2"
							data-coverage-state={state.key}
						>
							<StateCell state={cell}>{state.short}</StateCell>
							<span className="flex min-w-0 flex-col">
								<span
									className={`text-xs ${cell === "gap" ? "font-medium text-amber-800" : "text-slate-900"}`}
								>
									{cell === "gap" ? state.gap : state.label}
									{cell === "unknown" ? " (unknown)" : ""}
								</span>
								{cell === "gap" ? (
									<span className="text-[11px] text-slate-600">
										{state.hint}
									</span>
								) : cell === "unknown" ? (
									<span className="text-[11px] text-slate-500">
										{state.unknown}
									</span>
								) : null}
							</span>
						</li>
					);
				})}
			</ul>
			<div className="flex flex-col">
				<Field label="Usages in app" value={component.usages} />
				<Field label="Usages in designs" value={component.designUsages ?? 0} />
				<Field label="Wrappers" value={component.wrappers.length} />
			</div>
			{component.wrappers.length > 0 ? (
				<ul className="flex flex-col gap-0.5 font-mono text-[11px] text-slate-700">
					{component.wrappers.map((wrapper) => (
						<li key={wrapper} className="break-all">
							{wrapper}
						</li>
					))}
				</ul>
			) : null}
			{findings.length > 0 ? (
				<ShowFindingsButton
					label={`Show ${findings.length} in findings`}
					onClick={() => showLintFindings({ component: slug })}
				/>
			) : null}
			<FindingList findings={findings} designNames={designNames} />
		</div>
	);
}

function DesignInspector({
	report,
	design,
	board,
	designNames,
}: {
	report: LintReport;
	design: string;
	board: string | null;
	designNames: LintDesignNames;
}) {
	const rows = (report.designs ?? []).filter(
		(entry) =>
			entry.design === design && (board === null || entry.board === board),
	);
	const totals = rows.reduce(
		(sum, entry) => ({
			usages: sum.usages + entry.usages,
			errors: sum.errors + entry.findings.errors,
			warnings: sum.warnings + entry.findings.warnings,
			info: sum.info + entry.findings.info,
		}),
		{ usages: 0, errors: 0, warnings: 0, info: 0 },
	);
	const findings = report.findings.filter(
		(finding) =>
			finding.location?.kind === "design" &&
			finding.location.design === design &&
			(board === null || finding.location.board === board),
	);
	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-col">
				<Text className="text-sm font-medium text-slate-900">
					{designNames.get(design) ?? design}
				</Text>
				<Text tone="faint" className="font-mono text-[11px]">
					{design}
					{board ? ` › ${board}` : ""}
				</Text>
			</div>
			<div className="flex flex-col">
				{board === null ? (
					<Field
						label="Boards"
						value={rows.filter((entry) => entry.board !== null).length}
					/>
				) : null}
				<Field label="Usages" value={totals.usages} />
				<Field
					label="Findings"
					value={
						<CountTriplet
							errors={totals.errors}
							warnings={totals.warnings}
							info={totals.info}
						/>
					}
				/>
			</div>
			<OpenInEditorLink design={design} board={board} />
			{findings.length > 0 ? (
				<ShowFindingsButton
					label={`Show ${findings.length} in findings`}
					onClick={() => showLintFindings({ design, board })}
				/>
			) : null}
			<FindingList findings={findings} designNames={designNames} />
		</div>
	);
}

/** Inspector body of the lint page: details of the selected item. */
export function SystemEditorLintInspector({
	systemId,
	projectScope,
}: {
	systemId: string;
	projectScope?: ProjectQueryScope;
}) {
	const selection = useLintSelection();
	const { report } = useSystemLint(systemId, projectScope);
	const designNames = useDesignNames(
		Boolean(report?.designs?.length),
		projectScope,
	);
	if (!report || !selection) {
		return (
			<Text tone="faint" className="text-xs">
				Select a finding, file, component or design to see its details.
			</Text>
		);
	}
	return (
		<LintSelectionDetails
			report={report}
			selection={selection}
			designNames={designNames}
		/>
	);
}

function LintSelectionDetails({
	report,
	selection,
	designNames,
}: {
	report: LintReport;
	selection: LintSelection;
	designNames: LintDesignNames;
}) {
	switch (selection.kind) {
		case "finding": {
			const finding = report.findings.find(
				(entry) => findingKey(entry) === selection.key,
			);
			return finding ? (
				<FindingInspector finding={finding} designNames={designNames} />
			) : (
				<Text tone="faint" className="text-xs">
					This finding is not in the current report.
				</Text>
			);
		}
		case "file":
		case "folder":
			return (
				<FileInspector
					report={report}
					path={selection.path}
					isFolder={selection.kind === "folder"}
					designNames={designNames}
				/>
			);
		case "component":
			return (
				<ComponentInspector
					report={report}
					slug={selection.slug}
					designNames={designNames}
				/>
			);
		case "design":
			return (
				<DesignInspector
					report={report}
					design={selection.design}
					board={selection.board}
					designNames={designNames}
				/>
			);
	}
}
