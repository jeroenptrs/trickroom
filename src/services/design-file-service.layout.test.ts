import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import { DESIGN_FILE_VERSION } from "./design-file-schema";
import {
	createDesignFileService,
	type DesignFileService,
} from "./design-file-service";

const board = (id: string, name = id): Node => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
	},
	children: [],
});

const design = (...boards: Node[]): TrickroomDesign => ({
	name: "Layout",
	boards,
});

const renamed = (source: TrickroomDesign, boardId: string, name: string) => ({
	...source,
	boards: source.boards.map((entry) =>
		entry.id === boardId
			? { ...entry, props: { ...entry.props, "data-trickroom-name": name } }
			: entry,
	),
});

describe("design folder layout", () => {
	let projectRoot: string;
	let service: DesignFileService;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-design-layout-test-"),
		);
		service = createDesignFileService(projectRoot);
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	const folder = (designId: string) => path.join(service.designsDir, designId);
	const boardFile = (designId: string, boardId: string) =>
		path.join(folder(designId), "boards", `${boardId}.json`);
	const manifestFile = (designId: string) =>
		path.join(folder(designId), "design.json");

	/** Inode and mtime of every file of a design, to see which were rewritten. */
	const snapshotFiles = async (designId: string) => {
		const files = [
			"design.json",
			...(await readdir(path.join(folder(designId), "boards"))).map(
				(name) => `boards/${name}`,
			),
		];
		const entries = await Promise.all(
			files.map(async (file) => {
				const fileStat = await stat(path.join(folder(designId), file));
				return [file, `${fileStat.ino}:${fileStat.mtimeMs}`] as const;
			}),
		);
		return Object.fromEntries(entries);
	};

	const changedFiles = (
		before: Record<string, string>,
		after: Record<string, string>,
	) =>
		[...new Set([...Object.keys(before), ...Object.keys(after)])]
			.filter((file) => before[file] !== after[file])
			.sort();

	const writeLegacy = async (designId: string, value: unknown) => {
		await mkdir(service.designsDir, { recursive: true });
		await writeFile(
			path.join(service.designsDir, `${designId}.json`),
			JSON.stringify(value),
			"utf8",
		);
	};

	it("rewrites only the board that changed", async () => {
		const created = await service.createDesignFile(
			"one",
			design(board("a"), board("b"), board("c")),
		);
		const before = await snapshotFiles("one");

		const written = await service.writeDesignFile(
			"one",
			renamed(created.design, "b", "B2"),
			{ expectedRevision: created.revision },
		);

		expect(changedFiles(before, await snapshotFiles("one"))).toEqual([
			"boards/b.json",
		]);
		expect(written.changedBoardIds).toEqual(["b"]);
	});

	it("adds, deletes and reorders boards one file at a time", async () => {
		const created = await service.createDesignFile(
			"sets",
			design(board("a"), board("b"), board("c")),
		);
		const [a, b, c] = created.design.boards as [Node, Node, Node];

		let before = await snapshotFiles("sets");
		const added = await service.writeDesignFile(
			"sets",
			{ ...created.design, boards: [a, board("new"), b, c] },
			{ expectedRevision: created.revision },
		);
		expect(changedFiles(before, await snapshotFiles("sets"))).toEqual([
			"boards/new.json",
		]);

		before = await snapshotFiles("sets");
		const deleted = await service.writeDesignFile(
			"sets",
			{ ...added.design, boards: [a, board("new"), c] },
			{ expectedRevision: added.revision },
		);
		expect(changedFiles(before, await snapshotFiles("sets"))).toEqual([
			"boards/b.json",
		]);

		before = await snapshotFiles("sets");
		const reordered = await service.writeDesignFile(
			"sets",
			{ ...deleted.design, boards: [c, a, board("new")] },
			{ expectedRevision: deleted.revision },
		);
		expect(changedFiles(before, await snapshotFiles("sets"))).toEqual([
			"boards/c.json",
		]);
		expect(reordered.design.boards.map((entry) => entry.id)).toEqual([
			"c",
			"a",
			"new",
		]);
		await expect(service.readDesignFile("sets")).resolves.toMatchObject({
			design: reordered.design,
			revision: reordered.revision,
		});
	});

	it("renames a design by rewriting only its manifest", async () => {
		const created = await service.createDesignFile(
			"named",
			design(board("a"), board("b")),
		);
		const before = await snapshotFiles("named");

		await service.writeDesignFile(
			"named",
			{ ...created.design, name: "Renamed" },
			{ expectedRevision: created.revision },
		);

		expect(changedFiles(before, await snapshotFiles("named"))).toEqual([
			"design.json",
		]);
	});

	it("reads a legacy design without writing and converts it on the first write", async () => {
		await writeLegacy("old", { version: 1, ...design(board("a"), board("b")) });
		const read = await service.readDesignFile("old");
		expect(read.storedVersion).toBe(1);
		expect(read.migrated).toBe(true);
		expect(read.file).toBe("old.json");
		await expect(readdir(service.designsDir)).resolves.toEqual(["old.json"]);

		const written = await service.writeDesignFile(
			"old",
			renamed(read.design, "a", "A2"),
			{ expectedRevision: read.revision },
		);

		await expect(readdir(service.designsDir)).resolves.toEqual(["old"]);
		await expect(readdir(path.join(folder("old"), "boards"))).resolves.toEqual([
			"a.json",
			"b.json",
		]);
		const reread = await service.readDesignFile("old");
		expect(reread).toMatchObject({
			design: written.design,
			revision: written.revision,
			storedVersion: DESIGN_FILE_VERSION,
			migrated: false,
			file: "old/design.json",
		});
	});

	it("keeps the same revision when a legacy design is converted unchanged", async () => {
		await writeLegacy("same", design(board("a")));
		const read = await service.readDesignFile("same");

		const written = await service.writeDesignFile("same", read.design, {
			expectedRevision: read.revision,
		});

		expect(written.revision).toBe(read.revision);
	});

	it("prefers the folder when an older single file exists too, and says so", async () => {
		await service.createDesignFile("both", design(board("a", "Folder")));
		await writeLegacy("both", design(board("a", "Legacy")));

		const read = await service.readDesignFile("both");
		expect(read.design.boards[0]?.props["data-trickroom-name"]).toBe("Folder");
		expect(read.warnings).toEqual([
			expect.objectContaining({ code: "LEGACY_DESIGN_FILE_PRESENT" }),
		]);
		await expect(service.readRawDesign("both")).resolves.toMatchObject({
			warnings: [
				expect.objectContaining({ code: "LEGACY_DESIGN_FILE_PRESENT" }),
			],
		});
		await expect(service.listDesignSummaries()).resolves.toEqual([
			expect.objectContaining({
				uuid: "both",
				warnings: [
					expect.objectContaining({ code: "LEGACY_DESIGN_FILE_PRESENT" }),
				],
			}),
		]);

		// Writes keep the legacy file for `trickroom migrate` to reconcile.
		await service.writeDesignFile("both", renamed(read.design, "a", "Edited"), {
			expectedRevision: read.revision,
		});
		await expect(
			stat(path.join(service.designsDir, "both.json")),
		).resolves.toBeTruthy();
	});

	it("lists only designs, in both layouts", async () => {
		await service.createDesignFile("folder-design", design(board("a")));
		await writeLegacy("legacy-design", design(board("a")));
		await writeFile(
			path.join(service.designsDir, "legacy-design.memory.json"),
			"{}",
			"utf8",
		);
		await writeFile(path.join(service.designsDir, ".gitkeep"), "", "utf8");
		await mkdir(path.join(service.designsDir, "not-a-design", "conflicts"), {
			recursive: true,
		});
		await writeFile(
			path.join(folder("folder-design"), "boards", ".a.json.123.tmp"),
			"{",
			"utf8",
		);

		const summaries = await service.listDesignSummaries();
		expect(summaries.map((summary) => [summary.uuid, summary.file])).toEqual([
			["folder-design", "folder-design/design.json"],
			["legacy-design", "legacy-design.json"],
		]);
		expect(summaries[0]).toMatchObject({ boardsCount: 1, name: "Layout" });
	});

	it("refreshes a cached summary when any board file changes", async () => {
		const created = await service.createDesignFile(
			"cached",
			design(board("a", "AAAA"), board("b")),
		);
		const [first] = await service.listDesignSummaries();
		expect(first?.revision).toBe(created.revision);

		// An edit outside Trickroom that keeps the file size.
		const filePath = boardFile("cached", "a");
		const contents = await readFile(filePath, "utf8");
		await writeFile(filePath, contents.replace("AAAA", "BBBB"), "utf8");

		const [second] = await service.listDesignSummaries();
		const read = await service.readDesignFile("cached");
		expect(second?.revision).toBe(read.revision);
		expect(second?.revision).not.toBe(created.revision);
	});

	it("refuses a design whose board file comes from a newer Trickroom", async () => {
		const created = await service.createDesignFile(
			"future",
			design(board("a")),
		);
		const filePath = boardFile("future", "a");
		const stored = JSON.parse(await readFile(filePath, "utf8"));
		await writeFile(
			filePath,
			JSON.stringify({ ...stored, version: DESIGN_FILE_VERSION + 1 }),
			"utf8",
		);

		await expect(service.readDesignFile("future")).rejects.toMatchObject({
			code: "UNSUPPORTED_DESIGN_VERSION",
		});
		await expect(service.listDesignSummaries()).resolves.toEqual([
			expect.objectContaining({
				uuid: "future",
				diagnostic: expect.objectContaining({
					code: "UNSUPPORTED_DESIGN_VERSION",
					version: DESIGN_FILE_VERSION + 1,
				}),
			}),
		]);
		await expect(
			service.writeDesignFile("future", created.design),
		).rejects.toMatchObject({ code: "UNSUPPORTED_DESIGN_VERSION" });
	});

	it("reports a board file that holds another board", async () => {
		await service.createDesignFile("mismatch", design(board("a")));
		const stored = JSON.parse(
			await readFile(boardFile("mismatch", "a"), "utf8"),
		);
		await writeFile(
			boardFile("mismatch", "a"),
			JSON.stringify({ ...stored, board: board("other") }),
			"utf8",
		);

		await expect(service.readDesignFile("mismatch")).rejects.toMatchObject({
			code: "INVALID_DESIGN_PAYLOAD",
			message: expect.stringContaining('holds board "other"'),
		});
	});

	it("refuses board ids that cannot be file names or that collide by case", async () => {
		for (const id of ["a/b", "..", ".hidden", "a:b", "trailing.", ""]) {
			await expect(
				service.writeDesignFile("unsafe", design(board(id))),
			).rejects.toMatchObject({ code: "INVALID_DESIGN_PAYLOAD" });
		}
		await expect(
			service.writeDesignFile("unsafe", design(board("Board"), board("board"))),
		).rejects.toMatchObject({ code: "INVALID_DESIGN_PAYLOAD" });
		await expect(stat(folder("unsafe"))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("reads one board on its own with the revision the design read reports", async () => {
		await service.createDesignFile("single", design(board("a"), board("b")));
		const read = await service.readDesignFile("single");

		const single = await service.readDesignBoard("single", "b");

		expect(single).toEqual({
			designId: "single",
			board: read.design.boards[1],
			revision: read.boards[1]?.revision,
		});
		await expect(service.readDesignBoard("single", "missing")).resolves.toBe(
			null,
		);
		await writeLegacy("legacy-single", design(board("x")));
		await expect(
			service.readDesignBoard("legacy-single", "x"),
		).resolves.toMatchObject({ board: board("x") });
	});

	it("orders boards that tie on their order key by id, and inserts between them", async () => {
		const created = await service.createDesignFile(
			"tie",
			design(board("a"), board("b")),
		);
		// Two branches each added a board with the same order key.
		const keyOf = async (boardId: string) =>
			JSON.parse(await readFile(boardFile("tie", boardId), "utf8")).order;
		const tiedKey = await keyOf("a");
		for (const id of ["y", "x"]) {
			await writeFile(
				boardFile("tie", id),
				JSON.stringify({
					version: DESIGN_FILE_VERSION,
					order: tiedKey,
					board: board(id),
				}),
				"utf8",
			);
		}
		const read = await service.readDesignFile("tie");
		expect(read.design.boards.map((entry) => entry.id)).toEqual([
			"a",
			"x",
			"y",
			"b",
		]);

		const [a, x, y, b] = read.design.boards as [Node, Node, Node, Node];
		const written = await service.writeDesignFile(
			"tie",
			{ ...created.design, boards: [a, x, board("between"), y, b] },
			{ expectedRevision: read.revision },
		);
		expect(written.design.boards.map((entry) => entry.id)).toEqual([
			"a",
			"x",
			"between",
			"y",
			"b",
		]);
		await expect(service.readDesignFile("tie")).resolves.toMatchObject({
			revision: written.revision,
		});
	});

	it("deletes every file of a design", async () => {
		await service.createDesignFile("gone", design(board("a")));
		await writeLegacy("gone", design(board("a")));

		await service.deleteDesignFile("gone");

		await expect(readdir(service.designsDir)).resolves.toEqual([]);
		await expect(service.deleteDesignFile("gone")).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("refuses to create a design that exists in either layout", async () => {
		await writeLegacy("taken", design(board("a")));

		await expect(
			service.createDesignFile("taken", design(board("a"))),
		).rejects.toMatchObject({ code: "DESIGN_FILE_ALREADY_EXISTS" });
		expect(
			await readFile(manifestFile("taken"), "utf8").catch(() => null),
		).toBe(null);
	});
});
