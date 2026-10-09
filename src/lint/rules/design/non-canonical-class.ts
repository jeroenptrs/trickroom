import {
	type ClassMerge,
	createClassMerge,
	mergeComponentClasses,
	renderComponentClassName,
} from "../../../utils/class-merge";
import {
	type ClassContext,
	createCanonicalClassChecker,
	mergeTreatsAlike,
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
 * Each finding is settled among the classes that render with it
 * (`settleInContext`): a design node's rendered classes as the canvas
 * renders them (`getRenderedClassName`: an instance node's component
 * classes and override merged the way the project's code merges them), and
 * for a component definition every class the component declares on that
 * template path, as if all of its variant values and compounds applied.
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

const contextOf = (
	target: LintClassTarget,
	merge: ClassMerge | null,
): ClassContext => {
	const { context } = target;
	if (context.kind === "definition") {
		return {
			classes: [
				...classesOf(context.baseClassName),
				...classesOf(context.component),
			],
			complete: true,
			...(merge
				? {
						mergesAlike: (classToken: string, canonical: string) =>
							mergeTreatsAlike(merge, context.component, classToken, canonical),
					}
				: {}),
		};
	}
	const { render } = context;
	if (render.kind === "classes") {
		return { classes: classesOf(render.className), complete: render.known };
	}
	if (!merge) return { classes: classesOf(render.unmerged), complete: true };
	const rendered = (override: string | undefined) =>
		renderComponentClassName(
			{ component: render.component, override },
			render.baseClassName,
			merge,
		);
	// The base classes stay out of the merge: only the component classes
	// and the override (where the class is) are compared.
	const merged = (override: string | undefined) =>
		mergeComponentClasses(render.component, override, merge);
	return {
		classes: classesOf(rendered(render.override)),
		complete: true,
		mergesAlike: (classToken, canonical) => {
			const before = new Set(
				classesOf(replaceClass(merged(render.override), classToken, canonical)),
			);
			const after = new Set(
				classesOf(
					merged(
						render.override === undefined
							? undefined
							: replaceClass(render.override, classToken, canonical),
					),
				),
			);
			return (
				before.size === after.size && [...before].every((c) => after.has(c))
			);
		},
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
		const contexts = new Map<LintClassTarget, ClassContext>();
		const settled = await settleInContext(
			inspector,
			pending.map(({ target, found }) => {
				let context = contexts.get(target);
				if (!context) {
					context = contextOf(target, merge);
					contexts.set(target, context);
				}
				return { found, context };
			}),
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
