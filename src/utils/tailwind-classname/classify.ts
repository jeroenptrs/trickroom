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
import type { ParseClassNameOptions, ParsedClass } from "./parse";

export type { ColorIntent } from "./color";
export type {
	CustomFunctionalIntent,
	KnownUtilityIntent,
	UtilityIntent,
} from "./domains";
export { UTILITY_DOMAINS } from "./domains";
export type { SpacingIntent } from "./spacing";
export type { StyleIntent, StyleProperty, StyleUtilityDomain } from "./style";

/** Everything needed to parse and classify a className string. */
export type ClassNameOptions = ParseClassNameOptions & ClassifyContext;

export function classifyParsedClass(
	parsed: ParsedClass,
	options: ClassifyContext,
): UtilityIntent {
	return classifyKnownUtility(parsed, options);
}
