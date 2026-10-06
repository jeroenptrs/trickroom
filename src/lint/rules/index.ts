import { unknownClassTokenRule } from "./code/class-tokens";
import { redundantClassRule } from "./code/redundant-class";
import {
	requiredAxisMissingRule,
	unknownVariantValueRule,
} from "./code/variant-values";
import {
	variantsFileOrphanedRule,
	variantsFileStaleRule,
} from "./code/variants-file";
import {
	componentStylingRestrictedRule,
	variantsImportedOutsideComponentRule,
} from "./code/variants-import";
import {
	slotNotCalledRule,
	wrapperMissingVariantsCallRule,
} from "./code/wrapper";
import { designOnlyClassTargetRule } from "./design/design-only-class-target";
import { designUnknownClassTokenRule } from "./design/unknown-class-token";
import { designUnknownVariantValueRule } from "./design/unknown-variant-value";
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
	wrapperMissingVariantsCallRule,
	slotNotCalledRule,
	unknownVariantValueRule,
	requiredAxisMissingRule,
	unknownClassTokenRule,
	redundantClassRule,
	variantsImportedOutsideComponentRule,
	componentStylingRestrictedRule,
	designUnknownClassTokenRule,
	designOnlyClassTargetRule,
	designUnknownVariantValueRule,
];

export const lintRuleRegistry = createLintRuleRegistry(LINT_RULE_KINDS);
