import { describe, expect, it } from "vitest";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";
import { focusUtility } from "./focusPropertiesController";

const opts = { colorTokens: new Set(["blue-500"]) };

describe("focusPropertiesController", () => {
	it("writes ring width without clobbering ring color", () => {
		const next = applyStyleUtility(
			"ring-blue-500 outline-2 unknown-card",
			opts,
			"focus.ring-width",
			focusUtility("focus.ring-width", "2"),
		);
		expect(next).toBe("ring-blue-500 outline-2 unknown-card ring-2");
	});

	it("replaces only the targeted focus slot", () => {
		const next = applyStyleUtility(
			"ring-2 ring-offset-2 ring-blue-500",
			opts,
			"focus.ring-offset",
			focusUtility("focus.ring-offset", "4"),
		);
		expect(next).toBe("ring-2 ring-offset-4 ring-blue-500");
	});

	it("clears one focus property without touching unrelated classes", () => {
		expect(
			clearStyleProperty("ring-2 outline-dashed ring-blue-500", opts, "focus.ring-width"),
		).toBe("outline-dashed ring-blue-500");
	});

	it("reads active focus values", () => {
		expect(
			styleValueText(getStyleIntent("ring-2 outline-dashed", opts, "focus.ring-width")),
		).toBe("2");
		expect(
			styleValueText(
				getStyleIntent("ring-2 outline-dashed", opts, "focus.outline-style"),
			),
		).toBe("dashed");
	});
});
