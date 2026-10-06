import {
	createDesignClassChecker,
	DESIGN_CLASS_DIAGNOSTIC_CODES,
	type DesignClassDiagnostic,
	type DesignClassTokens,
	splitClassCandidate,
} from "../../../utils/design-class-diagnostics";
import { TAILWIND_TOKEN_DOMAINS } from "../../../utils/tailwind-token-domains";
import type { SystemContractTokens } from "../../contract";
import type { LintRuleFinding, LintRuleKind } from "../types";

/**
 * The class and token checks `getDesignDiagnostics` runs on every
 * `className` (unknown or removed tokens, arbitrary values where the system
 * has tokens, utilities Tailwind cannot emit), over every board of every
 * linked design, configurable per system:
 *
 * - `allow`: classes or `*` globs never reported. A pattern matches the
 *   whole class (`hover:bg-legacy-500`) or the class without its variants
 *   and important marker (`bg-legacy-*` covers `md:hover:bg-legacy-500`).
 * - `codes`: report only these diagnostic codes (default: all of
 *   `DESIGN_CLASS_DIAGNOSTIC_CODES`).
 */

export const UNKNOWN_CLASS_TOKEN_RULE_ID = "design.unknown-class-token";

type UnknownClassTokenOptions = {
	allow: readonly string[];
	codes: ReadonlySet<string>;
};

const KNOWN_OPTIONS = new Set(["allow", "codes"]);
const KNOWN_CODES = new Set<string>(DESIGN_CLASS_DIAGNOSTIC_CODES);

const stringListIssues = (value: unknown, field: string): string[] =>
	value === undefined ||
	(Array.isArray(value) &&
		value.every((entry) => typeof entry === "string" && entry.trim()))
		? []
		: [`${field} must be a list of non-empty strings.`];

export const unknownClassTokenOptionIssues = (
	options: Record<string, unknown>,
): string[] => {
	const issues = Object.keys(options)
		.filter((key) => !KNOWN_OPTIONS.has(key))
		.map((key) => `options.${key} is not an option; use allow or codes.`);
	issues.push(...stringListIssues(options.allow, "options.allow"));
	const codeIssues = stringListIssues(options.codes, "options.codes");
	issues.push(...codeIssues);
	if (codeIssues.length === 0 && Array.isArray(options.codes)) {
		for (const code of options.codes as string[]) {
			if (!KNOWN_CODES.has(code.trim())) {
				issues.push(
					`options.codes has unknown code "${code}"; the codes are ${DESIGN_CLASS_DIAGNOSTIC_CODES.join(", ")}.`,
				);
			}
		}
	}
	return issues;
};

const readOptions = (
	options: Record<string, unknown>,
): UnknownClassTokenOptions => ({
	allow: Array.isArray(options.allow)
		? (options.allow as string[]).map((entry) => entry.trim())
		: [],
	codes: new Set(
		Array.isArray(options.codes)
			? (options.codes as string[]).map((entry) => entry.trim())
			: DESIGN_CLASS_DIAGNOSTIC_CODES,
	),
});

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** `*` matches any run of characters; everything else is literal. */
export const compileClassAllowList = (
	patterns: readonly string[],
): ((classToken: string) => boolean) => {
	if (patterns.length === 0) return () => false;
	const exact = new Set(patterns.filter((pattern) => !pattern.includes("*")));
	const globs = patterns
		.filter((pattern) => pattern.includes("*"))
		.map(
			(pattern) =>
				new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`, "u"),
		);
	const matches = (value: string) =>
		exact.has(value) || globs.some((glob) => glob.test(value));
	return (classToken) => {
		if (matches(classToken)) return true;
		const { important, root, modifier } = splitClassCandidate(classToken);
		const utility = `${root}${modifier}`;
		return matches(utility) || (important !== "" && matches(`!${utility}`));
	};
};

/** The contract's tokens as the class checks need them; null without a snapshot. */
export const designClassTokensFromContract = (
	tokens: SystemContractTokens,
): DesignClassTokens | null => {
	if (tokens.snapshot === null) return null;
	return {
		domains: Object.fromEntries(
			TAILWIND_TOKEN_DOMAINS.map((domain) => [
				domain,
				new Set(tokens.domains[domain]),
			]),
		) as unknown as DesignClassTokens["domains"],
		colorTokens: new Set(tokens.domains.color),
		removed: new Set(
			TAILWIND_TOKEN_DOMAINS.flatMap((domain) =>
				(tokens.removed[domain] ?? []).map((name) => `${domain}:${name}`),
			),
		),
		customUtilities: tokens.customUtilities,
	};
};

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

export const unknownClassTokenRule: LintRuleKind = {
	id: UNKNOWN_CLASS_TOKEN_RULE_ID,
	side: "design",
	defaultSeverity: "warning",
	description:
		"A class in a design references a token the system does not define or removed, uses an arbitrary value where the system has tokens, or is not a utility the system's Tailwind can emit.",
	validateOptions: unknownClassTokenOptionIssues,
	run: async ({ contract, designs, rule, tailwind }) => {
		const options = readOptions(rule.options);
		const isAllowed = compileClassAllowList(options.allow);
		const check = createDesignClassChecker({
			tokens: designClassTokensFromContract(contract.tokens),
			inspector: await tailwind.inspector(),
		});
		const findings: LintRuleFinding[] = [];
		const diagnostics: DesignClassDiagnostic[] = [];
		for (const design of designs.designs) {
			for (const board of design.boards) {
				for (const node of board.nodes) {
					if (node.className === null) continue;
					diagnostics.length = 0;
					check(
						node.className,
						{ path: `${node.path}.props.className`, elementId: node.element },
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
							location: {
								kind: "design",
								design: design.id,
								board: board.id,
								element: node.element,
								path: diagnostic.path,
							},
							details: detailsOf(diagnostic),
						});
					}
				}
			}
		}
		return findings;
	},
};
