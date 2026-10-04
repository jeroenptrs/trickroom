import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesignSystemStorage } from "./design-system-store";
import {
	addMemoryNote,
	applyMemoryNoteBodyEdits,
	deleteMemoryNote,
	type MemoryManifestError,
	memoryNoteRevision,
	migrateMemoryManifest,
	normalizeMemoryManifest,
	readMemoryManifest,
	summarizeMemoryNoteBody,
	toMemoryNoteIndexEntry,
	updateMemoryNote,
} from "./memory-manifest-service";

const expectError = async (
	promise: Promise<unknown>,
	code: MemoryManifestError["code"],
) => {
	await expect(promise).rejects.toMatchObject({ code });
};

describe("memory manifest service", () => {
	let projectRoot: string;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-memory-"),
		);
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	it("reads an empty project manifest before any writes", async () => {
		const read = await readMemoryManifest(projectRoot, { kind: "project" });
		expect(read.exists).toBe(false);
		expect(read.manifest.notes).toEqual({});
		expect(read.revision).toMatch(/^sha256:/);
	});

	it("adds and reads back a project note and bumps the revision", async () => {
		const empty = await readMemoryManifest(projectRoot, { kind: "project" });
		const { note, read } = await addMemoryNote(
			projectRoot,
			{ kind: "project" },
			{ body: "Why this project exists.", category: "intent" },
		);

		expect(note.noteId).toMatch(/^note_/);
		expect(read.exists).toBe(true);
		expect(read.revision).not.toBe(empty.revision);

		const reread = await readMemoryManifest(projectRoot, { kind: "project" });
		expect(reread.manifest.notes[note.noteId]).toMatchObject({
			body: "Why this project exists.",
			category: "intent",
			author: { kind: "agent" },
		});
		expect(reread.manifest.scope).toEqual({ kind: "project" });
	});

	it("rejects an invalid category", async () => {
		await expectError(
			addMemoryNote(
				projectRoot,
				{ kind: "project" },
				// @ts-expect-error testing runtime guard
				{ body: "x", category: "nonsense" },
			),
			"INVALID_CATEGORY",
		);
	});

	it("enforces expectedRevision on update with STALE_WRITE", async () => {
		const { note } = await addMemoryNote(
			projectRoot,
			{ kind: "project" },
			{ body: "first", category: "usage" },
		);

		await expectError(
			updateMemoryNote(
				projectRoot,
				{ kind: "project" },
				note.noteId,
				{ body: "second" },
				{ expectedRevision: "sha256:stale" },
			),
			"STALE_WRITE",
		);
	});

	it("updates and deletes a note with the current revision", async () => {
		const added = await addMemoryNote(
			projectRoot,
			{ kind: "project" },
			{ body: "draft", category: "todo" },
		);

		const updated = await updateMemoryNote(
			projectRoot,
			{ kind: "project" },
			added.note.noteId,
			{ body: "done", category: "decision" },
			{ expectedRevision: added.read.revision },
		);
		expect(updated.note.body).toBe("done");
		expect(updated.note.category).toBe("decision");

		const deleted = await deleteMemoryNote(
			projectRoot,
			{ kind: "project" },
			added.note.noteId,
			{ expectedRevision: updated.read.revision },
		);
		expect(deleted.manifest.notes).toEqual({});
	});

	it("accepts per-note revisions so edits to different notes do not conflict", async () => {
		const scope = { kind: "project" } as const;
		const first = await addMemoryNote(projectRoot, scope, {
			body: "first",
			category: "usage",
		});
		const second = await addMemoryNote(projectRoot, scope, {
			body: "second",
			category: "usage",
		});
		const firstRevision = memoryNoteRevision(first.note);
		const secondRevision = memoryNoteRevision(second.note);
		expect(firstRevision).not.toBe(secondRevision);

		// Both agents read before either wrote; the manifest revision moves
		// under the second writer, but its note revision is still current.
		const updatedFirst = await updateMemoryNote(
			projectRoot,
			scope,
			first.note.noteId,
			{ body: "first, edited" },
			{ expectedRevision: firstRevision },
		);
		const updatedSecond = await updateMemoryNote(
			projectRoot,
			scope,
			second.note.noteId,
			{ body: "second, edited" },
			{ expectedRevision: secondRevision },
		);
		expect(updatedSecond.read.manifest.notes[first.note.noteId]?.body).toBe(
			"first, edited",
		);

		// A stale note revision, or another note's revision, is rejected with
		// the current revisions attached.
		await expect(
			updateMemoryNote(
				projectRoot,
				scope,
				first.note.noteId,
				{ body: "lost update" },
				{ expectedRevision: firstRevision },
			),
		).rejects.toMatchObject({
			code: "STALE_WRITE",
			details: {
				noteId: first.note.noteId,
				noteRevision: memoryNoteRevision(updatedFirst.note),
				scopeRevision: updatedSecond.read.revision,
			},
		});
		await expectError(
			deleteMemoryNote(projectRoot, scope, first.note.noteId, {
				expectedRevision: memoryNoteRevision(updatedSecond.note),
			}),
			"STALE_WRITE",
		);

		// The manifest revision still works, and deletes take note revisions.
		await updateMemoryNote(
			projectRoot,
			scope,
			first.note.noteId,
			{ title: "First" },
			{ expectedRevision: updatedSecond.read.revision },
		);
		const deleted = await deleteMemoryNote(
			projectRoot,
			scope,
			second.note.noteId,
			{ expectedRevision: memoryNoteRevision(updatedSecond.note) },
		);
		expect(Object.keys(deleted.manifest.notes)).toEqual([first.note.noteId]);
		await expectError(
			deleteMemoryNote(projectRoot, scope, second.note.noteId, {
				expectedRevision: memoryNoteRevision(updatedSecond.note),
			}),
			"NOTE_NOT_FOUND",
		);
	});

	it("applies body edits without resending the body", async () => {
		const scope = { kind: "project" } as const;
		const { note } = await addMemoryNote(projectRoot, scope, {
			body: "Use brand tokens.\n\nAvoid raw hex colors.",
			category: "conventions",
		});
		const updated = await updateMemoryNote(
			projectRoot,
			scope,
			note.noteId,
			{
				edits: [
					{ op: "replace", oldText: "raw hex", newText: "arbitrary" },
					{ op: "append", text: "Spacing follows the 4px grid." },
				],
			},
			{ expectedRevision: memoryNoteRevision(note) },
		);
		expect(updated.note.body).toBe(
			"Use brand tokens.\n\nAvoid arbitrary colors.\n\nSpacing follows the 4px grid.",
		);

		// A failing edit writes nothing.
		await expectError(
			updateMemoryNote(
				projectRoot,
				scope,
				note.noteId,
				{
					edits: [
						{ op: "append", text: "never written" },
						{ op: "replace", oldText: "missing", newText: "x" },
					],
				},
				{ expectedRevision: memoryNoteRevision(updated.note) },
			),
			"EDIT_TEXT_NOT_FOUND",
		);
		const reread = await readMemoryManifest(projectRoot, scope);
		expect(reread.manifest.notes[note.noteId]?.body).toBe(updated.note.body);
	});

	it("rejects ambiguous and empty edits", () => {
		expect(() =>
			applyMemoryNoteBodyEdits("a b a", [
				{ op: "replace", oldText: "a", newText: "c" },
			]),
		).toThrow(expect.objectContaining({ code: "EDIT_TEXT_NOT_UNIQUE" }));
		expect(
			applyMemoryNoteBodyEdits("a b a", [
				{ op: "replace", oldText: "a", newText: "c", all: true },
			]),
		).toBe("c b c");
		expect(() =>
			applyMemoryNoteBodyEdits("only", [
				{ op: "replace", oldText: "only", newText: "" },
			]),
		).toThrow(expect.objectContaining({ code: "INVALID_EDIT" }));
		expect(
			applyMemoryNoteBodyEdits("body\n", [
				{ op: "prepend", text: "Lead." },
				{ op: "append", text: "\nsame paragraph" },
			]),
		).toBe("Lead.\n\nbody\n\nsame paragraph");
		expect(
			applyMemoryNoteBodyEdits("$1 cost", [
				{ op: "replace", oldText: "$1", newText: "$$2" },
			]),
		).toBe("$$2 cost");
	});

	it("summarizes notes for the index without the body", () => {
		expect(summarizeMemoryNoteBody("\n## Heading\nrest")).toBe("Heading");
		const long = `${"word ".repeat(40)}end`;
		const summary = summarizeMemoryNoteBody(long);
		expect(summary.length).toBeLessThanOrEqual(121);
		expect(summary.endsWith("…")).toBe(true);

		const entry = toMemoryNoteIndexEntry({
			noteId: "note_1",
			title: "Why",
			body: "Line one.\nLine two.",
			category: "intent",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
			author: { kind: "agent" },
		});
		expect(entry).toEqual({
			noteId: "note_1",
			title: "Why",
			category: "intent",
			updatedAt: "2026-01-02T00:00:00.000Z",
			size: 19,
			revision: expect.stringMatching(/^note:[0-9a-f]{20}$/),
			summary: "Line one.",
		});
	});

	it("rejects an unsafe design id", async () => {
		await expectError(
			readMemoryManifest(projectRoot, { kind: "design", designId: "../evil" }),
			"INVALID_SCOPE",
		);
	});

	it("stores design memory as a sibling file and preserves reference tokens", async () => {
		const designId = "00000000-0000-4000-8000-000000000001";
		const { note } = await addMemoryNote(
			projectRoot,
			{ kind: "design", designId },
			{
				body: "See {{design:00000000-0000-4000-8000-000000000002}} for layout.",
				category: "intent",
			},
		);

		const siblingPath = path.join(
			projectRoot,
			".trickroom",
			"designs",
			`${designId}.memory.json`,
		);
		const contents = await readFile(siblingPath, "utf8");
		expect(contents).toContain(
			"{{design:00000000-0000-4000-8000-000000000002}}",
		);
		expect(note.body).toContain("{{design:");
	});

	it("stores system memory under the system folder", async () => {
		await createDesignSystemStorage(projectRoot, {
			systemName: "Core",
			cssPath: "src/index.css",
		});

		const { read } = await addMemoryNote(
			projectRoot,
			{ kind: "system", systemHandle: "Core" },
			{ body: "Use brand tokens only.", category: "conventions" },
		);

		expect(read.scope.kind).toBe("system");
		expect(read.path).toContain(`${path.sep}systems${path.sep}core${path.sep}`);
		expect(read.path.endsWith("memory.json")).toBe(true);
	});

	it("fails for an unknown system scope", async () => {
		await expectError(
			readMemoryManifest(projectRoot, {
				kind: "system",
				systemHandle: "missing",
			}),
			"SCOPE_NOT_FOUND",
		);
	});

	it("rejects a manifest whose note key does not match noteId", async () => {
		const manifestPath = path.join(projectRoot, ".trickroom", "memory.json");
		await mkdir(path.dirname(manifestPath), { recursive: true });
		await writeFile(
			manifestPath,
			JSON.stringify({
				version: 1,
				scope: { kind: "project" },
				metadata: {
					createdAt: new Date(0).toISOString(),
					updatedAt: new Date(0).toISOString(),
				},
				notes: {
					note_a: {
						noteId: "note_b",
						body: "x",
						category: "intent",
						createdAt: new Date(0).toISOString(),
						updatedAt: new Date(0).toISOString(),
						author: { kind: "agent" },
					},
				},
			}),
			"utf8",
		);

		await expectError(
			readMemoryManifest(projectRoot, { kind: "project" }),
			"INVALID_MANIFEST",
		);
	});

	it("rejects unsupported manifest versions after migration", () => {
		expect(() =>
			normalizeMemoryManifest(
				{
					version: 99,
					scope: { kind: "project" },
					metadata: {
						createdAt: new Date(0).toISOString(),
						updatedAt: new Date(0).toISOString(),
					},
					notes: {},
				},
				{ kind: "project" },
				"path/memory.json",
			),
		).toThrow(/Unsupported memory manifest version/);
	});

	it("leaves version 1 manifests unchanged in migrateMemoryManifest", () => {
		const manifest = {
			version: 1,
			scope: { kind: "project" },
			metadata: {
				createdAt: new Date(0).toISOString(),
				updatedAt: new Date(0).toISOString(),
			},
			notes: {},
		};
		expect(migrateMemoryManifest(manifest)).toEqual(manifest);
	});
});
