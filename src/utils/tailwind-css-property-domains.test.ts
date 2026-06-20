import { describe, expect, it } from "vitest";
import {
	cssPropertyToDomain,
	inferCustomUtilityDomains,
} from "./tailwind-css-property-domains";

describe("cssPropertyToDomain", () => {
	it("routes colour properties to the panel that edits that colour", () => {
		// No standalone colour panel: colour folds into its structural panel.
		expect(cssPropertyToDomain("background-color")).toBe("background");
		expect(cssPropertyToDomain("border-color")).toBe("border");
		expect(cssPropertyToDomain("border-top-color")).toBe("border");
		expect(cssPropertyToDomain("color")).toBe("typography");
		expect(cssPropertyToDomain("text-decoration-color")).toBe("typography");
		expect(cssPropertyToDomain("outline-color")).toBe("focus");
	});

	it("keeps border geometry on the border domain", () => {
		expect(cssPropertyToDomain("border-width")).toBe("border");
		expect(cssPropertyToDomain("border-radius")).toBe("border");
		expect(cssPropertyToDomain("border-top-left-radius")).toBe("border");
	});

	it("routes all background properties to the background domain", () => {
		expect(cssPropertyToDomain("background-image")).toBe("background");
		expect(cssPropertyToDomain("background-size")).toBe("background");
		expect(cssPropertyToDomain("background-color")).toBe("background");
	});

	it("maps typography, spacing, size, layout, effects, motion, transform", () => {
		expect(cssPropertyToDomain("font-size")).toBe("typography");
		expect(cssPropertyToDomain("line-height")).toBe("typography");
		expect(cssPropertyToDomain("letter-spacing")).toBe("typography");
		expect(cssPropertyToDomain("padding-inline")).toBe("spacing");
		expect(cssPropertyToDomain("margin")).toBe("spacing");
		expect(cssPropertyToDomain("gap")).toBe("spacing");
		expect(cssPropertyToDomain("width")).toBe("size");
		expect(cssPropertyToDomain("max-height")).toBe("size");
		expect(cssPropertyToDomain("inline-size")).toBe("size");
		expect(cssPropertyToDomain("block-size")).toBe("size");
		expect(cssPropertyToDomain("min-inline-size")).toBe("size");
		expect(cssPropertyToDomain("display")).toBe("layout");
		expect(cssPropertyToDomain("justify-content")).toBe("layout");
		expect(cssPropertyToDomain("box-shadow")).toBe("effects");
		expect(cssPropertyToDomain("opacity")).toBe("effects");
		expect(cssPropertyToDomain("transition-property")).toBe("motion");
		expect(cssPropertyToDomain("transform")).toBe("transform");
		expect(cssPropertyToDomain("cursor")).toBe("interaction");
		expect(cssPropertyToDomain("fill")).toBe("vector");
		expect(cssPropertyToDomain("outline-style")).toBe("focus");
		expect(cssPropertyToDomain("mask-image")).toBe("mask");
		expect(cssPropertyToDomain("z-index")).toBe("position");
	});

	it("routes table/list/box-flow properties to the structure domain", () => {
		expect(cssPropertyToDomain("table-layout")).toBe("structure");
		expect(cssPropertyToDomain("caption-side")).toBe("structure");
		expect(cssPropertyToDomain("border-collapse")).toBe("structure");
		expect(cssPropertyToDomain("border-spacing")).toBe("structure");
		expect(cssPropertyToDomain("list-style-type")).toBe("structure");
		expect(cssPropertyToDomain("list-style-image")).toBe("structure");
		expect(cssPropertyToDomain("break-inside")).toBe("structure");
		expect(cssPropertyToDomain("box-sizing")).toBe("structure");
		expect(cssPropertyToDomain("box-decoration-break")).toBe("structure");
		expect(cssPropertyToDomain("visibility")).toBe("structure");
		expect(cssPropertyToDomain("float")).toBe("structure");
		expect(cssPropertyToDomain("clear")).toBe("structure");
		expect(cssPropertyToDomain("columns")).toBe("structure");
		// Border *paint*/sizing still belongs to the border panel, not structure.
		expect(cssPropertyToDomain("border-color")).toBe("border");
		expect(cssPropertyToDomain("border-width")).toBe("border");
	});

	it("strips vendor prefixes and returns null for unmapped properties", () => {
		expect(cssPropertyToDomain("-webkit-box-shadow")).toBe("effects");
		expect(cssPropertyToDomain("speak")).toBeNull();
	});
});

describe("inferCustomUtilityDomains", () => {
	it("returns sorted, de-duplicated domains from compiled CSS", () => {
		// font-weight + text `color` → typography; cursor → interaction.
		const css = `.x { font-weight: 600; cursor: pointer; color: red; }`;
		expect(inferCustomUtilityDomains(css)).toEqual([
			"interaction",
			"typography",
		]);
	});

	it("handles nested/variant rules and ignores custom properties", () => {
		const css = `.x { --foo: 1; font-size: 1rem; &:hover { background-color: blue; } }`;
		expect(inferCustomUtilityDomains(css)).toEqual([
			"background",
			"typography",
		]);
	});

	it("returns empty for null or domain-less CSS", () => {
		expect(inferCustomUtilityDomains(null)).toEqual([]);
		expect(inferCustomUtilityDomains(".x { speak: none; }")).toEqual([]);
	});
});
