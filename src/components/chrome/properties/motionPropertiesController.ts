import type { ModelOptions, StyleProperty } from "../../../utils/tailwind-classname";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";

export { getStyleIntent, styleValueText };

/** Map a transition-property slot value to its utility body. */
export function transitionPropertyUtility(value: string): string {
	if (value === "DEFAULT") return "transition";
	if (value === "none") return "transition-none";
	return `transition-${value}`;
}

/** Map a motion slot value to its Tailwind utility body. */
export function motionUtility(property: StyleProperty, value: string): string {
	if (value.startsWith("[") || value.startsWith("(")) {
		switch (property) {
			case "motion.transition-property":
				return `transition-${value}`;
			case "motion.duration":
				return `duration-${value}`;
			case "motion.delay":
				return `delay-${value}`;
			case "motion.easing":
				return `ease-${value}`;
			case "motion.animation":
				return `animate-${value}`;
			default:
				return value;
		}
	}

	switch (property) {
		case "motion.transition-property":
			return transitionPropertyUtility(value);
		case "motion.duration":
			return `duration-${value}`;
		case "motion.delay":
			return `delay-${value}`;
		case "motion.easing":
			return `ease-${value}`;
		case "motion.animation":
			return value === "none" ? "animate-none" : `animate-${value}`;
		default:
			return value;
	}
}

/** Segmented/display value for transition-property (DEFAULT → default). */
export function readTransitionPropertyValue(
	className: string,
	options: ModelOptions,
): string | null {
	const raw = styleValueText(
		getStyleIntent(className, options, "motion.transition-property"),
	);
	if (!raw) return null;
	return raw === "DEFAULT" ? "default" : raw;
}

/** Apply a ValueField input for duration, delay, easing, or animation. */
export function applyMotionInput(
	className: string,
	options: ModelOptions,
	property: StyleProperty,
	input: string,
): string {
	const trimmed = input.trim();
	if (!trimmed) return clearStyleProperty(className, options, property);
	return applyStyleUtility(className, options, property, motionUtility(property, trimmed));
}

/** Return the display string for a motion property slot. */
export function readMotionValue(
	className: string,
	options: ModelOptions,
	property: StyleProperty,
): string {
	return styleValueText(getStyleIntent(className, options, property)) ?? "";
}
