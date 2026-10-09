import { describe, expect, it } from "vitest";
import { lintRuleRegistry } from "./index";
import { LINT_RULE_KIND_LEDGER } from "./ledger";

describe("rule kind ledger", () => {
	it("lists every registered kind, and every kind it lists is registered unless retired", () => {
		const ledger = new Map(
			LINT_RULE_KIND_LEDGER.map((entry) => [entry.id, entry]),
		);
		expect(ledger.size).toBe(LINT_RULE_KIND_LEDGER.length);
		const unlisted = [...lintRuleRegistry.ids].filter((id) => !ledger.has(id));
		// A new kind: append its id to LINT_RULE_KIND_LEDGER.
		expect(unlisted).toEqual([]);
		const missing = LINT_RULE_KIND_LEDGER.filter(
			(entry) => !entry.retired && !lintRuleRegistry.ids.has(entry.id),
		).map((entry) => entry.id);
		// A kind was removed or renamed: ids are permanent, so mark the old
		// id `retired` instead of deleting it (see docs/lint.md).
		expect(missing).toEqual([]);
		const revived = LINT_RULE_KIND_LEDGER.filter(
			(entry) => entry.retired && lintRuleRegistry.ids.has(entry.id),
		).map((entry) => entry.id);
		expect(revived).toEqual([]);
	});
});
