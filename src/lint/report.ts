import { readFile } from "node:fs/promises";
import path from "node:path";
import {
	type FileLockHandle,
	withFileLock,
} from "../services/design-file-lock";
import type { LintSeverity } from "./config";
import type { LintRatchetResult } from "./ratchet";
import type { LintLocation, LintSide } from "./rules/types";
import { resolveWritableSystemDir, writeSystemFileAtomic } from "./system-file";

/**
 * `.trickroom/systems/<id>/lint-report.json`: the latest lint run of one
 * system, committed, and the ratchet baseline. CLI, MCP and the server
 * write it; the dashboard reads it and computes nothing itself. Every list
 * is stably sorted so the committed file diffs cleanly. Documented in
 * docs/lint.md.
 */

export const LINT_REPORT_VERSION = 1;
export const LINT_REPORT_FILE_NAME = "lint-report.json";

export type LintFinding = {
	/** Rule kind id, e.g. `code.variants-file-stale`. */
	rule: string;
	severity: LintSeverity;
	side: LintSide;
	message: string;
	/** Component slug, when known. */
	component?: string;
	location: LintLocation | null;
};

export type LintSeverityCounts = {
	errors: number;
	warnings: number;
	info: number;
};

export type LintSideSummary = {
	findings: LintSeverityCounts;
	/** Keyed by rule kind id; every enabled kind of the side is present. */
	rules: Record<string, LintSeverityCounts>;
	/** Code: scanned source files. Design: scanned design files. */
	scanned: number;
};

export type LintComponentCoverage = {
	slug: string;
	componentId: string;
	name: string;
	/** Has a published version. */
	published: boolean;
	/** Its variants file is on disk and current; null without a codegen block. */
	generated: boolean | null;
	/** A scanned module binds its variants file; null when no sources were scanned. */
	bound: boolean | null;
	/** Rendered by JSX somewhere in the scanned sources; null as above. */
	usedInApp: boolean | null;
	/** Placed in a Design linked to the system. */
	usedInDesigns: boolean | null;
	/** The bound wrapper module(s). */
	wrappers: string[];
	/** JSX usages in the scanned sources. */
	usages: number;
	/**
	 * Instances placed in the linked Designs. Always written by runs that
	 * read designs; reports written before that read as 0.
	 */
	designUsages?: number;
};

export type LintFileStats = {
	/** Relative to the project root, `/` separators. */
	file: string;
	/** What the file is to the system, when it is one of these. */
	role: "generated" | "wrapper" | null;
	/** Component slug for generated and wrapper files. */
	component: string | null;
	usages: number;
	findings: LintSeverityCounts;
};

export type LintDesignStats = {
	/** Design file id. */
	design: string;
	/** Board id; null for the row of the whole design. */
	board: string | null;
	usages: number;
	findings: LintSeverityCounts;
};

export type LintRatchetBaseline = {
	/** When the baseline numbers were computed (a passing run). */
	generatedAt: string;
	/** Tracked numbers, see `ratchet.ts`. */
	numbers: Record<string, number>;
	/**
	 * Every rule kind id the writers of the baseline knew (the ledger of
	 * ever-shipped ids, the registry, earlier baselines' `kinds`), enabled
	 * or not; only grows. A kind not listed is adopted by the next run.
	 * Absent in baselines written before kinds were recorded, see
	 * `ratchet.ts`.
	 */
	kinds?: string[];
};

export type LintReport = {
	version: typeof LINT_REPORT_VERSION;
	generatedAt: string;
	system: { id: string; name: string };
	contract: { hash: string; components: number };
	config: { present: boolean };
	/** The ratchet outcome of the run that wrote this report (`ratchet.status`). */
	status: "pass" | "fail";
	summary: { code: LintSideSummary; design: LintSideSummary | null };
	findings: LintFinding[];
	components: LintComponentCoverage[];
	/** Files with a role, a usage or a finding; other scanned files are counted only. */
	files: LintFileStats[];
	/**
	 * One row per linked design (`board: null`) and per board; null when
	 * the report predates the design side.
	 */
	designs: LintDesignStats[] | null;
	/**
	 * This run's comparison: the baseline it compared against (with its
	 * numbers), what got worse, what broke a threshold, and this run's
	 * numbers. The dashboard's delta against the committed baseline comes
	 * from here, so an improvement keeps the numbers it improved on.
	 */
	ratchet: LintRatchetResult;
	/**
	 * What the next run ratchets against. A passing run sets it to its own
	 * numbers; a failing run written on demand keeps the previous baseline,
	 * so a failing report never lowers the bar.
	 */
	ratchetBaseline: LintRatchetBaseline;
};

