import { describeComponentLocation } from "../../../lint/component-location";
import type { LintSeverity, LintThresholds } from "../../../lint/config";
import type { LintRatchetResult } from "../../../lint/ratchet";
import type {
	LintComponentCoverage,
	LintDesignStats,
	LintFileStats,
	LintFinding,
	LintReport,
	LintSeverityCounts,
} from "../../../lint/report";
import type {
	LintCoverageFilter,
	LintFindingsFilter,
} from "../../../stores/lint-dashboard-store";

/**
 * Pure helpers behind the lint dashboard. Every number shown comes from the
 * report (docs/lint.md): these functions only reshape it (group, aggregate a
 * tree, filter, look up the ratchet comparison); none recomputes a finding,
 * a coverage state or a ratchet outcome.
 */

export type LintSide = "code" | "design";

// ---------------------------------------------------------------------------
// Ratchet

/** Metrics where a higher number is better, as `src/lint/ratchet.ts` has it. */
const isHigherBetterMetric = (metric: string) => metric.startsWith("coverage.");

export type LintMetricComparison = {
	metric: string;
	current: number;
	/** Null on the first run: nothing to compare against. */
	baseline: number | null;
	/** `current - baseline`; null without a baseline. */
	delta: number | null;
	/** The delta is a change for the worse. */
	worse: boolean;
	/** The run listed this metric as a regression. */
	regressed: boolean;
	breach: { kind: "max" | "min"; limit: number } | null;
};

/**
 * One tracked number of this run against the baseline it compared with
 * (`ratchet.numbers` against `ratchet.baseline.numbers`; a missing number
 * counts as 0, like the ratchet does).
 */
export const compareLintMetric = (
	ratchet: LintRatchetResult,
	metric: string,
): LintMetricComparison => {
	const current = ratchet.numbers[metric] ?? 0;
	const baseline = ratchet.baseline
		? (ratchet.baseline.numbers[metric] ?? 0)
		: null;
	const delta = baseline === null ? null : current - baseline;
	const breach = ratchet.breaches.find((entry) => entry.metric === metric);
	return {
		metric,
		current,
		baseline,
		delta,
		worse:
			delta !== null && (isHigherBetterMetric(metric) ? delta < 0 : delta > 0),
		regressed: ratchet.regressions.some((entry) => entry.metric === metric),
		breach: breach ? { kind: breach.kind, limit: breach.limit } : null,
	};
};

export const formatDelta = (delta: number | null) => {
	if (delta === null) return "new";
	if (delta === 0) return "±0";
	return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
};

/** The configured limit for a metric, from `lint.json` thresholds. */
export const thresholdForMetric = (
	thresholds: LintThresholds | undefined,
	metric: string,
): { kind: "max" | "min"; limit: number } | null => {
	if (!thresholds) return null;
	const [scope, ...rest] = metric.split(".");
	const key = rest.join(".");
	let limit: number | undefined;
	if (scope === "code" || scope === "design") {
		limit = thresholds[scope]?.[key as "errors" | "warnings"];
	} else if (scope === "rule") {
		limit = thresholds.rules?.[key];
	} else if (scope === "coverage") {
		limit = thresholds.coverage?.[key as LintCoverageState];
	}
	if (limit === undefined) return null;
	return { kind: scope === "coverage" ? "min" : "max", limit };
};

export type LintRuleRow = {
	id: string;
	counts: LintSeverityCounts;
	comparison: LintMetricComparison;
};

/** The rule kinds of a side as `summary[side].rules` lists them, by id. */
export const ruleRowsForSide = (
	report: LintReport,
	side: LintSide,
): LintRuleRow[] | null => {
	const summary = report.summary[side];
	if (!summary) return null;
	return Object.entries(summary.rules)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([id, counts]) => ({
			id,
			counts,
			comparison: compareLintMetric(report.ratchet, `rule.${id}`),
		}));
};

export type LintRuleRowSeverity = {
	severity: LintSeverity;
	/** False when the kind had no findings and `severity` is lint.json's. */
	fromReport: boolean;
	/** What the badge's tooltip says. */
	title: string;
};

