import { classifyColorParsedClass } from "../color";
import type { ParsedClass } from "../parse";
import { classifySpacingParsedClass } from "../spacing";
import { classifyStyleParsedClass } from "../style";
import type { ClassifyContext, UtilityDomain, UtilityIntent } from "./types";

export type {
	ClassifyContext,
	ColorIntent,
	KnownUtilityIntent,
	SpacingIntent,
	StyleIntent,
	UtilityDomain,
	UtilityIntent,
} from "./types";

/**
 * Ordered utility domains. Earlier domains win when multiple could match;
 * color runs before spacing so shared-prefix disambiguation stays stable.
 */
export const UTILITY_DOMAINS: readonly UtilityDomain[] = [
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
