/**
 * Color utility registry.
 *
 * Each entry tells the classifier which Tailwind utility prefix maps to
 * which `ColorProperty`, plus how to disambiguate against the prefix's
 * non-color siblings (widths, sizes, styles, …).
 *
 * Color-only registry used by the color domain classifier. Other utility
 * domains (spacing, layout, …) use their own modules; see `README.md`.
 */

export type ColorProperty =
	| "background"
	| "text"
	| "border"
	| "ring"
	| "ring-offset"
	| "outline"
	| "fill"
	| "stroke"
	| "text-shadow"
	| "accent"
	| "caret"
	| "placeholder"
	| "decoration"
	| "divide"
	| "shadow"
	| "inset-shadow"
	| "gradient-from"
	| "gradient-via"
	| "gradient-to";

export type ColorRegistryEntry = {
	prefix: string;
	property: ColorProperty;
	/**
	 * Sub-modifier segments that can appear between the prefix and the
	 * color value, e.g. the sides for `border-x-blue-500`.
	 */
	sides?: readonly string[];
	/**
	 * Literal value tokens that belong to a non-color sibling utility
	 * (e.g. `text-sm`, `border-solid`, `bg-cover`). When a parsed value
	 * matches one of these, the classifier returns `unknown` rather than
	 * a stale-color warning.
	 */
	nonColorValues?: ReadonlySet<string>;
	/**
	 * Regex matchers for non-color siblings whose values are open-ended
	 * (e.g. numeric widths like `border-2`, `ring-4`).
	 */
	nonColorMatchers?: readonly RegExp[];
	/**
	 * When true, the bare prefix on its own (e.g. `border`, `ring`,
	 * `shadow`) is a non-color utility. The classifier returns `unknown`
	 * in that case rather than treating the missing value as a stale
	 * color.
	 */
	bareIsNonColor?: boolean;
};

const NUMERIC = /^\d+(\.\d+)?$/;
const FRACTIONAL_NUMERIC = /^-?\d+(\.\d+)?\/\d+(\.\d+)?$/;
const BG_GRADIENT = /^(linear|radial|conic)(-|$)/;

const TEXT_SIZES = new Set([
	"xs",
	"sm",
	"base",
	"lg",
	"xl",
	"2xl",
	"3xl",
	"4xl",
	"5xl",
	"6xl",
	"7xl",
	"8xl",
	"9xl",
]);

const TEXT_ALIGN = new Set([
	"left",
	"center",
	"right",
	"justify",
	"start",
	"end",
]);

const TEXT_WRAP_AND_OVERFLOW = new Set([
	"wrap",
	"nowrap",
	"balance",
	"pretty",
	"ellipsis",
	"clip",
]);

const BG_NON_COLOR = new Set([
	// repeat
	"repeat",
	"no-repeat",
	"repeat-x",
	"repeat-y",
	"repeat-round",
	"repeat-space",
	// size
	"auto",
	"cover",
	"contain",
	// attachment
	"fixed",
	"local",
	"scroll",
	// position
	"bottom",
	"center",
	"left",
	"right",
	"top",
	"left-bottom",
	"left-top",
	"right-bottom",
	"right-top",
	// origin / clip
	"origin-border",
	"origin-padding",
	"origin-content",
	"clip-border",
	"clip-padding",
	"clip-content",
	"clip-text",
	// blend
	"blend-normal",
	"blend-multiply",
	"blend-screen",
	"blend-overlay",
	"blend-darken",
	"blend-lighten",
	"blend-color-dodge",
	"blend-color-burn",
	"blend-hard-light",
	"blend-soft-light",
	"blend-difference",
	"blend-exclusion",
	"blend-hue",
	"blend-saturation",
	"blend-color",
	"blend-luminosity",
	"blend-plus-darker",
	"blend-plus-lighter",
]);

const BORDER_STYLES = new Set([
	"solid",
	"dashed",
	"dotted",
	"double",
	"hidden",
	"none",
]);

const BORDER_LAYOUT = new Set(["collapse", "separate"]);

const RING_NON_COLOR = new Set(["inset"]);

const OUTLINE_STYLES = new Set([
	"solid",
	"dashed",
	"dotted",
	"double",
	"none",
	"hidden",
]);

const SHADOW_SIZES = new Set([
	"2xs",
	"xs",
	"sm",
	"md",
	"lg",
	"xl",
	"2xl",
	"inner",
	"none",
]);

const TEXT_SHADOW_SIZES = new Set(["2xs", "xs", "sm", "md", "lg", "none"]);

const FILL_KEYWORDS = new Set(["none", "current", "inherit"]);

