import { describe, expect, it } from "vitest";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";
import {
	applyMotionInput,
	motionUtility,
	readMotionValue,
	readTransitionPropertyValue,
} from "./motionPropertiesController";

const opts = { colorTokens: new Set(["red-500"]) };

describe("motionPropertiesController", () => {
	it("writes duration without clobbering easing or animation", () => {
		const next = applyStyleUtility(
			"ease-in-out animate-spin unknown-card",
			opts,
			"motion.duration",
			motionUtility("motion.duration", "300"),
		);
		expect(next).toBe("ease-in-out animate-spin unknown-card duration-300");
	});

	it("replaces only the targeted motion slot", () => {
		const next = applyStyleUtility(
			"duration-300 delay-150 ease-out",
			opts,
			"motion.delay",
			motionUtility("motion.delay", "75"),
		);
		expect(next).toBe("duration-300 delay-75 ease-out");
	});

	it("writes arbitrary transition-property utilities", () => {
		expect(motionUtility("motion.transition-property", "[color,transform]")).toBe(
			"transition-[color,transform]",
		);
	});

	it("clears one motion property without touching unrelated classes", () => {
		expect(
			clearStyleProperty(
				"transition-colors duration-300 ease-in animate-pulse",
				opts,
				"motion.duration",
			),
		).toBe("transition-colors ease-in animate-pulse");
	});

	it("reads active motion values and preserves unknown classes on round-trip", () => {
		const input = "transition-all duration-500 delay-100 ease-linear animate-bounce custom-motion";
		expect(readTransitionPropertyValue(input, opts)).toBe("all");
		expect(readMotionValue(input, opts, "motion.duration")).toBe("500");
		expect(readMotionValue(input, opts, "motion.delay")).toBe("100");
		expect(readMotionValue(input, opts, "motion.easing")).toBe("linear");
		expect(readMotionValue(input, opts, "motion.animation")).toBe("bounce");

		const next = applyMotionInput(input, opts, "motion.easing", "in-out");
		expect(next).toBe(
			"transition-all duration-500 delay-100 ease-in-out animate-bounce custom-motion",
		);
		expect(
			styleValueText(getStyleIntent(next, opts, "motion.easing")),
		).toBe("in-out");
	});
});
