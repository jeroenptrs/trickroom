import { describe, expect, it } from "vitest";
import { hiddenSectionRows, type SectionRowInfo } from "./styleSectionRows";

function row(
	overrides: Partial<SectionRowInfo> & { id: string },
): SectionRowInfo {
	return { label: overrides.id, isSet: false, likely: false, ...overrides };
}

describe("hiddenSectionRows", () => {
	it("returns unset, unrevealed rows in registration order", () => {
		const rows = new Map<string, SectionRowInfo | null>([
			["a", row({ id: "a", isSet: true })],
			["b", row({ id: "b" })],
			["c", row({ id: "c", likely: true })],
		]);

		expect(hiddenSectionRows(rows, new Set()).map((r) => r.id)).toEqual([
			"b",
			"c",
		]);
	});

	it("excludes revealed rows and mounted-but-unreported placeholders", () => {
		const rows = new Map<string, SectionRowInfo | null>([
			["a", row({ id: "a" })],
			["pending", null],
			["b", row({ id: "b" })],
		]);

		expect(hiddenSectionRows(rows, new Set(["a"])).map((r) => r.id)).toEqual([
			"b",
		]);
	});
});
