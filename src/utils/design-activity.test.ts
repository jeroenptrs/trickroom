// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrickroomDesignSummary } from "../types";

type DesignActivityModule = typeof import("./design-activity");

const createStorage = () => {
	const values = new Map<string, string>();
	return {
		values,
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value);
		},
		removeItem: (key: string) => {
			values.delete(key);
		},
	};
};

const summary = (
	uuid: string,
	name: string,
	modifiedAt: string,
): TrickroomDesignSummary => ({
	uuid,
	file: `${uuid}/design.json`,
	name,
	boardsCount: 0,
	layersCount: 0,
	modifiedAt,
});

describe("design activity", () => {
	let storage: ReturnType<typeof createStorage>;
	let activity: DesignActivityModule;

	beforeEach(async () => {
		storage = createStorage();
		vi.stubGlobal("window", { localStorage: storage });
		vi.resetModules();
		activity = await import("./design-activity");
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps opened designs under one browser-wide key, whatever the scope", () => {
		activity.markDesignOpened(
			"/work/main",
			"design-a",
			"2026-10-01T10:00:00.000Z",
		);

		expect(
			JSON.parse(storage.values.get("trickroom:design-activity") ?? ""),
		).toEqual({ "design-a": "2026-10-01T10:00:00.000Z" });
		expect(storage.values.has("trickroom:design-activity:/work/main")).toBe(
			false,
		);
		// Another worktree of the same project is another scope.
		expect(activity.getDesignLastOpenedAt("/work/feature", "design-a")).toBe(
			"2026-10-01T10:00:00.000Z",
		);
	});

	it("merges the current scope's legacy history on read and writes only the new key", () => {
		storage.setItem(
			"trickroom:design-activity:/work/main",
			JSON.stringify({
				"design-a": "2026-09-01T10:00:00.000Z",
				"design-b": "2026-09-02T10:00:00.000Z",
			}),
		);
		storage.setItem(
			"trickroom:design-activity:/work/other",
			JSON.stringify({ "design-c": "2026-09-03T10:00:00.000Z" }),
		);
		storage.setItem(
			"trickroom:design-activity",
			JSON.stringify({ "design-a": "2026-09-05T10:00:00.000Z" }),
		);

		// The later of the two entries wins.
		expect(activity.getDesignLastOpenedAt("/work/main", "design-a")).toBe(
			"2026-09-05T10:00:00.000Z",
		);
		expect(activity.getDesignLastOpenedAt("/work/main", "design-b")).toBe(
			"2026-09-02T10:00:00.000Z",
		);
		// Other scopes' legacy maps are not read.
		expect(
			activity.getDesignLastOpenedAt("/work/main", "design-c"),
		).toBeUndefined();

		activity.markDesignOpened(
			"/work/main",
			"design-d",
			"2026-09-06T10:00:00.000Z",
		);

		expect(
			JSON.parse(storage.values.get("trickroom:design-activity") ?? ""),
		).toEqual({
			"design-d": "2026-09-06T10:00:00.000Z",
			"design-a": "2026-09-05T10:00:00.000Z",
			"design-b": "2026-09-02T10:00:00.000Z",
		});
		// The legacy map is left as it was.
		expect(
			JSON.parse(
				storage.values.get("trickroom:design-activity:/work/main") ?? "",
			),
		).toEqual({
			"design-a": "2026-09-01T10:00:00.000Z",
			"design-b": "2026-09-02T10:00:00.000Z",
		});
	});

	it("uses the default legacy scope when the project has none", () => {
		storage.setItem(
			"trickroom:design-activity:default",
			JSON.stringify({ "design-a": "2026-09-01T10:00:00.000Z" }),
		);

		expect(activity.getDesignLastOpenedAt(undefined, "design-a")).toBe(
			"2026-09-01T10:00:00.000Z",
		);
	});

	it("ignores malformed storage", () => {
		storage.setItem("trickroom:design-activity", "{not json");
		storage.setItem(
			"trickroom:design-activity:/work/main",
			JSON.stringify({ "design-a": "yesterday", "design-b": 42 }),
		);

		expect(
			activity.getDesignLastOpenedAt("/work/main", "design-a"),
		).toBeUndefined();
		expect(
			activity.getDesignLastOpenedAt("/work/main", "design-b"),
		).toBeUndefined();

		activity.markDesignOpened(
			"/work/main",
			"design-a",
			"2026-09-01T10:00:00.000Z",
		);
		expect(activity.getDesignLastOpenedAt("/work/main", "design-a")).toBe(
			"2026-09-01T10:00:00.000Z",
		);
	});

	it("never moves an opened time backwards", () => {
		activity.markDesignOpened(
			"/work/main",
			"design-a",
			"2026-09-05T10:00:00.000Z",
		);
		activity.markDesignOpened(
			"/work/main",
			"design-a",
			"2026-09-01T10:00:00.000Z",
		);

		expect(activity.getDesignLastOpenedAt("/work/main", "design-a")).toBe(
			"2026-09-05T10:00:00.000Z",
		);
	});

	it("orders designs by the later of their last change and last open, then by name", () => {
		const designs = [
			summary("old", "Old", "2026-09-01T10:00:00.000Z"),
			summary("edited", "Edited", "2026-09-04T10:00:00.000Z"),
			summary("opened", "Opened", "2026-09-02T10:00:00.000Z"),
			summary("tie-b", "B tie", "2026-09-03T10:00:00.000Z"),
			summary("tie-a", "A tie", "2026-09-03T10:00:00.000Z"),
		];
		activity.markDesignOpened(
			"/work/feature",
			"opened",
			"2026-09-05T10:00:00.000Z",
		);

		expect(
			activity
				.sortDesignsByRecentActivity(designs, "/work/main")
				.map((design) => design.uuid),
		).toEqual(["opened", "edited", "tie-a", "tie-b", "old"]);
		expect(
			activity.getDesignActivityTimestamp(
				"/work/main",
				designs[2] as TrickroomDesignSummary,
			),
		).toBe(Date.parse("2026-09-05T10:00:00.000Z"));
	});

	it("does nothing without a window", async () => {
		vi.unstubAllGlobals();
		vi.resetModules();
		const serverSide: DesignActivityModule = await import("./design-activity");

		serverSide.markDesignOpened("/work/main", "design-a");
		expect(
			serverSide.getDesignLastOpenedAt("/work/main", "design-a"),
		).toBeUndefined();
	});
});
