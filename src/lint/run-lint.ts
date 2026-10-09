import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveCodegenConfig } from "../codegen/config";
import { type CodegenRunResult, runCodegen } from "../codegen/run-codegen";
import { readProjectConfigReadOnly } from "../project";
import {
	DesignFileLockTimeoutError,
	FileLockLostError,
} from "../services/design-file-lock";
import { createDesignFileService } from "../services/design-file-service";
import { createClassTokenInspector } from "../utils/class-token-diagnostics";
import { designReferencesSystemHandle } from "../utils/design-resource-references";
import {
	type DesignSystemRecord,
	findDesignSystem,
	listDesignSystems,
} from "../utils/design-system-store";
import {
	readSystemComponentManifest,
	SystemComponentManifestServiceError,
} from "../utils/system-component-manifest-service";
import { canonicalizeTailwindCandidatesInWorker } from "../utils/tailwind-canonicalize-client";
import {
	loadCachedTailwindDesignSystem,
	type TailwindDesignSystem,
} from "../utils/tailwind-design-system";
import { readDomainTokensReadonly } from "../utils/tailwind-token-store";
import {
	LINT_CONFIG_FILE_NAME,
	type ResolvedLintConfig,
	resolveLintConfig,
} from "./config";
import { readLintConfigFile } from "./config-file";
import { buildSystemContract, type SystemContract } from "./contract";
import {
	buildLintDesignIndex,
	countDesignUsages,
	type LintDesignIndex,
	type LintDesignInput,
} from "./designs";
import {
	collectTrackedNumbers,
	compareLintRatchet,
	type LintRatchetResult,
	nextRatchetBaseline,
} from "./ratchet";
import {
	countSeverity,
	emptySeverityCounts,
	LINT_REPORT_FILE_NAME,
	LINT_REPORT_LOCK_FILE_NAME,
	LINT_REPORT_VERSION,
	type LintComponentCoverage,
	type LintDesignStats,
	type LintFileStats,
	type LintFinding,
	type LintReport,
	type LintReportRead,
	LintReportWriteError,
	normalizeLintReport,
	readLintReport,
	summarizeFindings,
	withLintReportLock,
	writeLintReport,
} from "./report";
import { lintRuleRegistry } from "./rules/index";
import type { LintRuleRegistry } from "./rules/registry";
import type { LintTailwindInspector } from "./rules/types";
import { runLintRules, toReportFinding } from "./run-rules";
import {
	buildSourceIndex,
	countUsagesByFile,
	type SourceIndex,
} from "./source/index";
import { parseSourceModule, type SourceModule } from "./source/parse";
import { walkSourceFiles } from "./source/walk";

/**
 * Connects the pure lint modules to the filesystem, for `trickroom lint`,
 * the `lint` MCP tool and the server's lint routes. Reads the project
 * config, the system and its components (read-only, never migrating),
 * `lint.json` and the token snapshot; builds the contract; runs the codegen
 * check; scans and indexes the sources; runs the rule kinds; ratchets the
 * result against the committed report; writes the report under the
 * system folder when the write mode says so. Never prints.
 *
 * Writes: only `.trickroom/systems/<id>/lint-report.json`, atomically, and
 * only when the system folder resolves (symlinks followed) to a direct
 * child of `.trickroom/systems`. Nothing else on disk changes; a check
 * writes nothing at all.
 */

export type LintWriteMode = "on-pass" | "always" | "never";

export type RunLintInput = {
	projectRoot: string;
	/** System id, name or storage key; defaults as documented in docs/lint.md. */
	system?: string | null;
	/** Never write; the result still carries the report and the ratchet. */
	check?: boolean;
	/** When to write the report; `on-pass` unless `check` is set. */
	write?: LintWriteMode;
	registry?: LintRuleRegistry;
	formatterTimeoutMs?: number;
	now?: () => Date;
};

