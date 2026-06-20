import { describe, expect, it } from "vitest";
import {
	arbitraryTokenCandidate,
	filterTokenOptions,
	findTokenOption,
	formatPx,
	isArbitraryTokenValue,
	spacingScaleOptions,
	stepToken,
	type TokenFieldOption,
} from "./tokenFieldController";

const SCALE: TokenFieldOption[] = [
	{ value: "0", resolved: "0px" },
	{ value: "0.5", resolved: "2px" },
	{ value: "1", resolved: "4px" },
	{ value: "2", resolved: "8px" },
	{ value: "10", resolved: "40px" },
	{ value: "px", resolved: "1px" },
	{ value: "full", resolved: "100%" },
];

describe("tokenFieldController", () => {
	describe("spacingScaleOptions", () => {
		it("resolves px through the spacing multiplier", () => {
			const options = spacingScaleOptions(4);
			expect(findTokenOption(options, "2")).toEqual({
				value: "2",
				resolved: "8px",
			});
			expect(findTokenOption(options, "0.5")).toEqual({
				value: "0.5",
				resolved: "2px",
			});
		});

		it("omits the resolved column when the multiplier is unknown", () => {
			const options = spacingScaleOptions(null);
			expect(findTokenOption(options, "2")).toEqual({ value: "2" });
		});
	});

	describe("formatPx", () => {
		it("strips float noise", () => {
			expect(formatPx(8)).toBe("8px");
			expect(formatPx(8.333333)).toBe("8.33px");
		});
	});

	describe("filterTokenOptions", () => {
		it("returns every option for an empty query", () => {
			expect(filterTokenOptions(SCALE, "")).toEqual(SCALE);
			expect(filterTokenOptions(SCALE, "  ")).toEqual(SCALE);
		});

		it("ranks value prefix matches before substring and resolved matches", () => {
			const values = filterTokenOptions(SCALE, "1").map((o) => o.value);
			expect(values).toEqual(["1", "10", "px", "full"]);
		});

		it("matches the resolved column so px values find their token", () => {
			const values = filterTokenOptions(SCALE, "8px").map((o) => o.value);
			expect(values).toEqual(["2"]);
		});

		it("drops options that match nowhere", () => {
			expect(filterTokenOptions(SCALE, "zzz")).toEqual([]);
		});
	});

	describe("arbitraryTokenCandidate", () => {
		it("returns null for empty input", () => {
			expect(arbitraryTokenCandidate("")).toBeNull();
			expect(arbitraryTokenCandidate("  ")).toBeNull();
		});

		it("wraps bare numbers as px so the token outranks them", () => {
			expect(arbitraryTokenCandidate("10")).toEqual({
				value: "[10px]",
				arbitrary: true,
			});
			expect(arbitraryTokenCandidate("13.5")).toEqual({
				value: "[13.5px]",
				arbitrary: true,
			});
		});

		it("wraps negative numbers as px for margins", () => {
			expect(arbitraryTokenCandidate("-8")).toEqual({
				value: "[-8px]",
				arbitrary: true,
			});
		});

		it("completes bracketed and custom-property input as typed", () => {
			expect(arbitraryTokenCandidate("[10vw]")?.value).toBe("[10vw]");
			expect(arbitraryTokenCandidate("[10vw")?.value).toBe("[10vw]");
			expect(arbitraryTokenCandidate("(--card-width")?.value).toBe(
				"(--card-width)",
			);
			expect(arbitraryTokenCandidate("[")).toBeNull();
		});

		it("wraps free text, underscoring spaces per Tailwind syntax", () => {
			expect(arbitraryTokenCandidate("10rem")?.value).toBe("[10rem]");
			expect(arbitraryTokenCandidate("min(100%, 20px)")?.value).toBe(
				"[min(100%,_20px)]",
			);
		});
	});

	describe("isArbitraryTokenValue", () => {
		it("flags bracketed and custom-property values", () => {
			expect(isArbitraryTokenValue("[10px]")).toBe(true);
			expect(isArbitraryTokenValue("(--x)")).toBe(true);
			expect(isArbitraryTokenValue("2")).toBe(false);
			expect(isArbitraryTokenValue("full")).toBe(false);
		});
	});

	describe("stepToken", () => {
		it("steps between adjacent numeric tokens", () => {
			expect(stepToken(SCALE, "2", 1)).toBe("10");
			expect(stepToken(SCALE, "2", -1)).toBe("1");
		});

		it("enters the scale at the bottom from an empty value", () => {
			expect(stepToken(SCALE, "", 1)).toBe("0");
			expect(stepToken(SCALE, "", -1)).toBeNull();
		});

		it("lands off-scale numbers on the nearest token in the direction", () => {
			expect(stepToken(SCALE, "3", 1)).toBe("10");
			expect(stepToken(SCALE, "3", -1)).toBe("2");
		});

		it("does not step past the ends of the scale", () => {
			expect(stepToken(SCALE, "10", 1)).toBeNull();
			expect(stepToken(SCALE, "0", -1)).toBeNull();
		});

		it("does not step keywords or arbitrary values", () => {
			expect(stepToken(SCALE, "full", 1)).toBeNull();
			expect(stepToken(SCALE, "[10px]", 1)).toBeNull();
		});

		it("returns null when the scale has no numeric tokens", () => {
			const keywords: TokenFieldOption[] = [{ value: "auto" }];
			expect(stepToken(keywords, "", 1)).toBeNull();
		});
	});
});
