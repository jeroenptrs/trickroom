import { describe, expect, it } from "vitest";
import { buildPropertyModel } from "../../../utils/tailwind-classname";
import { computePropertySlots, propertyHasEntries } from "./propertySlots";

const opts = { colorTokens: new Set<string>() };

describe("computePropertySlots", () => {
	it("orders base first, then existing variants, then drafts, deduped", () => {
		const model = buildPropertyModel("flex md:hidden hover:flex", opts);
		const slots = computePropertySlots(model, "layout.display", ["lg", "md"]);

		expect(slots.map((slot) => slot.variantKey)).toEqual([
			"",
			"md",
			"hover",
			"lg",
		]);
		expect(slots[0].variants).toEqual([]);
		expect(slots[1].variants).toEqual(["md"]);
		// base + md have model entries; lg is a draft with no entry yet
		expect(Boolean(slots[0].entry)).toBe(true);
		expect(Boolean(slots[1].entry)).toBe(true);
		expect(slots[3].entry).toBeUndefined();
	});

	it("always includes the base slot even when only overrides exist", () => {
		const model = buildPropertyModel("hover:flex", opts);
		const slots = computePropertySlots(model, "layout.display", []);

		expect(slots[0].variantKey).toBe("");
		expect(slots[0].entry).toBeUndefined();
		expect(slots.some((slot) => slot.variantKey === "hover")).toBe(true);
	});

	it("surfaces dark classes as ordinary variant slots (todo 572)", () => {
		const model = buildPropertyModel("flex dark:hidden", opts);
		const slots = computePropertySlots(model, "layout.display", []);

		expect(slots.map((slot) => slot.variantKey)).toEqual(["", "dark"]);
		expect(slots[1].variants).toEqual(["dark"]);
		expect(Boolean(slots[1].entry)).toBe(true);
	});
});

describe("propertyHasEntries", () => {
	it("is true for a base-only value and for an override-only value", () => {
		expect(
			propertyHasEntries(buildPropertyModel("flex", opts), "layout.display"),
		).toBe(true);
		expect(
			propertyHasEntries(
				buildPropertyModel("hover:flex", opts),
				"layout.display",
			),
		).toBe(true);
	});

	it("is false when the property has no classes", () => {
		const model = buildPropertyModel("flex", opts);
		expect(propertyHasEntries(model, "layout.justify-content")).toBe(false);
		expect(
			propertyHasEntries(buildPropertyModel("", opts), "layout.display"),
		).toBe(false);
	});
});
