import { classifyColorParsedClass } from "../color";
import type { ParsedClass } from "../parse";
import { classifySpacingParsedClass } from "../spacing";
import { classifyStyleParsedClass } from "../style";
import type { ClassifyContext, UtilityDomain, UtilityIntent } from "./types";

export type {
	ClassifyContext,
	ColorIntent,
	CustomFunctionalIntent,
	KnownUtilityIntent,
	SpacingIntent,
	StyleIntent,
	UtilityDomain,
	UtilityIntent,
} from "./types";

/**
 * Static roots are exact-matched on every class token, and real design systems
 * define hundreds of them (e.g. a whole colour system). Memoize a lookup `Set`
 * keyed by the roots array's identity — callers pass a stable, memoized array
 * (from `useResolvedCustomUtilities` or `splitCustomUtilityRoots`), so this is
 * built once per system rather than scanned per token.
 */
const staticRootSetCache = new WeakMap<
	readonly string[],
	ReadonlySet<string>
>();
function staticRootLookup(roots: readonly string[]): ReadonlySet<string> {
	let set = staticRootSetCache.get(roots);
	if (!set) {
		set = new Set(roots);
		staticRootSetCache.set(roots, set);
	}
	return set;
}

/**
 * Custom `@utility` classification. Runs FIRST (see `UTILITY_DOMAINS`) so that
 * DS-recognized custom utilities win over the heuristic built-in domains for
 * ambiguous prefixes — e.g. a system's `text-interaction-*` / `bg-penn-app`
 * are custom utilities, not generic text/background colors. Returns `null` for
 * non-custom classes, leaving built-in classification untouched.
 */
const customFunctionalDomain: UtilityDomain = {
	kind: "custom-functional",
	classify: (parsed, context) => {
		const utility = parsed.utility;

		// Static custom utilities match by EXACT name only (no value suffix),
		// so a stray `bg-penn-app-x` is never mistaken for `bg-penn-app`.
		const staticRoots = context.customStaticUtilityRoots;
		if (staticRoots?.length && staticRootLookup(staticRoots).has(utility)) {
			return {
				kind: "custom-functional" as const,
				property: utility,
				value: null,
			};
		}

		// Functional custom utilities match by exact name OR `root-` prefix.
		// Roots are sorted by length descending so longer prefixes (e.g.
		// "text-interaction") win over shorter ones (e.g. "text").
		const functionalRoots = context.customFunctionalUtilityRoots;
		if (functionalRoots) {
			for (const root of functionalRoots) {
				if (utility === root) {
					return {
						kind: "custom-functional" as const,
						property: root,
						value: null,
					};
				}
				if (utility.startsWith(`${root}-`)) {
					return {
						kind: "custom-functional" as const,
						property: root,
						value: utility.slice(root.length + 1),
					};
				}
			}
		}
		return null;
	},
};

/**
 * Ordered utility domains. Earlier domains win when multiple could match.
 * custom-functional is FIRST so explicit `@utility` definitions take precedence
 * over built-in heuristics (which over-eagerly claim `text-*`/`bg-*` prefixes);
 * among the built-ins, color runs before spacing so shared-prefix
 * disambiguation stays stable.
 */
export const UTILITY_DOMAINS: readonly UtilityDomain[] = [
	customFunctionalDomain,
	{
		kind: "color",
		classify: (parsed, context) =>
			classifyColorParsedClass(parsed, { colorTokens: context.colorTokens }),
	},
	{
		kind: "spacing",
		classify: (parsed) => classifySpacingParsedClass(parsed),
	},
	{
		kind: "style",
		classify: (parsed) => classifyStyleParsedClass(parsed),
	},
];

export function classifyKnownUtility(
	parsed: ParsedClass,
	context: ClassifyContext,
): UtilityIntent {
	for (const domain of UTILITY_DOMAINS) {
		const intent = domain.classify(parsed, context);
		if (intent) {
			return intent;
		}
	}
	return { kind: "unknown" };
}
