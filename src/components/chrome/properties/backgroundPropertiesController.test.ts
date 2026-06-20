import { describe, expect, it } from "vitest";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";
import { backgroundUtility } from "./backgroundPropertiesController";

const opts = { colorTokens: new Set(["red-500"]) };

describe("backgroundPropertiesController", () => {
	it("writes background size without clobbering background color", () => {
		const next = applyStyleUtility(
			"bg-red-500 bg-center unknown-card",
			opts,
			"background.background-size",
			backgroundUtility("background.background-size", "cover"),
		);
		expect(next).toBe("bg-red-500 bg-center unknown-card bg-cover");
	});

	it("replaces only the targeted background slot", () => {
		const next = applyStyleUtility(
			"bg-cover bg-no-repeat bg-red-500",
			opts,
			"background.background-repeat",
			backgroundUtility("background.background-repeat", "repeat"),
		);
		expect(next).toBe("bg-cover bg-repeat bg-red-500");
	});

	it("clears one background property without touching unrelated classes", () => {
		expect(
			clearStyleProperty("bg-cover bg-red-500", opts, "background.background-size"),
		).toBe("bg-red-500");
	});

	it("reads active background values", () => {
		expect(
			styleValueText(
				getStyleIntent("bg-cover bg-fixed", opts, "background.background-size"),
			),
		).toBe("cover");
		expect(
			styleValueText(
				getStyleIntent("bg-cover bg-fixed", opts, "background.background-attachment"),
			),
		).toBe("fixed");
	});
});
