/**
 * Classifier: turns a `ParsedClass` into a semantic `UtilityIntent`.
 *
 * For the MVP, only color utilities are recognized. Anything else (or
 * unknown user-defined classes) is returned as `{ kind: "unknown" }`.
 *
 * Disambiguation against non-color siblings (`text-sm`, `border-2`,
 * `bg-cover`, …) uses each registry entry's `nonColorValues` /
 * `nonColorMatchers`. A class whose prefix matches a color entry but
 * whose value is recognised as a non-color sibling is treated as
 * unknown rather than producing a stale-color warning.
 */

import type { ParsedClass } from "./parse";
import {
	type ColorProperty,
	type ColorRegistryEntry,
	UNIVERSAL_COLOR_KEYWORDS,
	findColorRegistryEntry,
} from "./registry";

export type ColorIntent = {
	kind: "color";
	/** Which color property this utility writes to. */
	property: ColorProperty;
	/**
	 * Color token name (e.g. `"blue-500"`) when the utility uses a
	 * named token. Null for arbitrary values and universal keywords.
	 */
	token: string | null;
	/**
	 * Verbatim arbitrary value with brackets (e.g. `"[#abc]"`), or null
	 * when the utility uses a named token.
	 */
	arbitraryValue: string | null;
	/**
	 * Universal color keyword (`current`, `transparent`, `inherit`,
	 * `black`, `white`) when present.
	 */
	keyword: string | null;
	/**
	 * Whether this color resolves in the active design system. Named
	 * tokens that aren't in the active token set surface as resolved =
	 * false so the UI can render a warning swatch.
	 */
	resolved: boolean;
};

export type UtilityIntent = ColorIntent | { kind: "unknown" };

export type ClassifyOptions = {
	/**
	 * Names of color tokens currently resolved by the active design
	 * system (e.g. `"blue-500"`, `"brand-primary"`). Universal keywords
	 * such as `current`/`transparent` do not need to be included.
	 */
	colorTokens: ReadonlySet<string>;
};

export function classifyParsedClass(
	parsed: ParsedClass,
	options: ClassifyOptions,
): UtilityIntent {
	// Fully arbitrary utilities (`[mask:...]`) are always unknown.
	if (parsed.prefix === "" && parsed.arbitrary) {
		return { kind: "unknown" };
	}

	const entry = findColorRegistryEntry(parsed.prefix);
	if (!entry) {
		return { kind: "unknown" };
	}

	// Bare prefix (`border`, `ring`, `shadow`) — width/keyword utility,
	// not a color.
	if (parsed.value === null) {
		if (entry.bareIsNonColor) return { kind: "unknown" };
		// `caret`, `placeholder`, `bg`, `text`, … on their own aren't
		// recognized utilities either.
		return { kind: "unknown" };
	}

	// Arbitrary value: classify as color when it looks like a color.
	if (parsed.arbitrary && parsed.value !== null) {
		const inner = parsed.value.slice(1, -1);
		if (looksLikeColorValue(inner)) {
			return {
				kind: "color",
				property: entry.property,
				token: null,
				arbitraryValue: parsed.value,
				keyword: null,
				resolved: true,
			};
		}
		return { kind: "unknown" };
	}

	// Strip a sub-modifier (e.g. `t-` from `border-t-blue-500`) when the
	// entry declares one. `border-t-2` keeps the `2` as the value, which
	// then matches `nonColorMatchers`.
	const valueAfterSide = stripSide(parsed.value, entry.sides);

	// `divide-x` / `divide-y` on their own: side-only with no further
	// value. That's a layout utility.
	if (valueAfterSide === "") {
		return { kind: "unknown" };
	}

	if (isNonColorSibling(valueAfterSide, entry)) {
		return { kind: "unknown" };
	}

	if (UNIVERSAL_COLOR_KEYWORDS.has(valueAfterSide)) {
		return {
			kind: "color",
			property: entry.property,
			token: null,
			arbitraryValue: null,
			keyword: valueAfterSide,
			resolved: true,
		};
	}

	const resolved = options.colorTokens.has(valueAfterSide);

	return {
		kind: "color",
		property: entry.property,
		token: valueAfterSide,
		arbitraryValue: null,
		keyword: null,
		resolved,
	};
}

function stripSide(
	value: string,
	sides: readonly string[] | undefined,
): string {
	if (!sides) return value;
	for (const side of sides) {
		const head = `${side}-`;
		if (value.startsWith(head)) return value.slice(head.length);
		if (value === side) return "";
	}
	return value;
}

function isNonColorSibling(value: string, entry: ColorRegistryEntry): boolean {
	if (entry.nonColorValues?.has(value)) return true;
	if (entry.nonColorMatchers?.some((re) => re.test(value))) return true;
	return false;
}

const COLOR_FUNCTION_PREFIXES = [
	"rgb(",
	"rgba(",
	"hsl(",
	"hsla(",
	"oklch(",
	"oklab(",
	"lab(",
	"lch(",
	"hwb(",
	"color(",
];

function looksLikeColorValue(inner: string): boolean {
	if (inner.length === 0) return false;
	if (inner.startsWith("#")) return true;
	if (inner.startsWith("var(")) return true;
	const lower = inner.toLowerCase();
	return COLOR_FUNCTION_PREFIXES.some((p) => lower.startsWith(p));
}
