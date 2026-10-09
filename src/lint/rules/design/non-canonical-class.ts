import type { RecipeTemplateNode } from "../../../types";
import {
	type ClassMerge,
	createClassMerge,
	renderComponentClassName,
	resolveComponentNodeClasses,
} from "../../../utils/class-merge";
import { compareSystemComponentVariantAxisKeys } from "../../../utils/system-component-variant-class-layers";
import type { PublishedSystemComponentVersion } from "../../../utils/system-components";
import type { LintComponentClassEntry } from "../../designs";
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
import {
	collectLintClassTargets,
	hasLintClassScope,
	type LintClassTarget,
	targetLocationFields,
} from "./class-targets";

/**
 * The classes of the system's component definitions and of the layers of
 * the linked designs (`collectLintClassTargets`) against the form the
 * system's Tailwind writes each class in, as `code.non-canonical-class`
 * does for the sources. `design_validate` returns the canonical class as the
 * finding's `suggestions`.
 *
 * Each finding is settled in every way its classes render
 * (`settleInContext`, scenarios from `contextOf`): a design node's classes
 * as the canvas renders them (`getRenderedClassName`: an instance node's
 * component classes and override merged the way the project's code merges
 * them), and a component definition's classes in each variant
 * configuration it can render, never all values at once.
 */

const classesOf = (className: string | null | undefined) =>
	(className ?? "").split(/\s+/u).filter(Boolean);

/** How the canvas merges component classes for this run's system. */
const classMergeOf = async (
	tailwind: LintRuleContext["tailwind"],
): Promise<ClassMerge | null> => {
	const config = await tailwind.mergeConfig();
	return createClassMerge(
		config.status === "derived"
			? { mode: "derived", config: config.config }
			: config.status === "stock"
				? { mode: "stock" }
				: { mode: "none" },
	);
};

/**
 * Every configuration a component can render: each value of each axis, and
 * no value for an axis without a default; null above
 * `MAX_CONTEXT_SCENARIOS`. Matching compounds follow from the values.
 */
const configurations = (
	version: PublishedSystemComponentVersion,
): Array<Record<string, string>> | null => {
	const variants = version.variants;
	let result: Array<Record<string, string>> = [{}];
	for (const [axis, definition] of Object.entries(variants?.axes ?? {}).sort(
		([left], [right]) => compareSystemComponentVariantAxisKeys(left, right),
	)) {
		const fallback = variants?.defaultValues?.[axis] ?? definition.defaultValue;
		const options: Array<string | undefined> = Object.keys(definition.values);
		if (fallback === undefined || !Object.hasOwn(definition.values, fallback)) {
			options.push(undefined);
		}
		result = result.flatMap((values) =>
			options.map((value) =>
				value === undefined ? values : { ...values, [axis]: value },
			),
		);
		if (result.length > MAX_CONTEXT_SCENARIOS) return null;
	}
	return result;
};

/** The version with the target's class string using the canonical form. */
const withEntryReplaced = (
	version: PublishedSystemComponentVersion,
	entry: LintComponentClassEntry,
	classToken: string,
	canonical: string,
): PublishedSystemComponentVersion => {
	const copy = structuredClone(version);
	const replace = (className: unknown) =>
		typeof className === "string"
			? replaceClass(className, classToken, canonical)
			: className;
	if (entry.axis !== null && entry.value !== null) {
		const classes =
			copy.variants?.axes[entry.axis]?.values[entry.value]?.classesByPath;
		if (classes) classes[entry.path] = String(replace(classes[entry.path]));
	} else if (entry.compound !== null) {
		const classes =
			copy.variants?.compoundVariants?.[entry.compound]?.classesByPath;
		if (classes) classes[entry.path] = String(replace(classes[entry.path]));
	} else {
		const visit = (template: RecipeTemplateNode) => {
			if (template.path === entry.path) {
				if (
					typeof template.className === "string" &&
					template.className.trim()
				) {
					template.className = String(replace(template.className));
				} else if (
					template.props &&
					typeof template.props.className === "string"
				) {
					template.props.className = replaceClass(
						template.props.className,
						classToken,
						canonical,
					);
				}
			}
			for (const child of template.children ?? []) visit(child);
		};
		visit(copy.root);
	}
	return copy;
};

