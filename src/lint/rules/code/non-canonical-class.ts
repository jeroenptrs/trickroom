import { createClassMerge } from "../../../utils/class-merge";
import type { SourceClassString, SourcePosition } from "../../source/parse";
import {
	type ClassContext,
	createCanonicalClassChecker,
	MAX_CONTEXT_SCENARIOS,
	NON_CANONICAL_CLASS_OPTIONS,
	type NonCanonicalClass,
	noCompiledCssNote,
	nonCanonicalClassDetails,
	nonCanonicalClassMessage,
	replaceClass,
	settleInContext,
} from "../canonical-classes";
import type { LintRuleContext, LintRuleFinding, LintRuleKind } from "../types";
import { classTokenPosition, codeLocation, getCodeAnalysis } from "./analysis";
import { providedCombinations } from "./redundant-class";

/**
 * Class strings in the scanned sources that Tailwind writes differently:
 * `bg-[#FFF]` for `bg-white`, `[&:has(.x)]:p-2` for `has-[.x]:p-2`. The
 * canonical form is a property of the class alone, so a literal next to
 * non-literal parts (`mixed`) is checked; template fragments
 * (`complete: false`) are not, since a class may continue across the
 * interpolation. Generated variants files are codegen's output and skipped.
 * A canonical form is reported only when it compiles to the class's CSS
 * (see `createCanonicalClassChecker`).
 *
 * Each finding is then settled in every combination that can render with
 * it (`settleInContext`, scenarios from `contextFor`): the parts of its
 * class string that can apply together with it, and for the `className`
 * of a bound component each set of root classes the component may apply.
 * Never a union of branches: one branch's class does not compete with, or
 * stand in for, the other's.
 */

const classesOf = (className: string) =>
	className.split(/\s+/u).filter(Boolean);

const samePosition = (left: SourcePosition, right: SourcePosition) =>
	left.line === right.line && left.column === right.column;

const isAfter = (left: SourcePosition, right: SourcePosition) =>
	left.line > right.line ||
	(left.line === right.line && left.column > right.column);

/** Two strings on different sides of one choice never apply together. */
const exclusive = (left: SourceClassString, right: SourceClassString) =>
	left.branch.some((outer) =>
		right.branch.some(
			(inner) => inner.choice === outer.choice && inner.side !== outer.side,
		),
	);

/**
 * Every combination of `optional` strings that can apply together, the
 * empty one included; null once there are more than `limit`.
 */
const realizableCombinations = (
	optional: readonly SourceClassString[],
	limit: number,
): SourceClassString[][] | null => {
	let combinations: SourceClassString[][] = [[]];
	for (const part of optional) {
		combinations = [
			...combinations,
			...combinations
				.filter((combination) =>
					combination.every((other) => !exclusive(other, part)),
				)
				.map((combination) => [...combination, part]),
		];
		if (combinations.length > limit) return null;
	}
	return combinations;
};

/**
 * The scenarios a class string's literal renders in: each combination of
 * the other parts that can apply with it (an unconditional part always
 * does, a conditional one may or may not, and never one on another side of
 * a choice it shares with the literal or with another part of the
 * combination: `on ? "a" : "b"` renders "a" or "b", never both), and for
 * the `className` of a bound component each set of root classes it may
 * apply (`providedCombinations`).
 * Complete only for a `className` with nothing but literals, on an
 * intrinsic element or a bound component, that no later spread may
 * replace, within `MAX_CONTEXT_SCENARIOS`; otherwise what is always there
 * (the unconditional parts and the literal) is checked, and the finding is
 * context-dependent. Classes may be merged on the way (tv() merges, a
 * `cn()` may), so each scenario is compared merged too.
 */
