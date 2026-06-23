import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesignSystemStorage } from "./design-system-store";
import {
	addMemoryNote,
	deleteMemoryNote,
	type MemoryManifestError,
	readMemoryManifest,
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
});
