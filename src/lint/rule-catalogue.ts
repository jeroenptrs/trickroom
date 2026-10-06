import type { LintSeverity } from "./config";
import type { LintRuleOptionSpec } from "./rule-options";
import { lintRuleRegistry } from "./rules/index";
import type { LintRuleRegistry } from "./rules/registry";
import type { LintSide } from "./rules/types";

/**
 * The rule kind catalogue as plain data, for the dashboard's config editor:
 * what `GET .../lint/config` returns so the browser never bundles engine
 * code. `LINT_RULE_OPTION_SPECS` documents the options a kind takes, keyed by
 * kind id (from `LintRuleKind.options`), so the editor can render a form for
 * them; a kind without an entry has no documented options, and any options stored for it (or keys a spec
 * does not list) are shown read-only and kept as they are on save.
 */

export type { LintRuleOptionSpec } from "./rule-options";

export type LintRuleKindSummary = {
	id: string;
	side: LintSide;
	defaultSeverity: LintSeverity;
	description: string;
	options: LintRuleOptionSpec[];
};

/**
 * Documented options per rule kind id, read from each kind's `options`
 * (the same specs `getLintConfigIssues` validates `lint.json` against), so
 * the form and the validation cannot drift. A kind with options declares
 * them on its `LintRuleKind`.
 */
export const LINT_RULE_OPTION_SPECS: Readonly<
	Record<string, readonly LintRuleOptionSpec[]>
> = Object.fromEntries(
	lintRuleRegistry.kinds
		.filter((kind) => (kind.options?.length ?? 0) > 0)
		.map((kind) => [kind.id, kind.options ?? []]),
);

/** The registry's kinds with their option specs (`optionSpecs` overrides them). */
export const describeLintRuleKinds = (
	registry: LintRuleRegistry = lintRuleRegistry,
	optionSpecs?: Readonly<Record<string, readonly LintRuleOptionSpec[]>>,
): LintRuleKindSummary[] =>
	registry.kinds.map((kind) => ({
		id: kind.id,
		side: kind.side,
		defaultSeverity: kind.defaultSeverity,
		description: kind.description,
		options: [...(optionSpecs?.[kind.id] ?? kind.options ?? [])],
	}));
