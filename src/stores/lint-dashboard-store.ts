import { createStore, useSelector } from "@tanstack/react-store";
import type { LintSeverity } from "../lint/config";

// UI state of the lint page in the System editor: the active view, what the
// inspector shows and the filters the views link into. Shared by the rail,
// the workspace and the inspector; never persisted.

export type LintDashboardView =
	| "adherence"
	| "coverage"
	| "files"
	| "designs"
	| "findings"
	| "config";

export const LINT_DASHBOARD_VIEWS: Array<{
	value: LintDashboardView;
	label: string;
}> = [
	{ value: "adherence", label: "Adherence" },
	{ value: "coverage", label: "Coverage" },
	{ value: "files", label: "Code map" },
	{ value: "designs", label: "Design map" },
	{ value: "findings", label: "Findings" },
	{ value: "config", label: "Rules" },
];

export type LintSelection =
	| { kind: "finding"; key: string }
	| { kind: "file"; path: string }
	| { kind: "folder"; path: string }
	| { kind: "component"; slug: string }
	| { kind: "design"; design: string; board: string | null };

export type LintFindingsFilter = {
	side: "code" | "design" | null;
	severity: LintSeverity | null;
	rule: string | null;
	component: string | null;
	/** A file path, or a folder path matching every file under it. */
	file: string | null;
	design: string | null;
	/** Only with `design`. */
	board: string | null;
	/** Matched against the message, rule, component and location. */
	text: string;
};

export type LintCoverageFilter =
	| "all"
	| "gaps"
	| "published"
	| "generated"
	| "bound"
	| "usedInApp"
	| "usedInDesigns";

export type LintDashboardState = {
	view: LintDashboardView;
	selection: LintSelection | null;
	findingsFilter: LintFindingsFilter;
	coverageFilter: LintCoverageFilter;
};

export const emptyLintFindingsFilter = (): LintFindingsFilter => ({
	side: null,
	severity: null,
	rule: null,
	component: null,
	file: null,
	design: null,
	board: null,
	text: "",
});

const createDefaultState = (): LintDashboardState => ({
	view: "adherence",
	selection: null,
	findingsFilter: emptyLintFindingsFilter(),
	coverageFilter: "all",
});

export const lintDashboardStore = createStore<LintDashboardState>(
	createDefaultState(),
);

export function setLintDashboardView(view: LintDashboardView) {
	lintDashboardStore.setState((state) =>
		state.view === view ? state : { ...state, view, selection: null },
	);
}

export function selectLintItem(selection: LintSelection | null) {
	lintDashboardStore.setState((state) => ({ ...state, selection }));
}

export function setLintFindingsFilter(patch: Partial<LintFindingsFilter>) {
	lintDashboardStore.setState((state) => ({
		...state,
		findingsFilter: { ...state.findingsFilter, ...patch },
	}));
}

export function setLintCoverageFilter(coverageFilter: LintCoverageFilter) {
	lintDashboardStore.setState((state) => ({ ...state, coverageFilter }));
}

/** Opens the findings view with only the given filter applied. */
export function showLintFindings(filter: Partial<LintFindingsFilter>) {
	lintDashboardStore.setState((state) => ({
		...state,
		view: "findings",
		selection: null,
		findingsFilter: { ...emptyLintFindingsFilter(), ...filter },
	}));
}

/** Back to the defaults, for a different system and for tests. */
export function resetLintDashboard(state?: Partial<LintDashboardState>) {
	lintDashboardStore.setState(() => ({ ...createDefaultState(), ...state }));
}

export const useLintDashboardView = () =>
	useSelector(lintDashboardStore, (state) => state.view);

export const useLintSelection = () =>
	useSelector(lintDashboardStore, (state) => state.selection);

export const useLintFindingsFilter = () =>
	useSelector(lintDashboardStore, (state) => state.findingsFilter);

export const useLintCoverageFilter = () =>
	useSelector(lintDashboardStore, (state) => state.coverageFilter);
