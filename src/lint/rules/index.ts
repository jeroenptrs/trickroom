import { unknownClassTokenRule } from "./code/class-tokens";
import { nonCanonicalClassRule } from "./code/non-canonical-class";
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
import { designNonCanonicalClassRule } from "./design/non-canonical-class";
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
 * kinds first, then design-side. A new kind also appends its id to
 * `LINT_RULE_KIND_LEDGER` (`ledger.ts`); ids are permanent.
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
	nonCanonicalClassRule,
	variantsImportedOutsideComponentRule,
	componentStylingRestrictedRule,
	designUnknownClassTokenRule,
	designNonCanonicalClassRule,
	designOnlyClassTargetRule,
	designUnknownVariantValueRule,
];

export const lintRuleRegistry = createLintRuleRegistry(LINT_RULE_KINDS);
