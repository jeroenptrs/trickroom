import path from "node:path";
import type { TrickroomDesign } from "../types";
import {
	type DesignSystemRecord,
	findDesignSystem,
} from "../utils/design-system-store";
import { readSystemComponentManifest } from "../utils/system-component-manifest-service";
import { createEmptySystemComponentManifest } from "../utils/system-components";
import {
	readDomainTokensReadonly,
	type TailwindTokenStorage,
} from "../utils/tailwind-token-store";
import {
	LINT_CONFIG_FILE_NAME,
	type ResolvedLintConfig,
	resolveLintConfig,
} from "./config";
import { readLintConfigFile } from "./config-file";
import { buildSystemContract, type SystemContract } from "./contract";
import { buildLintDesignIndex } from "./designs";
import { lintRuleRegistry } from "./rules/index";
import type { LintRuleRegistry } from "./rules/registry";
import { createTailwindInspectorLoader } from "./run-lint";
import { type LintRunFinding, runLintRules } from "./run-rules";
import { buildSourceIndex } from "./source/index";

/**
 * The design-side rule kinds on one design, for `design_validate` and the
 * editor's design lint route: the same kinds, the same runner and the
 * system's resolved `lint.json` as `trickroom lint`, so enabled kinds,
 * severities and options apply the same way. Reads the system read-only.
 *
 * Unlike a lint run it never fails: an invalid or unreadable `lint.json`
 * (invalid options included) falls back to the defaults, unreadable
 * components to none, and a failing kind is skipped, each reported in
 * `diagnostics`.
 * Findings without a design location (a component-level finding such as
 * `design.design-only-class-target`) are kept only for components the
 * checked boards place.
 */

export type DesignLintDiagnostic = {
	code:
		| "INVALID_LINT_CONFIG"
		| "INVALID_COMPONENT_MANIFEST"
		| "LINT_RULE_FAILED";
	message: string;
	/** Project-relative, `/` separators. */
	path?: string;
};

export type DesignLintResult = {
	system: { id: string; name: string };
	/** Enabled design-side kinds, in registry order. */
	rules: string[];
	findings: LintRunFinding[];
	diagnostics: DesignLintDiagnostic[];
};

export type DesignLintSetup = {
	system: DesignSystemRecord;
	contract: SystemContract;
	config: ResolvedLintConfig;
	tokens: TailwindTokenStorage | null;
	diagnostics: DesignLintDiagnostic[];
	inspector: ReturnType<typeof createTailwindInspectorLoader>;
};

const toPosix = (value: string) => value.split(path.sep).join("/");

/** Everything the design rules need from the system, read once per call. */
export async function loadDesignLintSetup({
	projectRoot,
	system,
	registry = lintRuleRegistry,
}: {
	projectRoot: string;
	system: DesignSystemRecord;
	registry?: LintRuleRegistry;
}): Promise<DesignLintSetup> {
	const systemId = system.manifest.systemId;
	const diagnostics: DesignLintDiagnostic[] = [];
	const lintPath = toPosix(
		path.relative(projectRoot, path.join(system.dir, LINT_CONFIG_FILE_NAME)),
	);

	let manifest = createEmptySystemComponentManifest();
	try {
		manifest = (
			await readSystemComponentManifest(projectRoot, systemId, {
				readOnly: true,
			})
		).manifest;
	} catch (error) {
		// An invalid manifest or a filesystem error (a folder in its place):
		// validation goes on without components rather than failing.
		diagnostics.push({
			code: "INVALID_COMPONENT_MANIFEST",
			message: `The components of system "${system.manifest.systemName}" could not be read, so component rules saw none: ${error instanceof Error ? error.message : String(error)}`,
		});
	}

	// Invalid options make the file invalid too (`getLintConfigIssues`
	// checks them against each kind's option specs): the defaults apply.
	const read = await readLintConfigFile(system.dir, registry);
	if (read.status === "invalid" || read.status === "unreadable") {
		diagnostics.push({
			code: "INVALID_LINT_CONFIG",
			message: `${lintPath} ${read.status === "unreadable" ? "could not be read" : "is invalid"}, so the default rules apply: ${read.issues.join(" ")}`,
			path: lintPath,
		});
	}
	const config = resolveLintConfig(
		read.status === "present" ? read.config : null,
		{ ruleKinds: registry.kinds, codegenOutDir: null },
	);

	const tokens = await readDomainTokensReadonly(projectRoot, systemId);
	const contract = buildSystemContract({
		system: {
			id: systemId,
			name: system.manifest.systemName,
			cssPath: system.manifest.cssPath ?? null,
		},
		manifest,
		tokens,
		codegen: { status: "unconfigured" },
	});
	return {
		system,
		contract,
		config,
		tokens,
		diagnostics,
		inspector: createTailwindInspectorLoader(
			projectRoot,
			system.manifest.cssPath ?? tokens?.metadata.cssPath ?? null,
		),
	};
}

/** Runs the enabled design-side kinds on one design (or some of its boards). */
export async function lintDesign({
	projectRoot,
	setup,
	designId,
	design,
	boardIds,
	registry = lintRuleRegistry,
}: {
	projectRoot: string;
	setup: DesignLintSetup;
	designId: string;
	design: TrickroomDesign;
	boardIds?: ReadonlySet<string>;
	registry?: LintRuleRegistry;
}): Promise<DesignLintResult> {
	const { contract } = setup;
	const designs = buildLintDesignIndex({
		systemId: contract.system.id,
		designs: [{ id: designId, design, boardIds }],
	});
	const { config } = setup;
	const run = await runLintRules({
		registry,
		config,
		side: "design",
		context: {
			projectRoot,
			contract,
			config,
			codegen: null,
			sources: buildSourceIndex({
				modules: [],
				contract,
				componentModules: {},
			}),
			designs,
			tailwind: { inspector: setup.inspector },
		},
	});

	const placed = new Set(
		contract.components
			.filter(
				(component) => (designs.usages[component.componentId] ?? []).length > 0,
			)
			.map((component) => component.slug),
	);
	return {
		system: { id: contract.system.id, name: contract.system.name },
		rules: run.enabled.design,
		findings: run.findings.filter(
			(finding) =>
				finding.location?.kind === "design" ||
				(finding.component !== undefined && placed.has(finding.component)),
		),
		diagnostics: [
			...setup.diagnostics,
			...run.failures.map((failure) => ({
				code: "LINT_RULE_FAILED" as const,
				message: `Rule "${failure.rule}" failed and was skipped: ${failure.message}`,
			})),
		],
	};
}

/** What the editor's design lint route returns (`GET /api/trickroom/design/lint`). */
export type DesignFileLintResponse = {
	designId: string;
	/** Null when the design links no system, or one that does not exist. */
	system: { id: string; name: string } | null;
	rules: string[];
	findings: LintRunFinding[];
	diagnostics: DesignLintDiagnostic[];
};

/** The design rules on a design read by the caller, with its linked system. */
export async function lintLinkedDesign({
	projectRoot,
	designId,
	design,
}: {
	projectRoot: string;
	designId: string;
	design: TrickroomDesign;
}): Promise<DesignFileLintResponse> {
	const handle = design.systemId ?? design.systemName ?? null;
	const system = handle
		? await findDesignSystem(projectRoot, handle, { readOnly: true })
		: null;
	if (!system) {
		return { designId, system: null, rules: [], findings: [], diagnostics: [] };
	}
	const result = await lintDesign({
		projectRoot,
		setup: await loadDesignLintSetup({ projectRoot, system }),
		designId,
		design,
	});
	return { designId, ...result };
}
