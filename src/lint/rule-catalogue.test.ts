import { describe, expect, it } from "vitest";
import {
	describeLintRuleKinds,
	LINT_RULE_OPTION_SPECS,
} from "./rule-catalogue";
import { lintRuleRegistry } from "./rules/index";

describe("lint rule catalogue", () => {
	it("documents options only for registered rule kinds", () => {
		for (const id of Object.keys(LINT_RULE_OPTION_SPECS)) {
			expect(lintRuleRegistry.ids.has(id), id).toBe(true);
		}
	});

	it("lists every registered kind in registry order with its option specs", () => {
		const kinds = describeLintRuleKinds();
		expect(kinds.map((kind) => kind.id)).toEqual(
			lintRuleRegistry.kinds.map((kind) => kind.id),
		);
		for (const kind of kinds) {
			expect(kind.options).toEqual(LINT_RULE_OPTION_SPECS[kind.id] ?? []);
			expect(new Set(kind.options.map((spec) => spec.key)).size).toBe(
				kind.options.length,
			);
		}
	});
});