export const emptySeverityCounts = (): LintSeverityCounts => ({
	errors: 0,
	warnings: 0,
	info: 0,
});

export const countSeverity = (
	counts: LintSeverityCounts,
	severity: LintSeverity,
) => {
	if (severity === "error") counts.errors += 1;
	else if (severity === "warning") counts.warnings += 1;
	else counts.info += 1;
};

const compareStrings = (left: string, right: string) =>
	left < right ? -1 : left > right ? 1 : 0;

const compareOptional = (
	left: string | number | undefined,
	right: string | number | undefined,
) => {
	if (left === right) return 0;
	if (left === undefined) return -1;
	if (right === undefined) return 1;
	return typeof left === "number" && typeof right === "number"
		? left - right
		: compareStrings(String(left), String(right));
};

const compareLocations = (
	left: LintLocation | null,
	right: LintLocation | null,
) => {
	if (left === null || right === null)
		return left === right ? 0 : left === null ? -1 : 1;
	if (left.kind !== right.kind) return left.kind === "code" ? -1 : 1;
	if (left.kind === "code" && right.kind === "code") {
		return (
			compareStrings(left.file, right.file) ||
			compareOptional(left.line, right.line) ||
			compareOptional(left.column, right.column)
		);
	}
	if (left.kind === "design" && right.kind === "design") {
		return (
			compareStrings(left.design, right.design) ||
			compareOptional(left.board, right.board) ||
			compareOptional(left.element, right.element) ||
			compareOptional(left.path, right.path)
		);
	}
	return 0;
};

const SEVERITY_ORDER: Record<LintSeverity, number> = {
	error: 0,
	warning: 1,
	info: 2,
};

/** Side, rule, location, severity, component, message. */
const compareLintFindings = (left: LintFinding, right: LintFinding) =>
	compareStrings(left.side, right.side) ||
	compareStrings(left.rule, right.rule) ||
	compareLocations(left.location, right.location) ||
	SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
	compareOptional(left.component, right.component) ||
	compareStrings(left.message, right.message);

export const sortLintFindings = (findings: readonly LintFinding[]) =>
	[...findings].sort(compareLintFindings);

export const summarizeFindings = (
	findings: readonly LintFinding[],
	side: LintSide,
	ruleIds: readonly string[],
	scanned: number,
): LintSideSummary => {
	const summary: LintSideSummary = {
		findings: emptySeverityCounts(),
		rules: Object.fromEntries(
			[...ruleIds]
				.sort(compareStrings)
				.map((id) => [id, emptySeverityCounts()]),
		),
		scanned,
	};
	for (const finding of findings) {
		if (finding.side !== side) continue;
		countSeverity(summary.findings, finding.severity);
		summary.rules[finding.rule] ??= emptySeverityCounts();
		countSeverity(summary.rules[finding.rule], finding.severity);
	}
	summary.rules = Object.fromEntries(
		Object.entries(summary.rules).sort(([left], [right]) =>
			compareStrings(left, right),
		),
	);
	return summary;
};

const sortedComponents = (components: readonly LintComponentCoverage[]) =>
	[...components]
		.map((component) => ({
			...component,
			designUsages: component.designUsages ?? 0,
		}))
		.sort((left, right) => compareStrings(left.slug, right.slug));

const sortedFiles = (files: readonly LintFileStats[]) =>
	[...files].sort((left, right) => compareStrings(left.file, right.file));

