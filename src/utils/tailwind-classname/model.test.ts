import { describe, expect, it } from "vitest";
import {
	buildPropertyModel,
	clearColor,
	serialize,
	setColor,
} from "./model";

const TOKENS = new Set([
	"red-500",
	"blue-500",
	"blue-600",
	"slate-200",
	"black",
	"white",
]);

const opts = { colorTokens: TOKENS };

describe("buildPropertyModel — grouping", () => {
	it("places color classes into the default mode bucket", () => {
		const model = buildPropertyModel("flex bg-red-500 text-blue-500", opts);
		const def = model.byMode[""];
		expect(def.byProperty.background?.[""]?.intent).toMatchObject({
			kind: "color",
			property: "background",
			token: "red-500",
			resolved: true,
		});
		expect(def.byProperty.text?.[""]?.intent).toMatchObject({
			token: "blue-500",
			resolved: true,
		});
	});

	it("collects non-color classes into `unknown`", () => {
		const model = buildPropertyModel("flex p-4 bg-red-500", opts);
		expect(model.unknown.map((p) => p.raw)).toEqual(["flex", "p-4"]);
	});

	it("splits classes by variant", () => {
		const model = buildPropertyModel(
			"bg-red-500 hover:bg-blue-500 md:hover:bg-slate-200",
			opts,
		);
		const bg = model.byMode[""].byProperty.background;
		expect(bg?.[""]?.intent.token).toBe("red-500");
		expect(bg?.["hover"]?.intent.token).toBe("blue-500");
		expect(bg?.["md:hover"]?.intent.token).toBe("slate-200");
	});

	it("splits classes by mode", () => {
		const model = buildPropertyModel("bg-red-500 dark:bg-blue-500", opts);
		expect(model.byMode[""].byProperty.background?.[""]?.intent.token).toBe(
			"red-500",
		);
		expect(
			model.byMode["dark"].byProperty.background?.[""]?.intent.token,
		).toBe("blue-500");
	});

	it("last class wins within the same (mode, property, variant) slot", () => {
		const model = buildPropertyModel("bg-red-500 bg-blue-500", opts);
		const slot = model.byMode[""].byProperty.background?.[""];
		expect(slot?.intent.token).toBe("blue-500");
		expect(slot?.originalIndex).toBe(1);
	});

	it("flags resolved=false when a token is missing from the active set", () => {
		const model = buildPropertyModel("bg-rose-999", opts);
		expect(model.byMode[""].byProperty.background?.[""]?.intent).toMatchObject(
			{
				kind: "color",
				token: "rose-999",
				resolved: false,
			},
		);
	});
});

describe("serialize — round-trip", () => {
	it("round-trips a no-op parse → serialize", () => {
		const inputs = [
			"flex bg-red-500 text-sm hover:bg-blue-500",
			"dark:hover:bg-red-500!",
			"bg-[#abc] text-blue-500/50",
			"data-[state=open]:bg-red-500 [mask:linear-gradient(red,blue)]",
		];
		for (const input of inputs) {
			const model = buildPropertyModel(input, opts);
			expect(serialize(model)).toBe(input);
		}
	});

	it("normalizes inter-class whitespace to a single space", () => {
		const model = buildPropertyModel("  flex   bg-red-500\ttext-sm  ", opts);
		expect(serialize(model)).toBe("flex bg-red-500 text-sm");
	});

	it("returns an empty string for an empty model", () => {
		expect(serialize(buildPropertyModel("", opts))).toBe("");
	});
});

