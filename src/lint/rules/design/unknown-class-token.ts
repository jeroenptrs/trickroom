import {
	CLASS_TOKEN_DIAGNOSTIC_CODES,
	classTokenContextFromResolved,
	compileClassAllowList,
} from "../../../utils/class-token-diagnostics";
import {
	createDesignClassChecker,
	type DesignClassDiagnostic,
} from "../../../utils/design-class-diagnostics";
import type { LintRuleOptionSpec } from "../../rule-options";
import type { LintRuleFinding, LintRuleKind } from "../types";
import { collectLintClassTargets } from "./class-targets";

/**
 * The class and token checks `getDesignDiagnostics` runs on every
 * `className` (unknown or removed tokens, arbitrary values where the system
 * has tokens, utilities Tailwind cannot emit), over the classes of the
 * system's component definitions and of the layers of every linked design
 * (`collectLintClassTargets`), configurable per system with the options
 * below. The per-class checks are `src/utils/class-token-diagnostics.ts`,
 * shared with `code.unknown-class-token`.
 */

export const UNKNOWN_CLASS_TOKEN_RULE_ID = "design.unknown-class-token";

export const DESIGN_UNKNOWN_CLASS_TOKEN_OPTIONS: readonly LintRuleOptionSpec[] =
	[
		{
			key: "allow",
			label: "Allowed classes",
			description:
				"Classes never reported. `*` matches any run of characters and `?` one; a pattern matches the whole class or its utility without variants (`bg-legacy-*` allows `md:hover:bg-legacy-500`).",
			type: "string-list",
			placeholder: "bg-legacy-*",
		},
		{
			key: "codes",
			label: "Checks",
			description:
				"Report only these checks; all of them when unset. One code per line.",
			type: "string-list",
			placeholder: "UNKNOWN_COLOR_TOKEN",
			values: CLASS_TOKEN_DIAGNOSTIC_CODES,
		},
	];

/** Options already checked against the specs by `getLintConfigIssues`. */
const readOptions = (options: Record<string, unknown>) => ({
	allow: Array.isArray(options.allow) ? (options.allow as string[]) : [],
	codes: new Set<string>(
		Array.isArray(options.codes)
			? (options.codes as string[])
			: CLASS_TOKEN_DIAGNOSTIC_CODES,
	),
});

/** The fields of a class diagnostic `design_validate` returns with the finding. */
const detailsOf = (diagnostic: DesignClassDiagnostic) => ({
	check: diagnostic.code,
	className: diagnostic.className,
	classToken: diagnostic.classToken,
	...(diagnostic.token === undefined ? {} : { token: diagnostic.token }),
	...(diagnostic.property === undefined
		? {}
		: { property: diagnostic.property }),
	...(diagnostic.domain === undefined ? {} : { domain: diagnostic.domain }),
	...(diagnostic.suggestions === undefined
		? {}
		: { suggestions: diagnostic.suggestions }),
});

export const designUnknownClassTokenRule: LintRuleKind = {
	id: UNKNOWN_CLASS_TOKEN_RULE_ID,
	side: "design",
	defaultSeverity: "warning",
	description:
		"A class in a design references a token the system does not define or removed, uses an arbitrary value where the system has tokens, or is not a utility the system's Tailwind can emit.",
	options: DESIGN_UNKNOWN_CLASS_TOKEN_OPTIONS,
	run: async ({ contract, designs, rule, tailwind }) => {
		const options = readOptions(rule.options);
		const isAllowed = compileClassAllowList(options.allow);
		const check = createDesignClassChecker(
			classTokenContextFromResolved(
				{
					domains: contract.tokens.domains,
					customUtilities: contract.tokens.customUtilities,
					hasSnapshot: contract.tokens.snapshot !== null,
				},
				await tailwind.inspector(),
			),
		);
		const findings: LintRuleFinding[] = [];
		const diagnostics: DesignClassDiagnostic[] = [];
		for (const target of collectLintClassTargets(designs)) {
			diagnostics.length = 0;
			check(
				target.className,
				{ path: target.location.path ?? "", elementId: target.element ?? "" },
				diagnostics,
			);
			for (const diagnostic of diagnostics) {
				if (
					!options.codes.has(diagnostic.code) ||
					isAllowed(diagnostic.classToken)
				) {
					continue;
				}
				findings.push({
					message: diagnostic.message,
					location: target.location,
					...(target.component ? { component: target.component } : {}),
					details: detailsOf(diagnostic),
				});
			}
		}
		return findings;
	},
};
