/**
 * `PropertyModel` is the editing-friendly view over a parsed className
 * string. It groups every recognised utility class by `(mode, property,
 * variantKey)` while keeping the original ordered list around so we
 * can serialize back to the className string without churn.
 *
 * Mutation helpers (`setColor`, `clearColor`, `setSpacing`, …) return a
 * fresh model. Their philosophy is "edit minimally, then re-derive
 * everything", which keeps the model in lock-step with the canonical
 * className string at all times.
 */

import {
	type ClassifyContext,
	type ColorProperty,
	classifyParsedClass,
	type KnownUtilityIntent,
} from "./classify";
import {
	type ParseClassNameOptions,
	type ParsedClass,
	parseClassName,
} from "./parse";
import {
	DEFAULT_MODE,
	formatWithVariantChain,
	removeRawAtIndex,
	replaceOrAppendRaw,
	resolveSlotTarget,
	type SlotTarget,
	slotKeysFromParsed,
} from "./slots";
import {
	SPACING_PROPERTY_TO_PREFIX,
	type SpacingProperty,
	type SpacingValue,
} from "./spacing";
import type { StyleProperty } from "./style";

export type {
	ColorIntent,
	ColorProperty,
	KnownUtilityIntent,
	StyleIntent,
	StyleProperty,
	StyleUtilityDomain,
} from "./classify";
export type { ParsedClass } from "./parse";
export type { SpacingIntent, SpacingProperty, SpacingValue } from "./spacing";

/**
 * Semantic property slots modeled by the className editor. Each key maps
 * to one Tailwind utility family and is scoped further by mode and variant.
 */
export type PropertyKey = ColorProperty | SpacingProperty | StyleProperty;

export type PropertyEntry = {
	parsed: ParsedClass;
	intent: KnownUtilityIntent;
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
	/** Classes that did not classify as a known utility domain. */
	unknown: ParsedClass[];
	/** All parsed classes in original order. */
	original: ParsedClass[];
};

export type ModelOptions = ParseClassNameOptions & ClassifyContext;

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
		if (intent.kind === "unknown") {
			unknown.push(parsed);
			return;
		}
		const { modeKey, variantKey } = slotKeysFromParsed(parsed);
		byMode[modeKey] ??= { byProperty: {} };
		const bucket = byMode[modeKey];
		bucket.byProperty[intent.property] ??= {};
		const slot = bucket.byProperty[intent.property];
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
} & SlotTarget & {
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
	return applyPropertyMutation(
		model,
		mutation.property,
		formatColorClass(mutation),
		mutation,
		options,
	);
}

/**
 * Remove the color class for `(property, mode, variants)`.
 * No-op when the slot is empty.
 */
export function clearColor(
	model: PropertyModel,
	property: ColorProperty,
	options: ModelOptions,
	target: SlotTarget = {},
): PropertyModel {
	return clearPropertyMutation(model, property, target, options);
}

export type SpacingMutation = {
	property: SpacingProperty;
	value: SpacingValue;
} & SlotTarget & {
		/** Defaults to `false`. Only valid for margin utilities. */
		negative?: boolean;
		/** Defaults to `false`. */
		important?: boolean;
	};

/**
 * Set or replace the spacing class for `(property, mode, variants)`.
 *
 * The first spacing slice intentionally replaces only exact property
 * slots. For example, editing `padding-x` replaces `px-*` but preserves
 * an existing `p-*` shorthand so user-authored cascade remains stable.
 */
export function setSpacing(
	model: PropertyModel,
	mutation: SpacingMutation,
	options: ModelOptions,
): PropertyModel {
	return applyPropertyMutation(
		model,
		mutation.property,
		formatSpacingClass(mutation),
		mutation,
		options,
	);
}

/**
 * Remove the spacing class for `(property, mode, variants)`.
 * No-op when the exact slot is empty.
 */