const sortedDesigns = (designs: readonly LintDesignStats[]) =>
	[...designs].sort(
		(left, right) =>
			compareStrings(left.design, right.design) ||
			compareOptional(left.board ?? undefined, right.board ?? undefined),
	);

const sortedNumbers = (numbers: Record<string, number>) =>
	Object.fromEntries(
		Object.entries(numbers).sort(([left], [right]) =>
			compareStrings(left, right),
		),
	);

const normalizeBaseline = (
	baseline: LintRatchetBaseline,
): LintRatchetBaseline => ({
	generatedAt: baseline.generatedAt,
	numbers: sortedNumbers(baseline.numbers),
	...(baseline.kinds
		? { kinds: [...baseline.kinds].sort(compareStrings) }
		: {}),
});

const byMetric = <T extends { metric: string }>(entries: readonly T[]) =>
	[...entries].sort((left, right) => compareStrings(left.metric, right.metric));

const normalizeRatchet = (ratchet: LintRatchetResult): LintRatchetResult => ({
	status: ratchet.status,
	baseline: ratchet.baseline ? normalizeBaseline(ratchet.baseline) : null,
	regressions: byMetric(ratchet.regressions).map((entry) => ({ ...entry })),
	breaches: byMetric(ratchet.breaches).map((entry) => ({ ...entry })),
	// Reports written before adoption have no list.
	adopted: byMetric(ratchet.adopted ?? []).map((entry) => ({ ...entry })),
	numbers: sortedNumbers(ratchet.numbers),
});

/** A report with every list in its stable order. */
export const normalizeLintReport = (report: LintReport): LintReport => ({
	version: report.version,
	generatedAt: report.generatedAt,
	system: { id: report.system.id, name: report.system.name },
	contract: { ...report.contract },
	config: { ...report.config },
	status: report.status,
	summary: {
		code: { ...report.summary.code },
		design: report.summary.design ? { ...report.summary.design } : null,
	},
	findings: sortLintFindings(report.findings),
	components: sortedComponents(report.components),
	files: sortedFiles(report.files),
	designs: report.designs ? sortedDesigns(report.designs) : null,
	ratchet: normalizeRatchet(report.ratchet),
	ratchetBaseline: normalizeBaseline(report.ratchetBaseline),
});

export const serializeLintReport = (report: LintReport): string =>
	`${JSON.stringify(normalizeLintReport(report), null, "\t")}\n`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isCounts = (value: unknown): value is LintSeverityCounts =>
	isRecord(value) &&
	typeof value.errors === "number" &&
	typeof value.warnings === "number" &&
	typeof value.info === "number";

const isSideSummary = (value: unknown): value is LintSideSummary =>
	isRecord(value) &&
	isCounts(value.findings) &&
	isRecord(value.rules) &&
	Object.values(value.rules).every(isCounts) &&
	typeof value.scanned === "number";

const isLocation = (value: unknown): value is LintLocation | null =>
	value === null ||
	(isRecord(value) &&
		((value.kind === "code" && typeof value.file === "string") ||
			(value.kind === "design" && typeof value.design === "string")));

const isFinding = (value: unknown): value is LintFinding =>
	isRecord(value) &&
	typeof value.rule === "string" &&
	(value.severity === "error" ||
		value.severity === "warning" ||
		value.severity === "info") &&
	(value.side === "code" || value.side === "design") &&
	typeof value.message === "string" &&
	isLocation(value.location);

const isNullableBoolean = (value: unknown) =>
	value === null || typeof value === "boolean";

const isCoverage = (value: unknown): value is LintComponentCoverage =>
	isRecord(value) &&
	typeof value.slug === "string" &&
	typeof value.componentId === "string" &&
	typeof value.name === "string" &&
	typeof value.published === "boolean" &&
	isNullableBoolean(value.generated) &&
	isNullableBoolean(value.bound) &&
	isNullableBoolean(value.usedInApp) &&
	isNullableBoolean(value.usedInDesigns) &&
	Array.isArray(value.wrappers) &&
	typeof value.usages === "number" &&
	(value.designUsages === undefined || typeof value.designUsages === "number");

