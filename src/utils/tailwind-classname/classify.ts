/**
 * Classifier entry point: turns a `ParsedClass` into a semantic `UtilityIntent`.
 *
 * Domain-specific logic lives in per-domain modules (`color.ts`, `spacing.ts`, …)
 * and is orchestrated through `domains/index.ts`. See `README.md` for how to add
 * a new domain.
 */

import {
	type ClassifyContext,
	classifyKnownUtility,
	type UtilityIntent,
} from "./domains";
import type { ParsedClass } from "./parse";

export type { ColorIntent } from "./color";
export type {
	CustomFunctionalIntent,
	KnownUtilityIntent,
	UtilityIntent,
} from "./domains";
export { UTILITY_DOMAINS } from "./domains";
export type { SpacingIntent } from "./spacing";
export type { StyleIntent, StyleProperty, StyleUtilityDomain } from "./style";

/** @deprecated Prefer `ClassifyContext`; kept for existing call sites. */
export type ClassifyOptions = ClassifyContext;

export function classifyParsedClass(
	parsed: ParsedClass,
	options: ClassifyContext,
): UtilityIntent {
	return classifyKnownUtility(parsed, options);
}