export function clearSpacing(
	model: PropertyModel,
	property: SpacingProperty,
	options: ModelOptions,
	target: SlotTarget = {},
): PropertyModel {
	return clearPropertyMutation(model, property, target, options);
}

export type StyleMutation = {
	property: StyleProperty;
	/**
	 * Utility body without mode/variant prefixes, e.g. `flex`, `w-4`,
	 * `border-2`, `text-sm`, or `mask-linear-45`.
	 */
	utility: string;
} & SlotTarget & {
		/** Defaults to `false`. */
		negative?: boolean;
		/** Defaults to `false`. */
		important?: boolean;
	};

export function setStyle(
	model: PropertyModel,
	mutation: StyleMutation,
	options: ModelOptions,
): PropertyModel {
	return applyPropertyMutation(
		model,
		mutation.property,
		formatStyleClass(mutation),
		mutation,
		options,
	);
}

export function clearStyle(
	model: PropertyModel,
	property: StyleProperty,
	options: ModelOptions,
	target: SlotTarget = {},
): PropertyModel {
	return clearPropertyMutation(model, property, target, options);
}

function applyPropertyMutation(
	model: PropertyModel,
	property: PropertyKey,
	newRaw: string,
	target: SlotTarget,
	options: ModelOptions,
): PropertyModel {
	const { modeKey, variantKey } = resolveSlotTarget(target);
	const existing = model.byMode[modeKey]?.byProperty[property]?.[variantKey];
	const newRaws = replaceOrAppendRaw(
		model.original.map((p) => p.raw),
		existing?.originalIndex,
		newRaw,
	);
	return buildPropertyModel(newRaws.join(" "), options);
}

function clearPropertyMutation(
	model: PropertyModel,
	property: PropertyKey,
	target: SlotTarget,
	options: ModelOptions,
): PropertyModel {
	const { modeKey, variantKey } = resolveSlotTarget(target);
	const existing = model.byMode[modeKey]?.byProperty[property]?.[variantKey];
	if (!existing) return model;
	const newRaws = removeRawAtIndex(
		model.original.map((p) => p.raw),
		existing.originalIndex,
	);
	return buildPropertyModel(newRaws.join(" "), options);
}

const COLOR_PROPERTY_TO_PREFIX: Record<ColorProperty, string> = {
	background: "bg",
	text: "text",
	border: "border",
	ring: "ring",
	"ring-offset": "ring-offset",
	outline: "outline",
	fill: "fill",
	stroke: "stroke",
	"text-shadow": "text-shadow",
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
	const value = formatColorValue(mutation.value);
	const body = `${prefix}-${value}${mutation.important ? "!" : ""}`;
	return formatWithVariantChain(body, mutation);
}

function formatSpacingClass(mutation: SpacingMutation): string {
	const prefix = SPACING_PROPERTY_TO_PREFIX[mutation.property];
	const value = formatSpacingValue(mutation.value);
	const negative = mutation.negative ? "-" : "";
	const body = `${negative}${prefix}-${value}${mutation.important ? "!" : ""}`;
	return formatWithVariantChain(body, mutation);
}

function formatStyleClass(mutation: StyleMutation): string {
	const negative = mutation.negative ? "-" : "";
	const body = `${negative}${mutation.utility}${mutation.important ? "!" : ""}`;
	return formatWithVariantChain(body, mutation);
}

function formatSpacingValue(value: SpacingValue): string {
	switch (value.kind) {
		case "scale":
			return value.value;
		case "keyword":
			return value.keyword;
		case "arbitrary":
			return value.value.startsWith("[") ? value.value : `[${value.value}]`;
		case "custom-property":
			return value.value.startsWith("(") ? value.value : `(${value.value})`;
	}
}

function formatColorValue(value: ColorValue): string {
	switch (value.kind) {
		case "token":
			return value.token;
		case "keyword":
			return value.keyword;
		case "arbitrary":
			return value.value.startsWith("[") ? value.value : `[${value.value}]`;
	}
}
