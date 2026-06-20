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
 * Apply a ValueField input for an inset-type property (top/right/bottom/left/inset*).
 * Handles negative values (leading "-") and clears the property when input is empty.
 */
export function applyInsetInput(
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

/** Utility body for inset override slots (negative encoded in the class body). */
export function insetUtilityFromInput(
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

/** Utility body for z-index override slots. */
export function zIndexUtilityFromInput(input: string): string | null {
	const trimmed = input.trim();
	return trimmed ? `z-${trimmed}` : null;
}

/** Apply a z-index ValueField input (no negative needed). */
export function applyZIndexInput(
	className: string,
	options: ModelOptions,
	input: string,
): string {
	const trimmed = input.trim();
	if (!trimmed)
		return clearStyleProperty(className, options, "position.z-index");
	return applyStyleUtility(
		className,
		options,
		"position.z-index",
		`z-${trimmed}`,
	);
}

/** Return the display string for a position slot. */
export function readPositionValue(
	className: string,
	options: ModelOptions,
	property: StyleProperty,
): string {
	return styleValueText(getStyleIntent(className, options, property)) ?? "";
}
