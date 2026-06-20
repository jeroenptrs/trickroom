import { describe, expect, it } from "vitest";
import {
	layerDropInsertionIndex,
	reorderInsertionIndex,
} from "./reorder-insertion-index";

describe("reorderInsertionIndex", () => {
	it("decrements when the source sits before the insertion point", () => {
		expect(reorderInsertionIndex(["A", "B", "C"], "A", 2)).toBe(1);
		expect(reorderInsertionIndex(["A", "B", "C"], "A", 1)).toBe(0);
	});

	it("leaves the index unchanged when the source is absent or at/after the point", () => {
		expect(reorderInsertionIndex(["A", "B", "C"], "C", 2)).toBe(2);
		expect(reorderInsertionIndex(["A", "B", "C"], "B", 1)).toBe(1);
		expect(reorderInsertionIndex(["A", "B", "C"], "missing", 2)).toBe(2);
	});
});

describe("layerDropInsertionIndex", () => {
	it("places the first sibling after the second without an off-by-one", () => {
		expect(layerDropInsertionIndex(["A", "B", "C"], "A", "after", "B")).toBe(1);
	});

	it("matches raw targetIndex + 1 when moving backward in the list", () => {
		expect(layerDropInsertionIndex(["A", "B", "C"], "C", "after", "B")).toBe(2);
	});
});
