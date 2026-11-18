import { parseClassName } from "../../../utils/tailwind-classname/parse";
import type { LintDesignIndex } from "../../designs";
import type { LintRuleOptionSpec } from "../../rule-options";
import {
	CLASS_RESTRICTIONS_OPTION,
	compileClassRestrictions,
	findClassRestrictionViolations,
} from "../class-restrictions";
import { optionsNote } from "../code/analysis";
import {
	createDarkVariantChecker,
	DARK_VARIANT_OPTIONS,
} from "../dark-variants";
import {
	compileNameGlobs,
	compileTextPatterns,
	matchTextPatterns,
	TEXT_PATTERNS_OPTION,
} from "../text-patterns";
import type {
	LintComponentLocation,
	LintLocation,
	LintRuleFinding,
	LintRuleKind,
} from "../types";
import { collectLintClassTargets, targetLocationFields } from "./class-targets";

/**
 * The guideline kinds on the design side, twins of `../code/guidelines.ts`.
 * The class kinds check the class strings the other design class kinds do
 * (`collectLintClassTargets`: a component's classes once on its definition,
 * an instance only its override). The text kind checks text the same way:
 * every text of a published component version (template and slot
 * defaults) once on the component, and every text node of the linked
 * designs that has text of its own (`LintDesignNode.text`).
 */

const TEXT_PATTERN_ID = "design.text-pattern";

export const DESIGN_TEXT_PATTERN_OPTIONS: readonly LintRuleOptionSpec[] = [
	TEXT_PATTERNS_OPTION,
	{
		key: "skipLayers",
		label: "Skipped layers",
		description:
			"Layer name globs (`*` any run, `?` one character, any case): a text node is skipped when its name or an ancestor's matches, so notes and annotations next to the design are not linted. One per line.",
		type: "string-list",
		placeholder: "Note*",
	},
];

type DesignText = {
	text: string;
	/** Names of the node and its ancestors. */
	names: readonly string[];
	location: Extract<LintLocation, { kind: "design" }> | null;
	componentLocation?: LintComponentLocation;
	component?: string;
};

const parentPath = (path: string) => {
	const index = path.lastIndexOf(".children[");
	return index === -1 ? null : path.slice(0, index);
};

/** Every text the text kind checks, with where to report it. */
const collectDesignTexts = (designs: LintDesignIndex): DesignText[] => {
	const texts: DesignText[] = [];
	for (const definition of designs.components) {
		for (const entry of definition.texts) {
			texts.push({
				text: entry.text,
				names: entry.names,
				location: null,
				component: definition.slug,
				componentLocation: {
					componentId: definition.componentId,
					version: definition.version,
					...(entry.slot === null ? {} : { slot: entry.slot }),
					path: entry.path,
				},
			});
		}
	}
	for (const design of designs.designs) {
		for (const board of design.boards) {
			const names = new Map<string, readonly string[]>();
			for (const node of board.nodes) {
				// Depth first, so a parent is always indexed before its children.
				const parent = parentPath(node.path);
				const chain = [
					...((parent !== null ? names.get(parent) : undefined) ?? []),
					...(node.name === null ? [] : [node.name]),
				];
				names.set(node.path, chain);
				if (node.text === null || node.text.trim().length === 0) continue;
				texts.push({
					text: node.text,
					names: chain,
					location: {
						kind: "design",
						design: design.id,
						board: board.id,
						element: node.element,
						path: `${node.path}.children`,
					},
				});
			}
		}
	}
	return texts;
};

export const designTextPatternRule: LintRuleKind = {
	id: TEXT_PATTERN_ID,
	side: "design",
	defaultSeverity: "warning",
	description:
		"Configurable: a text in a design or a component contains text the options ban. Does nothing until options list patterns.",
	options: DESIGN_TEXT_PATTERN_OPTIONS,
	run: ({ designs, rule }) => {
		const { patterns, problems } = compileTextPatterns(rule.options);
		const findings: LintRuleFinding[] = [];
		if (problems.length > 0)
			findings.push(optionsNote(TEXT_PATTERN_ID, problems));
		if (patterns.length === 0) return findings;
		const skipped = compileNameGlobs(
			Array.isArray(rule.options.skipLayers)
				? (rule.options.skipLayers as string[])
				: [],
		);
		for (const entry of collectDesignTexts(designs)) {
			if (entry.names.some(skipped)) continue;
			for (const match of matchTextPatterns(entry.text, patterns)) {
				findings.push({
					location: entry.location,
					...(entry.componentLocation
						? { componentLocation: entry.componentLocation }
						: {}),
					...(entry.component ? { component: entry.component } : {}),
					message: match.message,
					details: { pattern: match.pattern.pattern, match: match.match },
				});
			}
		}
		return findings;
	},
};

const classTokens = (className: string) =>
	parseClassName(className).map((parsed) => parsed.raw);

export const designClassRestrictedRule: LintRuleKind = {
	id: "design.class-restricted",
	side: "design",
	defaultSeverity: "warning",
	description:
		"Configurable: a class string in a design or a component uses a class the options forbid, alone or next to another class. Does nothing until options list restrictions.",
	options: [CLASS_RESTRICTIONS_OPTION],
	run: ({ designs, rule }) => {
		const restrictions = compileClassRestrictions(rule.options);
		if (restrictions.length === 0) return [];
		const findings: LintRuleFinding[] = [];
		for (const target of collectLintClassTargets(designs)) {
			for (const violation of findClassRestrictionViolations(
				classTokens(target.className),
				restrictions,
				(token) => token,
			)) {
				findings.push({
					...targetLocationFields(target),
					message: violation.message,
					details: {
						classToken: violation.token,
						restriction: violation.restriction.index,
					},
				});
			}
		}
		return findings;
	},
};

export const designMissingDarkVariantRule: LintRuleKind = {
	id: "design.missing-dark-variant",
	side: "design",
	defaultSeverity: "warning",
	description:
		"Configurable: a class string in a design or a component sets a colour from the configured tokens without a dark: class for the same property and variants. Does nothing until options list colours.",
	options: DARK_VARIANT_OPTIONS,
	run: ({ contract, designs, rule }) => {
		const check = createDarkVariantChecker<string>(
			rule.options,
			contract.tokens.domains.color ?? [],
			(token) => token,
		);
		if (!check) return [];
		const findings: LintRuleFinding[] = [];
		for (const target of collectLintClassTargets(designs)) {
			for (const missing of check(classTokens(target.className))) {
				findings.push({
					...targetLocationFields(target),
					message: missing.message,
					details: { classToken: missing.token, expected: missing.expected },
				});
			}
		}
		return findings;
	},
};
