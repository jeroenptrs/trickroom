import { describe, expect, it } from "vitest";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";

const opts = { colorTokens: new Set(["red-500"]) };

describe("styleSectionController", () => {
	it("writes a utility into the exact property slot and preserves the rest", () => {
		const next = applyStyleUtility(
			"flex bg-red-500 unknown-card",
			opts,
			"layout.justify-content",
			"justify-between",
		);
		expect(next).toBe("flex bg-red-500 unknown-card justify-between");
	});

	it("replaces only the targeted slot, leaving sibling layout slots intact", () => {
		const next = applyStyleUtility(
			"flex flex-row justify-start",
			opts,
			"layout.flex-direction",
			"flex-col",
		);
		expect(next).toBe("flex flex-col justify-start");
	});

	it("clears one property without touching unrelated classes", () => {
		expect(
			clearStyleProperty("flex flex-col bg-red-500", opts, "layout.flex-direction"),
		).toBe("flex bg-red-500");
	});

	it("reads the active value for a property", () => {
		expect(
			styleValueText(getStyleIntent("flex flex-row", opts, "layout.display")),
		).toBe("flex");
		expect(
			styleValueText(
				getStyleIntent("flex flex-row", opts, "layout.flex-direction"),
			),
		).toBe("row");
		expect(
			getStyleIntent("flex", opts, "layout.justify-content"),
		).toBeUndefined();
	});

	it("targets selector/breakpoint override slots without touching base", () => {
		const withHover = applyStyleUtility(
			"flex",
			opts,
			"layout.flex-direction",
			"flex-col",
			{ variants: ["hover"] },
		);
		expect(withHover).toBe("flex hover:flex-col");

		const both = applyStyleUtility(
			withHover,
			opts,
			"layout.flex-direction",
			"flex-row",
		);
		expect(both).toBe("flex hover:flex-col flex-row");

		expect(
			styleValueText(
				getStyleIntent(both, opts, "layout.flex-direction", ["hover"]),
			),
		).toBe("col");
		expect(
			styleValueText(getStyleIntent(both, opts, "layout.flex-direction")),
		).toBe("row");

		// Clearing the hover override leaves the base slot intact.
		expect(
			clearStyleProperty(both, opts, "layout.flex-direction", ["hover"]),
		).toBe("flex flex-row");
	});
});
