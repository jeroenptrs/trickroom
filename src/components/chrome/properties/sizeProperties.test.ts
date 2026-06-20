import { describe, expect, it } from "vitest";
import {
	applySizeInput,
	inputToSizeUtility,
	readSizeValue,
} from "./sizePropertiesController";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";

const opts = { colorTokens: new Set<string>() };

describe("sizePropertiesController", () => {
	describe("inputToSizeUtility", () => {
		it("builds a utility body from prefix and input", () => {
			expect(inputToSizeUtility("w", "4")).toBe("w-4");
			expect(inputToSizeUtility("h", "full")).toBe("h-full");
			expect(inputToSizeUtility("min-w", "[200px]")).toBe("min-w-[200px]");
			expect(inputToSizeUtility("max-w", "(--my-var)")).toBe(
				"max-w-(--my-var)",
			);
		});

		it("returns null for empty input", () => {
			expect(inputToSizeUtility("w", "")).toBeNull();
			expect(inputToSizeUtility("w", "   ")).toBeNull();
		});
	});

	describe("applySizeInput", () => {
		it("sets a width utility and preserves other classes", () => {
			const result = applySizeInput(
				"h-4 unknown-card",
				opts,
				"size.width",
				"w",
				"full",
			);
			expect(result).toBe("h-4 unknown-card w-full");
		});

		it("clears the property when input is empty", () => {
			const result = applySizeInput("w-4 h-8", opts, "size.width", "w", "");
			expect(result).toBe("h-8");
		});
	});

	describe("readSizeValue", () => {
		it("returns the scale value string for a size class", () => {
			expect(readSizeValue("w-4 h-8", opts, "size.width")).toBe("4");
			expect(readSizeValue("w-4 h-8", opts, "size.height")).toBe("8");
		});

		it("returns empty string when the property is unset", () => {
			expect(readSizeValue("h-8", opts, "size.width")).toBe("");
		});

		it("returns arbitrary value display string", () => {
			expect(readSizeValue("w-[200px]", opts, "size.width")).toBe("[200px]");
		});
	});
});

describe("size domain — shared styleSectionController helpers", () => {
	it("sets width without touching height", () => {
		const next = applyStyleUtility(
			"h-4 unknown-cls",
			opts,
			"size.width",
			"w-full",
		);
		expect(next).toBe("h-4 unknown-cls w-full");
	});

	it("replaces width slot exactly, leaving height and unknown classes intact", () => {
		const next = applyStyleUtility(
			"w-4 h-8 text-sm",
			opts,
			"size.width",
			"w-full",
		);
		expect(next).toBe("w-full h-8 text-sm");
	});

	it("clears width without touching height or unrelated classes", () => {
		expect(clearStyleProperty("w-4 h-8 unknown", opts, "size.width")).toBe(
			"h-8 unknown",
		);
	});

	it("sets height independently of width", () => {
		const next = applyStyleUtility(
			"w-full h-4",
			opts,
			"size.height",
			"h-screen",
		);
		expect(next).toBe("w-full h-screen");
	});

	it("min-w and max-w occupy separate slots", () => {
		const afterMin = applyStyleUtility(
			"max-w-lg unknown",
			opts,
			"size.min-width",
			"min-w-0",
		);
		expect(afterMin).toBe("max-w-lg unknown min-w-0");
		const afterMax = applyStyleUtility(
			afterMin,
			opts,
			"size.max-width",
			"max-w-xl",
		);
		expect(afterMax).toBe("max-w-xl unknown min-w-0");
	});

	it("size (square) is a separate slot from w and h", () => {
		const next = applyStyleUtility("w-4 h-4", opts, "size.size", "size-8");
		expect(next).toBe("w-4 h-4 size-8");
	});

	it("flex-1 and flex-row do not collide", () => {
		const withRow = applyStyleUtility("flex-row", opts, "size.flex", "flex-1");
		expect(withRow).toBe("flex-row flex-1");
	});

	it("grow and shrink are separate slots", () => {
		const next = applyStyleUtility(
			"grow shrink-0 w-4",
			opts,
			"size.grow",
			"grow-0",
		);
		expect(next).toBe("grow-0 shrink-0 w-4");
	});

	it("unknown classes round-trip unchanged when setting a size property", () => {
		const next = applyStyleUtility(
			"unknown-card cool-class",
			opts,
			"size.width",
			"w-4",
		);
		expect(next).toBe("unknown-card cool-class w-4");
	});

	it("reads grow value correctly", () => {
		expect(styleValueText(getStyleIntent("grow w-4", opts, "size.grow"))).toBe(
			"1",
		);
		expect(
			styleValueText(getStyleIntent("grow-0 w-4", opts, "size.grow")),
		).toBe("0");
		expect(getStyleIntent("w-4", opts, "size.grow")).toBeUndefined();
	});

	it("reads flex value correctly", () => {
		expect(styleValueText(getStyleIntent("flex-1", opts, "size.flex"))).toBe(
			"1",
		);
		expect(styleValueText(getStyleIntent("flex-auto", opts, "size.flex"))).toBe(
			"auto",
		);
		expect(styleValueText(getStyleIntent("flex-none", opts, "size.flex"))).toBe(
			"none",
		);
	});
});