const plural = (count: number, word: string) =>
	`${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * The severity a rule row shows: the most severe one the report counted for
 * the kind (an info-only kind, such as the codegen check without a codegen
 * block, is info), else the severity lint.json configures, muted.
 */
export const ruleRowSeverity = (
	counts: LintSeverityCounts,
	configured: LintSeverity | null,
): LintRuleRowSeverity | null => {
	const counted = [
		counts.errors > 0 ? plural(counts.errors, "error") : null,
		counts.warnings > 0 ? plural(counts.warnings, "warning") : null,
		counts.info > 0 ? `${counts.info} info` : null,
	].filter((part): part is string => part !== null);
	const severity: LintSeverity | null =
		counts.errors > 0
			? "error"
			: counts.warnings > 0
				? "warning"
				: counts.info > 0
					? "info"
					: null;
	if (severity) {
		return {
			severity,
			fromReport: true,
			title: `In this report: ${counted.join(", ")}`,
		};
	}
	return configured
		? {
				severity: configured,
				fromReport: false,
				title: "No findings in this report; the severity lint.json sets",
			}
		: null;
};

// ---------------------------------------------------------------------------
// Coverage

export type LintCoverageState =
	| "published"
	| "generated"
	| "bound"
	| "usedInApp"
	| "usedInDesigns";

export const LINT_COVERAGE_STATES: Array<{
	key: LintCoverageState;
	label: string;
	short: string;
	gap: string;
	/** What to do about the gap. */
	hint: string;
	/** Why the state can be unknown (null in the report). */
	unknown: string;
}> = [
	{
		key: "published",
		label: "Published",
		short: "P",
		gap: "Not published",
		hint: "Publish a version in the Components page; drafts are never linted.",
		unknown: "Unknown.",
	},
	{
		key: "generated",
		label: "Generated",
		short: "G",
		gap: "Not generated",
		hint: 'Run "trickroom codegen" so a current variants file exists.',
		unknown: "Codegen is not configured for this project.",
	},
	{
		key: "bound",
		label: "Bound",
		short: "B",
		gap: "Unbound",
		hint: "Import the variants file from a wrapper component, or name the wrapper in lint.json components.",
		unknown: "No source files were scanned.",
	},
	{
		key: "usedInApp",
		label: "Used in app",
		short: "A",
		gap: "Unused in app",
		hint: "No scanned JSX renders this component's wrapper.",
		unknown: "No source files were scanned.",
	},
	{
		key: "usedInDesigns",
		label: "Used in designs",
		short: "D",
		gap: "Unused in designs",
		hint: "No Design places an instance of this component.",
		unknown: "This report has no design-side results yet.",
	},
];

export type LintCoverageCellState = "met" | "gap" | "unknown";

export const coverageCellState = (
	component: LintComponentCoverage,
	state: LintCoverageState,
): LintCoverageCellState => {
	const value = component[state];
	if (value === null) return "unknown";
	return value ? "met" : "gap";
};

/** The states this component is missing; unknown states are not gaps. */
export const coverageGaps = (
	component: LintComponentCoverage,
): LintCoverageState[] =>
	LINT_COVERAGE_STATES.filter((state) => component[state.key] === false).map(
		(state) => state.key,
	);

export const filterCoverage = (
	components: readonly LintComponentCoverage[],
	filter: LintCoverageFilter,
	search = "",
) => {
	const query = search.trim().toLowerCase();
	return components.filter((component) => {
		if (filter === "gaps" && coverageGaps(component).length === 0) {
			return false;
		}
		if (filter !== "all" && filter !== "gaps" && component[filter] !== false) {
			return false;
		}
		return (
			query.length === 0 ||
			`${component.name} ${component.slug}`.toLowerCase().includes(query)
		);
	});
};

/** Components per state, from the report rows (not recomputed from code). */
export const countCoverage = (components: readonly LintComponentCoverage[]) => {
	const counts = Object.fromEntries(
		LINT_COVERAGE_STATES.map((state) => [
			state.key,
			{ met: 0, gap: 0, unknown: 0 },
		]),
	) as Record<LintCoverageState, Record<LintCoverageCellState, number>>;
	let withGaps = 0;
	for (const component of components) {
		for (const state of LINT_COVERAGE_STATES) {
			counts[state.key][coverageCellState(component, state.key)] += 1;
		}
		if (coverageGaps(component).length > 0) withGaps += 1;
	}
	return { states: counts, withGaps };
};

// ---------------------------------------------------------------------------
// Heat map tree

export type LintHeatNode = {
	/** Unique path; folders end without a slash. */
	id: string;
	name: string;
	kind: "folder" | "file";
	usages: number;
	findings: LintSeverityCounts;
	/** Files under this node (1 for a file). */
	fileCount: number;
	children: LintHeatNode[];
	/** The report row of a file. */
	file: LintFileStats | null;
};

const emptyCounts = (): LintSeverityCounts => ({
	errors: 0,
	warnings: 0,
	info: 0,
});

const addCounts = (target: LintSeverityCounts, source: LintSeverityCounts) => {
	target.errors += source.errors;
	target.warnings += source.warnings;
	target.info += source.info;
};

/** Both sides' counts added up, for one total over the report. */
export const totalFindings = (
	summary: LintReport["summary"],
): LintSeverityCounts => {
	const total = { ...summary.code.findings };
	if (summary.design) addCounts(total, summary.design.findings);
	return total;
};

/** The designs `designs[]` lists, without counting their board rows. */
export const countReportDesigns = (designs: readonly LintDesignStats[]) =>
	new Set(designs.map((row) => row.design)).size;

/** Errors plus warnings: the violations, as the ratchet tracks them. */
export const violationCount = (counts: LintSeverityCounts) =>
	counts.errors + counts.warnings;

const folderNode = (id: string, name: string): LintHeatNode => ({
	id,
	name,
	kind: "folder",
	usages: 0,
	findings: emptyCounts(),
	fileCount: 0,
	children: [],
	file: null,
});

/**
 * The file tree of `files[]`: folders aggregate their children's usages,
 * finding counts and file counts. A folder whose only child is a folder is
 * merged into it (`src/components/ui`), so deep single-child chains take one
 * row. Children are folders first, then files, by name.
 */
export const buildFileTree = (
	files: readonly LintFileStats[],
): LintHeatNode => {
	const root = folderNode("", "");
	const folders = new Map<string, LintHeatNode>([["", root]]);
	for (const file of files) {
		const segments = file.file.split("/");
		let parent = root;
		for (let index = 0; index < segments.length - 1; index += 1) {
			const id = segments.slice(0, index + 1).join("/");
			let folder = folders.get(id);
			if (!folder) {
				folder = folderNode(id, segments[index] ?? id);
				folders.set(id, folder);
				parent.children.push(folder);
			}
			parent = folder;
		}
		parent.children.push({
			id: file.file,
			name: segments.at(-1) ?? file.file,
			kind: "file",
			usages: file.usages,
			findings: { ...file.findings },
			fileCount: 1,
			children: [],
			file,
		});
	}
	const finish = (node: LintHeatNode): LintHeatNode => {
		if (node.kind === "file") return node;
		node.children = node.children.map(finish);
		node.children.sort((left, right) =>
			left.kind === right.kind
				? left.name.localeCompare(right.name)
				: left.kind === "folder"
					? -1
					: 1,
		);
		for (const child of node.children) {
			node.usages += child.usages;
			node.fileCount += child.fileCount;
			addCounts(node.findings, child.findings);
		}
		const only = node.children[0];
		if (
			node !== root &&
			node.children.length === 1 &&
			only?.kind === "folder"
		) {
			return { ...only, name: `${node.name}/${only.name}` };
		}
		return node;
	};
	return finish(root);
};

export type LintDesignNames = ReadonlyMap<string, string>;

/**
 * The design tree of `designs[]`: one row per design aggregating its boards'
 * rows. A row with `board: null` holds what is not on a board; it adds to
 * the design and is not listed as a board.
 */
export const buildDesignTree = (
	designs: readonly LintDesignStats[],
	names: LintDesignNames = new Map(),
): LintHeatNode => {
	const root = folderNode("", "");
	const byDesign = new Map<string, LintHeatNode>();
	for (const entry of designs) {
		let design = byDesign.get(entry.design);
		if (!design) {
			design = folderNode(
				`design:${entry.design}`,
				names.get(entry.design) ?? entry.design,
			);
			byDesign.set(entry.design, design);
			root.children.push(design);
		}
		design.usages += entry.usages;
		addCounts(design.findings, entry.findings);
		if (entry.board !== null) {
			design.children.push({
				id: `board:${entry.design}/${entry.board}`,
				name: entry.board,
				kind: "file",
				usages: entry.usages,
				findings: { ...entry.findings },
				fileCount: 1,
				children: [],
				file: null,
			});
		}
	}
	for (const design of root.children) {
		design.fileCount = design.children.length;
		root.usages += design.usages;
		addCounts(root.findings, design.findings);
	}
	root.children.sort((left, right) => left.name.localeCompare(right.name));
	return root;
};

export type LintHeatSort = "name" | "usages" | "findings";

export type LintHeatRow = {
	node: LintHeatNode;
	depth: number;
	expanded: boolean;
};

const sortChildren = (children: LintHeatNode[], sort: LintHeatSort) => {
	if (sort === "name") return children;
	const value = (node: LintHeatNode) =>
		sort === "usages" ? node.usages : violationCount(node.findings);
	return [...children].sort(
		(left, right) =>
			value(right) - value(left) || left.name.localeCompare(right.name),
	);
};

/** The visible rows of a tree: children of expanded folders, depth first. */
export const flattenHeatTree = (
	root: LintHeatNode,
	expanded: ReadonlySet<string>,
	sort: LintHeatSort = "name",
): LintHeatRow[] => {
	const rows: LintHeatRow[] = [];
	const visit = (node: LintHeatNode, depth: number) => {
		for (const child of sortChildren(node.children, sort)) {
			const isExpanded = child.kind === "folder" && expanded.has(child.id);
			rows.push({ node: child, depth, expanded: isExpanded });
			if (isExpanded) visit(child, depth + 1);
		}
	};
	visit(root, 0);
	return rows;
};

/** Every folder id of a tree, for "expand all". */
export const collectFolderIds = (root: LintHeatNode): string[] => {
	const ids: string[] = [];
	const visit = (node: LintHeatNode) => {
		for (const child of node.children) {
			if (child.kind === "folder" && child.children.length > 0) {
				ids.push(child.id);
				visit(child);
			}
		}
	};
	visit(root);
	return ids;
};

export const findHeatNode = (
	root: LintHeatNode,
	id: string,
): LintHeatNode | null => {
	if (root.id === id) return root;
	for (const child of root.children) {
		if (id === child.id || id.startsWith(`${child.id}/`)) {
			const found = findHeatNode(child, id);
			if (found) return found;
		}
	}
	return null;
};

export const filterFiles = (
	files: readonly LintFileStats[],
	{ text, onlyFindings }: { text: string; onlyFindings: boolean },
) => {
	const query = text.trim().toLowerCase();
	return files.filter(
		(file) =>
			(!onlyFindings ||
				file.findings.errors + file.findings.warnings + file.findings.info >
					0) &&
			(query.length === 0 || file.file.toLowerCase().includes(query)),
	);
};

// ---------------------------------------------------------------------------
// Heat scale

export type LintHeatStep = 0 | 1 | 2 | 3 | 4;

export type LintHeatScale = {
	/** Upper bounds of steps 1 to 3; step 4 is anything above the last. */
	cuts: [number, number, number] | null;
	step: (value: number) => LintHeatStep;
	/** Legend entries for the steps that can occur. */
	legend: Array<{ step: LintHeatStep; label: string }>;
};

const quantile = (sorted: readonly number[], q: number) =>
	sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;

/**
 * A few discrete steps over the non-zero values (quartiles), so a handful of
 * hot files do not wash out the rest. Zero is always its own step. Folders
 * use the scale of their files, so a busy folder reads as hot.
 */
export const buildHeatScale = (values: readonly number[]): LintHeatScale => {
	const nonZero = values.filter((value) => value > 0).sort((a, b) => a - b);
	if (nonZero.length === 0) {
		return {
			cuts: null,
			step: (value) => (value > 0 ? 4 : 0),
			legend: [{ step: 0, label: "0" }],
		};
	}
	const cuts: [number, number, number] = [
		quantile(nonZero, 0.25),
		quantile(nonZero, 0.5),
		quantile(nonZero, 0.75),
	];
	const step = (value: number): LintHeatStep => {
		if (value <= 0) return 0;
		if (value <= cuts[0]) return 1;
		if (value <= cuts[1]) return 2;
		if (value <= cuts[2]) return 3;
		return 4;
	};
	const legend: LintHeatScale["legend"] = [{ step: 0, label: "0" }];
	let lower = 1;
	for (const [index, upper] of cuts.entries()) {
		if (upper >= lower) {
			legend.push({
				step: (index + 1) as LintHeatStep,
				label: upper === lower ? `${upper}` : `${lower}–${upper}`,
			});
			lower = upper + 1;
		}
	}
	legend.push({ step: 4, label: `${lower}+` });
	return { cuts, step, legend };
};

// ---------------------------------------------------------------------------
// Findings

/** Stable identity of a finding within a report. */
export const findingKey = (finding: LintFinding) => {
	const location = finding.location;
	const component = finding.componentLocation;
	const where =
		location === null
			? component
				? `${component.componentId}@${component.version}/${component.path ?? ""}/${component.axis ?? ""}/${component.value ?? ""}/${component.compound ?? ""}`
				: ""
			: location.kind === "code"
				? `${location.file}:${location.line ?? ""}:${location.column ?? ""}`
				: `${location.design}/${location.board ?? ""}/${location.element ?? ""}/${location.path ?? ""}`;
	return [
		finding.side,
		finding.rule,
		finding.severity,
		finding.component ?? "",
		where,
		finding.message,
	].join("\u0000");
};

export const isUnderPath = (file: string, pathOrFolder: string) =>
	file === pathOrFolder || file.startsWith(`${pathOrFolder}/`);

export const formatFindingLocation = (
	finding: LintFinding,
	designNames: LintDesignNames = new Map(),
) => {
	const location = finding.location;
	if (location === null) {
		return finding.componentLocation
			? describeComponentLocation(finding.componentLocation, finding.component)
			: null;
	}
	if (location.kind === "code") {
		return [location.file, location.line, location.column]
			.filter((part) => part !== undefined)
			.join(":");
	}
	return [
		designNames.get(location.design) ?? location.design,
		location.board,
		location.element,
		location.path,
	]
		.filter((part): part is string => Boolean(part))
		.join(" › ");
};

export const filterFindings = (
	findings: readonly LintFinding[],
	filter: LintFindingsFilter,
) => {
	const query = filter.text.trim().toLowerCase();
	return findings.filter((finding) => {
		if (filter.side && finding.side !== filter.side) return false;
		if (filter.severity && finding.severity !== filter.severity) return false;
		if (filter.rule && finding.rule !== filter.rule) return false;
		if (filter.component && finding.component !== filter.component) {
			return false;
		}
		const location = finding.location;
		if (filter.file) {
			if (location?.kind !== "code") return false;
			if (!isUnderPath(location.file, filter.file)) return false;
		}
		if (filter.design) {
			if (location?.kind !== "design") return false;
			if (location.design !== filter.design) return false;
			if (filter.board && location.board !== filter.board) return false;
		}
		if (query.length > 0) {
			const haystack = [
				finding.message,
				finding.rule,
				finding.component ?? "",
				formatFindingLocation(finding) ?? "",
			]
				.join(" ")
				.toLowerCase();
			if (!haystack.includes(query)) return false;
		}
		return true;
	});
};

export const isFindingsFilterActive = (filter: LintFindingsFilter) =>
	Boolean(
		filter.side ||
			filter.severity ||
			filter.rule ||
			filter.component ||
			filter.file ||
			filter.design ||
			filter.text.trim(),
	);

export const severityTone = (severity: LintSeverity) =>
	severity === "error"
		? ("danger" as const)
		: severity === "warning"
			? ("warning" as const)
			: ("info" as const);

/** Report-level facts the rail and the header show. */
export const isReportStale = (
	report: LintReport,
	currentContractHash: string | null | undefined,
) =>
	typeof currentContractHash === "string" &&
	currentContractHash !== report.contract.hash;
