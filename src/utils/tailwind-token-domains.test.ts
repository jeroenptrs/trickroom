import { describe, expect, it } from "vitest";
import {
	diffTailwindDomainTokensAgainstDefaults,
	computeTokenDomainOverrides,
	extractTailwindTokenResetOverrides,
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

describe("diffTailwindDomainTokensAgainstDefaults", () => {
	it("does not mark missing defaults as removed without reset declarations", () => {
		expect(
			diffTailwindDomainTokensAgainstDefaults(
				"container",
				{ "2xs": "18rem" },
				{ sm: "24rem", md: "28rem" },
			).removed,
		).toEqual([]);
	});

	it("marks missing defaults as removed when a namespace reset exists", () => {
		expect(
			diffTailwindDomainTokensAgainstDefaults(
				"inset-shadow",
				{ base: "inset 0 0 0 1px var(--color-border)" },
				{ xs: "inset 0 1px 1px rgb(0 0 0 / 0.05)" },
				["--inset-shadow-*"],
			).removed,
		).toEqual([
			{
				name: "xs",
				defaultValue: "inset 0 1px 1px rgb(0 0 0 / 0.05)",
				domain: "inset-shadow",
			},
		]);
	});

	it("marks exact reset declarations as removed without resetting the whole namespace", () => {
		expect(
			diffTailwindDomainTokensAgainstDefaults(
				"radius",
				{ sm: "0.25rem" },
				{ sm: "0.25rem", xl: "0.75rem", "2xl": "1rem" },
				["--radius-xl"],
			).removed,
		).toEqual([
			{
				name: "xl",
				defaultValue: "0.75rem",
				domain: "radius",
			},
		]);
	});

	it("marks family wildcard reset declarations as removed", () => {
		expect(
			diffTailwindDomainTokensAgainstDefaults(
				"color",
				{ "brand-500": "#123456" },
				{
					"red-50": "#fee2e2",
					"red-100": "#fecaca",
					"blue-50": "#eff6ff",
				},
				["--color-red-*"],
			).removed,
		).toEqual([
			{ name: "red-100", defaultValue: "#fecaca", domain: "color" },
			{ name: "red-50", defaultValue: "#fee2e2", domain: "color" },
		]);
	});
});

describe("extractTailwindTokenResetOverrides", () => {
	it("extracts exact and wildcard initial declarations from token source metadata", async () => {
		const code = [
			"@theme {",
			"  --color-*: initial;",
			"  --color-brand-500: #123456;",
			"  --radius-xl: initial;",
			"  --radius-sm: 0.25rem;",
			"  --text-2xs: 0.6875rem;",
			"}",
		].join("\n");
		const themeValues = new Map([
			[
				"--color-brand-500",
				{ value: "#123456", src: [{ file: "theme.css", code }] },
			],
			[
				"--radius-sm",
				{ value: "0.25rem", src: [{ file: "theme.css", code }] },
			],
		]);
		const designSystem = {
			theme: {
				entries() {
					return themeValues.entries();
				},
			},
		};

		expect(
			extractTailwindTokenResetOverrides(
				designSystem as Parameters<typeof extractTailwindTokenResetOverrides>[0],
			),
		).toMatchObject({
			color: ["--color-*"],
			radius: ["--radius-xl"],
			text: [],
		});
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
