import {
	buildPropertyModel,
	clearStyle,
	type ModelOptions,
	type PropertyEntry,
	type StyleIntent,
	type StyleProperty,
	serialize,
	setStyle,
} from "../../../utils/tailwind-classname";

const DEFAULT_MODE = "";
const DEFAULT_VARIANT = "";

/**
 * Shared controller helpers for every Style-tab section built on the unified
 * `style` utility domain (see src/utils/tailwind-classname/style.ts). Section
 * components stay declarative: map a chosen value to a Tailwind utility body
 * and let these helpers drive `setStyle` / `clearStyle` against the exact
 * `(mode, property, variant)` slot. Unknown classes round-trip unchanged.
 */
export function getStyleEntry(
	className: string,
	options: ModelOptions,
	property: StyleProperty,
	variants: readonly string[] = [],
): PropertyEntry | undefined {
	const model = buildPropertyModel(className, options);
	const variantKey = variants.join(":") || DEFAULT_VARIANT;
	const entry = model.byMode[DEFAULT_MODE]?.byProperty[property]?.[variantKey];
	return entry?.intent.kind === "style" ? entry : undefined;
}

export function getStyleIntent(
	className: string,
	options: ModelOptions,
	property: StyleProperty,
	variants: readonly string[] = [],
): StyleIntent | undefined {
	const entry = getStyleEntry(className, options, property, variants);
	return entry && entry.intent.kind === "style" ? entry.intent : undefined;
}

/**
 * Write `utility` (a Tailwind class body without mode/variant prefixes, e.g.
 * `flex`, `flex-row`, `w-4`, `text-sm`) into the slot for `property`. Pass
 * `variants` (e.g. `["hover"]`, `["md"]`, `["md","hover"]`) to target a
 * selector/breakpoint override slot; defaults to the base slot.
 */
export function applyStyleUtility(
	className: string,
	options: ModelOptions,
	property: StyleProperty,
	utility: string,
	mutationOptions: {
		variants?: string[];
		negative?: boolean;
		important?: boolean;
	} = {},
): string {
	const model = buildPropertyModel(className, options);
	const next = setStyle(
		model,
		{
			property,
			utility,
			variants: mutationOptions.variants,
			negative: mutationOptions.negative,
			important: mutationOptions.important,
		},
		options,
	);
	return serialize(next);
}

/**
 * Clear the slot for `property` in the given `variants` chain (base slot by
 * default). No-op when the slot is empty.
 */
export function clearStyleProperty(
	className: string,
	options: ModelOptions,
	property: StyleProperty,
	variants: string[] = [],
): string {
	const model = buildPropertyModel(className, options);
	const next = clearStyle(model, property, options, { variants });
	return serialize(next);
}

/**
 * Human-readable text for the current value of a style intent. Use for the
 * value summary shown on a collapsed section header and for matching the
 * active option of a segmented control.
 */
export function styleValueText(intent: StyleIntent | undefined): string | null {
	if (!intent) {
		return null;
	}
	const prefix = intent.negative ? "-" : "";
	switch (intent.value.kind) {
		case "none":
			return null;
		case "keyword":
			return intent.value.value;
		case "scale":
			return `${prefix}${intent.value.value}`;
		case "arbitrary":
		case "custom-property":
			return `${prefix}${intent.value.value}`;
	}
}
