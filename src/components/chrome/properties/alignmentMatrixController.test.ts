import { describe, expect, it } from "vitest";
import {
	alignmentCell,
	cellAlignment,
	isDistributeValue,
	normalizeFlexAxis,
} from "./alignmentMatrixController";

describe("normalizeFlexAxis", () => {
	it("maps col and col-reverse to the col axis", () => {
		expect(normalizeFlexAxis("col")).toBe("col");
		expect(normalizeFlexAxis("col-reverse")).toBe("col");
	});

	it("defaults row, row-reverse, and unset to the row axis", () => {
		expect(normalizeFlexAxis("row")).toBe("row");
		expect(normalizeFlexAxis("row-reverse")).toBe("row");
		expect(normalizeFlexAxis(null)).toBe("row");
	});
});

describe("cellAlignment", () => {
	it("maps columns to justify and rows to align in a row container", () => {
		expect(cellAlignment("row", 0, 2)).toEqual({
			justify: "start",
			align: "end",
		});
		expect(cellAlignment("row", 1, 1)).toEqual({
			justify: "center",
			align: "center",
		});
	});

	it("swaps the axes in a column container", () => {
		expect(cellAlignment("col", 0, 2)).toEqual({
			justify: "end",
			align: "start",
		});
	});
});

describe("alignmentCell", () => {
	it("is the inverse of cellAlignment on both axes", () => {
		for (const axis of ["row", "col"] as const) {
			for (let column = 0; column < 3; column += 1) {
				for (let row = 0; row < 3; row += 1) {
					const { justify, align } = cellAlignment(axis, column, row);
					expect(alignmentCell(axis, justify, align)).toEqual({ column, row });
				}
			}
		}
	});

	it("returns null when either value is unset", () => {
		expect(alignmentCell("row", "start", null)).toBeNull();
		expect(alignmentCell("row", null, "center")).toBeNull();
	});

	it("returns null for values outside the matrix (between, stretch)", () => {
		expect(alignmentCell("row", "between", "center")).toBeNull();
		expect(alignmentCell("row", "start", "stretch")).toBeNull();
	});
});

describe("isDistributeValue", () => {
	it("recognizes the distribution justify values", () => {
		expect(isDistributeValue("between")).toBe(true);
		expect(isDistributeValue("around")).toBe(true);
		expect(isDistributeValue("evenly")).toBe(true);
	});

	it("rejects positions and unset", () => {
		expect(isDistributeValue("center")).toBe(false);
		expect(isDistributeValue(null)).toBe(false);
	});
});
