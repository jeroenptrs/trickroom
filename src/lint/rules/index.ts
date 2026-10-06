import {
	variantsFileOrphanedRule,
	variantsFileStaleRule,
} from "./code/variants-file";
import { designOnlyClassTargetRule } from "./design/design-only-class-target";
import { unknownClassTokenRule } from "./design/unknown-class-token";
import { unknownVariantValueRule } from "./design/unknown-variant-value";
import { createLintRuleRegistry } from "./registry";
import type { LintRuleKind } from "./types";

export { createLintRuleRegistry, type LintRuleRegistry } from "./registry";
export type {
	LintLocation,
	LintRuleContext,
	LintRuleFinding,
	LintRuleKind,
	LintSide,
	LintTailwindInspector,
} from "./types";

/**
 * Every shipped rule kind, in catalogue order (docs/lint.md). Code-side
 * kinds first, then design-side. WP3 and WP4 append theirs here.
 */
export const LINT_RULE_KINDS: readonly LintRuleKind[] = [
	variantsFileStaleRule,
	variantsFileOrphanedRule,
	unknownClassTokenRule,
	designOnlyClassTargetRule,
	unknownVariantValueRule,
];

export const lintRuleRegistry = createLintRuleRegistry(LINT_RULE_KINDS);
