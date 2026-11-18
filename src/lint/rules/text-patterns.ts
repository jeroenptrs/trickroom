import type { LintRuleOptionField, LintRuleOptionSpec } from "../rule-options";

/**
 * Banned text in UI copy, shared by `code.text-pattern` and
 * `design.text-pattern`: the `patterns` option, its compilation and the
 * match. Pure; the patterns are the project's data, never Trickroom's.
 */

const PATTERN_FIELDS: readonly LintRuleOptionField[] = [
	{
		key: "pattern",
		label: "Pattern",
		description:
			"The text to find: matched literally, or as a JavaScript regular expression with regex on.",
		type: "string",
		required: true,
		placeholder: "Are you sure",
	},
	{
		key: "regex",
		label: "Regular expression",
		description: "Read the pattern as a regular expression.",
		type: "boolean",
	},
	{
		key: "flags",
		label: "Flags",
		description:
			"Regular expression flags, such as i for case-insensitive; also applies to a literal pattern. g and y are ignored.",
		type: "string",
		placeholder: "i",
	},
	{
		key: "message",
		label: "Message",
		description:
			"What the finding says: the guideline and what to write instead.",
		type: "string",
		required: true,
		placeholder: "Say what happens instead of asking for confirmation.",
	},
];

export const TEXT_PATTERNS_OPTION: LintRuleOptionSpec = {
	key: "patterns",
	label: "Banned text",
	description:
		"Text the copy must not contain, each with the message its finding shows. The rule does nothing until this lists a pattern.",
	type: "object-list",
	fields: PATTERN_FIELDS,
};

export type CompiledTextPattern = {
	/** The pattern as configured, for messages. */
	pattern: string;
	expression: RegExp;
	message: string;
};

const ALLOWED_FLAGS = new Set(["i", "m", "s", "u", "v"]);

const escapeRegExp = (value: string) =>
	value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * The configured patterns as regular expressions. Shapes are checked by the
 * option spec; what it cannot check (an invalid regular expression, an
 * unknown flag) comes back as problems, and the pattern is skipped.
 */
export const compileTextPatterns = (
	options: Record<string, unknown>,
): { patterns: CompiledTextPattern[]; problems: string[] } => {
	const patterns: CompiledTextPattern[] = [];
	const problems: string[] = [];
	const entries = Array.isArray(options.patterns) ? options.patterns : [];
	for (const [index, raw] of entries.entries()) {
		const entry = raw as {
			pattern: string;
			regex?: boolean;
			flags?: string;
			message: string;
		};
		const flags = [...new Set((entry.flags ?? "").split(""))].filter(
			(flag) => flag !== "g" && flag !== "y",
		);
		const unknown = flags.filter((flag) => !ALLOWED_FLAGS.has(flag));
		if (unknown.length > 0) {
			problems.push(
				`patterns[${index}].flags has unknown flag${unknown.length === 1 ? "" : "s"} ${unknown.join("")}; the pattern is skipped.`,
			);
			continue;
		}
		if (!flags.includes("u") && !flags.includes("v")) flags.push("u");
		try {
			patterns.push({
				pattern: entry.pattern,
				expression: new RegExp(
					entry.regex ? entry.pattern : escapeRegExp(entry.pattern),
					flags.join(""),
				),
				message: entry.message,
			});
		} catch (error) {
			problems.push(
				`patterns[${index}].pattern is not a valid regular expression (${error instanceof Error ? error.message : String(error)}); the pattern is skipped.`,
			);
		}
	}
	return { patterns, problems };
};

const MAX_EXCERPT = 80;

const excerpt = (text: string) => {
	const flat = text.replace(/\s+/gu, " ").trim();
	return flat.length > MAX_EXCERPT
		? `${flat.slice(0, MAX_EXCERPT - 1)}…`
		: flat;
};

export type TextPatternMatch = {
	pattern: CompiledTextPattern;
	/** The matched text. */
	match: string;
	/** The finding's message. */
	message: string;
};

/** The patterns a text matches, one match each (the first), in option order. */
export const matchTextPatterns = (
	text: string,
	patterns: readonly CompiledTextPattern[],
): TextPatternMatch[] => {
	const matches: TextPatternMatch[] = [];
	for (const pattern of patterns) {
		const found = pattern.expression.exec(text);
		if (!found) continue;
		matches.push({
			pattern,
			match: found[0],
			message: `${pattern.message} Found "${found[0]}" in "${excerpt(text)}".`,
		});
	}
	return matches;
};

/**
 * Name globs (`*` any run, `?` one character), matched against a whole
 * name, ignoring case.
 */
export const compileNameGlobs = (
	patterns: readonly string[],
): ((name: string) => boolean) => {
	const expressions = patterns
		.map((pattern) => pattern.trim())
		.filter((pattern) => pattern.length > 0)
		.map(
			(pattern) =>
				new RegExp(
					`^${pattern
						.split("")
						.map((char) =>
							char === "*" ? ".*" : char === "?" ? "." : escapeRegExp(char),
						)
						.join("")}$`,
					"iu",
				),
		);
	return (name) => expressions.some((expression) => expression.test(name));
};