const isFileStats = (value: unknown): value is LintFileStats =>
	isRecord(value) &&
	typeof value.file === "string" &&
	(value.role === "generated" ||
		value.role === "wrapper" ||
		value.role === null) &&
	(typeof value.component === "string" || value.component === null) &&
	typeof value.usages === "number" &&
	isCounts(value.findings);

const isDesignStats = (value: unknown): value is LintDesignStats =>
	isRecord(value) &&
	typeof value.design === "string" &&
	(typeof value.board === "string" || value.board === null) &&
	typeof value.usages === "number" &&
	isCounts(value.findings);

const isNumbers = (value: unknown): value is Record<string, number> =>
	isRecord(value) &&
	Object.values(value).every((entry) => typeof entry === "number");

const isBaseline = (value: unknown): value is LintRatchetBaseline =>
	isRecord(value) &&
	typeof value.generatedAt === "string" &&
	isNumbers(value.numbers) &&
	(value.kinds === undefined ||
		(Array.isArray(value.kinds) &&
			value.kinds.every((entry) => typeof entry === "string")));

const isRatchet = (value: unknown): value is LintRatchetResult =>
	isRecord(value) &&
	(value.status === "pass" || value.status === "fail") &&
	(value.baseline === null || isBaseline(value.baseline)) &&
	Array.isArray(value.regressions) &&
	value.regressions.every(
		(entry) =>
			isRecord(entry) &&
			typeof entry.metric === "string" &&
			typeof entry.baseline === "number" &&
			typeof entry.current === "number",
	) &&
	Array.isArray(value.breaches) &&
	value.breaches.every(
		(entry) =>
			isRecord(entry) &&
			typeof entry.metric === "string" &&
			(entry.kind === "max" || entry.kind === "min") &&
			typeof entry.limit === "number" &&
			typeof entry.current === "number",
	) &&
	(value.adopted === undefined ||
		(Array.isArray(value.adopted) &&
			value.adopted.every(
				(entry) =>
					isRecord(entry) &&
					typeof entry.metric === "string" &&
					typeof entry.current === "number",
			))) &&
	isNumbers(value.numbers);

export type LintReportIssue = {
	code: "INVALID_REPORT" | "UNSUPPORTED_VERSION";
	message: string;
};

/** The report a stored value holds, or the reason it cannot be used. */
export const parseLintReport = (
	value: unknown,
):
	| { report: LintReport; issue: null }
	| { report: null; issue: LintReportIssue } => {
	if (!isRecord(value)) {
		return {
			report: null,
			issue: {
				code: "INVALID_REPORT",
				message: "lint-report.json must be a JSON object.",
			},
		};
	}
	if (value.version !== LINT_REPORT_VERSION) {
		return {
			report: null,
			issue: {
				code: "UNSUPPORTED_VERSION",
				message: `lint-report.json version ${JSON.stringify(value.version)} is not supported; this Trickroom understands version ${LINT_REPORT_VERSION}.`,
			},
		};
	}
	const valid =
		typeof value.generatedAt === "string" &&
		isRecord(value.system) &&
		typeof value.system.id === "string" &&
		typeof value.system.name === "string" &&
		isRecord(value.contract) &&
		typeof value.contract.hash === "string" &&
		typeof value.contract.components === "number" &&
		isRecord(value.config) &&
		typeof value.config.present === "boolean" &&
		(value.status === "pass" || value.status === "fail") &&
		isRecord(value.summary) &&
		isSideSummary(value.summary.code) &&
		(value.summary.design === null || isSideSummary(value.summary.design)) &&
		Array.isArray(value.findings) &&
		value.findings.every(isFinding) &&
		Array.isArray(value.components) &&
		value.components.every(isCoverage) &&
		Array.isArray(value.files) &&
		value.files.every(isFileStats) &&
		(value.designs === null ||
			(Array.isArray(value.designs) && value.designs.every(isDesignStats))) &&
		isRatchet(value.ratchet) &&
		isBaseline(value.ratchetBaseline);
	if (!valid) {
		return {
			report: null,
			issue: {
				code: "INVALID_REPORT",
				message: "lint-report.json does not have the expected shape.",
			},
		};
	}
	return {
		report: normalizeLintReport(value as unknown as LintReport),
		issue: null,
	};
};

