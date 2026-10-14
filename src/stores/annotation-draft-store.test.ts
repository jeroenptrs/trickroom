import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotationTarget } from "../services/annotations.types";

const storage = new Map<string, string>();
let failStorage = false;

vi.stubGlobal("window", {
	get sessionStorage() {
		return {
			getItem: (key: string) => {
				if (failStorage) throw new Error("storage unavailable");
				return storage.get(key) ?? null;
			},
			setItem: (key: string, value: string) => {
				if (failStorage) throw new Error("storage unavailable");
				storage.set(key, value);
			},
			removeItem: (key: string) => {
				if (failStorage) throw new Error("storage unavailable");
				storage.delete(key);
			},
		};
	},
});

// The store is a module singleton; a fresh import stands in for a reload.
async function loadModule() {
	vi.resetModules();
	return import("./annotation-draft-store");
}

const layerTarget: AnnotationTarget = {
	kind: "layer",
	designId: "d1",
	boardId: "b1",
	elementId: "l1",
};
const boardTarget: AnnotationTarget = {
	kind: "board",
	designId: "d1",
	boardId: "b1",
};

const KEY = "trickroom:annotation-drafts:project-a";
const readStored = (key = KEY) => JSON.parse(storage.get(key) ?? "null");

beforeEach(() => {
	storage.clear();
	failStorage = false;
});

afterEach(() => {
	vi.useRealTimers();
});

describe("annotation draft store", () => {
	it("persists a draft under the project key with a version", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setAnnotationDraft(layerTarget, "make it bigger");

		expect(store.annotationDraftStorageKey("project-a")).toBe(KEY);
		const stored = readStored();
		expect(stored.version).toBe(1);
		expect(stored.drafts).toEqual([
			expect.objectContaining({ target: layerTarget, body: "make it bigger" }),
		]);
		expect(stored.replies).toEqual({});
	});

	it("keys drafts by target key", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setAnnotationDraft(layerTarget, "one");
		store.setAnnotationDraft(boardTarget, "two");

		expect(Object.keys(store.annotationDraftStore.get().drafts).sort()).toEqual(
			["board:d1/b1", "layer:d1/l1"],
		);
		expect(store.getAnnotationDrafts()).toHaveLength(2);
	});

	it("restores drafts and replies after a reload", async () => {
		const first = await loadModule();
		first.loadAnnotationDrafts("project-a");
		first.setAnnotationDraft(layerTarget, "keep me");
		first.setReplyDraft("ann-1", "reply text");

		const reloaded = await loadModule();
		expect(reloaded.annotationDraftStore.get().drafts).toEqual({});
		reloaded.loadAnnotationDrafts("project-a");

		const state = reloaded.annotationDraftStore.get();
		expect(state.projectScope).toBe("project-a");
		expect(state.drafts["layer:d1/l1"]).toMatchObject({
			key: "layer:d1/l1",
			target: layerTarget,
			body: "keep me",
		});
		expect(state.replies).toEqual({ "ann-1": "reply text" });
	});

	it("restores when switching away and back", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setAnnotationDraft(layerTarget, "kept");
		store.loadAnnotationDrafts(null);
		expect(store.annotationDraftStore.get().drafts).toEqual({});
		store.loadAnnotationDrafts("project-a");
		expect(store.getAnnotationDrafts().map((draft) => draft.body)).toEqual([
			"kept",
		]);
	});

	it("keeps drafts per project", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setAnnotationDraft(layerTarget, "for a");

		store.loadAnnotationDrafts("project-b");
		expect(store.getAnnotationDrafts()).toEqual([]);
		store.setAnnotationDraft(boardTarget, "for b");

		expect(readStored(KEY).drafts).toHaveLength(1);
		expect(
			readStored("trickroom:annotation-drafts:project-b").drafts[0].body,
		).toBe("for b");
		store.loadAnnotationDrafts("project-a");
		expect(store.getAnnotationDrafts().map((draft) => draft.body)).toEqual([
			"for a",
		]);
	});

	it("does not persist without a project scope", async () => {
		const store = await loadModule();
		store.setAnnotationDraft(layerTarget, "orphan");
		expect(storage.size).toBe(0);
		expect(store.getAnnotationDrafts()).toHaveLength(1);
	});

	it("removes a draft when its body is empty or whitespace", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setAnnotationDraft(layerTarget, "text");
		store.setAnnotationDraft(boardTarget, "other");
		store.setAnnotationDraft(layerTarget, "  \n\t");

		expect(Object.keys(store.annotationDraftStore.get().drafts)).toEqual([
			"board:d1/b1",
		]);
		expect(readStored().drafts).toHaveLength(1);
	});

	it("leaves the state untouched when emptying a draft that does not exist", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		const before = store.annotationDraftStore.get();
		store.setAnnotationDraft(layerTarget, "");
		store.setReplyDraft("nope", " ");
		expect(store.annotationDraftStore.get()).toBe(before);
	});

	it("updates an existing draft in place", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(1_000);
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setAnnotationDraft(layerTarget, "v1");
		vi.setSystemTime(2_000);
		store.setAnnotationDraft(layerTarget, "v2");

		const drafts = store.getAnnotationDrafts();
		expect(drafts).toHaveLength(1);
		expect(drafts[0]).toMatchObject({ body: "v2", updatedAt: 2_000 });
	});

	it("discards the drafts it is told to", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setAnnotationDraft(layerTarget, "a");
		store.setAnnotationDraft(boardTarget, "b");
		store.discardAnnotationDrafts(["layer:d1/l1", "unknown"]);

		expect(Object.keys(store.annotationDraftStore.get().drafts)).toEqual([
			"board:d1/b1",
		]);
		expect(readStored().drafts).toHaveLength(1);
	});

	it("keeps the state identity when discarding nothing", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setAnnotationDraft(layerTarget, "a");
		const before = store.annotationDraftStore.get();
		store.discardAnnotationDrafts(["unknown"]);
		expect(store.annotationDraftStore.get()).toBe(before);
	});

	it("keeps reply drafts per annotation and removes them when empty", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setReplyDraft("ann-1", "first");
		store.setReplyDraft("ann-2", "second");
		expect(readStored().replies).toEqual({
			"ann-1": "first",
			"ann-2": "second",
		});

		store.setReplyDraft("ann-1", "   ");
		expect(store.annotationDraftStore.get().replies).toEqual({
			"ann-2": "second",
		});
		expect(readStored().replies).toEqual({ "ann-2": "second" });
	});

	it("removes the storage key once everything is cleared", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setAnnotationDraft(layerTarget, "a");
		store.setReplyDraft("ann-1", "r");
		expect(storage.has(KEY)).toBe(true);

		store.discardAnnotationDrafts(["layer:d1/l1"]);
		expect(storage.has(KEY)).toBe(true);
		store.setReplyDraft("ann-1", "");
		expect(storage.has(KEY)).toBe(false);
	});
});

