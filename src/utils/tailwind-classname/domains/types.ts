import type { ColorIntent } from "../color";
import type { ParsedClass } from "../parse";
import type { SpacingIntent } from "../spacing";
import type { StyleIntent } from "../style";

export type { ColorIntent } from "../color";
export type { SpacingIntent } from "../spacing";
export type { StyleIntent } from "../style";

export type CustomFunctionalIntent = {
	kind: "custom-functional";
	/**
	 * The @utility root, used as conflict identity key
	 * (e.g. "text-interaction" for "text-interaction-sm").
	 */
	property: string;
	value: string | null;
};

export type KnownUtilityIntent =
	| ColorIntent
	| SpacingIntent
	| StyleIntent
	| CustomFunctionalIntent;

export type UtilityIntent = KnownUtilityIntent | { kind: "unknown" };

export type ClassifyContext = {
	/**
	 * Names of color tokens currently resolved by the active design
	 * system. Passed to the color domain classifier only.
	 */
	colorTokens: ReadonlySet<string>;
	/**
	 * Functional custom @utility roots (wildcard, value-taking), sorted by length
	 * descending for longest-prefix matching. Matched by exact name OR `root-`
	 * prefix (e.g. root `text-interaction` matches `text-interaction-sm`).
	 * Absent or empty → such utilities classify as "unknown".
	 */
	customFunctionalUtilityRoots?: readonly string[];
	/**
	 * Static custom @utility roots (value-less, e.g. `core-interaction-primary`,
	 * `bg-penn-app`). Matched by EXACT name only — never by prefix — so a stray
	 * `bg-penn-app-x` stays unknown.
	 */
	customStaticUtilityRoots?: readonly string[];
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
