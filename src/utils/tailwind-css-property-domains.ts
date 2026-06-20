/**
 * Maps raw CSS property names to Trickroom's UI domains so a custom `@utility`
 * can be "folded" into the panel(s) it actually affects (Background, Typography,
 * Border, …) instead of a single opaque "Custom" bucket.
 *
 * The vocabulary is exactly the inspector panels: `StyleUtilityDomain` plus the
 * standalone `spacing` domain. Note there is no `color` panel — Trickroom edits
 * colour *within* its structural panels, so colour properties are routed to
 * those (background-color → background, border-color → border, text `color` →
 * typography). A utility that sets properties across several domains (e.g. a
 * semantic `@apply` button utility) folds into ALL of them.
 */

import type { StyleUtilityDomain } from "./tailwind-classname/style";

export type CustomUtilityDomain = StyleUtilityDomain | "spacing";

/**
 * Ordered rules: the first match wins. Colour properties are routed to the
 * panel that edits that colour (e.g. `background-color` → background via the
 * `^background` rule, `border-*-color` → border, text `color` → typography),
 * since there is no standalone colour panel.
 */
const PROPERTY_DOMAIN_RULES: ReadonlyArray<
	readonly [RegExp, CustomUtilityDomain]
> = [
	// SVG paint.
	[/^(fill|stroke)(-|$)/, "vector"],
	// Masking.
	[/^mask(-|$)/, "mask"],
	// Structure (tables, lists, box flow). Listed before border/typography/layout
	// so these fold into the Structure panel rather than those panels — matching
	// where the editor exposes them (see `StructureProperties`).
	[/^(table-layout|caption-side|empty-cells)$/, "structure"],
	[/^(border-collapse|border-spacing)$/, "structure"],
	[/^list-style(-|$)/, "structure"],
	[/^break-(before|after|inside)$/, "structure"],
	[
		/^(box-sizing|box-decoration-break|visibility|float|clear|columns)$/,
		"structure",
	],
	// Background (incl. background-color, background-image/size/position/…).
	[/^background(-|$)/, "background"],
	// Border (incl. border-*-color, -width, -style, -radius).
	[/^border.*(color|width|style)$/, "border"],
	[/^border.*radius$/, "border"],
	// Focus ring / outline (incl. outline-color).
	[/^outline(-|$)/, "focus"],
	// Form-control colours.
	[/^(caret-color|accent-color)$/, "interaction"],
	// Typography (incl. text `color`, text-decoration-color via `^text-`).
	[
		/^(color|font|text-|line-height|letter-spacing|white-space|word-|overflow-wrap|hyphens|vertical-align|content|tab-size|-webkit-text-)/,
		"typography",
	],
	// Spacing.
	[
		/^(padding|margin|gap|row-gap|column-gap|scroll-padding|scroll-margin)/,
		"spacing",
	],
	// Sizing.
	[/^(width|height|inline-size|block-size|aspect-ratio|flex-basis|size)$/, "size"],
	[/^(min|max)-(width|height|inline-size|block-size)$/, "size"],
	// Effects.
	[/shadow$/, "effects"],
	[
		/^(opacity|filter|backdrop-filter|mix-blend-mode|background-blend-mode)$/,
		"effects",
	],
	// Motion.
	[/^(transition|animation|will-change)/, "motion"],
	// Transforms.
	[
		/^(transform|translate|rotate|scale|skew|perspective|backface-visibility)/,
		"transform",
	],
	// Position.
	[/^(position|top|right|bottom|left|inset|z-index)$/, "position"],
	// Layout.
	[
		/^(display|flex|grid|justify|align|place|order|overflow|object-fit|object-position|isolation)/,
		"layout",
	],
	// Interaction.
	[
		/^(cursor|pointer-events|user-select|touch-action|resize|appearance|scroll-behavior|scroll-snap)/,
		"interaction",
	],
];

const VENDOR_PREFIX = /^-(webkit|moz|ms|o)-/;

/**
 * Resolve a single CSS property name to its UI domain, or null when unmapped.
 * Vendor prefixes are stripped first, except `-webkit-text-*` (typography),
 * which the typography rule matches explicitly.
 */
export function cssPropertyToDomain(
	property: string,
): CustomUtilityDomain | null {
	const name = property.trim().toLowerCase();
	const normalized = name.startsWith("-webkit-text-")
		? name
		: name.replace(VENDOR_PREFIX, "");
	for (const [pattern, domain] of PROPERTY_DOMAIN_RULES) {
		if (pattern.test(normalized)) {
			return domain;
		}
	}
	return null;
}

/**
 * Extract declared CSS property names from a compiled utility's CSS, ignoring
 * custom properties (`--*`) and nested selectors. Brace-/variant-agnostic: it
 * matches `prop:` after any `{`, `;`, or line start.
 */
export function extractCssPropertyNames(css: string): string[] {
	const names = new Set<string>();
	for (const match of css.matchAll(/(?:^|[{;])\s*(-?[a-z][a-z-]+)\s*:/g)) {
		const name = match[1];
		if (name && !name.startsWith("--")) {
			names.add(name);
		}
	}
	return [...names];
}

/**
 * Infer the UI domain(s) a utility folds into from its compiled CSS. Returns a
 * sorted, de-duplicated list (empty when no property maps to a known domain).
 */
export function inferCustomUtilityDomains(
	css: string | null,
): CustomUtilityDomain[] {
	if (!css) return [];
	const domains = new Set<CustomUtilityDomain>();
	for (const property of extractCssPropertyNames(css)) {
		const domain = cssPropertyToDomain(property);
		if (domain) {
			domains.add(domain);
		}
	}
	return [...domains].sort();
}