const ACCENT_KEYWORDS = new Set(["auto"]);

const DECORATION_STYLES = new Set([
	"solid",
	"double",
	"dotted",
	"dashed",
	"wavy",
	"from-font",
	"auto",
]);

const DIVIDE_NON_COLOR = new Set([
	"solid",
	"dashed",
	"dotted",
	"double",
	"hidden",
	"none",
	"reverse",
]);

export const COLOR_REGISTRY: readonly ColorRegistryEntry[] = [
	{
		prefix: "bg",
		property: "background",
		nonColorValues: BG_NON_COLOR,
		nonColorMatchers: [BG_GRADIENT],
	},
	{
		prefix: "text",
		property: "text",
		nonColorValues: new Set([
			...TEXT_SIZES,
			...TEXT_ALIGN,
			...TEXT_WRAP_AND_OVERFLOW,
		]),
	},
	{
		prefix: "border",
		property: "border",
		sides: ["x", "y", "s", "e", "t", "r", "b", "l"],
		nonColorValues: new Set([...BORDER_STYLES, ...BORDER_LAYOUT]),
		nonColorMatchers: [NUMERIC],
		bareIsNonColor: true,
	},
	{
		prefix: "ring",
		property: "ring",
		nonColorValues: RING_NON_COLOR,
		nonColorMatchers: [NUMERIC],
		bareIsNonColor: true,
	},
	{
		prefix: "ring-offset",
		property: "ring-offset",
		nonColorMatchers: [NUMERIC],
	},
	{
		prefix: "outline",
		property: "outline",
		nonColorValues: OUTLINE_STYLES,
		nonColorMatchers: [NUMERIC],
		bareIsNonColor: true,
	},
	{
		prefix: "fill",
		property: "fill",
		nonColorValues: FILL_KEYWORDS,
	},
	{
		prefix: "stroke",
		property: "stroke",
		nonColorMatchers: [NUMERIC],
	},
	{
		prefix: "text-shadow",
		property: "text-shadow",
		nonColorValues: TEXT_SHADOW_SIZES,
		bareIsNonColor: true,
	},
	{
		prefix: "accent",
		property: "accent",
		nonColorValues: ACCENT_KEYWORDS,
	},
	{
		prefix: "caret",
		property: "caret",
	},
	{
		prefix: "placeholder",
		property: "placeholder",
	},
	{
		prefix: "decoration",
		property: "decoration",
		nonColorValues: DECORATION_STYLES,
		nonColorMatchers: [NUMERIC],
	},
	{
		prefix: "divide",
		property: "divide",
		// `divide-x` and `divide-y` (with optional `-N` width) are layout,
		// not color. We model that by including them in `nonColorValues`
		// and letting the matcher catch their width variants.
		sides: ["x", "y"],
		nonColorValues: DIVIDE_NON_COLOR,
		nonColorMatchers: [NUMERIC],
	},
	{
		prefix: "shadow",
		property: "shadow",
		nonColorValues: SHADOW_SIZES,
		bareIsNonColor: true,
	},
	{
		prefix: "inset-shadow",
		property: "inset-shadow",
		nonColorValues: SHADOW_SIZES,
		bareIsNonColor: true,
	},
	{
		prefix: "from",
		property: "gradient-from",
		// Stops can be percentages: `from-50%`.
		nonColorMatchers: [/^\d+%$/, FRACTIONAL_NUMERIC],
	},
	{
		prefix: "via",
		property: "gradient-via",
		nonColorMatchers: [/^\d+%$/, FRACTIONAL_NUMERIC],
	},
	{
		prefix: "to",
		property: "gradient-to",
		nonColorMatchers: [/^\d+%$/, FRACTIONAL_NUMERIC],
	},
];

const ENTRIES_BY_PREFIX = new Map<string, ColorRegistryEntry>(
	COLOR_REGISTRY.map((entry) => [entry.prefix, entry]),
);

/** Look up a color registry entry by its utility prefix. */
export function findColorRegistryEntry(
	prefix: string,
): ColorRegistryEntry | undefined {
	return ENTRIES_BY_PREFIX.get(prefix);
}

/**
 * Universal color keywords that resolve regardless of theme. These are
 * not part of the `--color-*` token namespace — Tailwind emits them as
 * literal CSS values (`currentColor`, `transparent`, `inherit`) so they
 * always work even when every theme token is removed. `black` and
 * `white` are normal tokens (`--color-black`, `--color-white`) and so
 * are NOT included here.
 */
export const UNIVERSAL_COLOR_KEYWORDS: ReadonlySet<string> = new Set([
	"inherit",
	"current",
	"transparent",
]);
