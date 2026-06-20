import { describe, expect, it } from "vitest";
import { defaultTailwindColorTokens } from "./default-tailwind-tokens";
import { computeResolvedColorTokens } from "./resolved-color-tokens";

const defaultNames = new Set(Object.keys(defaultTailwindColorTokens));

describe("computeResolvedColorTokens", () => {
	it("returns every default token when given no input", () => {
		const resolved = computeResolvedColorTokens();
		expect(resolved.names.size).toBe(defaultNames.size);
		for (const name of defaultNames) {
			expect(resolved.names.has(name)).toBe(true);
			expect(resolved.values.get(name)).toBe(
				defaultTailwindColorTokens[
					name as keyof typeof defaultTailwindColorTokens
				],
			);
		}
	});

	it("subtracts removed tokens", () => {
		const resolved = computeResolvedColorTokens({
			removed: [{ name: "red-500" }, { name: "blue-500" }],
		});
		expect(resolved.names.has("red-500")).toBe(false);
		expect(resolved.names.has("blue-500")).toBe(false);
		expect(resolved.names.has("green-500")).toBe(true);
	});

	it("accepts removed entries as plain strings", () => {
		const resolved = computeResolvedColorTokens({ removed: ["red-500"] });
		expect(resolved.names.has("red-500")).toBe(false);
	});

	it("adds new tokens not in defaults", () => {
		const resolved = computeResolvedColorTokens({
			meaningfulTokens: { "brand-primary": "#123456" },
		});
		expect(resolved.names.has("brand-primary")).toBe(true);
		expect(resolved.values.get("brand-primary")).toBe("#123456");
	});

	it("overrides default values when meaningful tokens redefine them", () => {
		const resolved = computeResolvedColorTokens({
			meaningfulTokens: { "blue-500": "rebeccapurple" },
		});
		expect(resolved.values.get("blue-500")).toBe("rebeccapurple");
		// Still in the resolved set.
		expect(resolved.names.has("blue-500")).toBe(true);
	});

	it("composes removed + added + overridden in one call", () => {
		const resolved = computeResolvedColorTokens({
			removed: [{ name: "red-500" }],
			meaningfulTokens: {
				"brand-primary": "#abcdef",
				"blue-500": "#000",
			},
		});
		expect(resolved.names.has("red-500")).toBe(false);
		expect(resolved.values.get("brand-primary")).toBe("#abcdef");
		expect(resolved.values.get("blue-500")).toBe("#000");
	});

	it("removal can drop a token even if it would otherwise be overridden", () => {
		const resolved = computeResolvedColorTokens({
			removed: [{ name: "blue-500" }],
			meaningfulTokens: {},
		});
		expect(resolved.names.has("blue-500")).toBe(false);
	});

	it("re-adding a removed token via meaningfulTokens makes it resolve again", () => {
		// Order: removed first, then meaningful tokens layered on top.
		const resolved = computeResolvedColorTokens({
			removed: [{ name: "blue-500" }],
			meaningfulTokens: { "blue-500": "#fff" },
		});
		expect(resolved.names.has("blue-500")).toBe(true);
		expect(resolved.values.get("blue-500")).toBe("#fff");
	});

	it("includes default `black` and `white` tokens", () => {
		const resolved = computeResolvedColorTokens();
		expect(resolved.names.has("black")).toBe(true);
		expect(resolved.names.has("white")).toBe(true);
	});
});