/**
 * The scenarios a target's classes render in, as the canvas renders them:
 * a layer's classes; an instance node's component classes and override,
 * merged the way the project's code merges them (as stored when classes do
 * not merge); a component definition's classes in every configuration it
 * can render (`configurations`), each with the target's string replaced in
 * the version itself, so a merge that drops or keeps another value's class
 * differently shows. Beyond `MAX_CONTEXT_SCENARIOS` configurations, the
 * configuration without values (what is always there) only, and the finding
 * is context-dependent.
 */
const contextOf = (
	target: LintClassTarget,
	found: NonCanonicalClass,
	merge: ClassMerge | null,
): ClassContext => {
	const { classToken, canonical } = found;
	const { context } = target;
	if (context.kind === "definition") {
		const { version, entry, baseClassName } = context;
		const replaced = withEntryReplaced(version, entry, classToken, canonical);
		const render = (
			source: PublishedSystemComponentVersion,
			variantValues: Record<string, string>,
		) => {
			const resolved = resolveComponentNodeClasses({
				version: source,
				path: entry.path,
				variantValues,
				overrides: {},
				baseClassName,
			});
			return classesOf(
				merge
					? renderComponentClassName(resolved, baseClassName, merge)
					: [baseClassName, resolved.component].filter(Boolean).join(" "),
			);
		};
		const all = configurations(version);
		return {
			scenarios: (all ?? [{}]).map((values) => ({
				before: render(version, values),
				after: render(replaced, values),
			})),
			complete: all !== null,
		};
	}
	const { render } = context;
	if (render.kind === "classes") {
		return {
			scenarios: [
				{
					before: classesOf(render.className),
					after: classesOf(
						replaceClass(render.className ?? "", classToken, canonical),
					),
				},
			],
			complete: render.known,
		};
	}
	if (!merge) {
		return {
			scenarios: [
				{
					before: classesOf(render.unmerged),
					after: classesOf(
						replaceClass(render.unmerged ?? "", classToken, canonical),
					),
				},
			],
			complete: true,
		};
	}
	const rendered = (override: string | undefined) =>
		classesOf(
			renderComponentClassName(
				{ component: render.component, override },
				render.baseClassName,
				merge,
			),
		);
	return {
		scenarios: [
			{
				before: rendered(render.override),
				after: rendered(
					render.override === undefined
						? undefined
						: replaceClass(render.override, classToken, canonical),
				),
			},
		],
		complete: true,
	};
};

export const designNonCanonicalClassRule: LintRuleKind = {
	id: "design.non-canonical-class",
	side: "design",
	defaultSeverity: "warning",
	description:
		"A class in a design is one Tailwind writes differently (an arbitrary value or variant with a named equivalent, a renamed utility); the finding names the canonical form.",
	options: NON_CANONICAL_CLASS_OPTIONS,
	run: async ({ designs, rule, tailwind }) => {
		const targets = collectLintClassTargets(designs);
		const inspector = await tailwind.inspector();
		const check = await createCanonicalClassChecker(
			inspector,
			rule.options,
			targets.map((target) => target.className),
		);
		if (!check) {
			return hasLintClassScope(designs) ? [noCompiledCssNote] : [];
		}

		const pending: Array<{
			target: LintClassTarget;
			found: NonCanonicalClass;
		}> = [];
		for (const target of targets) {
			for (const found of check(target.className)) {
				pending.push({ target, found });
			}
		}
		if (pending.length === 0) return [];
		const merge = await classMergeOf(tailwind);
		const settled = await settleInContext(
			inspector,
			pending.map(({ target, found }) => ({
				found,
				context: contextOf(target, found, merge),
			})),
		);
		const findings: LintRuleFinding[] = [];
		pending.forEach(({ target }, index) => {
			const found = settled[index];
			if (!found) return;
			findings.push({
				message: nonCanonicalClassMessage(found),
				...targetLocationFields(target),
				details: nonCanonicalClassDetails(target.className, found),
			});
		});
		return findings;
	},
};
