import { describe, expect, it } from "vitest";
import {
	buildFontFamilyOptions,
	firstQuotedFontFamily,
	isFontFamilyWeightCollision,
	labelFontFamilyToken,
	orderedFontFamilyNames,
} from "./font-family-options";
import { computeResolvedFontTokens } from "./resolved-font-tokens";

describe("font family options", () => {
	it("extracts the first quoted family from a stack", () => {
		expect(
			firstQuotedFontFamily(
				'"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
			),
		).toBe("IBM Plex Sans");
	});

	it("orders defaults before custom names", () => {
		expect(orderedFontFamilyNames(["display", "mono", "sans", "brand"])).toEqual([
			"sans",
			"mono",
			"brand",
			"display",
		]);
	});

	it("labels defaults with friendly names", () => {
		expect(labelFontFamilyToken("sans", defaultStack("sans"))).toBe("Sans");
	});

	it("labels custom tokens from quoted family when distinct", () => {
		expect(
			labelFontFamilyToken(
				"brand",
				'"IBM Plex Sans", ui-sans-serif, sans-serif',
			),
		).toBe("IBM Plex Sans");
	});

	it("falls back to a humanized token name without a quoted family", () => {
		expect(labelFontFamilyToken("brand-primary", "ui-sans-serif, sans-serif")).toBe(
			"Brand Primary",
		);
	});

	it("excludes weight-collision token names from options", () => {
		const resolved = computeResolvedFontTokens({
			meaningfulTokens: {
				bold: '"Accidental Bold", serif',
				display: '"Playfair Display", serif',
			},
		});
		const options = buildFontFamilyOptions(resolved);
		expect(options.map((option) => option.value)).not.toContain("bold");
		expect(options.map((option) => option.value)).toContain("display");
		expect(isFontFamilyWeightCollision("bold")).toBe(true);
	});
});

function defaultStack(name: "sans" | "serif" | "mono"): string {
	return computeResolvedFontTokens().values.get(name) ?? "";
}
