import { describe, expect, it } from "vitest";
import { editDistance, formatDidYouMean, suggestClosest } from "./suggestions";

describe("editDistance", () => {
	it("counts insertions, deletions, substitutions, and transpositions", () => {
		expect(editDistance("container", "container")).toBe(0);
		expect(editDistance("contaner", "container")).toBe(1);
		expect(editDistance("itmes", "items")).toBe(1);
		expect(editDistance("flex-colum", "flex-col")).toBe(2);
	});

	it("stops early once the limit is exceeded", () => {
		expect(editDistance("a", "abcdefgh", 2)).toBe(3);
	});
});

describe("suggestClosest", () => {
	const candidates = ["container", "text", "asset", "icon"];

	it("ranks near misses and case-insensitive matches", () => {
		expect(suggestClosest("contaner", candidates)).toEqual(["container"]);
		expect(suggestClosest("Text", candidates)).toEqual(["text"]);
	});

	it("matches prefixes for names unless disabled", () => {
		expect(
			suggestClosest("dialog", ["dialog.default", "menu.default"]),
		).toEqual(["dialog.default"]);
		expect(
			suggestClosest("dialog", ["dialog.default", "menu.default"], {
				prefixMatches: false,
			}),
		).toEqual([]);
	});

	it("returns nothing when no candidate is close", () => {
		expect(suggestClosest("zzzzzz", candidates)).toEqual([]);
	});

	it("formats did-you-mean suffixes", () => {
		expect(formatDidYouMean([])).toBe("");
		expect(formatDidYouMean(["a", "b"])).toBe(' Did you mean "a", "b"?');
	});
});
