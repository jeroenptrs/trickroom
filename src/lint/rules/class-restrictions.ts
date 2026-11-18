import { compileClassAllowList } from "../../utils/class-token-diagnostics";
import type { LintRuleOptionField, LintRuleOptionSpec } from "../rule-options";

/**
 * Forbidden classes and class combinations within one class string, shared
 * by `code.class-restricted` and `design.class-restricted`. Pure.
 */

const RESTRICTION_FIELDS: readonly LintRuleOptionField[] = [
	{
		key: "classes",
		label: "Classes",
		description:
			"Class globs that are forbidden: `*` matches any run of characters and `?` one, against the class as written and its utility without variants. One per line.",
		type: "string-list",
		required: true,
		placeholder: "text-pale-dim",
	},
	{
		key: "when",
		label: "Only next to",
		description:
			"Class globs: the restriction applies only when the same class string also has one of these. Always when empty.",
		type: "string-list",
		placeholder: "text-title-*",
	},
	{
		key: "message",
		label: "Message",
		description:
			"What the finding says: the guideline and what to use instead.",
		type: "string",
		required: true,
		placeholder: "Titles never dim.",
	},
	{
		key: "allowIn",
		label: "Allowed in files",
		description:
			"Code side only: project-relative file globs where the classes are allowed. One per line.",
		type: "string-list",
		placeholder: "src/components/ui/link.tsx",
	},
];

export const CLASS_RESTRICTIONS_OPTION: LintRuleOptionSpec = {
	key: "restrictions",
	label: "Restrictions",
	description:
		"Forbidden classes, optionally only next to other classes, each with the message its finding shows. The rule does nothing until this lists a restriction.",
	type: "object-list",
	fields: RESTRICTION_FIELDS,
};

export type CompiledClassRestriction = {
	index: number;
	classes: (classToken: string) => boolean;
	when: ((classToken: string) => boolean) | null;
	message: string;
	allowIn: readonly string[];
};

/** The configured restrictions; shapes are checked by the option spec. */
export const compileClassRestrictions = (
	options: Record<string, unknown>,
): CompiledClassRestriction[] =>
	(Array.isArray(options.restrictions) ? options.restrictions : []).map(
		(raw, index) => {
			const entry = raw as {
				classes: string[];
				when?: string[];
				message: string;
				allowIn?: string[];
			};
			return {
				index,
				classes: compileClassAllowList(entry.classes),
				when:
					entry.when && entry.when.length > 0
						? compileClassAllowList(entry.when)
						: null,
				message: entry.message,
				allowIn: entry.allowIn ?? [],
			};
		},
	);

export type ClassRestrictionViolation<Token> = {
	restriction: CompiledClassRestriction;
	token: Token;
	/** The class that made a `when` restriction apply. */
	trigger?: Token;
	message: string;
};

/**
 * The restricted classes among `tokens`, one violation per class and
 * restriction. `classOf` reads a token's class; `together` says whether two
 * tokens can render together (code: not on two sides of one conditional).
 * A class never triggers its own `when`.
 */
export const findClassRestrictionViolations = <Token>(
	tokens: readonly Token[],
	restrictions: readonly CompiledClassRestriction[],
	classOf: (token: Token) => string,
	together: (left: Token, right: Token) => boolean = () => true,
): ClassRestrictionViolation<Token>[] => {
	const violations: ClassRestrictionViolation<Token>[] = [];
	for (const restriction of restrictions) {
		for (const token of tokens) {
			const classToken = classOf(token);
			if (!restriction.classes(classToken)) continue;
			let trigger: Token | undefined;
			if (restriction.when) {
				const when = restriction.when;
				trigger = tokens.find(
					(other) =>
						other !== token && when(classOf(other)) && together(token, other),
				);
				if (trigger === undefined) continue;
			}
			violations.push({
				restriction,
				token,
				...(trigger === undefined ? {} : { trigger }),
				message: `Class "${classToken}"${trigger === undefined ? "" : ` next to "${classOf(trigger)}"`}: ${restriction.message}`,
			});
		}
	}
	return violations;
};
