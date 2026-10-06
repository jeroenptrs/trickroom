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
 * A literal attribute selects its value unless a later spread may override
 * it; an absent attribute selects the axis default unless a spread may
 * supply it; a dynamic value selects nothing knowable, so only the base
 * classes count for that axis. A className a later spread may replace is
 * skipped. Compound variants are not considered.
 */

const ROOT_SLOT = "root";

const classesOf = (className: string) =>
	parseClassName(className).map((parsed) => parsed.raw);

type ProvidedClass = { className: string; source: string };

/** What the component applies on the root for one element, in layering order. */
const providedClasses = (
	component: SystemContractComponent,
	element: SourceJsxElement,
): ProvidedClass[] => {
	const provided: ProvidedClass[] = [];
	const root = component.slots.find((slot) => slot.key === ROOT_SLOT);
	for (const className of classesOf(root?.className ?? "")) {
		provided.push({ className, source: "its base classes" });
	}
	for (const axis of component.axes) {
		const value = jsxAttributeValue(element, axis.key);
		let key: string | null = null;
		let source = "";
		if (value) {
			// Dynamic, or a literal a later spread may override: unknown.
			key = literalVariantKey(value);
			source = `${axis.key}="${key}"`;
		} else if (!element.spread && axis.default !== null) {
			key = String(axis.default);
			source = `the default ${axis.key}="${key}"`;
		}
		if (key === null) continue;
		const selected = axis.values.find((entry) => entry.key === key);
		for (const [slot, className] of selected?.classes ?? []) {
			if (slot !== ROOT_SLOT) continue;
			for (const entry of classesOf(className)) {
				provided.push({ className: entry, source });
			}
		}
	}
	return provided;
};

const mergedSet = (classes: readonly string[]) =>
	new Set(classesOf(twMerge(classes.join(" "))));

const sameSet = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
	left.size === right.size && [...left].every((entry) => right.has(entry));

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
			const strings = usageClassStrings(module, usage).filter(
				(entry) => entry.complete,
			);
			if (strings.length === 0) continue;
			if (!isComponentUsage(context.sources, component, usage)) continue;
			const provided = providedClasses(component, usage.element);
			const base = provided.map((entry) => entry.className);
			const merged = mergedSet(base);
			const occurrences = strings.flatMap((entry) =>
				classesOf(entry.value).map((className) => ({ entry, className })),
			);
			const all = occurrences.map((occurrence) => occurrence.className);
			const mergedWithAll = mergedSet([...base, ...all]);
			for (const [index, { entry, className }] of occurrences.entries()) {
				if (!sameSet(mergedSet([...base, className]), merged)) continue;
				const without = all.filter((_, other) => other !== index);
				if (!sameSet(mergedSet([...base, ...without]), mergedWithAll)) continue;
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
