import {
	type ClassTokenIssue,
	classTokenContextFromResolved,
	collectClassNameTokenIssues,
	compileClassAllowList,
} from "../../../utils/class-token-diagnostics";
import type { TailwindUtilityInspection } from "../../../utils/tailwind-utility-inspector";
import type { LintRuleOptionSpec } from "../../rule-options";
import type { LintRuleFinding, LintRuleKind } from "../types";
import {
	classTokenPosition,
	codeLocation,
	getCodeAnalysis,
	optionsNote,
} from "./analysis";

/**
 * Class strings in the scanned sources against the system's tokens, with
 * the same pipeline the design diagnostics use
 * (`src/utils/class-token-diagnostics.ts`): theme tokens per domain from
 * the contract, arbitrary values in token domains, and the compiled
 * Tailwind build (`context.tailwind.inspector()`) for whatever the token
 * tables cannot decide. Generated variants files are codegen's output and
 * are skipped, as are template fragments (`complete: false`).
 */

export const UNKNOWN_CLASS_TOKEN_SCOPES = [
	"wrappers",
	"usages",
	"all",
] as const;
export type UnknownClassTokenScope =
	(typeof UNKNOWN_CLASS_TOKEN_SCOPES)[number];

const RULE_ID = "code.unknown-class-token";

const readOptions = (options: Record<string, unknown>) => {
	const problems: string[] = [];
	let allow: string[] = [];
	let scope: UnknownClassTokenScope = "all";
	for (const key of Object.keys(options)) {
		if (key !== "allow" && key !== "scope") {
			problems.push(
				`"${key}" is not an option of this rule (allow, scope); ignored.`,
			);
		}
	}
	if (options.allow !== undefined) {
		if (
			Array.isArray(options.allow) &&
			options.allow.every((entry) => typeof entry === "string")
		) {
			allow = options.allow as string[];
		} else {
			problems.push('"allow" must be a list of class globs; ignored.');
		}
	}
	if (options.scope !== undefined) {
		if (
			typeof options.scope === "string" &&
			(UNKNOWN_CLASS_TOKEN_SCOPES as readonly string[]).includes(options.scope)
		) {
			scope = options.scope as UnknownClassTokenScope;
		} else {
			problems.push(
				`"scope" must be one of ${UNKNOWN_CLASS_TOKEN_SCOPES.map((entry) => `"${entry}"`).join(", ")}; using "all".`,
			);
		}
	}
	return { allow, scope, problems };
};

export const CODE_UNKNOWN_CLASS_TOKEN_OPTIONS: readonly LintRuleOptionSpec[] = [
	{
		key: "allow",
		label: "Allowed classes",
		description:
			"Classes never reported. `*` matches any run of characters and `?` one; a pattern matches the whole class or its utility without variants.",
		type: "string-list",
		placeholder: "bg-legacy-*",
	},
	{
		key: "scope",
		label: "Scope",
		description:
			"Which class strings are checked: in bound wrappers, at usage sites, or all scanned sources (default).",
		type: "string",
		values: UNKNOWN_CLASS_TOKEN_SCOPES,
	},
];

export const unknownClassTokenRule: LintRuleKind = {
	id: RULE_ID,
	side: "code",
	defaultSeverity: "warning",
	description:
		"A class string in a wrapper or usage site uses a token or utility the system does not define.",
	options: CODE_UNKNOWN_CLASS_TOKEN_OPTIONS,
	run: async (context) => {
		const { allow, scope, problems } = readOptions(context.rule.options);
		const findings: LintRuleFinding[] = [];
		if (problems.length > 0) findings.push(optionsNote(RULE_ID, problems));

		const tokens = context.contract.tokens;
		const hasSnapshot = tokens.snapshot !== null;
		const loaded = await context.tailwind.inspector();
		if (!hasSnapshot && !loaded) {
			findings.push({
				severity: "info",
				message:
					"The system has no token snapshot and no compiled CSS, so class tokens were not checked. Sync the system's tokens (or link its CSS) to enable this rule.",
				location: null,
			});
			return findings;
		}

		// One inspection per distinct candidate: the compiled build is the
		// slow part, and the same classes repeat across files.
		const inspections = new Map<string, TailwindUtilityInspection>();
		const inspector = loaded
			? {
					inspect: (candidate: string) => {
						let inspection = inspections.get(candidate);
						if (!inspection) {
							inspection = loaded.inspect(candidate);
							inspections.set(candidate, inspection);
						}
						return inspection;
					},
				}
			: null;
		const checkContext = classTokenContextFromResolved(
			{
				domains: tokens.domains,
				customUtilities: tokens.customUtilities,
				hasSnapshot,
			},
			inspector,
		);
		const allowed = compileClassAllowList(allow);
		const issuesByString = new Map<string, ClassTokenIssue[]>();

		const sources = context.sources;
		const analysis = getCodeAnalysis(context);
		// Wrapper modules as the rules see them: a configured barrel counts
		// through the modules that implement it.
		const wrapperSlug = new Map<string, string>();
		for (const [slug, files] of analysis.wrappers) {
			for (const file of files) {
				if (!wrapperSlug.has(file)) wrapperSlug.set(file, slug);
			}
		}
		const usageFiles = new Set(analysis.usages.map((usage) => usage.file));
		const inScope = (file: string) =>
			scope === "all"
				? true
				: scope === "wrappers"
					? wrapperSlug.has(file)
					: usageFiles.has(file);

		for (const file of sources.files) {
			if (sources.generated[file] !== undefined || !inScope(file)) continue;
			const slug = wrapperSlug.get(file);
			for (const entry of sources.modules[file].classStrings) {
				if (!entry.complete) continue;
				let issues = issuesByString.get(entry.value);
				if (!issues) {
					issues = collectClassNameTokenIssues(entry.value, checkContext);
					issuesByString.set(entry.value, issues);
				}
				for (const issue of issues) {
					if (allowed(issue.classToken)) continue;
					findings.push({
						...(slug ? { component: slug } : {}),
						location: codeLocation(
							file,
							classTokenPosition(entry, issue.classToken),
						),
						message: `${issue.message} Use a token of the system, or add "${issue.classToken}" to this rule's allow list if it is intended.`,
					});
				}
			}
		}
		return findings;
	},
};
