import { compileClassAllowList } from "../../utils/class-token-diagnostics";
import { classifyColorParsedClass } from "../../utils/tailwind-classname/color";
import { parseClassName } from "../../utils/tailwind-classname/parse";
import type { LintRuleOptionSpec } from "../rule-options";

/**
 * Colour classes without a `dark:` counterpart in the same class string,
 * shared by `code.missing-dark-variant` and `design.missing-dark-variant`.
 * Pure.
 *
 * A class is read with the Tailwind class parser and colour classifier the
 * token diagnostics use (`src/utils/tailwind-classname`): its variants, the
 * `dark` mode, and, for a colour utility, the property it sets (`bg`,
 * `text`, `border-t`, `ring`, `divide-x`, `fill`, `stroke`, `outline`,
 * `decoration`, `shadow`, `from`, …) and its colour. A class needs a twin
 * when its colour is a token the `colors` globs name and `allow` does not
 * exempt it; the twin is a colour class for the same property with the
 * same variants plus `dark`, in any order (`hover:bg-pale-3` is answered by
 * `dark:hover:bg-pale-9` or `hover:dark:bg-pale-9`). Opacity modifiers and
 * `!` do not matter. The twin's colour is a keyword, an arbitrary value, a
 * colour token of the system, or one the `colors` globs name; without a
 * token snapshot, any colour the classifier recognises.
 */

export const DARK_VARIANT_OPTIONS: readonly LintRuleOptionSpec[] = [
	{
		key: "colors",
		label: "Colours",
		description:
			"Colour token globs whose classes need a dark: counterpart (`pale-*`). The rule does nothing until this lists one. One per line.",
		type: "string-list",
		placeholder: "pale-*",
	},
	{
		key: "allow",
		label: "Exempt classes",
		description:
			"Class globs that need no counterpart, such as semantic utilities that switch themselves in CSS. Matched as written and as the utility without variants. One per line.",
		type: "string-list",
		placeholder: "bg-pale-app",
	},
];

/** Colour keywords a twin may use. */
const KEYWORDS = new Set([
	"transparent",
	"current",
	"inherit",
	"white",
	"black",
]);

export type DarkVariantChecker<Token> = (
	tokens: readonly Token[],
) => Array<{ token: Token; expected: string; message: string }>;

type ReadClass = {
	/** The utility without its colour: `bg-`, `border-t-`. */
	property: string;
	/** Sorted variants without `dark`. */
	variants: string;
	dark: boolean;
	/** The colour token, or null for a keyword or an arbitrary value. */
	token: string | null;
};

/**
 * A checker for one rule run, or null when `colors` names nothing.
 * `colorTokens` are the system's colour token names (a twin may use any).
 */
export const createDarkVariantChecker = <Token>(
	options: Record<string, unknown>,
	colorTokens: readonly string[],
	classOf: (token: Token) => string,
	together: (left: Token, right: Token) => boolean = () => true,
): DarkVariantChecker<Token> | null => {
	const colorGlobs = Array.isArray(options.colors)
		? (options.colors as string[])
		: [];
	if (colorGlobs.every((glob) => glob.trim().length === 0)) return null;
	const needsTwin = compileClassAllowList(colorGlobs);
	const allowed = compileClassAllowList(
		Array.isArray(options.allow) ? (options.allow as string[]) : [],
	);
	const tokenSet = new Set(colorTokens);
	const cache = new Map<string, ReadClass | null>();
	const read = (classToken: string): ReadClass | null => {
		const cached = cache.get(classToken);
		if (cached !== undefined) return cached;
		let result: ReadClass | null = null;
		const parsed = parseClassName(classToken)[0];
		const intent = parsed
			? classifyColorParsedClass(parsed, { colorTokens: tokenSet })
			: null;
		if (parsed && intent) {
			const value = intent.token ?? intent.keyword ?? intent.arbitraryValue;
			if (value !== null && parsed.utility.endsWith(value)) {
				result = {
					property: parsed.utility.slice(0, -value.length),
					variants: [...parsed.variants].sort().join(":"),
					dark: parsed.modes.includes("dark"),
					token: intent.token,
				};
			}
		}
		cache.set(classToken, result);
		return result;
	};
	const isColour = (entry: ReadClass) =>
		entry.token === null ||
		KEYWORDS.has(entry.token) ||
		// Without a token snapshot every colour the classifier sees counts.
		tokenSet.size === 0 ||
		tokenSet.has(entry.token) ||
		needsTwin(entry.token);
	return (tokens) => {
		const entries = tokens.map((token) => ({
			token,
			read: read(classOf(token)),
		}));
		const missing: Array<{ token: Token; expected: string; message: string }> =
			[];
		for (const { token, read: entry } of entries) {
			if (!entry || entry.dark || entry.token === null) continue;
			if (!needsTwin(entry.token)) continue;
			const classToken = classOf(token);
			if (allowed(classToken)) continue;
			const answered = entries.some(
				(other) =>
					other.read?.dark === true &&
					other.read.property === entry.property &&
					other.read.variants === entry.variants &&
					isColour(other.read) &&
					together(token, other.token),
			);
			if (answered) continue;
			const expected = `dark:${entry.variants ? `${entry.variants}:` : ""}${entry.property}*`;
			missing.push({
				token,
				expected,
				message: `Class "${classToken}" has no dark counterpart for the same property in this class string. Add a ${expected} class, or exempt the class in this rule's allow list if it switches itself in CSS.`,
			});
		}
		return missing;
	};
};
