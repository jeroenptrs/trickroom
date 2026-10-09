import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { lintRuleRegistry } from "./index";
import { LINT_RULE_KIND_LEDGER } from "./ledger";

/**
 * Every rule kind id Trickroom has shipped, pinned here so that removing
 * an id from both the registry and the ledger still fails. This list only
 * grows: a new kind appends its id here and to `LINT_RULE_KIND_LEDGER`;
 * a retired kind stays here and is marked `retired` in the ledger.
 */
const SHIPPED_KIND_IDS = [
	"code.variants-file-stale",
	"code.variants-file-orphaned",
	"code.wrapper-missing-variants-call",
	"code.slot-not-called",
	"code.unknown-variant-value",
	"code.required-axis-missing",
	"code.unknown-class-token",
	"code.redundant-class",
	"code.non-canonical-class",
	"code.variants-imported-outside-component",
	"code.component-styling-restricted",
	"design.unknown-class-token",
	"design.non-canonical-class",
	"design.design-only-class-target",
	"design.unknown-variant-value",
];

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

	it("keeps every id ever shipped", () => {
		const ledger = new Set(LINT_RULE_KIND_LEDGER.map((entry) => entry.id));
		expect(SHIPPED_KIND_IDS.filter((id) => !ledger.has(id))).toEqual([]);
	});

	it("is a literal list, not derived from the registry", async () => {
		const source = await readFile(
			new URL("./ledger.ts", import.meta.url),
			"utf8",
		);
		// A derived ledger would follow the registry through a removal.
		expect(source).not.toMatch(/^import(?!\s+type)/mu);
		for (const id of SHIPPED_KIND_IDS) {
			expect(source, id).toContain(`{ id: "${id}"`);
		}
	});
});
