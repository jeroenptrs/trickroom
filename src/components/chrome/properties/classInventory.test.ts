import { describe, expect, it } from "vitest";
import { buildClassInventory } from "./classInventory";

const opts = { colorTokens: new Set(["red-500"]) };

describe("buildClassInventory", () => {
	it("separates managed, arbitrary-property, and unrecognized classes", () => {
		const inv = buildClassInventory(
			"p-4 unknown-card hover:p-6 md:bg-red-500 [grid-area:main] mt-2!",
			opts,
		);

		expect(inv.managed.map((i) => i.raw)).toEqual([
			"p-4",
			"hover:p-6",
			"md:bg-red-500",
			"mt-2!",
		]);
		expect(inv.unknown.map((i) => i.raw)).toEqual(["unknown-card"]);
		expect(inv.arbitrary.map((i) => i.raw)).toEqual(["[grid-area:main]"]);
		expect(inv.conflicts).toEqual([]);
		// original order + count is preserved across all categories
		expect(inv.items).toHaveLength(6);
	});

	it("flags same-slot conflicts and marks the shadowed class", () => {
		const inv = buildClassInventory("p-4 p-6 flex", opts);

		expect(inv.conflicts).toHaveLength(1);
		expect(inv.conflicts[0].slot).toBe("spacing.padding");
		expect(inv.conflicts[0].raws).toEqual(["p-4", "p-6"]);
		expect(inv.items.filter((i) => i.shadowed).map((i) => i.raw)).toEqual([
			"p-4",
		]);
	});

	it("treats per-variant slots independently (no false conflict)", () => {
		const inv = buildClassInventory("p-4 hover:p-6 md:p-8", opts);
		expect(inv.conflicts).toEqual([]);
		expect(inv.managed).toHaveLength(3);
	});

	it("does not shadow a same-property class in a different mode bucket", () => {
		const inv = buildClassInventory("p-4 p-6 dark:p-8", opts);
		// Only the base bucket conflicts; dark:p-8 lives in its own bucket.
		expect(inv.conflicts).toHaveLength(1);
		expect(inv.items.filter((i) => i.shadowed).map((i) => i.raw)).toEqual([
			"p-4",
		]);
	});
});
