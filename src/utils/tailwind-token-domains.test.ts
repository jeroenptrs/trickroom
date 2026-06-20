import { describe, expect, it } from "vitest";
import {
	computeTokenDomainOverrides,
	extractTailwindTokens,
	normalizeTailwindTokenValue,
	tokenDomainToCssPropertyName,
} from "./tailwind-token-domains";

describe("tokenDomainToCssPropertyName", () => {
	it("maps default namespace tokens to the namespace variable", () => {
		expect(tokenDomainToCssPropertyName("spacing", "DEFAULT")).toBe(
			"--spacing",
		);
	});

	it("maps named tokens to their domain namespace", () => {
		expect(tokenDomainToCssPropertyName("radius", "lg")).toBe("--radius-lg");
		expect(tokenDomainToCssPropertyName("ease", "in-out")).toBe(
			"--ease-in-out",
		);
	});
});

describe("computeTokenDomainOverrides", () => {
	it("emits deterministic exact reset declarations for non-color domains", () => {
		expect(
			computeTokenDomainOverrides([
				{
					name: "lg",
					defaultValue: "0.5rem",
					domain: "radius",
				},
				{
					name: "DEFAULT",
					defaultValue: "0.25rem",
					domain: "spacing",
				},
				{
					name: "lg",
					defaultValue: "0.5rem",
					domain: "radius",
				},
			]),
		).toEqual(["--radius-lg", "--spacing"]);
	});
});

describe("normalizeTailwindTokenValue", () => {
	it("lowercases only valid CSS hex lengths", () => {
		expect(normalizeTailwindTokenValue(" #ABC ")).toBe("#abc");
		expect(normalizeTailwindTokenValue(" #AABBCCDD ")).toBe("#aabbccdd");
		expect(normalizeTailwindTokenValue(" #ABCDE ")).toBe("#ABCDE");
	});
});

describe("extractTailwindTokens", () => {
	it("assigns overlapping namespaces to the longest matching token domain", async () => {
		const { __unstable__loadDesignSystem } = await import("tailwindcss");
		const designSystem = await __unstable__loadDesignSystem(
			[
				"@theme {",
				"  --font-sans: ui-sans-serif;",
				"  --font-weight-bold: 700;",
				"  --text-sm: 0.875rem;",
				"  --text-shadow-sm: 0 1px 0 rgb(0 0 0 / 0.1);",
				"}",
			].join("\n"),
		);

		expect(extractTailwindTokens(designSystem)).toMatchObject({
			font: { sans: "ui-sans-serif" },
			"font-weight": { bold: "700" },
			text: { sm: "0.875rem" },
			"text-shadow": { sm: "0 1px 0 rgb(0 0 0 / 0.1)" },
		});
	});
});
