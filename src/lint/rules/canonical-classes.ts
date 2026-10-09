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

/**
 * One way the classes on the element can render with the finding's class:
 * one branch combination of a class string, one variant configuration of
 * a component. Never a union of alternatives: a class from another branch
 * is not there to compete with, or to stand in for, the class.
 */
export type ClassScenario = {
	/** The classes that render, in order, with the class as written. */
	before: readonly string[];
	/** The classes that render once the finding's own string uses the canonical form. */
	after: readonly string[];
	/**
	 * Classes may be merged (tailwind-merge) on the way, though `before` and
	 * `after` are not: merged, they must agree too.
	 */
	merge?: (className: string) => string;
};

/** The classes that may render on the element a class string styles. */
export type ClassContext = {
	/** Every combination that can render, or those known (`complete` false). */
	scenarios: readonly ClassScenario[];
	/**
	 * False when more combinations, or more classes, may render than the
	 * scenarios hold: a part the source model does not know, or more
	 * combinations than `MAX_CONTEXT_SCENARIOS`.
	 */
	complete: boolean;
};

/** Above this many combinations, a context is checked by what is always there. */
export const MAX_CONTEXT_SCENARIOS = 64;

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
 * `before` and `after` hold the same classes once the class and its
 * canonical form count as one: the replacement adds or removes nothing
 * else (merging keeps or drops the same classes).
 */
const replacedAlike = (
	before: readonly string[],
	after: readonly string[],
	classToken: string,
	canonical: string,
) => {
	const spelled = (classes: readonly string[]) =>
		new Set(classes.map((entry) => (entry === classToken ? canonical : entry)));
	const expected = spelled(before);
	const actual = spelled(after);
	return (
		expected.size === actual.size &&
		[...expected].every((entry) => actual.has(entry))
	);
};

/**
 * Settles each finding in every scenario of its context: null when the
 * replacement changes the result in any of them (another set of classes
 * renders, merged or not, or a competing declaration wins where it lost or
 * loses where it won, `verifyCanonicalInContext`); otherwise the finding,
 * marked `contextDependent` when the context is incomplete. Scenarios
 * without other classes need no compiling; the others go to the inspector
 * in one batch.
 */
export const settleInContext = async (
	inspector: LintTailwindInspector | null,
	items: ReadonlyArray<{ found: NonCanonicalClass; context: ClassContext }>,
): Promise<Array<NonCanonicalClass | null>> => {
	const checks = new Map<string, ContextCheck>();
	const plans = items.map(({ found, context }) => {
		const { classToken, canonical } = found;
		const keys: string[] = [];
		// The class still renders after the replacement (it is in another
		// string too): which of the two wins is not checked.
		let partial = false;
		for (const scenario of context.scenarios) {
			if (
				!replacedAlike(scenario.before, scenario.after, classToken, canonical)
			) {
				return null;
			}
			if (
				scenario.merge &&
				!replacedAlike(
					classesOf(scenario.merge(scenario.before.join(" "))),
					classesOf(scenario.merge(scenario.after.join(" "))),
					classToken,
					canonical,
				)
			) {
				return null;
			}
			if (
				scenario.before.includes(classToken) &&
				scenario.after.includes(classToken)
			) {
				partial = true;
				continue;
			}
			const others = scenario.before.filter((entry) => entry !== classToken);
			if (!scenario.before.includes(classToken) || others.length === 0) {
				continue;
			}
			const key = JSON.stringify([
				[...new Set(scenario.before)].sort(),
				classToken,
				canonical,
			]);
			checks.set(key, {
				classes: scenario.before,
				candidate: classToken,
				canonical,
			});
			keys.push(key);
		}
		return { found, complete: context.complete && !partial, keys };
	});
	const keys = [...checks.keys()];
	const verify = inspector?.verifyInContext;
	const verdicts = verify
		? await verify(keys.map((key) => checks.get(key) as ContextCheck))
		: [];
	const byKey = new Map(keys.map((key, index) => [key, verdicts[index]]));
	return plans.map((plan) => {
		if (!plan) return null;
		const results = plan.keys.map((key) => byKey.get(key));
		if (results.some((verdict) => verdict?.status === "changed")) return null;
		// Without a verdict for competing classes nothing was verified.
		const verified = results.every(
			(verdict) => verdict?.status === "unchanged",
		);
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
