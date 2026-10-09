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
};

/**
 * A checker over one run: the canonical form of each distinct class is
 * computed once. Null when the inspector cannot canonicalize (no compiled
 * CSS).
 */
export const createCanonicalClassChecker = (
	inspector: LintTailwindInspector | null,
	options: Record<string, unknown>,
): ((className: string) => NonCanonicalClass[]) | null => {
	const canonicalize = inspector?.canonicalize;
	if (!canonicalize) return null;
	const allowed = compileClassAllowList(
		Array.isArray(options.allow) ? (options.allow as string[]) : [],
	);
	const canonical = new Map<string, string>();
	return (className) => {
		const found: NonCanonicalClass[] = [];
		const seen = new Map<string, number>();
		for (const { raw } of parseClassName(className)) {
			const occurrence = seen.get(raw) ?? 0;
			seen.set(raw, occurrence + 1);
			let written = canonical.get(raw);
			if (written === undefined) {
				written = canonicalize(raw);
				canonical.set(raw, written);
			}
			if (written === raw || allowed(raw)) continue;
			found.push({ classToken: raw, canonical: written, occurrence });
		}
		return found;
	};
};

export const nonCanonicalClassMessage = ({
	classToken,
	canonical,
}: NonCanonicalClass) =>
	`Class "${classToken}" is written "${canonical}" in Tailwind's canonical form.`;

/** What `design_validate` returns with the finding: the replacement as a suggestion. */
export const nonCanonicalClassDetails = (
	className: string,
	{ classToken, canonical }: NonCanonicalClass,
) => ({
	className,
	classToken,
	canonical,
	suggestions: [canonical],
});

export const noCompiledCssNote: LintRuleFinding = {
	severity: "info",
	message:
		"The system has no compiled CSS, so classes were not checked against Tailwind's canonical forms. Link the system's CSS to enable this rule.",
	location: null,
};
