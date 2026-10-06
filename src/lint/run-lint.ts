import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveCodegenConfig } from "../codegen/config";
import { type CodegenRunResult, runCodegen } from "../codegen/run-codegen";
import { readProjectConfigReadOnly } from "../project";
import {
	findDesignSystem,
	listDesignSystems,
} from "../utils/design-system-store";
import {
	readSystemComponentManifest,
	SystemComponentManifestServiceError,
} from "../utils/system-component-manifest-service";
import { loadTailwindDesignSystem } from "../utils/tailwind-design-system";
import { readDomainTokensReadonly } from "../utils/tailwind-token-store";
import { inspectTailwindUtilityCandidate } from "../utils/tailwind-utility-inspector";
import {
	getLintConfigIssues,
	LINT_CONFIG_FILE_NAME,
	type LintConfig,
	type ResolvedLintConfig,
	resolveLintConfig,
} from "./config";
import { buildSystemContract, type SystemContract } from "./contract";
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
	LINT_REPORT_VERSION,
	type LintComponentCoverage,
	type LintFileStats,
	type LintFinding,
	type LintRatchetBaseline,
	type LintReport,
	LintReportWriteError,
	normalizeLintReport,
	readLintReport,
	summarizeFindings,
	writeLintReport,
} from "./report";
import { lintRuleRegistry } from "./rules/index";
import type { LintRuleRegistry } from "./rules/registry";
import type { LintRuleContext, LintTailwindInspector } from "./rules/types";
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
	| "SOURCE_PARSE_ERROR"
	| "SOURCES_TRUNCATED"
	| "RULE_FAILED"
	| "WRITE_FAILED"
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

const toPosix = (value: string) => value.split(path.sep).join("/");

const MAX_PARSE_ERROR_DIAGNOSTICS = 50;

const readLintConfigFile = async (
	systemDir: string,
	knownRuleIds: ReadonlySet<string>,
): Promise<{ config: LintConfig | null; issues: string[] }> => {
	const configPath = path.join(systemDir, LINT_CONFIG_FILE_NAME);
	let text: string;
	try {
		text = await readFile(configPath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { config: null, issues: [] };
		}
		throw error;
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return {
			config: null,
			issues: [
				`${LINT_CONFIG_FILE_NAME} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
			],
		};
	}
	const issues = getLintConfigIssues(value, knownRuleIds);
	return issues.length > 0
		? { config: null, issues }
		: { config: value as LintConfig, issues: [] };
};

const createTailwindInspectorLoader = (
	projectRoot: string,
	cssPath: string | null,
): (() => Promise<LintTailwindInspector | null>) => {
	let pending: Promise<LintTailwindInspector | null> | null = null;
	return () => {
		if (!cssPath?.trim()) {
			return Promise.resolve(null);
		}
		pending ??= loadTailwindDesignSystem({ projectRoot, cssPath })
			.then(({ designSystem }) => ({
				inspect: (candidate: string) =>
					inspectTailwindUtilityCandidate(designSystem, candidate),
			}))
			.catch(() => null);
		return pending;
	};
};

const buildCoverage = ({
	contract,
	codegen,
	sources,
	scanned,
}: {
	contract: SystemContract;
	codegen: CodegenRunResult | null;
	sources: SourceIndex;
	scanned: boolean;
}): LintComponentCoverage[] => {
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
			usedInDesigns: null,
			wrappers: identity?.wrappers ?? [],
			usages,
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

	const lintConfigRead = await readLintConfigFile(system.dir, registry.ids);
	if (lintConfigRead.issues.length > 0) {
		return fail(
			"INVALID_LINT_CONFIG",
			`${toPosix(path.relative(projectRoot, path.join(system.dir, LINT_CONFIG_FILE_NAME)))} is invalid: ${lintConfigRead.issues.join(" ")}`,
		);
	}
	const config: ResolvedLintConfig = resolveLintConfig(lintConfigRead.config, {
		ruleKinds: registry.kinds,
		codegenOutDir:
			codegenConfig.status === "configured" ? codegenConfig.outDir : null,
	});

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

	// Sources.
	const walked = await walkSourceFiles(projectRoot, config.source);
	if (walked.truncated) {
		warn(
			"SOURCES_TRUNCATED",
			`More source files than the scan limit; only the first ${walked.files.length} were linted. Narrow source.include in ${LINT_CONFIG_FILE_NAME}.`,
		);
	}
	const modules: SourceModule[] = [];
	let parseErrorCount = 0;
	for (const file of walked.files) {
		const text = await readFile(
			path.join(projectRoot, ...file.split("/")),
			"utf8",
		);
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

	// Rules.
	const tailwindInspector = createTailwindInspectorLoader(
		projectRoot,
		system.manifest.cssPath ?? tokens?.metadata.cssPath ?? null,
	);
	const findings: LintFinding[] = [];
	const enabledIds = { code: [] as string[], design: [] as string[] };
	for (const rule of config.rules) {
		const kind = registry.get(rule.id);
		if (!kind || !rule.enabled) continue;
		enabledIds[kind.side].push(kind.id);
		const context: LintRuleContext = {
			projectRoot,
			contract,
			config,
			rule,
			codegen,
			sources,
			designs: null,
			tailwind: { inspector: tailwindInspector },
		};
		try {
			for (const finding of await kind.run(context)) {
				findings.push({
					rule: kind.id,
					severity: finding.severity ?? rule.severity,
					side: kind.side,
					message: finding.message,
					...(finding.component ? { component: finding.component } : {}),
					location: finding.location,
				});
			}
		} catch (error) {
			fail(
				"RULE_FAILED",
				`Rule "${kind.id}" failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
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
					? summarizeFindings(findings, "design", enabledIds.design, 0)
					: null,
		},
		components,
	};

	const previous = await readLintReport(system.dir);
	let previousBaseline: LintRatchetBaseline | null = null;
	if (previous.status === "present") {
		previousBaseline = previous.report.ratchetBaseline;
	} else if (previous.status === "invalid") {
		warn(
			"INVALID_BASELINE",
			`${result.reportPath} could not be used as the ratchet baseline (${previous.issue.message}); this run starts a new baseline.`,
			result.reportPath,
		);
	}
	result.baseline = previous.status;
	const ratchet = compareLintRatchet({
		numbers: collectTrackedNumbers(draft),
		baseline: previousBaseline,
		thresholds: config.thresholds,
	});
	result.ratchet = ratchet;

	const report: LintReport = normalizeLintReport({
		version: LINT_REPORT_VERSION,
		generatedAt,
		system: { id: systemId, name: system.manifest.systemName },
		contract: { hash: contract.hash, components: contract.components.length },
		config: { present: config.present },
		status: ratchet.status,
		summary: draft.summary,
		findings,
		components,
		files: buildFileStats(sources, findings),
		designs: null,
		ratchetBaseline: nextRatchetBaseline({
			result: ratchet,
			generatedAt,
			previous: previousBaseline,
		}),
	});
	result.report = report;
	result.status = ratchet.status;

	const shouldWrite =
		writeMode === "always" ||
		(writeMode === "on-pass" && ratchet.status === "pass");
	if (shouldWrite) {
		try {
			await writeLintReport(projectRoot, system.dir, report);
			result.written = true;
		} catch (error) {
			if (error instanceof LintReportWriteError) {
				fail("WRITE_FAILED", error.message, result.reportPath);
			} else {
				fail(
					"WRITE_FAILED",
					`Could not write ${result.reportPath}: ${error instanceof Error ? error.message : String(error)}`,
					result.reportPath,
				);
			}
			result.status = "error";
		}
	}
	return result;
}
