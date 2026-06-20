import { describe, expect, it } from "vitest";
import {
	buildPropertyModel,
	clearColor,
	clearSpacing,
	clearStyle,
	serialize,
	setColor,
	setSpacing,
	setStyle,
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

	it("collects only unmodeled classes into `unknown`", () => {
		const model = buildPropertyModel("flex rounded bg-red-500", opts);
		expect(model.unknown.map((p) => p.raw)).toEqual([]);
		expect(
			model.byMode[""].byProperty["layout.display"]?.[""]?.intent,
		).toMatchObject({ kind: "style", property: "layout.display" });
		expect(
			model.byMode[""].byProperty["border.radius"]?.[""]?.intent,
		).toMatchObject({ kind: "style", property: "border.radius" });
	});

	it("splits classes by variant", () => {
		const model = buildPropertyModel(
			"bg-red-500 hover:bg-blue-500 md:hover:bg-slate-200",
			opts,
		);
		const bg = model.byMode[""].byProperty.background;
		expect(bg?.[""]?.intent.token).toBe("red-500");
		expect(bg?.hover?.intent.token).toBe("blue-500");
		expect(bg?.["md:hover"]?.intent.token).toBe("slate-200");
	});

	it("folds dark into the variant chains by default (todo 572)", () => {
		const model = buildPropertyModel("bg-red-500 dark:bg-blue-500", opts);
		expect(model.byMode[""].byProperty.background?.[""]?.intent.token).toBe(
			"red-500",
		);
		expect(model.byMode[""].byProperty.background?.dark?.intent.token).toBe(
			"blue-500",
		);
		expect(model.byMode.dark).toBeUndefined();
	});

	it("still buckets by mode when the caller passes modes explicitly", () => {
		const model = buildPropertyModel("bg-red-500 dark:bg-blue-500", {
			...opts,
			modes: ["dark"],
		});
		expect(model.byMode.dark.byProperty.background?.[""]?.intent.token).toBe(
			"blue-500",
		);
	});

	it("last class wins within the same (mode, property, variant) slot", () => {
		const model = buildPropertyModel("bg-red-500 bg-blue-500", opts);
		const slot = model.byMode[""].byProperty.background?.[""];
		expect(slot?.intent.token).toBe("blue-500");
		expect(slot?.originalIndex).toBe(1);
	});

	it("flags resolved=false when a token is missing from the active set", () => {
		const model = buildPropertyModel("bg-rose-999", opts);
		expect(model.byMode[""].byProperty.background?.[""]?.intent).toMatchObject({
			kind: "color",
			token: "rose-999",
			resolved: false,
		});
	});

	it("places spacing classes into semantic property slots", () => {
		const model = buildPropertyModel("p-4 px-2 -mt-1 gap-x-3", opts);
		const def = model.byMode[""];
		expect(def.byProperty.padding?.[""]?.intent).toMatchObject({
			kind: "spacing",
			property: "padding",
			value: { kind: "scale", value: "4" },
		});
		expect(def.byProperty["padding-x"]?.[""]?.intent).toMatchObject({
			kind: "spacing",
			property: "padding-x",
			value: { kind: "scale", value: "2" },
		});
		expect(def.byProperty["margin-top"]?.[""]?.intent).toMatchObject({
			kind: "spacing",
			property: "margin-top",
			negative: true,
		});
		expect(def.byProperty["gap-x"]?.[""]?.intent).toMatchObject({
			kind: "spacing",
			property: "gap-x",
			value: { kind: "scale", value: "3" },
		});
	});
});