describe("reading stored drafts", () => {
	const seed = (value: unknown) => storage.set(KEY, JSON.stringify(value));

	it("ignores malformed JSON", async () => {
		storage.set(KEY, "{not json");
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		expect(store.annotationDraftStore.get()).toMatchObject({
			projectScope: "project-a",
			drafts: {},
			replies: {},
		});
	});

	it("ignores an unknown older version", async () => {
		seed({
			version: 0,
			drafts: [{ target: layerTarget, body: "x", updatedAt: 1 }],
			replies: { a: "b" },
		});
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		expect(store.getAnnotationDrafts()).toEqual([]);
		expect(store.annotationDraftStore.get().replies).toEqual({});
	});

	// Review round 1: a newer format must survive this version.
	it("keeps a newer version's payload and turns drafting off", async () => {
		const payload = JSON.stringify({
			version: 2,
			drafts: [{ target: layerTarget, body: "future unsent text" }],
			replies: { a: "future reply" },
		});
		storage.set(KEY, payload);
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		expect(store.annotationDraftStore.get().unsupported).toEqual({
			version: 2,
		});
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("version 2"));
		// Writes are refused, so nothing persists over (or removes) it.
		store.setAnnotationDraft(boardTarget, "typed here");
		store.setReplyDraft("a", "typed reply");
		store.clearSentAnnotationDraft("board:d1/b1", {
			projectScope: "project-a",
			body: "typed here",
		});
		expect(store.getAnnotationDrafts()).toEqual([]);
		expect(storage.get(KEY)).toBe(payload);
		// Switching away and back leaves it too.
		store.loadAnnotationDrafts("project-b");
		store.loadAnnotationDrafts("project-a");
		expect(storage.get(KEY)).toBe(payload);
		warn.mockRestore();
	});

	it("ignores non-object payloads", async () => {
		for (const value of [null, 3, "text", []]) {
			seed(value);
			const { readStoredAnnotationDrafts } = await loadModule();
			expect(readStoredAnnotationDrafts("project-a").drafts).toEqual({});
		}
	});

	it("keeps valid entries and skips invalid ones", async () => {
		seed({
			version: 1,
			drafts: [
				{ target: layerTarget, body: "good", updatedAt: 5 },
				{ target: { kind: "layer", designId: "d1" }, body: "bad target" },
				{ target: boardTarget, body: 42 },
				{ target: boardTarget, body: "   " },
				"junk",
				{ target: boardTarget, body: "no timestamp" },
			],
			replies: { a: "reply", b: "", c: 7, d: "  " },
		});
		const { readStoredAnnotationDrafts } = await loadModule();
		const state = readStoredAnnotationDrafts("project-a");

		expect(Object.values(state.drafts).map((draft) => draft.body)).toEqual([
			"good",
			"no timestamp",
		]);
		expect(state.drafts["board:d1/b1"].updatedAt).toBe(0);
		expect(state.replies).toEqual({ a: "reply" });
	});

	it("tolerates drafts and replies of the wrong shape", async () => {
		seed({ version: 1, drafts: { a: 1 }, replies: ["x"] });
		const { readStoredAnnotationDrafts } = await loadModule();
		const state = readStoredAnnotationDrafts("project-a");
		expect(state.drafts).toEqual({});
		expect(state.replies).toEqual({});
	});
});

