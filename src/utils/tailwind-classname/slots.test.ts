import { describe, expect, it } from "vitest";
import { formatWithVariantChain, resolveSlotTarget } from "./slots";

describe("formatWithVariantChain", () => {
	it("returns the body unchanged when no modifiers are set", () => {
		expect(formatWithVariantChain("bg-red-500")).toBe("bg-red-500");
	});

	it("prefixes mode and variants in order", () => {
		expect(
			formatWithVariantChain("bg-red-500", {
				mode: "dark",
				variants: ["md", "hover"],
			}),
		).toBe("dark:md:hover:bg-red-500");
	});
});

describe("resolveSlotTarget", () => {
	it("defaults to the default mode and variant slot", () => {
		expect(resolveSlotTarget()).toEqual({ modeKey: "", variantKey: "" });
	});
});
