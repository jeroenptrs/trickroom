import { describe, expect, it } from "vitest";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";
import {
	applyInsetInput,
	applyZIndexInput,
	readPositionValue,
} from "./positionPropertiesController";

const opts = { colorTokens: new Set<string>() };

describe("positionPropertiesController", () => {
	describe("applyInsetInput", () => {
		it("applies a numeric inset value", () => {
			expect(applyInsetInput("text-sm", opts, "position.top", "top", "4")).toBe(
				"text-sm top-4",
			);
		});

		it("applies a negative top value", () => {
			const result = applyInsetInput("h-4", opts, "position.top", "top", "-4");
			expect(result).toBe("h-4 -top-4");
		});

		it("applies an arbitrary top value", () => {
			expect(applyInsetInput("h-4", opts, "position.top", "top", "[13px]")).toBe(
				"h-4 top-[13px]",
			);
		});

		it("clears the property when input is empty", () => {
			expect(applyInsetInput("top-4 h-4", opts, "position.top", "top", "")).toBe("h-4");
		});

		it("clears when input is only a dash", () => {
			expect(applyInsetInput("top-4 h-4", opts, "position.top", "top", "-")).toBe("h-4");
		});
	});

	describe("applyZIndexInput", () => {
		it("sets z-index", () => {
			expect(applyZIndexInput("text-sm", opts, "10")).toBe("text-sm z-10");
		});

		it("clears z-index when empty", () => {
			expect(applyZIndexInput("z-10 text-sm", opts, "")).toBe("text-sm");
		});

		it("supports z-auto", () => {
			expect(applyZIndexInput("", opts, "auto")).toBe("z-auto");
		});
	});

	describe("readPositionValue", () => {
		it("returns the position keyword", () => {
			expect(readPositionValue("absolute top-4", opts, "position.position")).toBe("absolute");
		});

		it("returns empty string when unset", () => {
			expect(readPositionValue("text-sm", opts, "position.top")).toBe("");
		});
	});
});

describe("position domain — styleSectionController helpers", () => {
	describe("position keyword", () => {
		it("sets position and preserves other classes", () => {
			const next = applyStyleUtility("text-sm unknown", opts, "position.position", "absolute");
			expect(next).toBe("text-sm unknown absolute");
		});

		it("replaces position slot exactly", () => {
			const next = applyStyleUtility("relative top-4 unknown", opts, "position.position", "absolute");
			expect(next).toBe("absolute top-4 unknown");
		});

		it("clears position without touching inset", () => {
			expect(clearStyleProperty("absolute top-4 unknown", opts, "position.position")).toBe(
				"top-4 unknown",
			);
		});
	});

	describe("inset slots are independent", () => {
		it("top and inset are separate slots", () => {
			const withInset = applyStyleUtility("unknown", opts, "position.inset", "inset-4");
			const withTop = applyStyleUtility(withInset, opts, "position.top", "top-2");
			expect(withTop).toBe("unknown inset-4 top-2");
		});

		it("editing top does not remove bottom", () => {
			const next = applyStyleUtility("top-4 bottom-4", opts, "position.top", "top-8");
			expect(next).toBe("top-8 bottom-4");
		});

		it("inset-x and inset-y are separate slots", () => {
			const withX = applyStyleUtility("unknown", opts, "position.inset-x", "inset-x-4");
			const withY = applyStyleUtility(withX, opts, "position.inset-y", "inset-y-2");
			expect(withY).toBe("unknown inset-x-4 inset-y-2");
		});
	});

	describe("z-index", () => {
		it("z-10 and z-auto classify correctly", () => {
			expect(styleValueText(getStyleIntent("z-10", opts, "position.z-index"))).toBe("10");
			expect(styleValueText(getStyleIntent("z-auto", opts, "position.z-index"))).toBe("auto");
		});

		it("editing z-index does not affect position", () => {
			const next = applyStyleUtility("absolute z-10", opts, "position.z-index", "z-50");
			expect(next).toBe("absolute z-50");
		});
	});

	describe("object-fit and object-position", () => {
		it("object-cover classifies as object-fit", () => {
			expect(
				styleValueText(getStyleIntent("object-cover", opts, "position.object-fit")),
			).toBe("cover");
		});

		it("object-center classifies as object-position", () => {
			expect(
				styleValueText(getStyleIntent("object-center", opts, "position.object-position")),
			).toBe("center");
		});

		it("object-fit and object-position are separate slots", () => {
			const withFit = applyStyleUtility("unknown", opts, "position.object-fit", "object-cover");
			const withPos = applyStyleUtility(withFit, opts, "position.object-position", "object-top");
			expect(withPos).toBe("unknown object-cover object-top");
		});
	});

	describe("unknown classes round-trip", () => {
		it("unknown classes preserved when editing position properties", () => {
			const next = applyStyleUtility("unknown-card top-4", opts, "position.position", "absolute");
			expect(next).toBe("unknown-card top-4 absolute");
		});
	});
});
