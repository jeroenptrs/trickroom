import { describe, expect, it } from "vitest";
import { defaultTailwindFontTokens } from "./default-tailwind-tokens";
import { computeResolvedFontTokens } from "./resolved-font-tokens";

const defaultNames = new Set(Object.keys(defaultTailwindFontTokens));

describe("computeResolvedFontTokens", () => {
	it("returns every default token when given no input", () => {
		const resolved = computeResolvedFontTokens();
		expect(resolved.names.size).toBe(defaultNames.size);
		for (const name of defaultNames) {
			expect(resolved.names.has(name)).toBe(true);
			expect(resolved.values.get(name)).toBe(defaultTailwindFontTokens[name]);
		}
	});

	it("subtracts removed tokens", () => {
		const resolved = computeResolvedFontTokens({
			removed: [{ name: "sans" }, { name: "mono" }],
		});
		expect(resolved.names.has("sans")).toBe(false);
		expect(resolved.names.has("mono")).toBe(false);
		expect(resolved.names.has("serif")).toBe(true);
	});

	it("adds custom tokens not in defaults", () => {
		const resolved = computeResolvedFontTokens({
			meaningfulTokens: {
				brand: '"IBM Plex Sans", ui-sans-serif, sans-serif',
			},
		});
		expect(resolved.names.has("brand")).toBe(true);
		expect(resolved.values.get("brand")).toContain("IBM Plex Sans");
	});

	it("overrides default stacks from meaningful tokens", () => {
		const resolved = computeResolvedFontTokens({
			meaningfulTokens: {
				sans: '"Custom Sans", system-ui, sans-serif',
			},
		});
		expect(resolved.values.get("sans")).toBe(
			'"Custom Sans", system-ui, sans-serif',
		);
	});
});
