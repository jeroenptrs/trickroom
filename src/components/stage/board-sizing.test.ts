import { describe, expect, it } from "vitest";
import { resolveBoardSizing } from "./board-sizing";

describe("resolveBoardSizing", () => {
	it("applies both defaults to boards without sizing", () => {
		expect(resolveBoardSizing(undefined)).toEqual({
			defaultWidth: true,
			defaultHeight: true,
		});
		expect(resolveBoardSizing("flex gap-4 bg-white p-6")).toEqual({
			defaultWidth: true,
			defaultHeight: true,
		});
	});

	it("treats width utilities under any variant as authored width", () => {
		for (const className of [
			"w-[640px]",
			"w-full",
			"w-fit",
			"w-1/2",
			"min-w-96",
			"max-w-screen-md",
			"md:w-96",
			"hover:max-w-none",
			"!w-80",
			"w-80!",
			"[width:300px]",
		]) {
			expect(resolveBoardSizing(className).defaultWidth, className).toBe(false);
		}
	});

	it("treats height utilities as authored height independently of width", () => {
		expect(resolveBoardSizing("w-[640px] h-[480px]")).toEqual({
			defaultWidth: false,
			defaultHeight: false,
		});
		expect(resolveBoardSizing("min-h-screen")).toEqual({
			defaultWidth: true,
			defaultHeight: false,
		});
		expect(resolveBoardSizing("size-96")).toEqual({
			defaultWidth: false,
			defaultHeight: false,
		});
	});

	it("does not mistake other utilities for sizing", () => {
		expect(resolveBoardSizing("whitespace-nowrap shadow-sm hidden")).toEqual({
			defaultWidth: true,
			defaultHeight: true,
		});
	});

	it("honours inline width and height", () => {
		expect(resolveBoardSizing("", { width: 320 })).toEqual({
			defaultWidth: false,
			defaultHeight: true,
		});
		expect(resolveBoardSizing("", { minHeight: 200 })).toEqual({
			defaultWidth: true,
			defaultHeight: false,
		});
	});
});
