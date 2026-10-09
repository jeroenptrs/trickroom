import { compileClassAllowList } from "../../utils/class-token-diagnostics";
import { parseClassName } from "../../utils/tailwind-classname/parse";
import type { LintRuleOptionSpec } from "../rule-options";
import type { LintRuleFinding, LintTailwindInspector } from "./types";

/**
 * The shared half of `code.non-canonical-class` and
 * `design.non-canonical-class`: every class of a class string against the
 * form the system's Tailwind writes it in (`canonicalizeCandidates`, through
 * `LintTailwindInspector.canonicalize`). Classes are judged one at a time,
 * so the verdict never depends on the classes around it.
 *
 * A canonical form is suggested only when compiling it gives the class's CSS
 * (`tailwind-canonical-equivalence.ts`): always, or under the current theme
 * (`themeVariables`, said in the message). A form that compiles to other CSS
 * (another selector, specificity or declaration, or nothing) is not
 * reported: the class as written is the correct one.
 */

export const NON_CANONICAL_CLASS_OPTIONS: readonly LintRuleOptionSpec[] = [
	{
		key: "allow",
		label: "Allowed classes",
		description:
			"Classes never reported. `*` matches any run of characters and `?` one; a pattern matches the whole class or its utility without variants.",
		type: "string-list",
		placeholder: "[scrollbar-width:*]",
	},
];

export type NonCanonicalClass = {
	/** The class as written. */
	classToken: string;
	/** The class as Tailwind writes it. */
	canonical: string;
	/** Which occurrence of `classToken` in the string, from 0. */
	occurrence: number;
	/**
	 * The theme variables `canonical` equals the class through
	 * (`calc(var(--spacing) * 154)` for `38.5rem`); empty when it compiles to
	 * the same CSS whatever the theme.
	 */
	themeVariables: string[];
};

/**
 * A checker over the class strings of one run: every distinct class is
 * canonicalized once, in one batch (in a worker on the server), and the
 * checker then answers per string without waiting. Null when the inspector
 * cannot canonicalize (no compiled CSS).
 */
export const createCanonicalClassChecker = async (
	inspector: LintTailwindInspector | null,
	options: Record<string, unknown>,
	classNames: Iterable<string>,
): Promise<((className: string) => NonCanonicalClass[]) | null> => {
	const canonicalize = inspector?.canonicalize;
	if (!canonicalize) return null;
	const allowed = compileClassAllowList(
		Array.isArray(options.allow) ? (options.allow as string[]) : [],
	);
	const tokens = new Set<string>();
	for (const className of classNames) {
		for (const { raw } of parseClassName(className)) {
			if (!allowed(raw)) tokens.add(raw);
		}
	}
	const distinct = [...tokens];
	const written = await canonicalize(distinct);
	// Only forms verified to compile to the class's CSS are suggested.
	const suggested = new Map<
		string,
		{ canonical: string; themeVariables: string[] }
	>();
	distinct.forEach((token, index) => {
		const result = written[index];
		if (!result || result.canonical === token) return;
		const verdict = result.verdict;
		if (verdict?.status === "equivalent") {
			suggested.set(token, { canonical: result.canonical, themeVariables: [] });
		} else if (verdict?.status === "theme-dependent") {
			suggested.set(token, {
				canonical: result.canonical,
				themeVariables: verdict.themeVariables,
			});
		}
	});
	return (className) => {
		const found: NonCanonicalClass[] = [];
		const seen = new Map<string, number>();
		for (const { raw } of parseClassName(className)) {
			const occurrence = seen.get(raw) ?? 0;
			seen.set(raw, occurrence + 1);
			const form = suggested.get(raw);
			if (!form) continue;
			found.push({ classToken: raw, occurrence, ...form });
		}
		return found;
	};
};

const themeVariableList = (themeVariables: readonly string[]) =>
	themeVariables.map((name) => `\`${name}\``).join(", ");

export const nonCanonicalClassMessage = ({
	classToken,
	canonical,
	themeVariables,
}: NonCanonicalClass) =>
	themeVariables.length === 0
		? `Class "${classToken}" is written "${canonical}" in Tailwind's canonical form.`
		: `Class "${classToken}" is written "${canonical}" in Tailwind's canonical form, which follows the theme: it compiles to the same CSS only while ${themeVariableList(themeVariables)} ${themeVariables.length === 1 ? "keeps its current value" : "keep their current values"}.`;

/** What `design_validate` returns with the finding: the replacement as a suggestion. */
export const nonCanonicalClassDetails = (
	className: string,
	{ classToken, canonical, themeVariables }: NonCanonicalClass,
) => ({
	className,
	classToken,
	canonical,
	suggestions: [canonical],
	...(themeVariables.length > 0
		? { themeDependent: true, themeVariables }
		: {}),
});

export const noCompiledCssNote: LintRuleFinding = {
	severity: "info",
	message:
		"The system has no compiled CSS, so classes were not checked against Tailwind's canonical forms. Link the system's CSS to enable this rule.",
	location: null,
};