export type LintRunDiagnosticCode =
	| "NOT_A_PROJECT"
	| "INVALID_CONFIG"
	| "NO_SYSTEM"
	| "SYSTEM_NOT_FOUND"
	| "INVALID_COMPONENT_MANIFEST"
	| "COMPONENT_MANIFEST_DIAGNOSTIC"
	| "INVALID_LINT_CONFIG"
	| "CODEGEN_OTHER_SYSTEM"
	| "INVALID_BASELINE"
	| "BASELINE_MOVED"
	| "REPORT_LOCKED"
	| "SOURCE_PARSE_ERROR"
	| "SOURCE_ROOT_MISSING"
	| "SOURCES_TRUNCATED"
	| "SOURCES_UNREADABLE"
	| "RULE_FAILED"
	| "WRITE_FAILED"
	| "WRAPPER_MODULE_NOT_SCANNED"
	| "DESIGN_UNREADABLE"
	| "DESIGNS_UNREADABLE"
	| "RUN_FAILED";

export type LintRunDiagnostic = {
	code: LintRunDiagnosticCode;
	severity: "error" | "warning";
	message: string;
	path?: string;
};

export type LintRunResult = {
	/** `error`: the run could not complete; nothing was written. */
	status: "pass" | "fail" | "error";
	mode: "check" | "write";
	system: { id: string; name: string } | null;
	report: LintReport | null;
	ratchet: LintRatchetResult | null;
	/** What the ratchet compared against. */
	baseline: "absent" | "invalid" | "present" | null;
	/** Where the report lives, relative to the project root. */
	reportPath: string | null;
	/** True when this run wrote the report. */
	written: boolean;
	diagnostics: LintRunDiagnostic[];
};

/** A platform path with `/` separators, as the report and diagnostics write it. */
export const toPosix = (value: string) => value.split(path.sep).join("/");

const MAX_PARSE_ERROR_DIAGNOSTICS = 50;

/**
 * Compiles the system CSS on first use for every rule of a run. The compiled
 * system is cached across runs and validation calls until the CSS changes
 * (`loadCachedTailwindDesignSystem`).
 */
const lintInspectors = new WeakMap<
	TailwindDesignSystem,
	LintTailwindInspector
>();

export const createTailwindInspectorLoader = (
	projectRoot: string,
	cssPath: string | null,
): (() => Promise<LintTailwindInspector | null>) => {
	let pending: Promise<LintTailwindInspector | null> | null = null;
	return () => {
		if (!cssPath?.trim()) {
			return Promise.resolve(null);
		}
		pending ??= loadCachedTailwindDesignSystem({ projectRoot, cssPath })
			.then(({ designSystem }) => {
				// One inspector per compiled system, so a cached system keeps it.
				let inspector = lintInspectors.get(designSystem);
				if (!inspector) {
					inspector = {
						...createClassTokenInspector(designSystem),
						// Off the main thread: the first canonicalization on a compiled
						// system takes seconds (see tailwind-canonicalize-worker.ts).
						canonicalize: (candidates) =>
							canonicalizeTailwindCandidatesInWorker(
								{ projectRoot, cssPath },
								candidates,
							),
					};
					lintInspectors.set(designSystem, inspector);
				}
				return inspector;
			})
			.catch(() => null);
		return pending;
	};
};

/**
 * The designs linked to the system (by `systemId`, or a legacy
 * `systemName`), read without the design lock so nothing is migrated or
 * written. A design that cannot be read is listed in `unreadable` and
 * skipped; designs linked to other systems or none are skipped silently.
 * A designs folder that cannot be listed throws (a missing one has no
 * designs).
 */
