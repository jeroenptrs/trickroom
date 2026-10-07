import {
	ChevronRight,
	FileCode,
	Folder,
	LayoutTemplate,
	PenTool,
	Search,
} from "lucide-react";
import { type RefObject, useCallback, useMemo, useState } from "react";
import type { LintReport } from "../../../lint/report";
import {
	type LintSelection,
	selectLintItem,
} from "../../../stores/lint-dashboard-store";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { EmptyState } from "../../ui/empty-state";
import { HeatSwatch } from "../../ui/heat-swatch";
import { Input } from "../../ui/input";
import { Segmented } from "../../ui/segmented";
import { Text } from "../../ui/text";
import { HeatLegend, SectionHeading } from "./LintParts";
import {
	buildDesignTree,
	buildFileTree,
	buildHeatScale,
	collectFolderIds,
	filterFiles,
	flattenHeatTree,
	type LintDesignNames,
	type LintHeatNode,
	type LintHeatRow,
	type LintHeatScale,
	type LintHeatSort,
	violationCount,
} from "./lint-dashboard-model";
import { useVirtualRows } from "./useVirtualRows";

const ROW_HEIGHT = 28;
const INDENT = 14;

const SORT_OPTIONS: Array<{ value: LintHeatSort; label: string }> = [
	{ value: "name", label: "Name" },
	{ value: "usages", label: "Usage" },
	{ value: "findings", label: "Findings" },
];

/** Top-level folders start open, so the first screen is not a single row. */
const initialExpanded = (root: LintHeatNode) =>
	new Set(
		root.children
			.filter((child) => child.kind === "folder" && child.children.length > 0)
			.map((child) => child.id),
	);

function HeatRow({
	row,
	usageScale,
	findingsScale,
	isSelected,
	onActivate,
	variant,
	style,
}: {
	row: LintHeatRow;
	usageScale: LintHeatScale;
	findingsScale: LintHeatScale;
	isSelected: boolean;
	onActivate: (row: LintHeatRow) => void;
	variant: "files" | "designs";
	style?: React.CSSProperties;
}) {
	const { node, depth, expanded } = row;
	const isFolder = node.kind === "folder";
	const hasChildren = node.children.length > 0;
	const violations = violationCount(node.findings);
	const Icon = isFolder
		? variant === "files"
			? Folder
			: PenTool
		: variant === "files"
			? FileCode
			: LayoutTemplate;
	return (
		<button
			type="button"
			data-lint-heat-row={node.id}
			data-selected={isSelected}
			aria-expanded={isFolder && hasChildren ? expanded : undefined}
			className="absolute inset-x-0 top-0 flex items-center gap-2 pr-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500 data-[selected=true]:bg-cyan-50"
			style={{ ...style, height: ROW_HEIGHT, paddingLeft: 8 + depth * INDENT }}
			onClick={() => onActivate(row)}
			title={node.id.replace(/^(design|board):/u, "")}
		>
			<ChevronRight
				className={`size-3.5 shrink-0 text-slate-400 transition-transform ${expanded ? "rotate-90" : ""} ${isFolder && hasChildren ? "" : "invisible"}`}
				aria-hidden="true"
			/>
			<Icon className="size-3.5 shrink-0 text-slate-400" aria-hidden="true" />
			<span
				className={`min-w-0 flex-1 truncate text-xs ${isFolder ? "font-medium text-slate-900" : "text-slate-800"}`}
			>
				{node.name}
			</span>
			{node.file?.role ? (
				<span className="shrink-0 font-mono text-[10px] text-slate-500">
					{node.file.role}
					{node.file.component ? ` · ${node.file.component}` : ""}
				</span>
			) : null}
			{isFolder && variant === "files" ? (
				<span className="w-14 shrink-0 text-right font-mono text-[10px] text-slate-400">
					{node.fileCount} {node.fileCount === 1 ? "file" : "files"}
				</span>
			) : null}
			<span className="flex w-16 shrink-0 items-center justify-end gap-1.5">
				<span className="font-mono text-[11px] text-slate-700">
					{node.usages}
				</span>
				<HeatSwatch
					scale="usage"
					step={usageScale.step(node.usages)}
					title={`${node.usages} usages`}
				/>
			</span>
			<span className="flex w-20 shrink-0 items-center justify-end gap-1.5">
				<span
					className={`font-mono text-[11px] ${node.findings.errors > 0 ? "text-red-700" : violations > 0 ? "text-amber-700" : "text-slate-400"}`}
				>
					{violations}
					{node.findings.info > 0 ? (
						<span className="text-cyan-700">+{node.findings.info}i</span>
					) : null}
				</span>
				<HeatSwatch
					scale="findings"
					step={findingsScale.step(violations)}
					title={`${node.findings.errors} errors, ${node.findings.warnings} warnings, ${node.findings.info} info`}
				/>
			</span>
		</button>
	);
}

