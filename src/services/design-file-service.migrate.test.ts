import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrate } from "../cli/migrate";
import type { Node } from "../types";
import {
	addMemoryNote,
	readMemoryManifest,
} from "../utils/memory-manifest-service";
import { DESIGN_FILE_VERSION } from "./design-file-schema";
import {
	createDesignFileService,
	type DesignFileService,
} from "./design-file-service";

const board = (id: string, name = id, children: Node[] = []): Node => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
	},
	children,
});

const v0Design = {
	name: "Version 0",
	componentMigrationPolicy: null,
	boards: [board("a"), board("b")],
};
const v1Design = { version: 1, name: "Version 1", boards: [board("c")] };

describe("migrating designs to the folder layout", () => {
	let projectRoot: string;
	let service: DesignFileService;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-design-migrate-test-"),
		);
		service = createDesignFileService(projectRoot);
		await mkdir(service.designsDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	const writeLegacy = (designId: string, value: unknown) =>
		writeFile(
			path.join(service.designsDir, `${designId}.json`),
			JSON.stringify(value),
			"utf8",
		);

	const listTree = async (): Promise<string[]> => {
		const walk = async (
			directory: string,
			prefix: string,
		): Promise<string[]> => {
			const entries = await readdir(directory, { withFileTypes: true });
			const nested = await Promise.all(
				entries.map((entry) =>
					entry.isDirectory()
						? walk(path.join(directory, entry.name), `${prefix}${entry.name}/`)
						: [`${prefix}${entry.name}`],
				),
			);
			return nested.flat().sort();
		};
		return walk(service.designsDir, "");
	};

	it("converts version 0 and version 1 designs, reading back the same design", async () => {
		await writeLegacy("zero", v0Design);
		await writeLegacy("one", v1Design);
		const before = await Promise.all(
			["zero", "one"].map((id) => service.readDesignFile(id)),
		);

		const results = await Promise.all(
			["zero", "one"].map((id) => service.migrateDesign(id)),
		);

		expect(results.map((result) => [result.status, result.verified])).toEqual([
			["converted", true],
			["converted", true],
		]);
		expect(results[0]).toMatchObject({
			boardCount: 2,
			filesWritten: [
				"zero/boards/a.json",
				"zero/boards/b.json",
				"zero/design.json",
			],
			filesRemoved: ["zero.json"],
		});
		await expect(listTree()).resolves.toEqual([
			"one/boards/c.json",
			"one/design.json",
			"zero/boards/a.json",
			"zero/boards/b.json",
			"zero/design.json",
		]);
		const after = await Promise.all(
			["zero", "one"].map((id) => service.readDesignFile(id)),
		);
		expect(after.map((read) => read.design)).toEqual(
			before.map((read) => read.design),
		);
		expect(after.map((read) => read.revision)).toEqual(
			before.map((read) => read.revision),
		);
		expect(
			after.every((read) => read.storedVersion === DESIGN_FILE_VERSION),
		).toBe(true);
	});

	it("is idempotent", async () => {
		await writeLegacy("zero", v0Design);
		await service.migrateDesign("zero");
		const tree = await listTree();

		await expect(service.migrateDesign("zero")).resolves.toMatchObject({
			status: "current",
			filesWritten: [],
			filesRemoved: [],
		});
		await expect(listTree()).resolves.toEqual(tree);
	});

	it("lists what would change without writing in a dry run", async () => {
		await writeLegacy("zero", v0Design);

		const result = await service.migrateDesign("zero", { dryRun: true });

		expect(result).toMatchObject({
			status: "converted",
			filesWritten: [
				"zero/boards/a.json",
				"zero/boards/b.json",
				"zero/design.json",
			],
			filesRemoved: ["zero.json"],
		});
		expect(result.verified).toBeUndefined();
		await expect(listTree()).resolves.toEqual(["zero.json"]);
	});

	it("skips designs it cannot read and designs from a newer Trickroom", async () => {
		await writeLegacy("broken", { name: "Broken" });
		await writeLegacy("future", {
			...v1Design,
			version: DESIGN_FILE_VERSION + 1,
		});

		const results = await Promise.all(
			["broken", "future"].map((id) => service.migrateDesign(id)),
		);

		expect(results.map((result) => result.status)).toEqual([
			"skipped",
			"skipped",
		]);
		expect(results[1]?.reason).toContain("newer than this Trickroom supports");
		await expect(listTree()).resolves.toEqual(["broken.json", "future.json"]);
	});

	describe("when the folder and the old file both exist", () => {
		const setUp = async () => {
			// The folder side: boards a and b. The old file (edited on another
			// branch): a changed, b unchanged, c added, and a new name.
			await service.createDesignFile("merged", {
				name: "Folder name",
				boards: [board("a"), board("b")],
			});
			await writeLegacy("merged", {
				version: 1,
				name: "Old name",
				boards: [board("a", "A edited in old file"), board("c"), board("b")],
			});
		};

		it("adds boards only the old file has, saves differing ones and removes the old file", async () => {
			await setUp();

			const result = await service.migrateDesign("merged");

			expect(result).toMatchObject({
				status: "reconciled",
				verified: true,
				addedBoardIds: ["c"],
				conflictFiles: [
					"merged/conflicts/a.json",
					"merged/conflicts/design.json",
				],
				filesRemoved: ["merged.json"],
			});
			const read = await service.readDesignFile("merged");
			expect(read.design.name).toBe("Folder name");
			expect(read.design.boards.map((entry) => entry.id)).toEqual([
				"a",
				"c",
				"b",
			]);
			expect(read.design.boards[0]?.props["data-trickroom-name"]).toBe("a");
			expect(read.warnings).toBeUndefined();
			await expect(
				readFile(
					path.join(service.designsDir, "merged", "conflicts", "a.json"),
					"utf8",
				).then(JSON.parse),
			).resolves.toEqual({
				version: DESIGN_FILE_VERSION,
				source: "merged.json",
				board: board("a", "A edited in old file"),
			});
			await expect(listTree()).resolves.toEqual([
				"merged/boards/a.json",
				"merged/boards/b.json",
				"merged/boards/c.json",
				"merged/conflicts/a.json",
				"merged/conflicts/design.json",
				"merged/design.json",
			]);
		});

		it("only reports in a dry run", async () => {
			await setUp();

			await expect(
				service.migrateDesign("merged", { dryRun: true }),
			).resolves.toMatchObject({
				status: "reconciled",
				addedBoardIds: ["c"],
				conflictFiles: [
					"merged/conflicts/a.json",
					"merged/conflicts/design.json",
				],
			});
			await expect(listTree()).resolves.toContain("merged.json");
		});

		it("saves a board whose ids already exist elsewhere instead of adding it", async () => {
			await service.createDesignFile("demoted", {
				name: "Demoted",
				boards: [board("a", "a", [board("x")])],
			});
			await writeLegacy("demoted", {
				version: 1,
				name: "Demoted",
				boards: [board("a"), board("x")],
			});

			const result = await service.migrateDesign("demoted");

			expect(result.addedBoardIds).toEqual([]);
			expect(result.conflictFiles).toEqual([
				"demoted/conflicts/a.json",
				"demoted/conflicts/x.json",
			]);
		});
	});

	describe("the trickroom migrate command", () => {
		const run = async (args: string[]) => {
			const stdout: string[] = [];
			const stderr: string[] = [];
			const code = await runMigrate(args, {
				stdout: (line) => stdout.push(line),
				stderr: (line) => stderr.push(line),
			});
			return { code, stdout, stderr };
		};

		it("migrates every design of a project and summarizes counts and sizes", async () => {
			await writeLegacy("zero", v0Design);
			await writeLegacy("one", v1Design);

			const dryRun = await run([projectRoot, "--dry-run"]);
			expect(dryRun.code).toBe(0);
			expect(dryRun.stdout.at(-1)).toMatch(
				/^2 designs \(dry run, nothing written\): 2 to convert, 0 to reconcile, 0 already current, 0 skipped\. Files: 5 to write, 2 to remove\./,
			);
			await expect(listTree()).resolves.toEqual(["one.json", "zero.json"]);

			const migrated = await run([projectRoot]);
			expect(migrated.code).toBe(0);
			expect(migrated.stdout.slice(0, 2)).toEqual([
				expect.stringMatching(/^converted +one {2}1 boards {2}/),
				expect.stringMatching(/^converted +zero {2}2 boards {2}/),
			]);
			expect(migrated.stdout.join("\n")).not.toContain("Version 0");

			const again = await run([projectRoot, "--json"]);
			expect(JSON.parse(again.stdout.join("\n")).summary).toMatchObject({
				designs: 2,
				current: 2,
				filesWritten: 0,
			});
		});

		it("fails on a missing project or unknown option", async () => {
			await expect(
				run([path.join(projectRoot, "missing")]),
			).resolves.toMatchObject({ code: 1 });
			await expect(run([projectRoot, "--force"])).resolves.toMatchObject({
				code: 1,
				stderr: [expect.stringContaining("Unknown option --force")],
			});
		});
	});

	describe("design memory", () => {
		const scope = (designId: string) => ({ kind: "design", designId }) as const;
		const addNote = (designId: string, body: string) =>
			addMemoryNote(projectRoot, scope(designId), { body, category: "intent" });
		const noteBodies = async (designId: string) =>
			Object.values(
				(await readMemoryManifest(projectRoot, scope(designId))).manifest.notes,
			).map((note) => note.body);

		it("stays next to a legacy design and moves into the folder with it", async () => {
			await writeLegacy("memo", v1Design);
			await addNote("memo", "Why this exists");
			await expect(listTree()).resolves.toEqual([
				"memo.json",
				"memo.memory.json",
			]);
			const before = await readMemoryManifest(projectRoot, scope("memo"));

			const read = await service.readDesignFile("memo");
			await service.writeDesignFile(
				"memo",
				{ ...read.design, name: "Converted" },
				{ expectedRevision: read.revision },
			);

			await expect(listTree()).resolves.toEqual([
				"memo/boards/c.json",
				"memo/design.json",
				"memo/memory.json",
			]);
			const after = await readMemoryManifest(projectRoot, scope("memo"));
			expect(after.revision).toBe(before.revision);
			expect(after.path).toBe(
				path.join(service.designsDir, "memo", "memory.json"),
			);
		});

		it("reads an old memory file next to a folder design and moves it on the next note", async () => {
			await service.createDesignFile("late", { name: "Late", boards: [] });
			await writeFile(
				path.join(service.designsDir, "late.memory.json"),
				JSON.stringify(
					(await readMemoryManifest(projectRoot, scope("late"))).manifest,
				),
				"utf8",
			);
			await expect(noteBodies("late")).resolves.toEqual([]);

			await addNote("late", "First");

			await expect(noteBodies("late")).resolves.toEqual(["First"]);
			await expect(listTree()).resolves.toEqual([
				"late/design.json",
				"late/memory.json",
			]);
		});

		it("merges notes from an old memory file when reconciling", async () => {
			await service.createDesignFile("notes", { name: "Notes", boards: [] });
			await addNote("notes", "Folder note");
			const folderMemory = await readFile(
				path.join(service.designsDir, "notes", "memory.json"),
				"utf8",
			);
			// Another branch added a note to the old file.
			const old = JSON.parse(folderMemory);
			old.notes.note_other = {
				...(Object.values(old.notes)[0] as object),
				noteId: "note_other",
				body: "Old file note",
			};
			await writeFile(
				path.join(service.designsDir, "notes.memory.json"),
				JSON.stringify(old),
				"utf8",
			);

			const result = await service.migrateDesign("notes");

			expect(result).toMatchObject({
				status: "reconciled",
				filesRemoved: ["notes.memory.json"],
				conflictFiles: [],
			});
			await expect(noteBodies("notes")).resolves.toEqual([
				"Folder note",
				"Old file note",
			]);
		});

		it("is removed with its design", async () => {
			await service.createDesignFile("doomed", { name: "Doomed", boards: [] });
			await addNote("doomed", "Note");
			await writeFile(
				path.join(service.designsDir, "doomed.memory.json"),
				"{}",
				"utf8",
			);

			await service.deleteDesignFile("doomed");

			await expect(listTree()).resolves.toEqual([]);
		});
	});
});
