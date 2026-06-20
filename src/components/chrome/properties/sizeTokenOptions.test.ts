import { describe, expect, it } from "vitest";
import {
	resolveSpacingBasePx,
	type SizeTokenContext,
	sizeTokenOptions,
} from "./sizeTokenOptions";
import { findTokenOption } from "./tokenFieldController";

const context: SizeTokenContext = {
	spacingBasePx: 4,
	containerTokens: new Map([
		["xs", "20rem"],
		["3xs", "16rem"],
		["DEFAULT", "0px"],
	]),
	aspectTokens: new Map([["video", "16 / 9"]]),
};

describe("sizeTokenOptions", () => {
	describe("resolveSpacingBasePx", () => {
		it("parses the DEFAULT spacing token to px", () => {
			expect(resolveSpacingBasePx(new Map([["DEFAULT", "0.25rem"]]))).toBe(4);
			expect(resolveSpacingBasePx(new Map([["DEFAULT", "2px"]]))).toBe(2);
		});

		it("returns null without a DEFAULT token or with an unparsable one", () => {
			expect(resolveSpacingBasePx(new Map())).toBeNull();
			expect(
				resolveSpacingBasePx(new Map([["DEFAULT", "calc(1vw)"]])),
			).toBeNull();
		});
	});

	it("builds the width scale with resolved px and keywords", () => {
		const options = sizeTokenOptions("size.width", context);
		expect(findTokenOption(options, "4")).toEqual({
			value: "4",
			resolved: "16px",
		});
		expect(findTokenOption(options, "px")).toEqual({
			value: "px",
			resolved: "1px",
		});
		expect(findTokenOption(options, "full")).toEqual({
			value: "full",
			resolved: "100%",
		});
		expect(findTokenOption(options, "screen")).toEqual({
			value: "screen",
			resolved: "100vw",
		});
		expect(findTokenOption(options, "1/2")).toEqual({
			value: "1/2",
			resolved: "50%",
		});
	});

	it("resolves height-axis screen to 100vh", () => {
		const options = sizeTokenOptions("size.height", context);
		expect(findTokenOption(options, "screen")).toEqual({
			value: "screen",
			resolved: "100vh",
		});
	});

	it("prepends the container scale to max-width, sorted ascending", () => {
		const options = sizeTokenOptions("size.max-width", context);
		expect(options[0]).toEqual({ value: "3xs", resolved: "256px" });
		expect(options[1]).toEqual({ value: "xs", resolved: "320px" });
		expect(findTokenOption(options, "DEFAULT")).toBeUndefined();
		expect(findTokenOption(options, "none")).toEqual({ value: "none" });
	});

	it("builds aspect options from the aspect tokens plus static square", () => {
		const options = sizeTokenOptions("size.aspect-ratio", context);
		expect(options).toEqual([
			{ value: "auto" },
			{ value: "square", resolved: "1 / 1" },
			{ value: "video", resolved: "16 / 9" },
		]);
	});

	it("returns no options for properties outside the size domain", () => {
		expect(sizeTokenOptions("layout.display", context)).toEqual([]);
	});
});