export const readLinkedDesigns = async (
	projectRoot: string,
	system: DesignSystemRecord,
): Promise<{
	designs: LintDesignInput[];
	unreadable: Array<{ id: string; file: string; message: string }>;
}> => {
	const service = createDesignFileService(projectRoot);
	const designs: LintDesignInput[] = [];
	const unreadable: Array<{ id: string; file: string; message: string }> = [];
	for (const id of await service.listDesignIds()) {
		try {
			const read = await service.readDesignFileWithoutLock(id);
			if (
				designReferencesSystemHandle(
					read.design,
					system.manifest.systemId,
					system,
				)
			) {
				designs.push({ id, design: read.design });
			}
		} catch (error) {
			unreadable.push({
				id,
				file: toPosix(
					path.relative(projectRoot, path.join(service.designsDir, id)),
				),
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return { designs, unreadable };
};

const buildCoverage = ({
	contract,
	codegen,
	sources,
	scanned,
	designs,
}: {
	contract: SystemContract;
	codegen: CodegenRunResult | null;
	sources: SourceIndex;
	scanned: boolean;
	designs: LintDesignIndex;
}): LintComponentCoverage[] => {
	const designUsages = countDesignUsages(designs);
	const codegenStatus = new Map(
		(codegen?.components ?? []).map((component) => [
			component.componentId,
			component.status,
		]),
	);
	const usageCounts = new Map<string, number>();
	for (const usage of sources.usages) {
		usageCounts.set(usage.slug, (usageCounts.get(usage.slug) ?? 0) + 1);
	}
	return contract.components.map((component) => {
		const identity = sources.components.find(
			(entry) => entry.componentId === component.componentId,
		);
		const usages = usageCounts.get(component.slug) ?? 0;
		return {
			slug: component.slug,
			componentId: component.componentId,
			name: component.name,
			published: component.publishedVersion !== null,
			generated:
				codegen === null
					? null
					: codegenStatus.get(component.componentId) === "ok",
			bound: scanned ? (identity?.wrappers.length ?? 0) > 0 : null,
			usedInApp: scanned ? usages > 0 : null,
			usedInDesigns: (designUsages[component.componentId] ?? 0) > 0,
			wrappers: identity?.wrappers ?? [],
			usages,
			designUsages: designUsages[component.componentId] ?? 0,
		};
	});
};

const buildFileStats = (
	sources: SourceIndex,
	findings: readonly LintFinding[],
): LintFileStats[] => {
	const usages = countUsagesByFile(sources);
	const roles = new Map<
		string,
		{ role: "generated" | "wrapper"; component: string | null }
	>();
	for (const component of sources.components) {
		for (const file of component.generatedFiles) {
			roles.set(file, { role: "generated", component: component.slug });
		}
		for (const file of component.wrappers) {
			if (!roles.has(file))
				roles.set(file, { role: "wrapper", component: component.slug });
		}
	}
	for (const file of sources.unknownGenerated) {
		roles.set(file, { role: "generated", component: null });
	}
	const counts = new Map<string, ReturnType<typeof emptySeverityCounts>>();
	for (const finding of findings) {
		if (finding.location?.kind !== "code") continue;
		const entry = counts.get(finding.location.file) ?? emptySeverityCounts();
		countSeverity(entry, finding.severity);
		counts.set(finding.location.file, entry);
	}
	const files = new Set([...sources.files, ...counts.keys()]);
	const stats: LintFileStats[] = [];
	for (const file of files) {
		const role = roles.get(file) ?? null;
		const usageCount = usages[file] ?? 0;
		const findingCounts = counts.get(file) ?? emptySeverityCounts();
		if (
			role === null &&
			usageCount === 0 &&
			findingCounts.errors + findingCounts.warnings + findingCounts.info === 0
		) {
			continue;
		}
		stats.push({
			file,
			role: role?.role ?? null,
			component: role?.component ?? null,
			usages: usageCount,
			findings: findingCounts,
		});
	}
	return stats;
};

/**
 * One row per board and one per linked design with `board: null`, each with
 * the instances of the system's components placed there and the findings
 * located there. The `board: null` row holds only what is on no board, not
 * the design's total: the dashboard adds up all rows of a design. It is
 * there for every linked design, clean or not, so a design without boards
 * is still listed.
 */
const buildDesignStats = (
	designs: LintDesignIndex,
	findings: readonly LintFinding[],
): LintDesignStats[] => {
	const rows = new Map<string, LintDesignStats>();
	const key = (design: string, board: string | null) =>
		`${design}\u0000${board ?? ""}`;
	for (const design of designs.designs) {
		rows.set(key(design.id, null), {
			design: design.id,
			board: null,
			usages: 0,
			findings: emptySeverityCounts(),
		});
		for (const board of design.boards) {
			rows.set(key(design.id, board.id), {
				design: design.id,
				board: board.id,
				usages: 0,
				findings: emptySeverityCounts(),
			});
		}
	}
	for (const usages of Object.values(designs.usages)) {
		for (const usage of usages) {
			const row = rows.get(key(usage.design, usage.board));
			if (row) row.usages += 1;
		}
	}
	for (const finding of findings) {
		if (finding.location?.kind !== "design") continue;
		const { design, board } = finding.location;
		const row = rows.get(key(design, board ?? null));
		if (row) countSeverity(row.findings, finding.severity);
	}
	return [...rows.values()];
};

/**
 * What identifies the committed report a run compared against: its
 * `generatedAt`, or why there was none.
 */
const reportRevision = (read: LintReportRead) =>
	read.status === "present"
		? `present:${read.report.generatedAt}`
		: read.status;

const reportWriteQueues = new Map<string, Promise<unknown>>();

/** One compare-and-write at a time per report path, in this process. */
async function runExclusiveReportWrite<T>(
	reportPath: string,
	operation: () => Promise<T>,
): Promise<T> {
	const previousWrite = reportWriteQueues.get(reportPath);
	const queuedWrite = previousWrite
		? previousWrite.catch(() => undefined).then(operation)
		: operation();
	reportWriteQueues.set(reportPath, queuedWrite);
	const release = () => {
		if (reportWriteQueues.get(reportPath) === queuedWrite) {
			reportWriteQueues.delete(reportPath);
		}
	};
	queuedWrite.then(release, release);
	return queuedWrite;
}

/**
 * Runs the lint; every failure, including one the engine did not foresee
 * (an unreadable project folder, duplicate system identities), comes back
 * as an `error` result with a diagnostic, never as a thrown error, so the
 * CLI's JSON and exit code stay intact.
 */
export async function runLint(input: RunLintInput): Promise<LintRunResult> {
	const mode: LintRunResult["mode"] = input.check ? "check" : "write";
	const result: LintRunResult = {
		status: "error",
		mode,
		system: null,
		report: null,
		ratchet: null,
		baseline: null,
		reportPath: null,
		written: false,
		diagnostics: [],
	};
	try {
		return await runLintInner(input, result);
	} catch (error) {
		const code = (error as { code?: unknown }).code;
		result.status = "error";
		result.written = false;
		result.diagnostics.push({
			code: "RUN_FAILED",
			severity: "error",
			message: `Lint could not complete${typeof code === "string" ? ` (${code})` : ""}: ${error instanceof Error ? error.message : String(error)}`,
		});
		return result;
	}
}

async function runLintInner(
	input: RunLintInput,
	result: LintRunResult,
): Promise<LintRunResult> {
	const projectRoot = path.resolve(input.projectRoot);
	const registry = input.registry ?? lintRuleRegistry;
	const writeMode: LintWriteMode = input.check
		? "never"
		: (input.write ?? "on-pass");
	const now = input.now ?? (() => new Date());
	const diagnostics = result.diagnostics;
	const fail = (
		code: LintRunDiagnosticCode,
		message: string,
		filePath?: string,
	) => {
		diagnostics.push({
			code,
			severity: "error",
			message,
			...(filePath ? { path: filePath } : {}),
		});
		return result;
	};
	const warn = (
		code: LintRunDiagnosticCode,
		message: string,
		filePath?: string,
	) => {
		diagnostics.push({
			code,
			severity: "warning",
			message,
			...(filePath ? { path: filePath } : {}),
		});
	};

	const isProject = await stat(path.join(projectRoot, ".trickroom")).then(
		(entry) => entry.isDirectory(),
		() => false,
	);
	if (!isProject) {
		return fail(
			"NOT_A_PROJECT",
			`No Trickroom project at ${projectRoot} (.trickroom is missing).`,
		);
	}

	let read: Awaited<ReturnType<typeof readProjectConfigReadOnly>>;
	try {
		read = await readProjectConfigReadOnly(projectRoot);
	} catch (error) {
		return fail(
			"INVALID_CONFIG",
			error instanceof Error ? error.message : String(error),
		);
	}
	const codegenConfig = resolveCodegenConfig(read.config);

	// The system: the option, else the codegen block's, else the project's
	// default, else the only system there is.
	let handle =
		input.system?.trim() ||
		(codegenConfig.status === "configured" ? codegenConfig.system : null) ||
		read.config.defaultSystemId?.trim() ||
		null;
	if (!handle) {
		const systems = await listDesignSystems(projectRoot, { readOnly: true });
		if (systems.length === 1) {
			handle = systems[0].manifest.systemId;
		} else {
			return fail(
				"NO_SYSTEM",
				systems.length === 0
					? "No design system to lint: the project has none under .trickroom/systems."
					: `No system selected: pass --system <id> (or "system" over MCP), or set a defaultSystemId for the project. Systems: ${systems.map((system) => `"${system.manifest.systemName}" (${system.manifest.systemId})`).join(", ")}.`,
			);
		}
	}
	const system = await findDesignSystem(projectRoot, handle, {
		readOnly: true,
	});
	if (!system) {
		return fail(
			"SYSTEM_NOT_FOUND",
			`No design system matches "${handle}" (id, name or storage key) under .trickroom/systems.`,
		);
	}
	const systemId = system.manifest.systemId;
	result.system = { id: systemId, name: system.manifest.systemName };
	result.reportPath = toPosix(
		path.relative(projectRoot, path.join(system.dir, LINT_REPORT_FILE_NAME)),
	);

	let manifestRead: Awaited<ReturnType<typeof readSystemComponentManifest>>;
	try {
		manifestRead = await readSystemComponentManifest(projectRoot, systemId, {
			readOnly: true,
		});
	} catch (error) {
		if (error instanceof SystemComponentManifestServiceError) {
			return fail(
				"INVALID_COMPONENT_MANIFEST",
				[
					error.message,
					...error.diagnostics.map((diagnostic) => diagnostic.message),
				].join(" "),
			);
		}
		throw error;
	}
	for (const diagnostic of manifestRead.diagnostics) {
		warn("COMPONENT_MANIFEST_DIAGNOSTIC", diagnostic.message, diagnostic.path);
	}

	const lintConfigRead = await readLintConfigFile(system.dir, registry);
	if (
		lintConfigRead.status === "invalid" ||
		lintConfigRead.status === "unreadable"
	) {
		return fail(
			"INVALID_LINT_CONFIG",
			`${toPosix(path.relative(projectRoot, path.join(system.dir, LINT_CONFIG_FILE_NAME)))} is invalid: ${lintConfigRead.issues.join(" ")}`,
		);
	}
	const config: ResolvedLintConfig = resolveLintConfig(
		lintConfigRead.status === "present" ? lintConfigRead.config : null,
		{
			ruleKinds: registry.kinds,
			codegenOutDir:
				codegenConfig.status === "configured" ? codegenConfig.outDir : null,
		},
	);

	const tokens = await readDomainTokensReadonly(projectRoot, systemId);
	const contract = buildSystemContract({
		system: {
			id: systemId,
			name: system.manifest.systemName,
			cssPath: system.manifest.cssPath ?? null,
		},
		manifest: manifestRead.manifest,
		tokens,
		codegen: codegenConfig,
	});

	// The codegen check, when the block targets this system.
	let codegen: CodegenRunResult | null = null;
	if (codegenConfig.status === "configured") {
		const target = codegenConfig.system
			? await findDesignSystem(projectRoot, codegenConfig.system, {
					readOnly: true,
				})
			: system;
		if (target && target.manifest.systemId !== systemId) {
			warn(
				"CODEGEN_OTHER_SYSTEM",
				`The codegen block generates system "${target.manifest.systemName}", not "${system.manifest.systemName}"; variants files were not checked for this system.`,
			);
		} else {
			codegen = await runCodegen({
				projectRoot,
				config: { ...codegenConfig, system: systemId },
				mode: "check",
				formatterTimeoutMs: input.formatterTimeoutMs,
			});
		}
	}

	// Sources. A folder or file that cannot be read fails the run: fewer
	// files means fewer findings, which the ratchet would take for an
	// improvement and record as the baseline.
	const walked = await walkSourceFiles(projectRoot, config.source);
	// Only roots lint.json names: a project without sources (designs only)
	// is not told about the default `src/**`.
	const includeConfigured =
		lintConfigRead.status === "present" &&
		lintConfigRead.config.source?.include !== undefined;
	for (const root of includeConfigured ? walked.missingRoots : []) {
		warn(
			"SOURCE_ROOT_MISSING",
			`${root} does not exist, so source.include has nothing to scan there. Check the globs in ${LINT_CONFIG_FILE_NAME}.`,
			root,
		);
	}
	for (const entry of walked.unreadable) {
		fail(
			"SOURCES_UNREADABLE",
			`Could not read the source folder ${entry.path}, so the scan would be incomplete: ${entry.message}`,
			entry.path,
		);
	}
	if (walked.unreadable.length > 0) return result;
	if (walked.truncated) {
		warn(
			"SOURCES_TRUNCATED",
			`More source files than the scan limit; only the first ${walked.files.length} were linted. Narrow source.include in ${LINT_CONFIG_FILE_NAME}.`,
		);
	}
	const modules: SourceModule[] = [];
	let parseErrorCount = 0;
	for (const file of walked.files) {
		let text: string;
		try {
			text = await readFile(path.join(projectRoot, ...file.split("/")), "utf8");
		} catch (error) {
			return fail(
				"SOURCES_UNREADABLE",
				`Could not read the source file ${file}, so the scan would be incomplete: ${error instanceof Error ? error.message : String(error)}`,
				file,
			);
		}
		const module = parseSourceModule(file, text, {
			classCalls: config.source.classCalls,
		});
		modules.push(module);
		if (module.errors.length > 0) {
			parseErrorCount += 1;
			if (parseErrorCount <= MAX_PARSE_ERROR_DIAGNOSTICS) {
				warn(
					"SOURCE_PARSE_ERROR",
					`${file} has syntax errors; it was linted as far as it parsed: ${module.errors[0]}`,
					file,
				);
			}
		}
	}
	const sources = buildSourceIndex({
		modules,
		contract,
		componentModules: config.components,
	});
	for (const component of sources.components) {
		for (const file of component.missingConfiguredWrappers) {
			warn(
				"WRAPPER_MODULE_NOT_SCANNED",
				`${LINT_CONFIG_FILE_NAME} names ${file} as the wrapper of "${component.slug}", but no scanned source file has that path; the component counts as unbound. Check the path and the source globs.`,
				file,
			);
		}
	}

	// Designs. A single design that cannot be read is skipped with a
	// warning; a designs folder that cannot be listed fails the run, for
	// the same reason as an unreadable source folder.
	let linked: Awaited<ReturnType<typeof readLinkedDesigns>>;
	try {
		linked = await readLinkedDesigns(projectRoot, system);
	} catch (error) {
		const designsPath = toPosix(
			path.relative(
				projectRoot,
				createDesignFileService(projectRoot).designsDir,
			),
		);
		return fail(
			"DESIGNS_UNREADABLE",
			`Could not list the designs in ${designsPath}, so the design side would be incomplete: ${error instanceof Error ? error.message : String(error)}`,
			designsPath,
		);
	}
	for (const entry of linked.unreadable) {
		warn(
			"DESIGN_UNREADABLE",
			`Design "${entry.id}" could not be read, so it was not linted: ${entry.message}`,
			entry.file,
		);
	}
	const designs = buildLintDesignIndex({
		systemId,
		designs: linked.designs,
	});

	// Rules.
	const rulesRun = await runLintRules({
		registry,
		config,
		context: {
			projectRoot,
			contract,
			config,
			codegen,
			sources,
			designs,
			tailwind: {
				inspector: createTailwindInspectorLoader(
					projectRoot,
					system.manifest.cssPath ?? tokens?.metadata.cssPath ?? null,
				),
			},
		},
	});
	for (const failure of rulesRun.failures) {
		fail("RULE_FAILED", `Rule "${failure.rule}" failed: ${failure.message}`);
	}
	const findings = rulesRun.findings.map(toReportFinding);
	const enabledIds = rulesRun.enabled;
	if (diagnostics.some((entry) => entry.severity === "error")) {
		return result;
	}

	// The report.
	const generatedAt = now().toISOString();
	const components = buildCoverage({
		contract,
		codegen,
		sources,
		scanned: walked.files.length > 0,
		designs,
	});
	const draft = {
		summary: {
			code: summarizeFindings(
				findings,
				"code",
				enabledIds.code,
				walked.files.length,
			),
			design:
				enabledIds.design.length > 0
					? summarizeFindings(
							findings,
							"design",
							enabledIds.design,
							designs.designs.length,
						)
					: null,
		},
		components,
	};

	const numbers = collectTrackedNumbers(draft);
	const files = buildFileStats(sources, findings);
	const designStats = buildDesignStats(designs, findings);
	const reportPath = result.reportPath;
	const ratchetAgainst = (previous: LintReportRead) => {
		if (previous.status === "invalid") {
			warn(
				"INVALID_BASELINE",
				`${reportPath} could not be used as the ratchet baseline (${previous.issue.message}); this run starts a new baseline.`,
				reportPath,
			);
		}
		const previousBaseline =
			previous.status === "present" ? previous.report.ratchetBaseline : null;
		const ratchet = compareLintRatchet({
			numbers,
			baseline: previousBaseline,
			thresholds: config.thresholds,
		});
		result.baseline = previous.status;
		result.ratchet = ratchet;
		result.status = ratchet.status;
		result.report = normalizeLintReport({
			version: LINT_REPORT_VERSION,
			generatedAt,
			system: { id: systemId, name: system.manifest.systemName },
			contract: { hash: contract.hash, components: contract.components.length },
			config: { present: config.present },
			status: ratchet.status,
			summary: draft.summary,
			findings,
			components,
			files,
			designs: designStats,
			ratchet,
			ratchetBaseline: nextRatchetBaseline({
				result: ratchet,
				generatedAt,
				previous: previousBaseline,
			}),
		});
		return ratchet;
	};

	if (writeMode === "never") {
		ratchetAgainst(await readLintReport(system.dir));
		return result;
	}

	// Compare and write as one step per report: runs in this process queue
	// up, and across processes the report is read again under its lock file
	// just before the write, so a run that replaced it since this one read
	// it is caught.
	await runExclusiveReportWrite(
		path.resolve(system.dir, LINT_REPORT_FILE_NAME),
		async () => {
			const previous = await readLintReport(system.dir);
			const ratchet = ratchetAgainst(previous);
			if (writeMode === "on-pass" && ratchet.status !== "pass") return;
			try {
				// The lock is held from the re-read through the rename, so no
				// other process replaces the report in between.
				await withLintReportLock(projectRoot, system.dir, async (lock) => {
					const current = await readLintReport(system.dir);
					if (reportRevision(current) !== reportRevision(previous)) {
						// The findings stand; only the comparison is redone.
						const moved = ratchetAgainst(current);
						if (moved.status !== "pass") {
							const worse = [
								...moved.regressions.map(
									(entry) =>
										`${entry.metric} ${entry.baseline} -> ${entry.current}`,
								),
								...moved.breaches.map(
									(entry) =>
										`${entry.metric} ${entry.current} (${entry.kind} ${entry.limit})`,
								),
							];
							fail(
								"BASELINE_MOVED",
								`${reportPath} was replaced during this run (now from ${current.status === "present" ? current.report.generatedAt : "no usable report"}), and against it this run is worse: ${worse.join(", ")}. Nothing was written.`,
								reportPath ?? undefined,
							);
							return;
						}
					}
					if (!result.report) return;
					// Fencing: write only while the lock is still this run's.
					await writeLintReport(projectRoot, system.dir, result.report, {
						beforeRename: lock.assertHeld,
					});
					result.written = true;
				});
			} catch (error) {
				result.status = "error";
				if (error instanceof DesignFileLockTimeoutError) {
					fail(
						"REPORT_LOCKED",
						`${reportPath} is locked by another lint run (${LINT_REPORT_LOCK_FILE_NAME}: ${error.message}); nothing was written. Run lint again, or delete the lock file if no run is active.`,
						reportPath ?? undefined,
					);
				} else if (error instanceof FileLockLostError) {
					fail(
						"REPORT_LOCKED",
						`This run lost its lock on ${reportPath} before writing (${LINT_REPORT_LOCK_FILE_NAME} was reclaimed or removed); nothing was written. Run lint again.`,
						reportPath ?? undefined,
					);
				} else if (error instanceof LintReportWriteError) {
					fail("WRITE_FAILED", error.message, reportPath ?? undefined);
				} else {
					fail(
						"WRITE_FAILED",
						`Could not write ${reportPath}: ${error instanceof Error ? error.message : String(error)}`,
						reportPath ?? undefined,
					);
				}
			}
		},
	);
	return result;
}