function HeatTree({
	root,
	variant,
	selection,
	scrollElementRef,
	sort,
	expandAllByDefault,
}: {
	root: LintHeatNode;
	variant: "files" | "designs";
	selection: LintSelection | null;
	scrollElementRef: RefObject<HTMLDivElement | null>;
	sort: LintHeatSort;
	expandAllByDefault: boolean;
}) {
	const [expanded, setExpanded] = useState<Set<string> | null>(null);
	const effectiveExpanded = useMemo(
		() =>
			expanded ??
			(expandAllByDefault
				? new Set(collectFolderIds(root))
				: initialExpanded(root)),
		[expanded, expandAllByDefault, root],
	);
	const rows = useMemo(
		() => flattenHeatTree(root, effectiveExpanded, sort),
		[root, effectiveExpanded, sort],
	);
	// Scales over the leaves (files, boards); folders reuse them.
	const { usageScale, findingsScale } = useMemo(() => {
		const leaves: LintHeatNode[] = [];
		const visit = (node: LintHeatNode) => {
			for (const child of node.children) {
				if (child.kind === "file" || child.children.length === 0) {
					leaves.push(child);
				} else {
					visit(child);
				}
			}
		};
		visit(root);
		return {
			usageScale: buildHeatScale(leaves.map((leaf) => leaf.usages)),
			findingsScale: buildHeatScale(
				leaves.map((leaf) => violationCount(leaf.findings)),
			),
		};
	}, [root]);

	const { containerRef, virtualizer, scrollMargin } = useVirtualRows({
		count: rows.length,
		estimateSize: ROW_HEIGHT,
		scrollElementRef,
		getItemKey: (index) => rows[index]?.node.id ?? String(index),
	});

	const toggle = useCallback(
		(id: string) => {
			setExpanded((current) => {
				const next = new Set(current ?? effectiveExpanded);
				if (next.has(id)) next.delete(id);
				else next.add(id);
				return next;
			});
		},
		[effectiveExpanded],
	);

	const activate = useCallback(
		(row: LintHeatRow) => {
			const { node } = row;
			if (node.kind === "folder" && node.children.length > 0) {
				toggle(node.id);
			}
			if (variant === "files") {
				selectLintItem(
					node.kind === "file"
						? { kind: "file", path: node.id }
						: { kind: "folder", path: node.id },
				);
				return;
			}
			if (node.id.startsWith("design:")) {
				selectLintItem({
					kind: "design",
					design: node.id.slice("design:".length),
					board: null,
				});
			} else {
				const rest = node.id.slice("board:".length);
				const slash = rest.indexOf("/");
				selectLintItem({
					kind: "design",
					design: rest.slice(0, slash),
					board: rest.slice(slash + 1),
				});
			}
		},
		[toggle, variant],
	);

	const selectedId =
		selection?.kind === "file" || selection?.kind === "folder"
			? selection.path
			: selection?.kind === "design"
				? selection.board === null
					? `design:${selection.design}`
					: `board:${selection.design}/${selection.board}`
				: null;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex flex-wrap items-center gap-x-6 gap-y-2">
					<HeatLegend label="usage" scale={usageScale} kind="usage" />
					<HeatLegend
						label="findings (errors + warnings)"
						scale={findingsScale}
						kind="findings"
					/>
				</div>
				<div className="flex items-center gap-1">
					<Button
						type="button"
						variant="ghost"
						className="px-2 py-1 text-xs"
						onClick={() => setExpanded(new Set(collectFolderIds(root)))}
					>
						Expand all
					</Button>
					<Button
						type="button"
						variant="ghost"
						className="px-2 py-1 text-xs"
						onClick={() => setExpanded(new Set())}
					>
						Collapse all
					</Button>
				</div>
			</div>
			<Card edge="inset" className="flex flex-col">
				<div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2 font-mono text-[10px] text-slate-500">
					<span className="min-w-0 flex-1 pl-6">
						{variant === "files" ? "file" : "design / board"}
					</span>
					<span className="w-16 shrink-0 text-right">usages</span>
					<span className="w-20 shrink-0 text-right">findings</span>
				</div>
				<div
					ref={containerRef}
					className="relative w-full"
					style={{ height: virtualizer.getTotalSize() }}
					role="tree"
					aria-label={variant === "files" ? "Code heat map" : "Design heat map"}
				>
					{virtualizer.getVirtualItems().map((item) => {
						const row = rows[item.index];
						if (!row) return null;
						return (
							<HeatRow
								key={item.key}
								row={row}
								usageScale={usageScale}
								findingsScale={findingsScale}
								isSelected={selectedId === row.node.id}
								onActivate={activate}
								variant={variant}
								style={{
									transform: `translateY(${item.start - scrollMargin}px)`,
								}}
							/>
						);
					})}
				</div>
			</Card>
		</div>
	);
}

