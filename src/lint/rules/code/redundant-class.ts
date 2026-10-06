import { twMerge } from "tailwind-merge";
import { parseClassName } from "../../../utils/tailwind-classname";
import type { SystemContractComponent } from "../../contract";
import type { SourceJsxElement } from "../../source/parse";
import type { LintRuleFinding, LintRuleKind } from "../types";
import {
	classTokenPosition,
	codeLocation,
	getCodeAnalysis,
	isComponentUsage,
	jsxAttributeValue,
	literalVariantKey,
	spreadFollows,
	usageClassStrings,
} from "./analysis";

/**
 * A class on a usage's `className` that changes nothing: the component
 * already applies it through the base classes of its root slot (where a
 * wrapper puts `className`) or the root classes of the variant values the
 * element selects. Redundancy follows `twMerge`, what tv() merges with: a
 * class is redundant when appending it to the provided classes (base,
 * then the selected values in codegen's layering order) leaves the merged
 * classes unchanged, and removing it from the usage's className leaves
 * the merged result of provided plus className unchanged too. So `px-3`
 * over a variant's `px-6` is an override, not a repeat, and so is `px-3`
 * after a `p-4` in the same className. Merged outputs are compared as
 * class sets: Tailwind's CSS does not depend on class order.
 *
 * Unknowns never count as absent: a class must be redundant under every
 * value a dynamic axis may take (`providedCombinations`), class literals
 * next to non-literal parts (`mixed`) are skipped, and so is a className a
 * later spread may replace. Compound variants are not considered.
 */

const ROOT_SLOT = "root";

const classesOf = (className: string) =>
	parseClassName(className).map((parsed) => parsed.raw);

type ProvidedClass = { className: string; source: string };

/**
 * Above this many combinations of dynamic axis values times subsets of
 * conditional class strings, the element is skipped.
 */
export const MAX_REDUNDANT_CLASS_COMBINATIONS = 64;

type AxisOption = { key: string | null; source: string };

/**
 * What the component may apply on the root for one element, in layering
 * order, once per combination of the values its dynamic axes may take.
 * A literal attribute selects its value; an absent attribute selects the
 * default, or nothing without one. An axis is dynamic when its attribute
 * is not a literal, a later spread may override it, or it is absent and a
 * spread may supply it: it may take any of its values or none (an
 * unknown value selects nothing). Null when there are more than
 * `MAX_REDUNDANT_CLASS_COMBINATIONS` combinations.
 */
const providedCombinations = (
	component: SystemContractComponent,
	element: SourceJsxElement,
): ProvidedClass[][] | null => {
	const root = component.slots.find((slot) => slot.key === ROOT_SLOT);
	const base = classesOf(root?.className ?? "").map((className) => ({
		className,
		source: "its base classes",
	}));
	const options: Array<{
		axis: (typeof component.axes)[number];
		options: AxisOption[];
	}> = [];
	let count = 1;
	for (const axis of component.axes) {
		const value = jsxAttributeValue(element, axis.key);
		const key = value ? literalVariantKey(value) : null;
		let axisOptions: AxisOption[];
		if (value && key !== null) {
			axisOptions = [{ key, source: `${axis.key}="${key}"` }];
		} else if (!value && !element.spread) {
			axisOptions = [
				axis.default === null
					? { key: null, source: "" }
					: {
							key: String(axis.default),
							source: `the default ${axis.key}="${String(axis.default)}"`,
						},
			];
		} else {
			// Dynamic: any value of the axis, or none.
			axisOptions = [
				...axis.values.map((entry) => ({
					key: entry.key,
					source: `${axis.key}="${entry.key}"`,
				})),
				{ key: null, source: "" },
			];
		}
		count *= axisOptions.length;
		if (count > MAX_REDUNDANT_CLASS_COMBINATIONS) return null;
		options.push({ axis, options: axisOptions });
	}
	let combinations: ProvidedClass[][] = [base];
	for (const { axis, options: axisOptions } of options) {
		combinations = combinations.flatMap((provided) =>
			axisOptions.map((option) => {
				const selected = axis.values.find((entry) => entry.key === option.key);
				const added = (selected?.classes ?? [])
					.filter(([slot]) => slot === ROOT_SLOT)
					.flatMap(([, className]) =>
						classesOf(className).map((entry) => ({
							className: entry,
							source: option.source,
						})),
					);
				return [...provided, ...added];
			}),
		);
	}
	return combinations;
};

