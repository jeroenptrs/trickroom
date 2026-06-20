import { describe, expect, it } from "vitest";
import {
	applyStructureInput,
	readStructureValue,
	structureUtility,
} from "./structurePropertiesController";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";

const opts = { colorTokens: new Set(["red-500"]) };

describe("structurePropertiesController", () => {
	it("writes float without clobbering visibility or table layout", () => {
		const next = applyStyleUtility(
			"invisible table-fixed unknown-card",
			opts,
			"structure.float",
			structureUtility("structure.float", "right"),
		);
		expect(next).toBe("invisible table-fixed unknown-card float-right");
	});

	it("replaces only the targeted structure slot", () => {
		const next = applyStyleUtility(
			"box-border float-left clear-both columns-3",
			opts,
			"structure.clear",
			structureUtility("structure.clear", "none"),
		);
		expect(next).toBe("box-border float-left clear-none columns-3");
	});

	it("clears one structure property without touching unrelated classes", () => {
		expect(
			clearStyleProperty(
				"list-disc list-inside border-collapse border-spacing-2",
				opts,
				"structure.list-style-type",
			),
		).toBe("list-inside border-collapse border-spacing-2");
	});

	it("rejects arbitrary bracket values except on supported structure properties", () => {
		expect(structureUtility("structure.float", "[3rem]")).toBe("");
		expect(structureUtility("structure.columns", "[3rem]")).toBe(
			"columns-[3rem]",
		);
	});

	it("reads structure values and round-trips columns without losing unknown classes", () => {
		const input =
			"box-content visible float-end break-inside-avoid columns-3 custom-struct";
		expect(readStructureValue(input, opts, "structure.box-sizing")).toBe(
			"content",
		);
		expect(readStructureValue(input, opts, "structure.visibility")).toBe(
			"visible",
		);
		expect(readStructureValue(input, opts, "structure.float")).toBe("end");
		expect(readStructureValue(input, opts, "structure.break-inside")).toBe(
			"avoid",
		);
		expect(readStructureValue(input, opts, "structure.columns")).toBe("3");

		const next = applyStructureInput(input, opts, "structure.columns", "2");
		expect(next).toBe(
			"box-content visible float-end break-inside-avoid columns-2 custom-struct",
		);
		expect(
			styleValueText(getStyleIntent(next, opts, "structure.columns")),
		).toBe("2");
	});
});
