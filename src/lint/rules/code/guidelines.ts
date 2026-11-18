import type { LintRuleOptionSpec } from "../../rule-options";
import { compileGlobs } from "../../source/glob";
import {
	CLASS_RESTRICTIONS_OPTION,
	compileClassRestrictions,
	findClassRestrictionViolations,
} from "../class-restrictions";
import {
	createDarkVariantChecker,
	DARK_VARIANT_OPTIONS,
} from "../dark-variants";
import {
	compileTextPatterns,
	matchTextPatterns,
	TEXT_PATTERNS_OPTION,
} from "../text-patterns";
import type { LintRuleFinding, LintRuleKind } from "../types";
import { classTokenPosition, codeLocation, optionsNote } from "./analysis";
import {
	type CodeClassToken,
	codeClassGroups,
	EXCLUDE_FILES_OPTION,
	excludedFiles,
	renderTogether,
} from "./class-groups";

/**
 * The guideline kinds on the code side: a project's writing and design
 * guidelines as data in `lint.json`. Each does nothing until configured.
 * The design-side twins are in `../design/guidelines.ts`.
 */

const TEXT_PATTERN_ID = "code.text-pattern";

/** Attributes whose string values are UI copy, unless `attributes` says otherwise. */
export const DEFAULT_TEXT_ATTRIBUTES: readonly string[] = [
	"label",
	"title",
	"placeholder",
	"aria-label",
	"aria-description",
	"alt",
	"description",
];

export const CODE_TEXT_PATTERN_OPTIONS: readonly LintRuleOptionSpec[] = [
	TEXT_PATTERNS_OPTION,
	{
		key: "attributes",
		label: "Text attributes",
		description: `JSX attributes whose string values are checked, besides text children. Default: ${DEFAULT_TEXT_ATTRIBUTES.join(", ")}. One per line.`,
		type: "string-list",
		placeholder: "aria-label",
	},
	EXCLUDE_FILES_OPTION,
];

export const codeTextPatternRule: LintRuleKind = {
	id: TEXT_PATTERN_ID,
	side: "code",
	defaultSeverity: "warning",
	description:
		"Configurable: UI copy in JSX (text children and text attributes such as label, title, placeholder and aria-label) contains text the options ban. Does nothing until options list patterns.",
	options: CODE_TEXT_PATTERN_OPTIONS,
	run: ({ rule, sources }) => {
		const { patterns, problems } = compileTextPatterns(rule.options);
		const findings: LintRuleFinding[] = [];
		if (problems.length > 0)
			findings.push(optionsNote(TEXT_PATTERN_ID, problems));
		if (patterns.length === 0) return findings;
		const attributes = new Set(
			Array.isArray(rule.options.attributes)
				? (rule.options.attributes as string[])
				: DEFAULT_TEXT_ATTRIBUTES,
		);
		const skip = excludedFiles(rule.options);
		for (const file of sources.files) {
			if (sources.generated[file] !== undefined || skip(file)) continue;
			for (const text of sources.modules[file].texts) {
				if (
					text.origin.kind === "jsx-attribute" &&
					!attributes.has(text.origin.attribute)
				) {
					continue;
				}
				for (const match of matchTextPatterns(text.value, patterns)) {
					findings.push({
						location: codeLocation(file, text.position),
						message: match.message,
						details: { pattern: match.pattern.pattern, match: match.match },
					});
				}
			}
		}
		return findings;
	},
};

export const CODE_CLASS_RESTRICTED_OPTIONS: readonly LintRuleOptionSpec[] = [
	CLASS_RESTRICTIONS_OPTION,
];

export const codeClassRestrictedRule: LintRuleKind = {
	id: "code.class-restricted",
	side: "code",
	defaultSeverity: "warning",
	description:
		"Configurable: a class string uses a class the options forbid, alone or next to another class. Does nothing until options list restrictions.",
	options: CODE_CLASS_RESTRICTED_OPTIONS,
	run: ({ rule, sources }) => {
		const restrictions = compileClassRestrictions(rule.options);
		if (restrictions.length === 0) return [];
		const allowIn = new Map(
			restrictions.map((restriction) => [
				restriction,
				restriction.allowIn.length > 0
					? compileGlobs(restriction.allowIn)
					: () => false,
			]),
		);
		const findings: LintRuleFinding[] = [];
		for (const group of codeClassGroups(sources)) {
			const applicable = restrictions.filter(
				(restriction) => !allowIn.get(restriction)?.(group.file),
			);
			if (applicable.length === 0) continue;
			for (const violation of findClassRestrictionViolations(
				group.tokens,
				applicable,
				(token) => token.classToken,
				renderTogether,
			)) {
				findings.push({
					location: codeLocation(
						group.file,
						classTokenPosition(
							violation.token.entry,
							violation.token.classToken,
							violation.token.occurrence,
						),
					),
					message: violation.message,
					details: {
						classToken: violation.token.classToken,
						restriction: violation.restriction.index,
					},
				});
			}
		}
		return findings;
	},
};

export const CODE_MISSING_DARK_VARIANT_OPTIONS: readonly LintRuleOptionSpec[] =
	[...DARK_VARIANT_OPTIONS, EXCLUDE_FILES_OPTION];

export const codeMissingDarkVariantRule: LintRuleKind = {
	id: "code.missing-dark-variant",
	side: "code",
	defaultSeverity: "warning",
	description:
		"Configurable: a class string sets a colour from the configured tokens without a dark: class for the same property and variants. Does nothing until options list colours.",
	options: CODE_MISSING_DARK_VARIANT_OPTIONS,
	run: ({ contract, rule, sources }) => {
		const check = createDarkVariantChecker<CodeClassToken>(
			rule.options,
			contract.tokens.domains.color ?? [],
			(token) => token.classToken,
			renderTogether,
		);
		if (!check) return [];
		const findings: LintRuleFinding[] = [];
		for (const group of codeClassGroups(sources, excludedFiles(rule.options))) {
			for (const missing of check(group.tokens)) {
				findings.push({
					location: codeLocation(
						group.file,
						classTokenPosition(
							missing.token.entry,
							missing.token.classToken,
							missing.token.occurrence,
						),
					),
					message: missing.message,
					details: {
						classToken: missing.token.classToken,
						expected: missing.expected,
					},
				});
			}
		}
		return findings;
	},
};
