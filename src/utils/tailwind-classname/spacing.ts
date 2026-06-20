import type { ParsedClass } from "./parse";

export type SpacingProperty =
	| "padding"
	| "padding-x"
	| "padding-y"
	| "padding-top"
	| "padding-right"
	| "padding-bottom"
	| "padding-left"
	| "padding-start"
	| "padding-end"
	| "margin"
	| "margin-x"
	| "margin-y"
	| "margin-top"
	| "margin-right"
	| "margin-bottom"
	| "margin-left"
	| "margin-start"
	| "margin-end"
	| "gap"
	| "gap-x"
	| "gap-y";

export type SpacingValue =
	| { kind: "scale"; value: string }
	| { kind: "arbitrary"; value: string }
	| { kind: "custom-property"; value: string }
	| { kind: "keyword"; keyword: "auto" };

export type SpacingIntent = {
	kind: "spacing";
	property: SpacingProperty;
	value: SpacingValue;
	negative: boolean;
};

export type ResolvedSpacingUtility = {
	property: SpacingProperty;
	value: string | null;
};

const PREFIX_TO_PROPERTY: Partial<Record<string, SpacingProperty>> = {
	p: "padding",
	px: "padding-x",
	py: "padding-y",
	pt: "padding-top",
	pr: "padding-right",
	pb: "padding-bottom",
	pl: "padding-left",
	ps: "padding-start",
	pe: "padding-end",
	m: "margin",
	mx: "margin-x",
	my: "margin-y",
	mt: "margin-top",
	mr: "margin-right",
	mb: "margin-bottom",
	ml: "margin-left",
	ms: "margin-start",
	me: "margin-end",
};

export const SPACING_PROPERTY_TO_PREFIX: Record<SpacingProperty, string> = {
	padding: "p",
	"padding-x": "px",
	"padding-y": "py",
	"padding-top": "pt",
	"padding-right": "pr",
	"padding-bottom": "pb",
	"padding-left": "pl",
	"padding-start": "ps",
	"padding-end": "pe",
	margin: "m",
	"margin-x": "mx",
	"margin-y": "my",
	"margin-top": "mt",
	"margin-right": "mr",
	"margin-bottom": "mb",
	"margin-left": "ml",
	"margin-start": "ms",
	"margin-end": "me",
	gap: "gap",
	"gap-x": "gap-x",
	"gap-y": "gap-y",
};

export function classifySpacingParsedClass(
	parsed: ParsedClass,
): SpacingIntent | null {
	const utility = resolveSpacingUtility(parsed);
	if (!utility || utility.value === null || utility.value.length === 0) {
		return null;
	}

	if (parsed.negative && !isMarginProperty(utility.property)) {
		return null;
	}

	const value = parseSpacingValue(utility.value, utility.property);
	if (!value) {
		return null;
	}

	return {
		kind: "spacing",
		property: utility.property,
		value,
		negative: parsed.negative,
	};
}

function resolveSpacingUtility(
	parsed: ParsedClass,
): ResolvedSpacingUtility | null {
	const property = PREFIX_TO_PROPERTY[parsed.prefix];
	if (property) {
		return { property, value: parsed.value };
	}

	if (parsed.prefix !== "gap") {
		return null;
	}

	if (parsed.value === "x") {
		return { property: "gap-x", value: null };
	}

	if (parsed.value?.startsWith("x-")) {
		return { property: "gap-x", value: parsed.value.slice(2) };
	}

	if (parsed.value === "y") {
		return { property: "gap-y", value: null };
	}

	if (parsed.value?.startsWith("y-")) {
		return { property: "gap-y", value: parsed.value.slice(2) };
	}

	return { property: "gap", value: parsed.value };
}

function parseSpacingValue(
	rawValue: string,
	property: SpacingProperty,
): SpacingValue | null {
	if (rawValue === "auto") {
		return isMarginProperty(property)
			? { kind: "keyword", keyword: "auto" }
			: null;
	}

	if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
		return { kind: "arbitrary", value: rawValue };
	}

	if (rawValue.startsWith("(") && rawValue.endsWith(")")) {
		return { kind: "custom-property", value: rawValue };
	}

	return { kind: "scale", value: rawValue };
}

function isMarginProperty(property: SpacingProperty): boolean {
	return property === "margin" || property.startsWith("margin-");
}
