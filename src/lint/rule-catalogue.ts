import type { LintSeverity } from "./config";
import { lintRuleRegistry } from "./rules/index";
import type { LintRuleRegistry } from "./rules/registry";
import type { LintSide } from "./rules/types";

/**
 * The rule kind catalogue as plain data, for the dashboard's config editor:
 * what `GET .../lint/config` returns so the browser never bundles engine
 * code. `LINT_RULE_OPTION_SPECS` documents the options a kind takes, keyed by
 * kind id, so the editor can render a form for them; a kind without an entry
 * has no documented options, and any options stored for it (or keys a spec
 * does not list) are shown read-only and kept as they are on save.
 */

export type LintRuleOptionSpec = {
	key: string;
	label: string;
	description: string;
} & (
	| { type: "boolean" }
	| { type: "number" }
	| { type: "string"; placeholder?: string }
	/** Allow lists, globs, slugs: one entry per line. */
	| { type: "string-list"; placeholder?: string }
	/** Per-component lists, keyed by component slug: `{ [slug]: string[] }`. */
	| { type: "component-map"; placeholder?: string }
);

export type LintRuleKindSummary = {
	id: string;
	side: LintSide;
	defaultSeverity: LintSeverity;
	description: string;
	options: LintRuleOptionSpec[];
};

/** Documented options per rule kind id; WP3 and WP4 add their kinds here. */
export const LINT_RULE_OPTION_SPECS: Readonly<
	Record<string, readonly LintRuleOptionSpec[]>
> = {};

export const describeLintRuleKinds = (
	registry: LintRuleRegistry = lintRuleRegistry,
	optionSpecs: Readonly<
		Record<string, readonly LintRuleOptionSpec[]>
	> = LINT_RULE_OPTION_SPECS,
): LintRuleKindSummary[] =>
	registry.kinds.map((kind) => ({
		id: kind.id,
		side: kind.side,
		defaultSeverity: kind.defaultSeverity,
		description: kind.description,
		options: [...(optionSpecs[kind.id] ?? [])],
	}));
