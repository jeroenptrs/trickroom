import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveCodegenConfig } from "../../../codegen/config";
import { runCodegen } from "../../../codegen/run-codegen";
import {
	CODEGEN_TEST_SYSTEM_ID,
	type CodegenTestProject,
	createCodegenTestProject,
	templateNode,
} from "../../../codegen/test-support";
import { readProjectConfigReadOnly } from "../../../project";
import {
	createEmptySystemComponentManifest,
	type SystemComponentDraftPayload,
	type SystemComponentRecord,
} from "../../../utils/system-components";
import type { TailwindTokenDomain } from "../../../utils/tailwind-token-domains";
import type { TailwindUtilityInspection } from "../../../utils/tailwind-utility-inspector";
import {
	type LintConfig,
	type ResolvedLintRule,
	resolveLintConfig,
} from "../../config";
import { buildSystemContract, type SystemContract } from "../../contract";
import { buildSourceIndex, type SourceIndex } from "../../source/index";
import { parseSourceModule } from "../../source/parse";
import { walkSourceFiles } from "../../source/walk";
import { LINT_RULE_KINDS } from "../index";
import type { LintRuleContext, LintRuleFinding, LintRuleKind } from "../types";

/**
 * Fixture projects for the code-side rules: a temp project with one system
 * and its components, variants files written by the real codegen into
 * `src/ui`, hand-written wrappers and usage sites, parsed through the real
 * source model. `run` builds a rule context the way `runLint` does.
 */

/** `button`: flat; `variant` required, `size` with a default, boolean `disabled`. */
export const buttonPayload = (): SystemComponentDraftPayload => ({
	root: templateNode("root", "inline-flex px-3 rounded-md"),
	slots: {},
	variants: {
		axes: {
			variant: {
				label: "Variant",
				values: {
					primary: { classesByPath: { root: "bg-blue-500 text-white" } },
					ghost: { classesByPath: { root: "bg-transparent" } },
				},
			},
			size: {
				label: "Size",
				defaultValue: "md",
				values: {
					sm: { classesByPath: { root: "h-8 text-sm" } },
					md: { classesByPath: { root: "h-10" } },
				},
			},
			disabled: {
				label: "Disabled",
				defaultValue: "false",
				values: {
					true: { classesByPath: { root: "opacity-50" } },
					false: {},
				},
			},
		},
		compoundVariants: [],
	},
	overrideTargets: {},
});

/** `card`: slots `root`, `title`, `body`; `tone` with a default. */
export const cardPayload = (): SystemComponentDraftPayload => ({
	root: templateNode("root", "flex flex-col p-4", [
		templateNode("title", "font-bold"),
		templateNode("body", "text-sm"),
	]),
	slots: {},
	variants: {
		axes: {
			tone: {
				label: "Tone",
				defaultValue: "plain",
				values: {
					plain: { classesByPath: { root: "bg-white" } },
					loud: { classesByPath: { root: "bg-red-500", title: "text-white" } },
				},
			},
		},
		compoundVariants: [],
	},
	overrideTargets: {},
});

export type LintFixture = {
	project: CodegenTestProject;
	contract: SystemContract;
	sources: SourceIndex;
	run: (
		kind: LintRuleKind,
		options?: {
			options?: Record<string, unknown>;
			inspect?: (candidate: string) => boolean;
			tokens?: Partial<Record<TailwindTokenDomain, string[]>> | null;
		},
	) => Promise<LintRuleFinding[]>;
};

export async function createLintFixture(options: {
	components: SystemComponentRecord[];
	/** Project-relative path to contents. */
	files: Record<string, string>;
	lint?: Pick<LintConfig, "components" | "source">;
	shape?: "auto" | "slots";
}): Promise<LintFixture> {
	const project = await createCodegenTestProject({
		codegen: {
			version: 1,
			outDir: "src/ui",
			...(options.shape ? { shape: options.shape } : {}),
		},
		components: options.components,
	});
	const read = await readProjectConfigReadOnly(project.root);
	const codegen = resolveCodegenConfig(read.config);
	if (codegen.status !== "configured") {
		throw new Error("codegen not configured");
	}
	await runCodegen({
		projectRoot: project.root,
		config: codegen,
		mode: "write",
	});
	for (const [file, text] of Object.entries(options.files)) {
		await mkdir(path.dirname(project.path(file)), { recursive: true });
		await writeFile(project.path(file), text);
	}

	const config = resolveLintConfig(
		options.lint ? { version: 1, ...options.lint } : null,
		{ ruleKinds: LINT_RULE_KINDS, codegenOutDir: codegen.outDir },
	);
	const walked = await walkSourceFiles(project.root, config.source);
	const modules = await Promise.all(
		walked.files.map(async (file) =>
			parseSourceModule(file, await readFile(project.path(file), "utf8"), {
				classCalls: config.source.classCalls,
			}),
		),
	);
	const contract = buildSystemContract({
		system: { id: CODEGEN_TEST_SYSTEM_ID, name: "Core" },
		manifest: {
			...createEmptySystemComponentManifest(),
			components: Object.fromEntries(
				options.components.map((record) => [record.componentId, record]),
			),
		},
		tokens: null,
		codegen,
	});
	const sources = buildSourceIndex({
		modules,
		contract,
		componentModules: config.components,
	});

	return {
		project,
		contract,
		sources,
		run: async (kind, runOptions = {}) => {
			const rule: ResolvedLintRule = {
				id: kind.id,
				enabled: true,
				severity: kind.defaultSeverity,
				options: runOptions.options ?? {},
			};
			let runContract = contract;
			if (runOptions.tokens) {
				const domains = { ...contract.tokens.domains };
				for (const [domain, names] of Object.entries(runOptions.tokens)) {
					domains[domain as TailwindTokenDomain] = [...(names ?? [])];
				}
				runContract = {
					...contract,
					tokens: {
						...contract.tokens,
						domains,
						snapshot: {
							syncedAt: "2026-01-01T00:00:00.000Z",
							reviewRequired: false,
						},
					},
				};
			}
			const inspect = runOptions.inspect;
			const context: LintRuleContext = {
				projectRoot: project.root,
				contract: runContract,
				config,
				rule,
				codegen: null,
				sources,
				designs: null,
				tailwind: {
					inspector: async () =>
						inspect
							? {
									inspect: (candidate): TailwindUtilityInspection => ({
										candidate,
										supported: inspect(candidate),
										parsedCandidateCount: inspect(candidate) ? 1 : 0,
										css: inspect(candidate) ? "x" : null,
									}),
								}
							: null,
				},
			};
			return kind.run(context);
		},
	};
}

export const createFixtures = () => {
	const fixtures: LintFixture[] = [];
	return {
		create: async (options: Parameters<typeof createLintFixture>[0]) => {
			const fixture = await createLintFixture(options);
			fixtures.push(fixture);
			return fixture;
		},
		cleanup: () =>
			Promise.all(
				fixtures.splice(0).map((fixture) => fixture.project.cleanup()),
			),
	};
};

/** Findings as `file:line:column message` lines, for compact assertions. */
export const describeFindings = (findings: LintRuleFinding[]): string[] =>
	findings.map((finding) => {
		const location =
			finding.location?.kind === "code"
				? `${finding.location.file}:${finding.location.line}:${finding.location.column}`
				: "-";
		return `${location} ${finding.message}`;
	});
