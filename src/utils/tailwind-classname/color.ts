/**
 * Color utility domain: classifier and intent shape.
 *
 * Registry entries live in `registry.ts`. This module maps parsed classes
 * to `ColorIntent` and disambiguates non-color siblings on shared prefixes.
 */

import type { ParsedClass } from "./parse";
import {
	COLOR_REGISTRY,
	type ColorProperty,
	type ColorRegistryEntry,
	findColorRegistryEntry,
	UNIVERSAL_COLOR_KEYWORDS,
} from "./registry";

export type ColorIntent = {
	kind: "color";
	property: ColorProperty;
	token: string | null;
	arbitraryValue: string | null;
	keyword: string | null;
	resolved: boolean;
};

export type ClassifyColorOptions = {
	colorTokens: ReadonlySet<string>;
};

type ResolvedColorUtility = {
	entry: ColorRegistryEntry;
	value: string | null;
	arbitrary: boolean;
};

const MULTI_SEGMENT_COLOR_REGISTRY = COLOR_REGISTRY.filter((entry) =>
	entry.prefix.includes("-"),
).sort((left, right) => right.prefix.length - left.prefix.length);

export function classifyColorParsedClass(
	parsed: ParsedClass,
	options: ClassifyColorOptions,
): ColorIntent | null {
	if (parsed.prefix === "" && parsed.arbitrary) {
		return null;
	}

	const utility = resolveColorUtility(parsed);
	if (!utility) {
		return null;
	}
	const { entry, value, arbitrary } = utility;

	if (value === null) {
		return null;
	}

	if (arbitrary) {
		const inner = value.slice(1, -1);
		if (looksLikeColorValue(inner)) {
			return {
				kind: "color",
				property: entry.property,
				token: null,
				arbitraryValue: value,
				keyword: null,
				resolved: true,
			};
		}
		return null;
	}

	const valueAfterSide = stripSide(value, entry.sides);
	if (valueAfterSide === "") {
		return null;
	}

	if (isNonColorSibling(valueAfterSide, entry)) {
		return null;
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

function resolveColorUtility(parsed: ParsedClass): ResolvedColorUtility | null {
	for (const entry of MULTI_SEGMENT_COLOR_REGISTRY) {
		if (parsed.utility === entry.prefix) {
			return {
				entry,
				value: null,
				arbitrary: false,
			};
		}

		const head = `${entry.prefix}-`;
		if (!parsed.utility.startsWith(head)) {
			continue;
		}

		const value = parsed.utility.slice(head.length);
		return {
			entry,
			value: value.length > 0 ? value : null,
			arbitrary: value.startsWith("[") && value.endsWith("]"),
		};
	}

	const exactEntry = findColorRegistryEntry(parsed.prefix);
	if (exactEntry) {
		return {
			entry: exactEntry,
			value: parsed.value,
			arbitrary: parsed.arbitrary,
		};
	}

	return null;
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