const mergedSet = (classes: readonly string[]) =>
	new Set(classesOf(twMerge(classes.join(" "))));

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
	left.size === right.size && [...left].every((entry) => right.has(entry));

/** Every subset of `items`, the empty one included. */
const subsets = <T>(items: readonly T[]): Array<ReadonlySet<T>> =>
	Array.from(
		{ length: 2 ** items.length },
		(_, mask) => new Set(items.filter((_, bit) => mask & (1 << bit))),
	);

export const redundantClassRule: LintRuleKind = {
	id: "code.redundant-class",
	side: "code",
	defaultSeverity: "warning",
	description:
		"A class on a usage's className repeats a class the component already applies through its base classes or the selected variant values.",
	run: (context) => {
		const analysis = getCodeAnalysis(context);
		const findings: LintRuleFinding[] = [];
		for (const usage of analysis.usages) {
			const component = analysis.components.get(usage.slug);
			if (!component || component.shape === null) continue;
			// A className a later spread may replace is not known to render.
			const classAttribute = usage.element.attributes.findLast(
				(attribute) => attribute.name === "className",
			);
			if (
				!classAttribute ||
				spreadFollows(usage.element, classAttribute.position)
			)
				continue;
			const module = context.sources.modules[usage.file];
			// Classes next to non-literal parts (`cn(extra, "px-3")`) may be
			// overridden by what those parts hold at runtime: skipped.
			const strings = usageClassStrings(module, usage).filter(
				(entry) => entry.complete && !entry.mixed,
			);
			if (strings.length === 0) continue;
			if (!isComponentUsage(context.sources, component, usage)) continue;
			const combinations = providedCombinations(component, usage.element);
			if (!combinations) continue;
			// Strings under a condition (`dense ? "py-2" : "py-1"`,
			// `active && "px-3"`) may or may not apply: each subset of them is
			// a scenario, and the unconditional strings apply in all of them.
			const conditionalStrings = strings.filter((entry) => entry.conditional);
			if (
				combinations.length * 2 ** conditionalStrings.length >
				MAX_REDUNDANT_CLASS_COMBINATIONS
			)
				continue;
			const scenarios = subsets(conditionalStrings);
			const occurrences = strings.flatMap((entry) =>
				classesOf(entry.value).map((className) => ({ entry, className })),
			);
			const checks = combinations.map((provided) => {
				const base = provided.map((entry) => entry.className);
				return { provided, base, merged: mergedSet(base) };
			});
			for (const [index, { entry, className }] of occurrences.entries()) {
				// Redundant only under every combination of dynamic axis values
				// and in every scenario where its own string applies.
				const redundant = checks.every(
					(check) =>
						sameSet(mergedSet([...check.base, className]), check.merged) &&
						scenarios.every((applies) => {
							if (entry.conditional && !applies.has(entry)) return true;
							const active = occurrences.flatMap((occurrence, other) =>
								!occurrence.entry.conditional || applies.has(occurrence.entry)
									? [{ className: occurrence.className, other }]
									: [],
							);
							return sameSet(
								mergedSet([
									...check.base,
									...active
										.filter((candidate) => candidate.other !== index)
										.map((candidate) => candidate.className),
								]),
								mergedSet([
									...check.base,
									...active.map((candidate) => candidate.className),
								]),
							);
						}),
				);
				if (!redundant) continue;
				const provided = checks[0].provided;
				const source =
					provided.findLast((candidate) => candidate.className === className)
						?.source ?? "its classes";
				findings.push({
					component: component.slug,
					location: codeLocation(
						usage.file,
						classTokenPosition(entry, className),
					),
					message: `<${usage.element.name} className> repeats "${className}", which "${component.slug}" already applies through ${source}. Remove it from className.`,
				});
			}
		}
		return findings;
	},
};