describe("when storage throws", () => {
	it("does not throw out of loading or writing", async () => {
		failStorage = true;
		const store = await loadModule();
		expect(() => store.loadAnnotationDrafts("project-a")).not.toThrow();
		expect(() => store.setAnnotationDraft(layerTarget, "text")).not.toThrow();
		expect(() => store.setReplyDraft("ann-1", "text")).not.toThrow();
		expect(() => store.discardAnnotationDrafts(["layer:d1/l1"])).not.toThrow();
		// The in-memory drafts still work.
		expect(store.annotationDraftStore.get().replies).toEqual({
			"ann-1": "text",
		});
	});
});

// Review round 1: Send and Reply clear only what they sent.
describe("clearing sent drafts", () => {
	it("clears a draft that still holds the sent text", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setAnnotationDraft(layerTarget, "first text");
		const sent = store.captureSentDraft("first text");
		store.clearSentAnnotationDraft("layer:d1/l1", sent);
		expect(store.getAnnotationDrafts()).toEqual([]);
		expect(storage.has(KEY)).toBe(false);
	});

	it("keeps text typed while the send was in flight", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setAnnotationDraft(layerTarget, "first text");
		const sent = store.captureSentDraft("first text");
		store.setAnnotationDraft(layerTarget, "new unsent text");
		store.clearSentAnnotationDraft("layer:d1/l1", sent);
		expect(store.getAnnotationDrafts().map((draft) => draft.body)).toEqual([
			"new unsent text",
		]);
	});

	it("keeps a reply typed while the reply was in flight", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setReplyDraft("a1", "first reply");
		const sent = store.captureSentDraft("first reply");
		store.setReplyDraft("a1", "new unsent reply");
		store.clearSentReplyDraft("a1", sent);
		expect(store.annotationDraftStore.get().replies.a1).toBe(
			"new unsent reply",
		);
		store.clearSentReplyDraft("a1", store.captureSentDraft("new unsent reply"));
		expect(store.annotationDraftStore.get().replies.a1).toBeUndefined();
	});

	it("clears in the project it was sent from, not the one now open", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		store.setAnnotationDraft(layerTarget, "sent from a");
		const sent = store.captureSentDraft("sent from a");
		store.loadAnnotationDrafts("project-b");
		store.setAnnotationDraft(layerTarget, "sent from a");
		store.clearSentAnnotationDraft("layer:d1/l1", sent);
		// Project b's draft with the same target and text stays.
		expect(store.getAnnotationDrafts().map((draft) => draft.body)).toEqual([
			"sent from a",
		]);
		// Project a's stored copy is gone.
		expect(storage.has(KEY)).toBe(false);
	});

	it("keys replies without a prototype", async () => {
		const store = await loadModule();
		store.loadAnnotationDrafts("project-a");
		expect(
			store.annotationDraftStore.get().replies.constructor,
		).toBeUndefined();
		store.setReplyDraft("constructor", "a reply");
		expect(store.annotationDraftStore.get().replies.constructor).toBe(
			"a reply",
		);
	});
});
