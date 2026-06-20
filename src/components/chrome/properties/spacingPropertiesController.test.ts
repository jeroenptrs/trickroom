import { describe, expect, it } from "vitest";
import {
	applySpacingChange,
	applySpacingClear,
	formatSpacingInputValue,
	getSpacingEntry,
	parseSpacingInputValue,
} from "./spacingPropertiesController";

const opts = { colorTokens: new Set(["red-500"]) };

describe("spacingPropertiesController", () => {
	it("sets and clears exact spacing slots", () => {
		const className = "flex p-4 px-2 bg-red-500";
		const next = applySpacingChange(className, opts, {
			property: "padding-x",
			value: { kind: "scale", value: "6" },
		});
		expect(next).toBe("flex p-4 px-6 bg-red-500");
		expect(applySpacingClear(next, opts, "padding")).toBe(
			"flex px-6 bg-red-500",
		);
	});

	it("targets a breakpoint override slot without touching base", () => {
		const withMd = applySpacingChange("p-4", opts, {
			property: "padding",
			value: { kind: "scale", value: "6" },
			variants: ["md"],
		});
		expect(withMd).toBe("p-4 md:p-6");
		expect(applySpacingClear(withMd, opts, "padding", ["md"])).toBe("p-4");
	});

	it("formats existing spacing entries for inputs", () => {
		const entry = getSpacingEntry("p-[13px] -mt-4", opts, "margin-top");
		expect(formatSpacingInputValue(entry)).toBe("-4");
		expect(
			formatSpacingInputValue(
				getSpacingEntry("p-[13px] -mt-4", opts, "padding"),
			),
		).toBe("[13px]");
	});

	it("parses common input values", () => {
		expect(parseSpacingInputValue("4", "padding")).toEqual({
			value: { kind: "scale", value: "4" },
			negative: false,
		});
		expect(parseSpacingInputValue("-4", "margin-top")).toEqual({
			value: { kind: "scale", value: "4" },
			negative: true,
		});
		expect(parseSpacingInputValue("auto", "margin-x")).toEqual({
			value: { kind: "keyword", keyword: "auto" },
			negative: false,
		});
		expect(parseSpacingInputValue("[13px]", "padding")).toEqual({
			value: { kind: "arbitrary", value: "[13px]" },
			negative: false,
		});
		expect(parseSpacingInputValue("--space-card", "gap")).toEqual({
			value: { kind: "custom-property", value: "--space-card" },
			negative: false,
		});
	});
});
