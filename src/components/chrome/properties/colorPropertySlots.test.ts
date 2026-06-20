import { describe, expect, it } from "vitest";
import { buildPropertyModel } from "../../../utils/tailwind-classname";
import { computeColorPropertySlots } from "./colorPropertySlots";

const TOKENS = new Set(["red-500", "blue-500", "slate-200"]);
const opts = { colorTokens: TOKENS };

describe("computeColorPropertySlots", () => {
	it("always includes a default slot, even when the model is empty", () => {
		const model = buildPropertyModel("", opts);
		const slots = computeColorPropertySlots(model, "background", []);
		expect(slots.map((s) => s.variantKey)).toEqual([""]);
		expect(slots[0].entry).toBeUndefined();
		expect(slots[0].variants).toEqual([]);
	});

	it("includes every model variant in addition to the default", () => {
		const model = buildPropertyModel(
			"bg-red-500 hover:bg-blue-500 md:hover:bg-slate-200",
			opts,
		);
		const slots = computeColorPropertySlots(model, "background", []);
		expect(slots.map((s) => s.variantKey)).toEqual([
			"",
			"hover",
			"md:hover",
		]);
		expect(slots[0].entry?.intent.token).toBe("red-500");
		expect(slots[1].entry?.intent.token).toBe("blue-500");
		expect(slots[2].entry?.intent.token).toBe("slate-200");
	});

	it("appends draft variants the model does not yet contain", () => {
		const model = buildPropertyModel("bg-red-500", opts);
		const slots = computeColorPropertySlots(model, "background", [
			"focus",
			"active",
		]);
		expect(slots.map((s) => s.variantKey)).toEqual([
			"",
			"focus",
			"active",
		]);
		expect(slots[1].entry).toBeUndefined();
		expect(slots[2].entry).toBeUndefined();
	});

	it("de-dupes draft variants that already exist in the model", () => {
		const model = buildPropertyModel("bg-red-500 hover:bg-blue-500", opts);
		const slots = computeColorPropertySlots(model, "background", ["hover"]);
		expect(slots.map((s) => s.variantKey)).toEqual(["", "hover"]);
		// The model entry wins — we do not introduce a second hover row.
		expect(slots[1].entry?.intent.token).toBe("blue-500");
	});

	it("splits multi-segment variant keys into a variant array", () => {
		const model = buildPropertyModel("md:hover:bg-red-500", opts);
		const slots = computeColorPropertySlots(model, "background", []);
		expect(slots[1].variants).toEqual(["md", "hover"]);
	});

	it("ignores variants for other properties", () => {
		const model = buildPropertyModel(
			"bg-red-500 hover:text-blue-500",
			opts,
		);
		const bg = computeColorPropertySlots(model, "background", []);
		const text = computeColorPropertySlots(model, "text", []);
		expect(bg.map((s) => s.variantKey)).toEqual([""]);
		expect(text.map((s) => s.variantKey)).toEqual(["", "hover"]);
	});
});
