import { ArrowRight, Boxes } from "lucide-react";
import { Link } from "react-router";
import { describeComponentClassSource } from "../../../lint/component-location";
import type { LintFinding, LintReport } from "../../../lint/report";
import type { ProjectQueryScope } from "../../../queries/project-scope";
import {
	type LintSelection,
	showLintFindings,
	useLintSelection,
} from "../../../stores/lint-dashboard-store";
import { buildDesignPath } from "../../../utils/design-deep-link";
import { buildSystemComponentPath } from "../../../utils/system-deep-link";
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
	coverageCellState,
	findingKey,
	formatFindingLocation,
	isUnderPath,
	LINT_COVERAGE_STATES,
	type LintDesignNames,
} from "./lint-dashboard-model";

const MAX_LISTED_FINDINGS = 50;

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
	systemId,
	findings,
	designNames,
	showLocation = true,
}: {
	systemId: string;
	findings: readonly LintFinding[];
	designNames: LintDesignNames;
	showLocation?: boolean;
}) {
	if (findings.length === 0) {
		return <Text variant="meta">No findings</Text>;
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
						<span
							className={`text-[10px] text-slate-500 ${finding.location?.kind === "design" ? "" : "font-mono"}`}
						>
							{formatFindingLocation(finding, designNames)}
						</span>
					) : null}
					{finding.componentLocation ? (
						<GoToComponentLink systemId={systemId} finding={finding} compact />
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
			Open design
			<ArrowRight className="size-3.5" aria-hidden="true" />
		</Link>
	);
}

/**
 * Opens the component a definition finding is on in the System editor, at the
 * template node of `componentLocation.path` when the draft is of its version.
 */
function GoToComponentLink({
	systemId,
	finding,
	compact = false,
}: {
	systemId: string;
	finding: LintFinding;
	compact?: boolean;
}) {
	const componentLocation = finding.componentLocation;
	if (!componentLocation) return null;
	return (
		<Link
			to={buildSystemComponentPath(systemId, componentLocation.componentId, {
				version: componentLocation.version,
				path: componentLocation.path,
			})}
			data-lint-go-to-component={componentLocation.componentId}
			className={
				compact
					? "inline-flex items-center gap-1 self-start text-xs text-cyan-700 hover:underline"
					: "inline-flex items-center gap-1.5 self-start px-2 py-1.5 text-xs font-medium text-slate-950 inset-shadow-[0_0_0_1px] inset-shadow-slate-200 hover:bg-slate-100"
			}
		>
			<Boxes className={compact ? "size-3" : "size-3.5"} aria-hidden="true" />
			Go to component
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
	systemId,
	finding,
	designNames,
}: {
	systemId: string;
	finding: LintFinding;
	designNames: LintDesignNames;
}) {
	const location = finding.location;
	const componentLocation = finding.componentLocation;
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
							<Field
								label="Board"
								value={designNames.get(location.board) ?? location.board}
							/>
						) : null}
						{location.element ? (
							<Field
								label="Layer"
								value={designNames.get(location.element) ?? location.element}
							/>
						) : null}
						{location.path ? (
							<Field label="Path" value={location.path} />
						) : null}
					</>
				) : null}
				{componentLocation ? (
					<>
						<Field label="Version" value={componentLocation.version} />
						{componentLocation.path ? (
							<Field label="Template path" value={componentLocation.path} />
						) : null}
						<Field
							label="Classes of"
							value={describeComponentClassSource(componentLocation)}
						/>
					</>
				) : location === null ? (
					<Field label="Location" value="none" />
				) : null}
			</div>
			{location?.kind === "design" ? (
				<OpenInEditorLink
					design={location.design}
					board={location.board}
					element={location.element}
				/>
			) : null}
			{componentLocation ? (
				<GoToComponentLink systemId={systemId} finding={finding} />
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
				{componentLocation && finding.component ? (
					<ShowFindingsButton
						label="All of this component"
						onClick={() => showLintFindings({ component: finding.component })}
					/>
				) : null}
			</div>
		</div>
	);
}

function FileInspector({
	systemId,
	report,
	path,
	isFolder,
	designNames,
}: {
	systemId: string;
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
				systemId={systemId}
				findings={findings}
				designNames={designNames}
				showLocation={isFolder}
			/>
		</div>
	);
}

function ComponentInspector({
	systemId,
	report,
	slug,
	designNames,
}: {
	systemId: string;
	report: LintReport;
	slug: string;
	designNames: LintDesignNames;
}) {
	const component = report.components.find((entry) => entry.slug === slug);
	if (!component) {
		return (
			<Text variant="meta">This component is not in the current report.</Text>
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
					{component.slug}
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
			<FindingList
				systemId={systemId}
				findings={findings}
				designNames={designNames}
			/>
		</div>
	);
}

function DesignInspector({
	systemId,
	report,
	design,
	board,
	designNames,
}: {
	systemId: string;
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
				{board ? (
					<Text tone="faint" className="text-[11px]">
						{designNames.get(board) ?? board}
					</Text>
				) : null}
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
			<FindingList
				systemId={systemId}
				findings={findings}
				designNames={designNames}
			/>
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
	const designNames = useDesignNames(report, projectScope);
	if (!report || !selection) {
		return (
			<Text variant="meta">
				Select a finding, file, component or design to see its details.
			</Text>
		);
	}
	return (
		<LintSelectionDetails
			systemId={systemId}
			report={report}
			selection={selection}
			designNames={designNames}
		/>
	);
}

function LintSelectionDetails({
	systemId,
	report,
	selection,
	designNames,
}: {
	systemId: string;
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
				<FindingInspector
					systemId={systemId}
					finding={finding}
					designNames={designNames}
				/>
			) : (
				<Text variant="meta">This finding is not in the current report.</Text>
			);
		}
		case "file":
		case "folder":
			return (
				<FileInspector
					systemId={systemId}
					report={report}
					path={selection.path}
					isFolder={selection.kind === "folder"}
					designNames={designNames}
				/>
			);
		case "component":
			return (
				<ComponentInspector
					systemId={systemId}
					report={report}
					slug={selection.slug}
					designNames={designNames}
				/>
			);
		case "design":
			return (
				<DesignInspector
					systemId={systemId}
					report={report}
					design={selection.design}
					board={selection.board}
					designNames={designNames}
				/>
			);
	}
}
