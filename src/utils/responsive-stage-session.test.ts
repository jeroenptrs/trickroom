import { describe, expect, it } from "vitest";
import {
	getResponsiveStageSessionStorageKey,
	readResponsiveStageSessionWidthFromStorage,
	writeResponsiveStageSessionWidthToStorage,
} from "./responsive-stage-session";

function createStorage(initial: Record<string, string> = {}) {
	const items = new Map(Object.entries(initial));
	return {
		getItem(key: string) {
			return items.get(key) ?? null;
		},
		setItem(key: string, value: string) {
			items.set(key, value);
		},
		items,
	} satisfies Pick<Storage, "getItem" | "setItem"> & {
		items: Map<string, string>;
	};
}

describe("responsive stage session storage", () => {
	it("separates stored viewport widths by project scope and design file", () => {
		expect(
			getResponsiveStageSessionStorageKey("project-a", "design-one.json"),
		).not.toBe(
			getResponsiveStageSessionStorageKey("project-b", "design-one.json"),
		);
		expect(
			getResponsiveStageSessionStorageKey("project-a", "design-one.json"),
		).not.toBe(
			getResponsiveStageSessionStorageKey("project-a", "design-two.json"),
		);
	});

	it("falls back to the default width for missing or corrupt data", () => {
		const storage = createStorage({
			corrupt: "{",
			invalid: JSON.stringify({ width: "wide" }),
		});

		expect(readResponsiveStageSessionWidthFromStorage(storage, "missing")).toBe(
			640,
		);
		expect(readResponsiveStageSessionWidthFromStorage(storage, "corrupt")).toBe(
			640,
		);
		expect(readResponsiveStageSessionWidthFromStorage(storage, "invalid")).toBe(
			640,
		);
	});

	it("clamps stored viewport widths on read and write", () => {
		const storage = createStorage({
			large: JSON.stringify({ width: 9999 }),
		});

		expect(readResponsiveStageSessionWidthFromStorage(storage, "large")).toBe(
			2400,
		);

		writeResponsiveStageSessionWidthToStorage(storage, "small", 12);

		expect(JSON.parse(storage.items.get("small") ?? "{}")).toEqual({
			width: 320,
		});
	});
});