export function LintFileHeatMapView({
	report,
	selection,
	scrollElementRef,
}: {
	report: LintReport;
	selection: LintSelection | null;
	scrollElementRef: RefObject<HTMLDivElement | null>;
}) {
	const [text, setText] = useState("");
	const [onlyFindings, setOnlyFindings] = useState(false);
	const [sort, setSort] = useState<LintHeatSort>("name");
	const files = useMemo(
		() => filterFiles(report.files, { text, onlyFindings }),
		[report.files, text, onlyFindings],
	);
	const root = useMemo(() => buildFileTree(files), [files]);
	const isFiltered = text.trim().length > 0 || onlyFindings;

	return (
		<div className="flex flex-col gap-4" data-lint-view="files">
			<SectionHeading
				title="codebase"
				detail={`${report.files.length.toLocaleString()} files with a role, a usage or a finding, of ${report.summary.code.scanned.toLocaleString()} scanned. Folders add up their files.`}
			/>
			<div className="flex flex-wrap items-center gap-2">
				<div className="relative min-w-48 flex-1">
					<Search
						className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-500"
						aria-hidden="true"
					/>
					<Input
						variant="formCompact"
						className="w-full px-7"
						aria-label="Filter files"
						placeholder="Filter by path"
						value={text}
						onChange={(event) => setText(event.target.value)}
					/>
				</div>
				<Button
					type="button"
					variant={onlyFindings ? "filled" : "outlined"}
					className="px-3 py-1.5 text-xs"
					aria-pressed={onlyFindings}
					onClick={() => setOnlyFindings(!onlyFindings)}
				>
					With findings
				</Button>
				<Segmented
					ariaLabel="Sort"
					options={SORT_OPTIONS}
					value={sort}
					onChange={(next) => setSort(next ?? "name")}
					className="flex-none"
				/>
			</div>
			{files.length === 0 ? (
				<Text tone="faint" className="text-xs">
					{report.files.length === 0
						? "No scanned file has a role, a usage or a finding."
						: "No files match the filter."}
				</Text>
			) : (
				<HeatTree
					key={isFiltered ? `filtered:${text}:${onlyFindings}` : "all"}
					root={root}
					variant="files"
					selection={selection}
					scrollElementRef={scrollElementRef}
					sort={sort}
					expandAllByDefault={isFiltered}
				/>
			)}
		</div>
	);
}

export function LintDesignHeatMapView({
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
	const [sort, setSort] = useState<LintHeatSort>("name");
	const root = useMemo(
		() =>
			report.designs ? buildDesignTree(report.designs, designNames) : null,
		[report.designs, designNames],
	);

	if (!root || !report.summary.design) {
		return (
			<div data-lint-view="designs">
				<EmptyState
					icon={PenTool}
					title="No design-side results yet"
					description="This report covers the code side only. Per Design and board usage and findings appear here once design rules run as part of lint."
				/>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4" data-lint-view="designs">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<SectionHeading
					title="designs"
					detail={`${root.children.length.toLocaleString()} designs in this report, of ${report.summary.design.scanned.toLocaleString()} scanned. Designs add up their boards.`}
				/>
				<Segmented
					ariaLabel="Sort"
					options={SORT_OPTIONS}
					value={sort}
					onChange={(next) => setSort(next ?? "name")}
					className="flex-none"
				/>
			</div>
			{root.children.length === 0 ? (
				<Text tone="faint" className="text-xs">
					No design places a component of this system or has a finding.
				</Text>
			) : (
				<HeatTree
					root={root}
					variant="designs"
					selection={selection}
					scrollElementRef={scrollElementRef}
					sort={sort}
					expandAllByDefault={false}
				/>
			)}
		</div>
	);
}
