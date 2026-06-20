/**
 * `PropertyModel` is the editing-friendly view over a parsed className
 * string. It groups every recognised color class by `(mode, property,
 * variantKey)` while keeping the original ordered list around so we
 * can serialize back to the className string without churn.
 *
 * Mutation helpers (`setColor`, `clearColor`) return a fresh model.
 * Their philosophy is "edit minimally, then re-derive everything",
 * which keeps the model in lock-step with the canonical className
 * string at all times.
 */

import {
	type ClassifyOptions,
	type ColorIntent,
	type ColorProperty,
	classifyParsedClass,
} from "./classify";
import {
	type ParseClassNameOptions,
	type ParsedClass,
	parseClassName,
} from "./parse";

export type { ColorIntent, ColorProperty } from "./classify";
export type { ParsedClass } from "./parse";

/**
 * For now the only properties we model are colors. The alias keeps
 * room for future non-color property kinds without rippling through
 * call sites.
 */
export type PropertyKey = ColorProperty;

export type PropertyEntry = {
	parsed: ParsedClass;
	intent: ColorIntent;
	/** Index of the parsed class inside `PropertyModel.original`. */
	originalIndex: number;
};

export type ModeBucket = {
	byProperty: Partial<
		Record<PropertyKey, Record<string /* variantKey */, PropertyEntry>>
	>;
};

export type PropertyModel = {
	/**
	 * Keyed by mode (e.g. `""` for default / light, `"dark"` for the
	 * dark mode bucket). Default mode is always present, even when
	 * empty, so callers can read `model.byMode[""]` unconditionally.
	 */
	byMode: Record<string, ModeBucket>;
	/** Classes that did not classify as colors. */
	unknown: ParsedClass[];
	/** All parsed classes in original order. */
	original: ParsedClass[];
};

export type ModelOptions = ParseClassNameOptions & ClassifyOptions;

const DEFAULT_MODE = "";

export function buildPropertyModel(
	className: string,
	options: ModelOptions,
): PropertyModel {
	const original = parseClassName(className, options);
	const byMode: Record<string, ModeBucket> = {
		[DEFAULT_MODE]: { byProperty: {} },
	};
	const unknown: ParsedClass[] = [];

	original.forEach((parsed, index) => {
		const intent = classifyParsedClass(parsed, {
			colorTokens: options.colorTokens,
		});
		if (intent.kind !== "color") {
			unknown.push(parsed);
			return;
		}
		const modeKey = parsed.modes.join(":");
		const variantKey = parsed.variants.join(":");
		const bucket = (byMode[modeKey] ??= { byProperty: {} });
		const slot = (bucket.byProperty[intent.property] ??= {});
		// Tailwind resolves later classes over earlier ones — last write wins.
		slot[variantKey] = { parsed, intent, originalIndex: index };
	});

	return { byMode, unknown, original };
}

/** Re-emit the className string from the model. */
export function serialize(model: PropertyModel): string {
	return model.original.map((p) => p.raw).join(" ");
}

export type ColorValue =
	| { kind: "token"; token: string }
	| { kind: "arbitrary"; value: string }
	| { kind: "keyword"; keyword: "current" | "transparent" | "inherit" };

export type ColorMutation = {
	property: ColorProperty;
	value: ColorValue;
	/** Defaults to `""` (default mode bucket). */
	mode?: string;
	/** Defaults to `[]` (default variant slot). */
	variants?: string[];
	/** Defaults to `false`. */
	important?: boolean;
};

/**
 * Set or replace the color class for `(property, mode, variants)`.
 *
 * - When a class already exists in that slot, it is replaced **in
 *   place** so unrelated classes keep their position.
 * - Otherwise, the new class is appended at the end of the className
 *   string (Tailwind's "later wins" cascade order).
 */
export function setColor(
	model: PropertyModel,
	mutation: ColorMutation,
	options: ModelOptions,
): PropertyModel {
	const newRaw = formatColorClass(mutation);
	const mode = mutation.mode ?? DEFAULT_MODE;
	const variantKey = (mutation.variants ?? []).join(":");
	const existing = model.byMode[mode]?.byProperty[mutation.property]?.[
		variantKey
	];

	const newRaws = model.original.map((p) => p.raw);
	if (existing) {
		newRaws[existing.originalIndex] = newRaw;
	} else {
		newRaws.push(newRaw);
	}
	return buildPropertyModel(newRaws.join(" "), options);
}

/**
 * Remove the color class for `(property, mode, variants)`.
 * No-op when the slot is empty.
 */
export function clearColor(
	model: PropertyModel,
	property: ColorProperty,
	options: ModelOptions,
	target: { mode?: string; variants?: string[] } = {},
): PropertyModel {
	const mode = target.mode ?? DEFAULT_MODE;
	const variantKey = (target.variants ?? []).join(":");
	const existing = model.byMode[mode]?.byProperty[property]?.[variantKey];
	if (!existing) return model;
	const newRaws = model.original
		.filter((_, i) => i !== existing.originalIndex)
		.map((p) => p.raw);
	return buildPropertyModel(newRaws.join(" "), options);
}

const COLOR_PROPERTY_TO_PREFIX: Record<ColorProperty, string> = {
	background: "bg",
	text: "text",
	border: "border",
	ring: "ring",
	outline: "outline",
	fill: "fill",
	stroke: "stroke",
	accent: "accent",
	caret: "caret",
	placeholder: "placeholder",
	decoration: "decoration",
	divide: "divide",
	shadow: "shadow",
	"inset-shadow": "inset-shadow",
	"gradient-from": "from",
	"gradient-via": "via",
	"gradient-to": "to",
};

function formatColorClass(mutation: ColorMutation): string {
	const prefix = COLOR_PROPERTY_TO_PREFIX[mutation.property];
	const value = formatValue(mutation.value);
	const body = `${prefix}-${value}${mutation.important ? "!" : ""}`;
	const variantChain = [
		...(mutation.mode && mutation.mode.length > 0 ? [mutation.mode] : []),
		...(mutation.variants ?? []),
	];
	return variantChain.length > 0 ? `${variantChain.join(":")}:${body}` : body;
}

function formatValue(value: ColorValue): string {
	switch (value.kind) {
		case "token":
			return value.token;
		case "keyword":
			return value.keyword;
		case "arbitrary":
			return value.value.startsWith("[") ? value.value : `[${value.value}]`;
	}
}