const contextFor = (
	context: LintRuleContext,
	file: string,
	entry: SourceClassString,
	found: NonCanonicalClass,
	group: readonly SourceClassString[],
	merge: ((className: string) => string) | null,
): ClassContext => {
	const { sources } = context;
	let complete =
		merge !== null && group.every((part) => part.complete && !part.mixed);
	let provided: string[][] = [[]];
	if (entry.origin.kind === "call") {
		// Where a class call's result goes is not followed.
		complete = false;
	} else {
		const element = sources.modules[file].jsx.find((candidate) =>
			candidate.attributes.some(
				(attribute) =>
					attribute.name === "className" &&
					samePosition(attribute.position, entry.expression),
			),
		);
		if (
			!element ||
			element.spreads.some((spread) => isAfter(spread, entry.expression))
		) {
			complete = false;
		} else if (!/^[a-z]/u.test(element.name) || element.name.includes(".")) {
			const usage = sources.usages.find(
				(candidate) =>
					candidate.file === file &&
					samePosition(candidate.element.position, element.position),
			);
			const component = usage
				? getCodeAnalysis(context).components.get(usage.slug)
				: undefined;
			const combinations =
				component && component.shape !== null
					? providedCombinations(component, element)
					: null;
			if (combinations) {
				provided = combinations.map((combination) =>
					combination.flatMap((entry) => classesOf(entry.className)),
				);
			} else {
				// Another component, or one whose classes cannot be decided.
				complete = false;
			}
		}
	}
	// Parts on another side of a choice the literal sits under never apply
	// with it; the others may.
	const optional = group.filter(
		(part) => part !== entry && part.conditional && !exclusive(part, entry),
	);
	const replaced = (part: SourceClassString) =>
		part === entry
			? classesOf(replaceClass(part.value, found.classToken, found.canonical))
			: classesOf(part.value);
	const scenario = (
		applied: ReadonlySet<SourceClassString>,
		base: string[],
	) => {
		const parts = group.filter(
			(part) => part === entry || !part.conditional || applied.has(part),
		);
		return {
			before: [...base, ...parts.flatMap((part) => classesOf(part.value))],
			after: [...base, ...parts.flatMap(replaced)],
			...(merge ? { merge } : {}),
		};
	};
	const combinations = realizableCombinations(
		optional,
		Math.floor(MAX_CONTEXT_SCENARIOS / provided.length),
	);
	if (!combinations) {
		return { scenarios: [scenario(new Set(), [])], complete: false };
	}
	return {
		scenarios: provided.flatMap((base) =>
			combinations.map((applied) => scenario(new Set(applied), base)),
		),
		complete,
	};
};

export const nonCanonicalClassRule: LintRuleKind = {
	id: "code.non-canonical-class",
	side: "code",
	defaultSeverity: "warning",
	description:
		"A class string uses a class Tailwind writes differently (an arbitrary value or variant with a named equivalent, a renamed utility); the finding names the canonical form.",
	options: NON_CANONICAL_CLASS_OPTIONS,
	run: async (context) => {
		const { sources } = context;
		const checked = sources.files
			.filter((file) => sources.generated[file] === undefined)
			.flatMap((file) =>
				sources.modules[file].classStrings
					.filter((entry) => entry.complete)
					.map((entry) => ({ file, entry })),
			);
		const inspector = await context.tailwind.inspector();
		const check = await createCanonicalClassChecker(
			inspector,
			context.rule.options,
			checked.map(({ entry }) => entry.value),
		);
		if (!check) return [noCompiledCssNote];

		const pending: Array<{
			file: string;
			entry: SourceClassString;
			found: NonCanonicalClass;
		}> = [];
		for (const { file, entry } of checked) {
			for (const found of check(entry.value)) {
				pending.push({ file, entry, found });
			}
		}
		if (pending.length === 0) return [];

		const mergeConfig = await context.tailwind.mergeConfig();
		// Unknown merging (the derived config failed): no context is complete.
		const merge =
			mergeConfig.status === "failed"
				? null
				: createClassMerge(
						mergeConfig.status === "derived"
							? { mode: "derived", config: mergeConfig.config }
							: { mode: "stock" },
					);
		const groupKey = (file: string, position: SourcePosition) =>
			`${file}\u0000${position.line}:${position.column}`;
		const groups = new Map<string, SourceClassString[]>();
		for (const file of sources.files) {
			for (const entry of sources.modules[file].classStrings) {
				const key = groupKey(file, entry.expression);
				groups.set(key, [...(groups.get(key) ?? []), entry]);
			}
		}
		const settled = await settleInContext(
			inspector,
			pending.map(({ file, entry, found }) => ({
				found,
				context: contextFor(
					context,
					file,
					entry,
					found,
					groups.get(groupKey(file, entry.expression)) ?? [entry],
					merge,
				),
			})),
		);

		const findings: LintRuleFinding[] = [];
		const wrapperSlug = new Map<string, string>();
		for (const [slug, files] of getCodeAnalysis(context).wrappers) {
			for (const file of files) {
				if (!wrapperSlug.has(file)) wrapperSlug.set(file, slug);
			}
		}
		pending.forEach(({ file, entry }, index) => {
			const found = settled[index];
			if (!found) return;
			const slug = wrapperSlug.get(file);
			findings.push({
				...(slug ? { component: slug } : {}),
				location: codeLocation(
					file,
					classTokenPosition(entry, found.classToken, found.occurrence),
				),
				message: `${nonCanonicalClassMessage(found)} Use "${found.canonical}"${found.themeVariables.length > 0 ? " if the value should follow the theme" : ""}, or add "${found.classToken}" to this rule's allow list if it is intended.`,
				details: nonCanonicalClassDetails(entry.value, found),
			});
		});
		return findings;
	},
};
