export {
	type ClassifyContext,
	type ClassNameOptions,
	type ColorIntent,
	type CustomFunctionalIntent,
	classifyParsedClass,
	type KnownUtilityIntent,
	type StyleIntent,
	type StyleProperty,
	type StyleUtilityDomain,
	UTILITY_DOMAINS,
	type UtilityIntent,
} from "./classify";
export type { UtilityDomain } from "./domains";
export {
	type ParseClassNameOptions,
	type ParsedClass,
	parseClassName,
} from "./parse";
export {
	type ColorProperty,
	type ColorRegistryEntry,
	findColorRegistryEntry,
	UNIVERSAL_COLOR_KEYWORDS,
} from "./registry";
export {
	getModifierChain,
	getUtilityConflictGroup,
	getUtilityConflictScope,
	type ModifierChain,
	sameModifierChain,
	type UtilityConflictScope,
	utilityScopesMayConflict,
} from "./scope";
export type { SpacingIntent } from "./spacing";