describe("setColor — replace in place", () => {
	it("replaces an existing class without disturbing siblings", () => {
		const model = buildPropertyModel("flex bg-red-500 text-sm", opts);
		const next = setColor(
			model,
			{
				property: "background",
				value: { kind: "token", token: "blue-500" },
			},
			opts,
		);
		expect(serialize(next)).toBe("flex bg-blue-500 text-sm");
	});

	it("appends when the slot is empty", () => {
		const model = buildPropertyModel("flex text-sm", opts);
		const next = setColor(
			model,
			{
				property: "background",
				value: { kind: "token", token: "blue-500" },
			},
			opts,
		);
		expect(serialize(next)).toBe("flex text-sm bg-blue-500");
	});

	it("replaces only the targeted variant slot", () => {
		const model = buildPropertyModel("bg-red-500 hover:bg-blue-500", opts);
		const next = setColor(
			model,
			{
				property: "background",
				variants: ["hover"],
				value: { kind: "token", token: "slate-200" },
			},
			opts,
		);
		expect(serialize(next)).toBe("bg-red-500 hover:bg-slate-200");
	});

	it("supports arbitrary values", () => {
		const model = buildPropertyModel("flex", opts);
		const next = setColor(
			model,
			{
				property: "background",
				value: { kind: "arbitrary", value: "[#abc]" },
			},
			opts,
		);
		expect(serialize(next)).toBe("flex bg-[#abc]");
	});

	it("wraps bare arbitrary values in brackets when missing", () => {
		const model = buildPropertyModel("", opts);
		const next = setColor(
			model,
			{
				property: "background",
				value: { kind: "arbitrary", value: "#abc" },
			},
			opts,
		);
		expect(serialize(next)).toBe("bg-[#abc]");
	});

	it("supports the universal `current` keyword", () => {
		const model = buildPropertyModel("", opts);
		const next = setColor(
			model,
			{
				property: "text",
				value: { kind: "keyword", keyword: "current" },
			},
			opts,
		);
		expect(serialize(next)).toBe("text-current");
	});

	it("emits the v4 important suffix when requested", () => {
		const model = buildPropertyModel("", opts);
		const next = setColor(
			model,
			{
				property: "background",
				value: { kind: "token", token: "red-500" },
				important: true,
			},
			opts,
		);
		expect(serialize(next)).toBe("bg-red-500!");
	});

	it("emits modes and variants in the chain", () => {
		const model = buildPropertyModel("", opts);
		const next = setColor(
			model,
			{
				property: "background",
				value: { kind: "token", token: "red-500" },
				mode: "dark",
				variants: ["md", "hover"],
			},
			opts,
		);
		expect(serialize(next)).toBe("dark:md:hover:bg-red-500");
	});
});

describe("clearColor — per-variant slot removal", () => {
	it("removes only the targeted slot", () => {
		const model = buildPropertyModel(
			"bg-red-500 hover:bg-blue-500 text-sm",
			opts,
		);
		const next = clearColor(model, "background", opts);
		expect(serialize(next)).toBe("hover:bg-blue-500 text-sm");
	});

	it("clearing the default does not touch hover", () => {
		const model = buildPropertyModel(
			"bg-red-500 hover:bg-blue-500",
			opts,
		);
		const next = clearColor(model, "background", opts);
		expect(serialize(next)).toBe("hover:bg-blue-500");
	});

	it("clearing hover does not touch the default", () => {
		const model = buildPropertyModel(
			"bg-red-500 hover:bg-blue-500",
			opts,
		);
		const next = clearColor(model, "background", opts, { variants: ["hover"] });
		expect(serialize(next)).toBe("bg-red-500");
	});

	it("is a no-op when the slot is empty", () => {
		const model = buildPropertyModel("flex", opts);
		const next = clearColor(model, "background", opts);
		expect(serialize(next)).toBe("flex");
	});

	it("can clear a stale color", () => {
		const model = buildPropertyModel("bg-rose-999 text-sm", opts);
		const next = clearColor(model, "background", opts);
		expect(serialize(next)).toBe("text-sm");
	});
});

describe("model preserves unknown classes through edits", () => {
	it("keeps non-color classes byte-identical when editing colors", () => {
		const input = "data-[state=open]:p-4 [mask:linear-gradient(red,blue)] bg-red-500";
		const model = buildPropertyModel(input, opts);
		const next = setColor(
			model,
			{
				property: "background",
				value: { kind: "token", token: "blue-500" },
			},
			opts,
		);
		expect(serialize(next)).toBe(
			"data-[state=open]:p-4 [mask:linear-gradient(red,blue)] bg-blue-500",
		);
	});
});