export type LintReportRead =
	| { status: "absent"; path: string }
	| { status: "invalid"; path: string; issue: LintReportIssue }
	| { status: "present"; path: string; report: LintReport };

/** The committed report of a system folder, when there is one. */
export async function readLintReport(
	systemDir: string,
): Promise<LintReportRead> {
	const reportPath = path.join(systemDir, LINT_REPORT_FILE_NAME);
	let text: string;
	try {
		text = await readFile(reportPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { status: "absent", path: reportPath };
		}
		// A folder, a permission problem, an unreadable link: not a baseline.
		return {
			status: "invalid",
			path: reportPath,
			issue: {
				code: "INVALID_REPORT",
				message: `lint-report.json could not be read: ${error instanceof Error ? error.message : String(error)}`,
			},
		};
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return {
			status: "invalid",
			path: reportPath,
			issue: {
				code: "INVALID_REPORT",
				message: `lint-report.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
			},
		};
	}
	const parsed = parseLintReport(value);
	return parsed.report
		? { status: "present", path: reportPath, report: parsed.report }
		: { status: "invalid", path: reportPath, issue: parsed.issue };
}

export class LintReportWriteError extends Error {
	readonly code: "REPORT_PATH_OUTSIDE_SYSTEMS";
	constructor(message: string) {
		super(message);
		this.name = "LintReportWriteError";
		this.code = "REPORT_PATH_OUTSIDE_SYSTEMS";
	}
}

/**
 * Write the report atomically (temp file and rename) into a system folder.
 * With symlinks followed, `.trickroom/systems` must be exactly that folder
 * under the real project root (not a link elsewhere) and the system folder
 * a direct child of it, so nothing is ever written outside the project.
 * Returns the file text written.
 */
export const LINT_REPORT_LOCK_FILE_NAME = `${LINT_REPORT_FILE_NAME}.lock`;

/**
 * Runs `operation` holding `lint-report.json.lock` in the system folder,
 * taken with an exclusive create, so one process at a time reads the
 * committed report and replaces it. The lock names its pid, host, time
 * and a token; one whose holder on this host has exited is reclaimed (one
 * whose pid cannot be checked once older than 30 seconds), a live holder's
 * never. `operation` gets the lock handle for the fencing check before its
 * rename. Throws `DesignFileLockTimeoutError` after waiting 5 seconds, and
 * `LintReportWriteError` when the folder is not a writable system folder
 * (the lock is never created outside one).
 */
export async function withLintReportLock<T>(
	projectRoot: string,
	systemDir: string,
	operation: (lock: FileLockHandle) => Promise<T>,
): Promise<T> {
	const realSystemDir = await resolveWritableSystemDir({
		projectRoot,
		systemDir,
		fileName: LINT_REPORT_FILE_NAME,
		refuse: (message) => new LintReportWriteError(message),
	});
	return withFileLock(
		path.join(realSystemDir, LINT_REPORT_LOCK_FILE_NAME),
		operation,
		{
			label: "lint report",
			staleAfterMs: 30_000,
			acquireTimeoutMs: 5_000,
			retryDelayMs: 25,
			createDirectory: false,
		},
	);
}

export async function writeLintReport(
	projectRoot: string,
	systemDir: string,
	report: LintReport,
	options: {
		/** Runs between writing the temp file and renaming it into place. */
		beforeRename?: () => Promise<void>;
	} = {},
): Promise<{ path: string; contents: string }> {
	return writeSystemFileAtomic({
		projectRoot,
		systemDir,
		fileName: LINT_REPORT_FILE_NAME,
		contents: serializeLintReport(report),
		refuse: (message) => new LintReportWriteError(message),
		beforeRename: options.beforeRename,
	});
}
