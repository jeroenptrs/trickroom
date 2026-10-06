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
 * A class on a usage's `className` that the component already applies:
 * the base classes of its root slot (where a wrapper puts `className`)
 * and the root classes of the variant values the element selects. A
 * literal attribute selects its value unless a later spread may override
 * it; an absent attribute selects the axis default unless a spread may
 * supply it; a dynamic value selects nothing knowable, so only the base
 * classes count for that axis. A className a later spread may replace is
 * skipped.
 * Compound variants are not considered.
 */

const ROOT_SLOT = "root";

const classesOf = (className: string) =>
	parseClassName(className).map((parsed) => parsed.raw);

/** Class -> where the component provides it, for one element. */
const providedClasses = (
	component: SystemContractComponent,
	element: SourceJsxElement,
): Map<string, string> => {
	const provided = new Map<string, string>();
	const root = component.slots.find((slot) => slot.key === ROOT_SLOT);
	for (const className of classesOf(root?.className ?? "")) {
		provided.set(className, "its base classes");
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
				if (!provided.has(entry)) provided.set(entry, source);
			}
		}
	}
	return provided;
};

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
			for (const entry of strings) {
				for (const className of classesOf(entry.value)) {
					const source = provided.get(className);
					if (source === undefined) continue;
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
		}
		return findings;
	},
};
