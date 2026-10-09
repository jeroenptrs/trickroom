import {
	createCanonicalClassChecker,
	NON_CANONICAL_CLASS_OPTIONS,
	noCompiledCssNote,
	nonCanonicalClassDetails,
	nonCanonicalClassMessage,
} from "../canonical-classes";
import type { LintRuleFinding, LintRuleKind } from "../types";

/**
 * Every `className` of every board of the linked designs against the form
 * the system's Tailwind writes each class in, as `code.non-canonical-class`
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
		const classNames = designs.designs.flatMap((design) =>
			design.boards.flatMap((board) =>
				board.nodes.flatMap((node) =>
					node.className === null ? [] : [node.className],
				),
			),
		);
		const check = await createCanonicalClassChecker(
			await tailwind.inspector(),
			rule.options,
			classNames,
		);
		if (!check) {
			return designs.designs.length > 0 ? [noCompiledCssNote] : [];
		}

		const findings: LintRuleFinding[] = [];
		for (const design of designs.designs) {
			for (const board of design.boards) {
				for (const node of board.nodes) {
					if (node.className === null) continue;
					for (const found of check(node.className)) {
						findings.push({
							message: nonCanonicalClassMessage(found),
							location: {
								kind: "design",
								design: design.id,
								board: board.id,
								element: node.element,
								path: `${node.path}.props.className`,
							},
							details: nonCanonicalClassDetails(node.className, found),
						});
					}
				}
			}
		}
		return findings;
	},
};
