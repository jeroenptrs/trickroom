import type { ColorIntent } from "../color";
import type { ParsedClass } from "../parse";
import type { SpacingIntent } from "../spacing";
import type { StyleIntent } from "../style";

export type { ColorIntent } from "../color";
export type { SpacingIntent } from "../spacing";
export type { StyleIntent } from "../style";

export type KnownUtilityIntent = ColorIntent | SpacingIntent | StyleIntent;

export type UtilityIntent = KnownUtilityIntent | { kind: "unknown" };

export type ClassifyContext = {
	/**
	 * Names of color tokens currently resolved by the active design
	 * system. Passed to the color domain classifier only.
	 */
	colorTokens: ReadonlySet<string>;
};

/**
 * One utility domain contributes a classifier that returns a known intent
 * or `null` when the parsed class does not belong to that domain.
 */
export type UtilityDomain = {
	readonly kind: KnownUtilityIntent["kind"];
	readonly classify: (
		parsed: ParsedClass,
		context: ClassifyContext,
	) => KnownUtilityIntent | null;
};
