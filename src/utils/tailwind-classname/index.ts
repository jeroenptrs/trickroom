export {
	type ClassifyContext,
	type ClassifyOptions,
	type ColorIntent,
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
	buildPropertyModel,
	type ColorMutation,
	type ColorValue,
	clearColor,
	clearSpacing,
	clearStyle,
	type ModeBucket,
	type ModelOptions,
	type PropertyEntry,
	type PropertyKey,
	type PropertyModel,
	type SpacingIntent,
	type SpacingMutation,
	type SpacingProperty,
	type SpacingValue,
	type StyleMutation,
	serialize,
	setColor,
	setSpacing,
	setStyle,
} from "./model";
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
	DEFAULT_MODE,
	formatWithVariantChain,
	resolveSlotTarget,
	type SlotKeys,
	type SlotTarget,
	slotKeysFromParsed,
} from "./slots";
export {
	getModifierChain,
	getUtilityConflictGroup,
	getUtilityConflictScope,
	sameModifierChain,
	type ModifierChain,
	type UtilityConflictScope,
	utilityScopesMayConflict,
} from "./scope";
