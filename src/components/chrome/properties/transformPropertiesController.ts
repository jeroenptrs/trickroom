import type { ModelOptions, StyleProperty } from "../../../utils/tailwind-classname";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";

export { getStyleIntent, styleValueText };

/**
 * Apply a ValueField input for a transform property that supports negatives
 * (translate-x/y, rotate, skew-x/y). Clears when input is empty.
 */
export function applyTransformInput(
	className: string,
	options: ModelOptions,
	property: StyleProperty,
	prefix: string,
	input: string,
): string {
	const trimmed = input.trim();
	if (!trimmed) return clearStyleProperty(className, options, property);

	const negative = trimmed.startsWith("-");
	const value = negative ? trimmed.slice(1).trim() : trimmed;
	if (!value) return clearStyleProperty(className, options, property);

	const utility = `${prefix}-${value}`;
	return applyStyleUtility(className, options, property, utility, { negative });
}

/** Utility body for transform override slots (negative encoded in the class body). */
export function transformUtilityFromInput(
	prefix: string,
	input: string,
): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("-")) {
		const value = trimmed.slice(1).trim();
		if (!value) return null;
		return `-${prefix}-${value}`;
	}
	return `${prefix}-${trimmed}`;
}

/** Map a transform-mode option value to its utility body. */
export function transformModeUtility(value: string): string {
	if (value === "transform") return "transform";
	if (value === "none") return "transform-none";
	return `transform-${value}`;
}

/** Return the display string for a transform property slot. */
export function readTransformValue(
	className: string,
	options: ModelOptions,
	property: StyleProperty,
): string {
	return styleValueText(getStyleIntent(className, options, property)) ?? "";
}
