import { compileClassAllowList } from "../../utils/class-token-diagnostics";
import type { ContextCheck } from "../../utils/tailwind-canonical-equivalence";
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
 *
 * Equivalent on its own is not equivalent on an element: Tailwind may emit
 * the canonical form at another place relative to a competing class
 * (`bg-[#FFF] bg-red-500` is red, `bg-white bg-red-500` white). So each
 * finding is settled among the classes that may render with it
 * (`settleInContext`): a form that changes which declaration wins, or that
 * merging treats differently, is not reported either; one whose context is
 * not fully known is reported as `contextDependent`.
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
	/**
	 * Set by `settleInContext`: other classes may render with this one that
	 * the check could not see, so the cascade next to them is not verified.
	 */
	contextDependent?: boolean;
};

/** The classes that may render on the element a class string styles. */
export type ClassContext = {
	/**
	 * Every class that may render there, the checked class included (when
	 * it renders): as rendered where that is known (merged), else a
	 * superset, as if every class string that may apply did.
	 */
	classes: readonly string[];
	/** False when more classes may render there than `classes`. */
	complete: boolean;
	/**
	 * Where classes may be merged (tailwind-merge) before they render: true
	 * when replacing the class by `canonical` changes the merged classes in
	 * nothing but that class.
	 */
	mergesAlike?: (classToken: string, canonical: string) => boolean;
};

const classesOf = (className: string) =>
	className.split(/\s+/u).filter(Boolean);

/** `className` with every `classToken` replaced by `canonical`. */
export const replaceClass = (
	className: string,
	classToken: string,
	canonical: string,
) =>
	classesOf(className)
		.map((entry) => (entry === classToken ? canonical : entry))
		.join(" ");

/**
 * Whether `merge` treats `canonical` like `classToken` in `className`: the
 * merged classes with the replacement are the merged classes with the class
 * replaced, as sets.
 */
export const mergeTreatsAlike = (
	merge: (className: string) => string,
	className: string,
	classToken: string,
	canonical: string,
) => {
	const before = new Set(
		classesOf(replaceClass(merge(className), classToken, canonical)),
	);
	const after = new Set(
		classesOf(merge(replaceClass(className, classToken, canonical))),
	);
	return before.size === after.size && [...before].every((c) => after.has(c));
};

/**
 * Settles each finding among the classes that may render with it: null when
 * the replacement would change the result there (merging treats it
 * differently, or a competing declaration wins where it lost or loses where
 * it won, `verifyCanonicalInContext`); otherwise the finding, marked
 * `contextDependent` when the context is incomplete. Checks without other
 * classes need no compiling; the others go to the inspector in one batch.
 */
export const settleInContext = async (
	inspector: LintTailwindInspector | null,
	items: ReadonlyArray<{ found: NonCanonicalClass; context: ClassContext }>,
): Promise<Array<NonCanonicalClass | null>> => {
	const checks = new Map<string, ContextCheck>();
	const plans = items.map(({ found, context }) => {
		const { classToken, canonical } = found;
		if (context.mergesAlike && !context.mergesAlike(classToken, canonical)) {
			return null;
		}
		const others = context.classes.filter((entry) => entry !== classToken);
		if (!context.classes.includes(classToken) || others.length === 0) {
			return { found, complete: context.complete, key: null };
		}
		const check = {
			classes: context.classes,
			candidate: classToken,
			canonical,
		};
		const key = JSON.stringify([
			[...new Set(context.classes)].sort(),
			classToken,
			canonical,
		]);
		checks.set(key, check);
		return { found, complete: context.complete, key };
	});
	const keys = [...checks.keys()];
	const verify = inspector?.verifyInContext;
	const verdicts = verify
		? await verify(keys.map((key) => checks.get(key) as ContextCheck))
		: [];
	const byKey = new Map(keys.map((key, index) => [key, verdicts[index]]));
	return plans.map((plan) => {
		if (!plan) return null;
		const verdict = plan.key === null ? null : byKey.get(plan.key);
		if (verdict?.status === "changed") return null;
		// Without a verdict for competing classes nothing was verified.
		const verified = plan.key === null || verdict?.status === "unchanged";
		const contextDependent = !plan.complete || !verified;
		return contextDependent ? { ...plan.found, contextDependent } : plan.found;
	});
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
	contextDependent,
}: NonCanonicalClass) =>
	[
		themeVariables.length === 0
			? `Class "${classToken}" is written "${canonical}" in Tailwind's canonical form.`
			: `Class "${classToken}" is written "${canonical}" in Tailwind's canonical form, which follows the theme: it compiles to the same CSS only while ${themeVariableList(themeVariables)} ${themeVariables.length === 1 ? "keeps its current value" : "keep their current values"}.`,
		contextDependent
			? `Not every class that renders with it is known here, so check that none of them competes with it before replacing it: Tailwind may order "${canonical}" differently against them.`
			: null,
	]
		.filter(Boolean)
		.join(" ");

/** What `design_validate` returns with the finding: the replacement as a suggestion. */
export const nonCanonicalClassDetails = (
	className: string,
	{
		classToken,
		canonical,
		themeVariables,
		contextDependent,
	}: NonCanonicalClass,
) => ({
	className,
	classToken,
	canonical,
	suggestions: [canonical],
	...(themeVariables.length > 0
		? { themeDependent: true, themeVariables }
		: {}),
	...(contextDependent ? { contextDependent: true } : {}),
});

export const noCompiledCssNote: LintRuleFinding = {
	severity: "info",
	message:
		"The system has no compiled CSS, so classes were not checked against Tailwind's canonical forms. Link the system's CSS to enable this rule.",
	location: null,
};
