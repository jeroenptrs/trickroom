import { describe, expect, it } from "vitest";
import { buildPropertyModel } from "../../../utils/tailwind-classname";
import {
	boxProperties,
	boxTokenOptions,
	boxWriteProperty,
	convertBoxShape,
	nextLinkState,
	readBoxModel,
	writeBoxSide,
} from "./boxModelController";

const opts = { colorTokens: new Set<string>() };

function read(className: string, group: "padding" | "margin", scope = "") {
	return readBoxModel(buildPropertyModel(className, opts), group, scope);
}

describe("readBoxModel", () => {
	it("derives the linked state from a bare all-sides class", () => {
		expect(read("flex p-4", "padding")).toEqual({
			linkState: "linked",
			sides: { top: "4", right: "4", bottom: "4", left: "4" },
		});
	});

	it("derives the axis state from px/py", () => {
		expect(read("px-4 py-2", "padding")).toEqual({
			linkState: "axis",
			sides: { top: "2", right: "4", bottom: "2", left: "4" },
		});
	});

	it("derives the sides state and falls back side → axis → all", () => {
		expect(read("p-1 px-4 pt-2", "padding")).toEqual({
			linkState: "sides",
			sides: { top: "2", right: "4", bottom: "1", left: "4" },
		});
	});

	it("treats an empty group as linked with unset sides", () => {
		expect(read("flex", "margin")).toEqual({
			linkState: "linked",
			sides: { top: null, right: null, bottom: null, left: null },
		});
	});

	it("reads the requested scope only", () => {
		expect(read("p-4 md:px-8", "padding", "md")).toEqual({
			linkState: "axis",
			sides: { top: null, right: "8", bottom: null, left: "8" },
		});
	});

	it("formats negative margins and keywords", () => {
		expect(read("-mt-2 mx-auto", "margin")).toEqual({
			linkState: "sides",
			sides: { top: "-2", right: "auto", bottom: null, left: "auto" },
		});
	});
});

describe("boxWriteProperty", () => {
	it("routes writes by link state", () => {
		expect(boxWriteProperty("padding", "top", "linked")).toBe("padding");
		expect(boxWriteProperty("padding", "top", "axis")).toBe("padding-y");
		expect(boxWriteProperty("padding", "left", "axis")).toBe("padding-x");
		expect(boxWriteProperty("margin", "left", "sides")).toBe("margin-left");
	});
});

describe("writeBoxSide", () => {
	it("writes the all-sides class while linked", () => {
		expect(
			writeBoxSide("p-4", opts, "padding", "right", "6", "linked", []),
		).toBe("p-6");
	});

	it("writes the axis class while axis-split", () => {
		expect(
			writeBoxSide("px-4 py-2", opts, "padding", "bottom", "3", "axis", []),
		).toBe("px-4 py-3");
	});

	it("writes the per-side class while unlinked", () => {
		expect(
			writeBoxSide("pt-2", opts, "padding", "left", "4", "sides", []),
		).toBe("pt-2 pl-4");
	});

	it("clears the routed property on empty input", () => {
		expect(
			writeBoxSide("px-4 py-2", opts, "padding", "top", "", "axis", []),
		).toBe("px-4");
	});

	it("targets the active scope's variant chain", () => {
		expect(
			writeBoxSide("p-4", opts, "padding", "top", "8", "linked", ["md"]),
		).toBe("p-4 md:p-8");
	});

	it("accepts negative and keyword margin input", () => {
		expect(writeBoxSide("", opts, "margin", "top", "-2", "sides", [])).toBe(
			"-mt-2",
		);
		expect(writeBoxSide("", opts, "margin", "left", "auto", "axis", [])).toBe(
			"mx-auto",
		);
	});
});

describe("nextLinkState", () => {
	it("cycles linked → axis → sides → linked", () => {
		expect(nextLinkState("linked")).toBe("axis");
		expect(nextLinkState("axis")).toBe("sides");
		expect(nextLinkState("sides")).toBe("linked");
	});
});

describe("convertBoxShape", () => {
	it("splits a linked class into axes", () => {
		expect(convertBoxShape("flex p-4", opts, "padding", "axis", [])).toBe(
			"flex py-4 px-4",
		);
	});

	it("splits axes into per-side classes", () => {
		expect(convertBoxShape("px-4 py-2", opts, "padding", "sides", [])).toBe(
			"pt-2 pr-4 pb-2 pl-4",
		);
	});

	it("collapses per-side classes using the first defined side", () => {
		expect(
			convertBoxShape("pt-2 pr-4 pb-2 pl-4", opts, "padding", "linked", []),
		).toBe("p-2");
	});

	it("keeps partially set groups partial", () => {
		expect(convertBoxShape("px-4", opts, "padding", "sides", [])).toBe(
			"pr-4 pl-4",
		);
	});

	it("clears the shape without writing when nothing is set", () => {
		expect(convertBoxShape("flex", opts, "padding", "axis", [])).toBe("flex");
	});

	it("converts only the active scope", () => {
		expect(convertBoxShape("p-4 md:p-8", opts, "padding", "axis", ["md"])).toBe(
			"p-4 md:py-8 md:px-8",
		);
	});

	it("round-trips negative margins through a conversion", () => {
		expect(convertBoxShape("-m-2", opts, "margin", "axis", [])).toBe(
			"-my-2 -mx-2",
		);
	});
});

describe("boxProperties / boxTokenOptions", () => {
	it("lists all seven properties of a group", () => {
		expect(boxProperties("margin")).toEqual([
			"margin",
			"margin-x",
			"margin-y",
			"margin-top",
			"margin-right",
			"margin-bottom",
			"margin-left",
		]);
	});

	it("offers auto only for margins", () => {
		const margin = boxTokenOptions("margin", 4);
		const padding = boxTokenOptions("padding", 4);
		expect(margin[0]).toEqual({ value: "auto" });
		expect(padding.some((option) => option.value === "auto")).toBe(false);
		expect(padding.at(-1)).toEqual({ value: "px", resolved: "1px" });
	});
});
