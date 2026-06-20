import { describe, expect, it } from "vitest";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";
import { effectsUtility } from "./effectsPropertiesController";

const opts = { colorTokens: new Set(["red-500"]) };

describe("effectsPropertiesController", () => {
	it("writes shadow size without clobbering shadow color", () => {
		const next = applyStyleUtility(
			"shadow-red-500 blur-md unknown-card",
			opts,
			"effects.shadow",
			effectsUtility("effects.shadow", "lg"),
		);
		expect(next).toBe("shadow-red-500 blur-md unknown-card shadow-lg");
	});

	it("replaces only the targeted effects slot", () => {
		const next = applyStyleUtility(
			"shadow-lg opacity-50 blur-md",
			opts,
			"effects.opacity",
			effectsUtility("effects.opacity", "75"),
		);
		expect(next).toBe("shadow-lg opacity-75 blur-md");
	});

	it("clears one effects property without touching unrelated classes", () => {
		expect(
			clearStyleProperty("shadow-lg blur-md shadow-red-500", opts, "effects.shadow"),
		).toBe("blur-md shadow-red-500");
	});

	it("reads active effects values", () => {
		expect(
			styleValueText(getStyleIntent("shadow-lg opacity-50", opts, "effects.shadow")),
		).toBe("lg");
		expect(
			styleValueText(getStyleIntent("shadow-lg opacity-50", opts, "effects.opacity")),
		).toBe("50");
	});
});
