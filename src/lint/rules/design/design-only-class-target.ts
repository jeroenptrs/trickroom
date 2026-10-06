import type { SystemContractClassTarget } from "../../contract";
import type { LintRuleFinding, LintRuleKind } from "../types";

/**
 * A variant value or compound variant of a published component adds
 * classes to a template path inside a design-only subtree. Codegen reports
 * the same entry as `DESIGN_ONLY_CLASS_TARGET` when it generates the file;
 * this kind reports it from the design model, with or without codegen, and
 * also for components whose root is design-only (they have no file). The
 * finding names the component; it has no location in a design.
 */

export const DESIGN_ONLY_CLASS_TARGET_RULE_ID =
	"design.design-only-class-target";

const describeTarget = (target: SystemContractClassTarget) =>
	target.compound === null
		? `Variant "${target.axis}=${target.value}"`
		: `Compound variant ${target.compound + 1}`;

export const designOnlyClassTargetRule: LintRuleKind = {
	id: DESIGN_ONLY_CLASS_TARGET_RULE_ID,
	side: "design",
	defaultSeverity: "error",
	description:
		"A variant value or compound variant of a published component adds classes to a node inside a design-only subtree, which does not exist in code.",
	run: ({ contract }) => {
		const findings: LintRuleFinding[] = [];
		for (const component of contract.components) {
			if (component.publishedVersion === null) continue;
			const designOnly = new Set(component.designOnlyPaths);
			if (designOnly.size === 0) continue;
			for (const target of component.classTargets) {
				if (!designOnly.has(target.path)) continue;
				findings.push({
					message: `${describeTarget(target)} of component "${component.slug}" (version ${component.publishedVersion}) has classes for path "${target.path}", which is inside a design-only subtree and does not exist in code. Remove the entry, retarget it, or clear design-only on the node, then publish.`,
					location: null,
					component: component.slug,
					details: { targetPath: target.path },
				});
			}
		}
		return findings;
	},
};
