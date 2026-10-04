import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import {
	createDesignFileService,
	type DesignFileService,
} from "./design-file-service";
import { calculateDesignRevision } from "./design-revision";

/**
 * Correctness edges of the write path's shortcuts: unchanged boards are
 * recognised by comparing their serialization with the stored file instead
 * of hashing them, and the stored design's revision comes from the plan.
 */

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

const design = (...boards: Node[]): TrickroomDesign => ({
	name: "Write path",
	boards,
});

describe("design write path", () => {
	let projectRoot: string;
	let service: DesignFileService;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-design-write-path-test-"),
		);
		service = createDesignFileService(projectRoot);
	});

	afterEach(async () => {
		await rm(projectRoot, { force: true, recursive: true });
	});

	const boardFile = (designId: string, boardId: string) =>
		path.join(service.designsDir, designId, "boards", `${boardId}.json`);

	it("detects a board changed in place (same object) by an update", async () => {
		const created = await service.createDesignFile(
			"in-place",
			design(board("a", "A", [board("a1")]), board("b")),
		);

		const outcome = await service.updateDesignFile("in-place", {
			expectedRevision: created.revision,
			mutate: async (read) => {
				const [first] = read.design.boards as [Node];
				first.props["data-trickroom-name"] = "Changed in place";
				((first.children as Node[])[0] as Node).props["data-trickroom-name"] =
					"Deep change";
				return { design: read.design };
			},
		});

		expect(outcome.status).toBe("written");
		if (outcome.status !== "written") return;
		expect(outcome.write.changedBoardIds).toEqual(["a"]);
		const reread = await service.readDesignFile("in-place");
		expect(reread.design.boards[0]?.props["data-trickroom-name"]).toBe(
			"Changed in place",
		);
		const child = (reread.design.boards[0]?.children as Node[])[0];
		expect(child?.props["data-trickroom-name"]).toBe("Deep change");
		expect(outcome.write.revision).toBe(reread.revision);
	});

	it("detects a board changed in place when the design is written whole", async () => {
		const created = await service.createDesignFile(
			"in-place-write",
			design(board("a"), board("b")),
		);
		const read = await service.readDesignFile("in-place-write");
		(read.design.boards[1] as Node).props["data-trickroom-name"] = "B2";

		const written = await service.writeDesignFile(
			"in-place-write",
			read.design,
			{ expectedRevision: created.revision },
		);

		expect(written.changedBoardIds).toEqual(["b"]);
		const reread = await service.readDesignFile("in-place-write");
		expect(reread.design.boards[1]?.props["data-trickroom-name"]).toBe("B2");
	});

	it("keeps a board unchanged whose stored file is formatted differently", async () => {
		const created = await service.createDesignFile(
			"formatting",
			design(board("a"), board("b")),
		);
		// Same content, compact and with another key order: not byte-equal to
		// what Trickroom would write, so the write falls back to hashing.
		const file = boardFile("formatting", "a");
		const stored = JSON.parse(await readFile(file, "utf8"));
		await writeFile(
			file,
			JSON.stringify({ board: stored.board, order: stored.order, version: 2 }),
		);
		const formatted = await readFile(file, "utf8");
		const read = await service.readDesignFile("formatting");
		expect(read.revision).toBe(created.revision);

		const written = await service.writeDesignFile(
			"formatting",
			{
				...read.design,
				boards: read.design.boards.map((entry) =>
					entry.id === "b"
						? {
								...entry,
								props: { ...entry.props, "data-trickroom-name": "B2" },
							}
						: entry,
				),
			},
			{ expectedRevision: read.revision },
		);

		expect(written.changedBoardIds).toEqual(["b"]);
		expect(await readFile(file, "utf8")).toBe(formatted);
	});

	it("reports the revision of the merged design it stored", async () => {
		const created = await service.createDesignFile(
			"merged",
			design(board("a"), board("b"), board("c")),
		);
		// Another writer changes board c after the caller's read.
		const other = await service.writeDesignFile(
			"merged",
			{
				...created.design,
				boards: created.design.boards.map((entry) =>
					entry.id === "c"
						? {
								...entry,
								props: { ...entry.props, "data-trickroom-name": "C2" },
							}
						: entry,
				),
			},
			{ expectedRevision: created.revision },
		);
		expect(other.changedBoardIds).toEqual(["c"]);

		const written = await service.writeDesignFile(
			"merged",
			{
				...created.design,
				name: "Renamed",
				boards: [
					...created.design.boards.map((entry) =>
						entry.id === "a"
							? {
									...entry,
									props: { ...entry.props, "data-trickroom-name": "A2" },
								}
							: entry,
					),
					board("d"),
				],
			},
			{ expectedRevision: created.revision },
		);

		expect(written.merged).toBe(true);
		expect(written.changedBoardIds).toEqual(["a", "d"]);
		const reread = await service.readDesignFile("merged");
		expect(written.revision).toBe(reread.revision);
		expect(written.revision).toBe(calculateDesignRevision(reread.design));
		expect(written.boards).toEqual(reread.boards);
		expect(
			reread.design.boards.map((entry) => entry.props["data-trickroom-name"]),
		).toEqual(["A2", "b", "C2", "d"]);
	});

	it("writes a moved board with its new order key when its content is unchanged", async () => {
		const created = await service.createDesignFile(
			"moved",
			design(board("a"), board("b"), board("c")),
		);
		const before = (await stat(boardFile("moved", "c"))).ino;
		const [a, b, c] = created.design.boards as [Node, Node, Node];

		const written = await service.writeDesignFile(
			"moved",
			{ ...created.design, boards: [c, a, b] },
			{ expectedRevision: created.revision },
		);

		expect(written.changedBoardIds).toEqual([]);
		expect((await stat(boardFile("moved", "c"))).ino).not.toBe(before);
		const reread = await service.readDesignFile("moved");
		expect(reread.design.boards.map((entry) => entry.id)).toEqual([
			"c",
			"a",
			"b",
		]);
		expect(written.revision).toBe(reread.revision);
	});
});
