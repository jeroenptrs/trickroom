import {
	createCanonicalClassChecker,
	NON_CANONICAL_CLASS_OPTIONS,
	noCompiledCssNote,
	nonCanonicalClassDetails,
	nonCanonicalClassMessage,
} from "../canonical-classes";
import type { LintRuleFinding, LintRuleKind } from "../types";
import {
	collectLintClassTargets,
	hasLintClassScope,
	targetLocationFields,
} from "./class-targets";

/**
 * The classes of the system's component definitions and of the layers of
 * the linked designs (`collectLintClassTargets`) against the form the
 * system's Tailwind writes each class in, as `code.non-canonical-class`
 * does for the sources. `design_validate` returns the canonical class as the
 * finding's `suggestions`.
 */

export const designNonCanonicalClassRule: LintRuleKind = {
	id: "design.non-canonical-class",
	side: "design",
	defaultSeverity: "warning",
	description:
		"A class in a design is one Tailwind writes differently (an arbitrary value or variant with a named equivalent, a renamed utility); the finding names the canonical form.",
	options: NON_CANONICAL_CLASS_OPTIONS,
	run: async ({ designs, rule, tailwind }) => {
		const targets = collectLintClassTargets(designs);
		const check = await createCanonicalClassChecker(
			await tailwind.inspector(),
			rule.options,
			targets.map((target) => target.className),
		);
		if (!check) {
			return hasLintClassScope(designs) ? [noCompiledCssNote] : [];
		}

		const findings: LintRuleFinding[] = [];
		for (const target of targets) {
			for (const found of check(target.className)) {
				findings.push({
					message: nonCanonicalClassMessage(found),
					...targetLocationFields(target),
					details: nonCanonicalClassDetails(target.className, found),
				});
			}
		}
		return findings;
	},
};
