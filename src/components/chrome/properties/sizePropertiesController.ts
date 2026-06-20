import type {
	ModelOptions,
	StyleProperty,
} from "../../../utils/tailwind-classname";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";

export { getStyleIntent, styleValueText };

/**
 * Convert a ValueField input string and a Tailwind prefix to a utility body.
 * Returns null when the input is empty or a stray/negative value (sizes have
 * no negative utilities), so the caller clears the property instead of
 * emitting an invalid class like `w--` or `w--4`.
 */
export function inputToSizeUtility(
	prefix: string,
	input: string,
): string | null {
	const trimmed = input.trim();
	if (!trimmed || trimmed.startsWith("-")) {
		return null;
	}
	return `${prefix}-${trimmed}`;
}

/** Apply a size ValueField input; clears the property when input is empty. */
export function applySizeInput(
	className: string,
	options: ModelOptions,
	property: StyleProperty,
	prefix: string,
	input: string,
): string {
	const utility = inputToSizeUtility(prefix, input);
	if (!utility) return clearStyleProperty(className, options, property);
	return applyStyleUtility(className, options, property, utility);
}

/** Return the display string for a size property slot (empty string when unset). */
export function readSizeValue(
	className: string,
	options: ModelOptions,
	property: StyleProperty,
): string {
	return styleValueText(getStyleIntent(className, options, property)) ?? "";
}
