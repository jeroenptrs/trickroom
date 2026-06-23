import { describe, expect, it } from "vitest";
import {
	MEMORY_CATEGORIES,
	type MemoryNote,
} from "../../../utils/memory-manifest-service.types";
import { MEMORY_CATEGORY_META } from "./memory-category-meta";
import { parseMemoryNoteTags, sortMemoryNotes } from "./memory-note-utils";

const note = (overrides: Partial<MemoryNote>): MemoryNote => ({
	noteId: "note_x",
	body: "body",
	category: "intent",
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	author: { kind: "user" },
	...overrides,
});

describe("sortMemoryNotes", () => {
	it("orders pinned first, then order, then newest updated", () => {
		const notes = [
			note({ noteId: "a", updatedAt: "2026-01-01T00:00:00.000Z" }),
			note({ noteId: "b", updatedAt: "2026-02-01T00:00:00.000Z" }),
			note({ noteId: "pinned", pinned: true }),
			note({ noteId: "ordered", order: -1 }),
		];
		expect(sortMemoryNotes(notes).map((entry) => entry.noteId)).toEqual([
			"pinned",
			"ordered",
			"b",
			"a",
		]);
	});

	it("does not mutate the input array", () => {
		const notes = [note({ noteId: "a" }), note({ noteId: "b", pinned: true })];
		const snapshot = notes.map((entry) => entry.noteId);
		sortMemoryNotes(notes);
		expect(notes.map((entry) => entry.noteId)).toEqual(snapshot);
	});
});

describe("parseMemoryNoteTags", () => {
	it("trims, splits, and drops empties", () => {
		expect(parseMemoryNoteTags(" layout , , spacing ,")).toEqual([
			"layout",
			"spacing",
		]);
	});

	it("returns an empty array for blank input", () => {
		expect(parseMemoryNoteTags("   ")).toEqual([]);
	});
});

describe("MEMORY_CATEGORY_META", () => {
	it("covers every category enum value", () => {
		for (const category of MEMORY_CATEGORIES) {
			expect(MEMORY_CATEGORY_META[category]).toBeDefined();
			expect(MEMORY_CATEGORY_META[category].label.length).toBeGreaterThan(0);
		}
	});
});