describe("style utility mutations", () => {
	it("edits exact style slots without removing sibling domains", () => {
		const model = buildPropertyModel("flex flex-row bg-red-500", opts);
		const next = setStyle(
			model,
			{ property: "layout.display", utility: "grid" },
			opts,
		);

		expect(serialize(next)).toBe("grid flex-row bg-red-500");
		expect(
			next.byMode[""].byProperty["layout.flex-direction"]?.[""]?.parsed.raw,
		).toBe("flex-row");
	});

	it("adds and clears variant style slots", () => {
		const model = buildPropertyModel("flex", opts);
		const next = setStyle(
			model,
			{
				property: "size.width",
				utility: "w-4",
				variants: ["md"],
			},
			opts,
		);
		expect(serialize(next)).toBe("flex md:w-4");

		const cleared = clearStyle(next, "size.width", opts, { variants: ["md"] });
		expect(serialize(cleared)).toBe("flex");
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

	it("edits ring offset colors without touching ring width", () => {
		const model = buildPropertyModel("ring-2 ring-offset-blue-500", opts);
		const next = setColor(
			model,
			{
				property: "ring-offset",
				value: { kind: "token", token: "red-500" },
			},
			opts,
		);
		expect(serialize(next)).toBe("ring-2 ring-offset-red-500");
	});

	it("edits text shadow colors without touching text shadow size", () => {
		const model = buildPropertyModel(
			"text-shadow-sm text-shadow-blue-500",
			opts,
		);
		const next = setColor(
			model,
			{
				property: "text-shadow",
				value: { kind: "token", token: "red-500" },
			},
			opts,
		);
		expect(serialize(next)).toBe("text-shadow-sm text-shadow-red-500");
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
		const model = buildPropertyModel("bg-red-500 hover:bg-blue-500", opts);
		const next = clearColor(model, "background", opts);
		expect(serialize(next)).toBe("hover:bg-blue-500");
	});

	it("clearing hover does not touch the default", () => {
		const model = buildPropertyModel("bg-red-500 hover:bg-blue-500", opts);
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

describe("setSpacing — exact slot replacement", () => {
	it("replaces an existing spacing class without disturbing siblings", () => {
		const model = buildPropertyModel("flex p-4 px-2 bg-red-500", opts);
		const next = setSpacing(
			model,
			{
				property: "padding-x",
				value: { kind: "scale", value: "6" },
			},
			opts,
		);
		expect(serialize(next)).toBe("flex p-4 px-6 bg-red-500");
	});

	it("appends when the slot is empty", () => {
		const model = buildPropertyModel("flex bg-red-500", opts);
		const next = setSpacing(
			model,
			{
				property: "padding",
				value: { kind: "scale", value: "4" },
			},
			opts,
		);
		expect(serialize(next)).toBe("flex bg-red-500 p-4");
	});

	it("supports negative margin values", () => {
		const model = buildPropertyModel("mt-2", opts);
		const next = setSpacing(
			model,
			{
				property: "margin-top",
				value: { kind: "scale", value: "4" },
				negative: true,
			},
			opts,
		);
		expect(serialize(next)).toBe("-mt-4");
	});

	it("supports auto margin, arbitrary values, and custom properties", () => {
		const model = buildPropertyModel("m-0 p-4 gap-2", opts);
		const withAuto = setSpacing(
			model,
			{
				property: "margin",
				value: { kind: "keyword", keyword: "auto" },
			},
			opts,
		);
		const withArbitrary = setSpacing(
			withAuto,
			{
				property: "padding",
				value: { kind: "arbitrary", value: "13px" },
			},
			opts,
		);
		const withCustom = setSpacing(
			withArbitrary,
			{
				property: "gap",
				value: { kind: "custom-property", value: "--space-card" },
			},
			opts,
		);
		expect(serialize(withCustom)).toBe("m-auto p-[13px] gap-(--space-card)");
	});

	it("replaces only the targeted variant slot", () => {
		const model = buildPropertyModel("p-4 hover:p-6 md:px-8", opts);
		const next = setSpacing(
			model,
			{
				property: "padding",
				variants: ["hover"],
				value: { kind: "scale", value: "10" },
			},
			opts,
		);
		expect(serialize(next)).toBe("p-4 hover:p-10 md:px-8");
	});
});

describe("clearSpacing — exact slot removal", () => {
	it("removes only the targeted spacing slot", () => {
		const model = buildPropertyModel("p-4 px-2 hover:p-6 bg-red-500", opts);
		const next = clearSpacing(model, "padding", opts);
		expect(serialize(next)).toBe("px-2 hover:p-6 bg-red-500");
	});

	it("can clear a variant spacing slot", () => {
		const model = buildPropertyModel("p-4 hover:p-6", opts);
		const next = clearSpacing(model, "padding", opts, {
			variants: ["hover"],
		});
		expect(serialize(next)).toBe("p-4");
	});
});

describe("model preserves unknown classes through edits", () => {
	it("keeps non-color classes byte-identical when editing colors", () => {
		const input =
			"data-[state=open]:p-4 [mask:linear-gradient(red,blue)] bg-red-500";
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

	it("keeps unknown classes byte-identical when editing spacing", () => {
		const input = "rounded-xl [mask:linear-gradient(red,blue)] p-4";
		const model = buildPropertyModel(input, opts);
		const next = setSpacing(
			model,
			{
				property: "padding",
				value: { kind: "scale", value: "8" },
			},
			opts,
		);
		expect(serialize(next)).toBe(
			"rounded-xl [mask:linear-gradient(red,blue)] p-8",
		);
	});
});
