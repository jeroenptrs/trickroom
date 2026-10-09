/**
 * Every rule kind id Trickroom has ever shipped. Ids are permanent: the
 * ratchet tells a newly shipped kind (adopted into the baseline) from a
 * known one by id, and every baseline records the ids its writer knew, so
 * a kind that is renamed or removed and comes back would otherwise be
 * adopted again with whatever findings it has by then.
 *
 * Append a kind's id when it ships. Never remove or rename an entry: a
 * kind taken out of the registry stays here with `retired` set. A real
 * rename would need an explicit alias mapping the old metric onto the new
 * one, which the ratchet does not support yet. `ledger.test.ts` keeps this
 * list and the registry in step. Documented in docs/lint.md.
 */

export type LintRuleKindLedgerEntry = {
	id: string;
	/** Why and when the kind left the registry; its id stays reserved. */
	retired?: string;
};

export const LINT_RULE_KIND_LEDGER: readonly LintRuleKindLedgerEntry[] = [
	{ id: "code.variants-file-stale" },
	{ id: "code.variants-file-orphaned" },
	{ id: "code.wrapper-missing-variants-call" },
	{ id: "code.slot-not-called" },
	{ id: "code.unknown-variant-value" },
	{ id: "code.required-axis-missing" },
	{ id: "code.unknown-class-token" },
	{ id: "code.redundant-class" },
	{ id: "code.non-canonical-class" },
	{ id: "code.variants-imported-outside-component" },
	{ id: "code.component-styling-restricted" },
	{ id: "design.unknown-class-token" },
	{ id: "design.non-canonical-class" },
	{ id: "design.design-only-class-target" },
	{ id: "design.unknown-variant-value" },
];

/** Every id in the ledger, retired ones included. */
export const LINT_RULE_KIND_LEDGER_IDS: readonly string[] =
	LINT_RULE_KIND_LEDGER.map((entry) => entry.id);
