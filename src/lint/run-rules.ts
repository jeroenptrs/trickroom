import type { ResolvedLintConfig } from "./config";
import type { LintFinding } from "./report";
import type { LintRuleRegistry } from "./rules/registry";
import type { LintRuleContext, LintSide } from "./rules/types";

/**
 * The rule runner `runLint` and the design validation share: runs every
 * enabled kind of the registry (optionally one side only) against one
 * context, stamps `rule`, `side` and the instance's severity on each
 * finding, and reports a kind that throws instead of letting it pass.
 */

/** A finding as the runner returns it: the report's shape plus the kind's `details`. */
export type LintRunFinding = LintFinding & {
	details?: Record<string, unknown>;
};

export type LintRuleFailure = { rule: string; message: string };

export type LintRulesRunResult = {
	findings: LintRunFinding[];
	/** Enabled kind ids per side, in registry order. */
	enabled: Record<LintSide, string[]>;
	failures: LintRuleFailure[];
};

export async function runLintRules({
	registry,
	config,
	context,
	side,
	skip,
}: {
	registry: LintRuleRegistry;
	config: ResolvedLintConfig;
	context: Omit<LintRuleContext, "rule">;
	/** Only the kinds of this side. */
	side?: LintSide;
	/** Kind ids not to run (for example ones with invalid options). */
	skip?: ReadonlySet<string>;
}): Promise<LintRulesRunResult> {
	const result: LintRulesRunResult = {
		findings: [],
		enabled: { code: [], design: [] },
		failures: [],
	};
	for (const rule of config.rules) {
		const kind = registry.get(rule.id);
		if (!kind || !rule.enabled || (side && kind.side !== side)) continue;
		if (skip?.has(kind.id)) continue;
		result.enabled[kind.side].push(kind.id);
		try {
			for (const finding of await kind.run({ ...context, rule })) {
				result.findings.push({
					rule: kind.id,
					severity: finding.severity ?? rule.severity,
					side: kind.side,
					message: finding.message,
					...(finding.component ? { component: finding.component } : {}),
					location: finding.location,
					...(finding.details ? { details: finding.details } : {}),
				});
			}
		} catch (error) {
			result.failures.push({
				rule: kind.id,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return result;
}

/** The finding as the report stores it, without `details`. */
export const toReportFinding = ({
	details: _details,
	...finding
}: LintRunFinding): LintFinding => finding;
