import { describe, expect, it } from "vitest";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";

const opts = { colorTokens: new Set<string>() };

describe("border domain — styleSectionController helpers", () => {
	describe("border-width", () => {
		it("sets border (DEFAULT) without touching other classes", () => {
			const next = applyStyleUtility(
				"text-sm unknown",
				opts,
				"border.border-width",
				"border",
			);
			expect(next).toBe("text-sm unknown border");
		});

		it("replaces border width slot exactly", () => {
			const next = applyStyleUtility(
				"border-2 text-sm",
				opts,
				"border.border-width",
				"border-4",
			);
			expect(next).toBe("border-4 text-sm");
		});

		it("replaces bare 'border' with 'border-2'", () => {
			const next = applyStyleUtility(
				"border rounded-md",
				opts,
				"border.border-width",
				"border-2",
			);
			expect(next).toBe("border-2 rounded-md");
		});

		it("clears border-width without affecting border-style or radius", () => {
			expect(
				clearStyleProperty(
					"border-2 border-solid rounded-lg",
					opts,
					"border.border-width",
				),
			).toBe("border-solid rounded-lg");
		});

		it("reads border-width value: DEFAULT for bare border", () => {
			expect(
				styleValueText(
					getStyleIntent("border text-sm", opts, "border.border-width"),
				),
			).toBe("DEFAULT");
		});

		it("reads border-width value: scale for border-2", () => {
			expect(
				styleValueText(getStyleIntent("border-2", opts, "border.border-width")),
			).toBe("2");
		});
	});

	describe("border-style", () => {
		it("sets border-style without touching border-width", () => {
			const next = applyStyleUtility(
				"border-2 unknown",
				opts,
				"border.border-style",
				"border-dashed",
			);
			expect(next).toBe("border-2 unknown border-dashed");
		});

		it("replaces border-style exactly", () => {
			const next = applyStyleUtility(
				"border-solid border-2",
				opts,
				"border.border-style",
				"border-dotted",
			);
			expect(next).toBe("border-dotted border-2");
		});

		it("border-width and border-style are separate slots", () => {
			const withWidth = applyStyleUtility(
				"unknown",
				opts,
				"border.border-width",
				"border-2",
			);
			const withStyle = applyStyleUtility(
				withWidth,
				opts,
				"border.border-style",
				"border-dashed",
			);
			expect(withStyle).toBe("unknown border-2 border-dashed");
		});
	});

	describe("border-width does not affect border-color", () => {
		it("editing border-width preserves color classes (unmanaged)", () => {
			const next = applyStyleUtility(
				"border border-red-500 unknown",
				opts,
				"border.border-width",
				"border-2",
			);
			expect(next).toBe("border-2 border-red-500 unknown");
		});
	});

	describe("radius", () => {
		it("sets bare overall radius", () => {
			const next = applyStyleUtility(
				"border-2",
				opts,
				"border.radius",
				"rounded",
			);
			expect(next).toBe("border-2 rounded");
			expect(styleValueText(getStyleIntent(next, opts, "border.radius"))).toBe(
				"DEFAULT",
			);
		});

		it("sets overall radius", () => {
			const next = applyStyleUtility(
				"border-2",
				opts,
				"border.radius",
				"rounded-md",
			);
			expect(next).toBe("border-2 rounded-md");
		});

		it("replaces overall radius without touching per-corner slots", () => {
			const next = applyStyleUtility(
				"rounded-lg rounded-tl-xl",
				opts,
				"border.radius",
				"rounded-full",
			);
			expect(next).toBe("rounded-full rounded-tl-xl");
		});

		it("per-corner slots are independent of overall radius", () => {
			const next = applyStyleUtility(
				"rounded-md border-2",
				opts,
				"border.radius-top-left",
				"rounded-tl-xl",
			);
			expect(next).toBe("rounded-md border-2 rounded-tl-xl");
		});

		it("clears radius without touching border-width", () => {
			expect(
				clearStyleProperty("border-2 rounded-lg", opts, "border.radius"),
			).toBe("border-2");
		});

		it("reads radius keyword value", () => {
			expect(
				styleValueText(
					getStyleIntent("rounded-md border-2", opts, "border.radius"),
				),
			).toBe("md");
			expect(
				styleValueText(getStyleIntent("rounded-full", opts, "border.radius")),
			).toBe("full");
			expect(getStyleIntent("border-2", opts, "border.radius")).toBeUndefined();
		});
	});

	describe("divide utilities", () => {
		it("sets divide-x without touching divide-y", () => {
			const next = applyStyleUtility(
				"divide-y-2 unknown",
				opts,
				"border.divide-x-width",
				"divide-x",
			);
			expect(next).toBe("divide-y-2 unknown divide-x");
		});

		it("divide-x and divide-y are separate slots", () => {
			const withX = applyStyleUtility(
				"unknown",
				opts,
				"border.divide-x-width",
				"divide-x-2",
			);
			const withY = applyStyleUtility(
				withX,
				opts,
				"border.divide-y-width",
				"divide-y-4",
			);
			expect(withY).toBe("unknown divide-x-2 divide-y-4");
		});

		it("divide does not collide with border-width", () => {
			const next = applyStyleUtility(
				"border-2 divide-x",
				opts,
				"border.divide-x-width",
				"divide-x-4",
			);
			expect(next).toBe("border-2 divide-x-4");
		});

		it("divide-x DEFAULT value read correctly", () => {
			expect(
				styleValueText(
					getStyleIntent("divide-x border-2", opts, "border.divide-x-width"),
				),
			).toBe("DEFAULT");
		});
	});

	describe("unknown classes round-trip", () => {
		it("unknown classes are preserved when editing border properties", () => {
			const next = applyStyleUtility(
				"unknown-card cool-class rounded-tl-sm",
				opts,
				"border.border-width",
				"border-2",
			);
			expect(next).toBe("unknown-card cool-class rounded-tl-sm border-2");
		});
	});
});
