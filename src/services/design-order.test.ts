import { describe, expect, it } from "vitest";
import {
	assignOrderKeys,
	compareStoredBoardOrder,
	generateOrderKeyBetween,
	generateOrderKeysBetween,
	isValidOrderKey,
} from "./design-order";

const isSorted = (keys: readonly string[]) =>
	keys.every((key, index) => index === 0 || (keys[index - 1] as string) < key);

describe("board order keys", () => {
	it("generates a key strictly between any two keys", () => {
		const cases: [string | null, string | null][] = [
			[null, null],
			[null, "V"],
			["V", null],
			["V", "W"],
			["z", null],
			[null, "1"],
			[null, "01"],
			["a0V", "a1"],
			["V", "V1"],
		];
		for (const [before, after] of cases) {
			const key = generateOrderKeyBetween(before, after);
			expect(isValidOrderKey(key)).toBe(true);
			if (before !== null) expect(key > before).toBe(true);
			if (after !== null) expect(key < after).toBe(true);
		}
		expect(() => generateOrderKeyBetween("b", "a")).toThrow();
	});

	it("spreads many keys evenly and keeps them short", () => {
		const keys = generateOrderKeysBetween(null, null, 100);
		expect(keys).toHaveLength(100);
		expect(isSorted(keys)).toBe(true);
		expect(Math.max(...keys.map((key) => key.length))).toBeLessThanOrEqual(3);
	});

	it("keeps keys of boards that stay in order and keys only the rest", () => {
		const keys = assignOrderKeys([
			{ id: "c", key: "c" },
			{ id: "a", key: "a" },
			{ id: "new", key: null },
			{ id: "b", key: "b" },
		]);
		// One board moved (c) and one is new: a and b keep their keys.
		expect(keys.get("a")).toBe("a");
		expect(keys.get("b")).toBe("b");
		expect(keys.get("c")).not.toBe("c");
		const ordered = ["c", "a", "new", "b"].map((id) => keys.get(id) as string);
		expect(isSorted(ordered)).toBe(true);
	});

	it("makes room between boards that tie on their key", () => {
		const keys = assignOrderKeys([
			{ id: "x", key: "V" },
			{ id: "new", key: null },
			{ id: "y", key: "V" },
		]);
		const ordered = ["x", "new", "y"].map((id) => keys.get(id) as string);
		expect(isSorted(ordered)).toBe(true);
		expect(keys.get("x")).toBe("V");
	});

	it("replaces keys that are missing or invalid", () => {
		const keys = assignOrderKeys([
			{ id: "a", key: "V" },
			{ id: "b", key: "bad key" },
			{ id: "c", key: "V0" },
		]);
		expect(keys.get("c")).not.toBe("V0");
		const ordered = ["a", "b", "c"].map((id) => keys.get(id) as string);
		expect(isSorted(ordered)).toBe(true);
	});

	it("sorts stored boards by key, then id, with invalid keys last", () => {
		const boards = [
			{ id: "d", order: 5 },
			{ id: "b", order: "V" },
			{ id: "a", order: "V" },
			{ id: "c", order: "A" },
		];
		expect(
			[...boards].sort(compareStoredBoardOrder).map((entry) => entry.id),
		).toEqual(["c", "a", "b", "d"]);
	});
});
