import type { Stats } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import {
	createDesignFileService,
	type DesignFileService,
} from "./design-file-service";
import { isSettledStat, settledFileAgeMs } from "./design-storage";

/**
 * Reads and writes trust a board file's identity (inode, size, times) to
 * reuse its cached contents and revision only once the file is settled.
 * These tests fake file times to reproduce what coarse time granularity and
 * inode reuse can do: a file replaced by one of the same size that looks
 * identical.
 */

const fakeTimes = vi.hoisted(() => ({
	/** Board file path -> fake stat fields. */
	byPath: new Map<string, { ino?: number; mtimeMs: number; ctimeMs: number }>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		stat: async (...args: Parameters<typeof actual.stat>) => {
			const result = (await actual.stat(...args)) as Stats;
			const fake = fakeTimes.byPath.get(String(args[0]));
			return fake ? Object.assign(result, fake) : result;
		},
	};
});

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
	name: "Identity",
	boards,
});

describe("isSettledStat", () => {
	it("trusts a file only once it is older than the coarsest time granularity", () => {
		const now = 1_000_000;
		const at = (mtimeMs: number, ctimeMs = mtimeMs) =>
			({ mtimeMs, ctimeMs }) as Stats;
		expect(isSettledStat(at(now - settledFileAgeMs - 1), now)).toBe(true);
		expect(isSettledStat(at(now - settledFileAgeMs), now)).toBe(false);
		expect(isSettledStat(at(now), now)).toBe(false);
		// A file from the future (clock skew) is not settled.
		expect(isSettledStat(at(now + 5_000), now)).toBe(false);
		// The inode change time counts too: a rename into place touches it.
		expect(isSettledStat(at(now - 60_000, now - 10), now)).toBe(false);
	});
});

describe("design file identity", () => {
	let projectRoot: string;
	let service: DesignFileService;

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-design-identity-test-"),
		);
		service = createDesignFileService(projectRoot);
	});

	afterEach(async () => {
		fakeTimes.byPath.clear();
		await rm(projectRoot, { force: true, recursive: true });
	});

	const boardFile = (designId: string, boardId: string) =>
		path.join(service.designsDir, designId, "boards", `${boardId}.json`);

	/** Replaces a board's name with another of the same length, in place. */
	const replaceSameSize = async (
		designId: string,
		boardId: string,
		from: string,
		to: string,
	) => {
		expect(to).toHaveLength(from.length);
		const file = boardFile(designId, boardId);
		const before = await readFile(file, "utf8");
		const after = before.replace(`"${from}"`, `"${to}"`);
		expect(after).not.toBe(before);
		await writeFile(file, after);
	};

	/** Makes a board file report the same identity whatever happens to it. */
	const freezeIdentity = async (
		designId: string,
		boardId: string,
		ageMs: number,
	) => {
		const file = boardFile(designId, boardId);
		const { ino } = await stat(file);
		const time = Date.now() - ageMs;
		fakeTimes.byPath.set(file, { ino, mtimeMs: time, ctimeMs: time });
	};

	it("rereads a file replaced moments ago by one that looks identical", async () => {
		await service.createDesignFile("racy", design(board("a", "First")));
		await freezeIdentity("racy", "a", 0);
		const first = await service.readDesignFile("racy");

		await replaceSameSize("racy", "a", "First", "Other");
		const second = await service.readDesignFile("racy");

		expect(second.design.boards[0]?.props["data-trickroom-name"]).toBe("Other");
		expect(second.revision).not.toBe(first.revision);
	});

	it("refuses a write over a board replaced moments ago by one that looks identical", async () => {
		await service.createDesignFile(
			"racy-write",
			design(board("a", "First"), board("b")),
		);
		await freezeIdentity("racy-write", "a", 0);
		const read = await service.readDesignFile("racy-write");

		// Another writer changes board a after this read, keeping its size,
		// inode and times.
		await replaceSameSize("racy-write", "a", "First", "Other");

		const outcome = await service.updateDesignFile("racy-write", {
			expectedRevision: read.revision,
			mutate: async (fresh) => ({
				design: {
					...fresh.design,
					boards: fresh.design.boards.map((entry) =>
						entry.id === "a"
							? {
									...entry,
									props: { ...entry.props, "data-trickroom-name": "Mine" },
								}
							: entry,
					),
				},
			}),
			// The caller's own (now stale) read, as MCP tools pass it.
			read: async () => read,
		});

		expect(outcome.status).toBe("revision-mismatch");
		if (outcome.status === "revision-mismatch") {
			expect(outcome.staleBoardIds).toEqual(["a"]);
		}
		const reread = await service.readDesignFile("racy-write");
		expect(reread.design.boards[0]?.props["data-trickroom-name"]).toBe("Other");
	});

	it("rereads one board replaced moments ago by one that looks identical", async () => {
		await service.createDesignFile("racy-board", design(board("a", "First")));
		await freezeIdentity("racy-board", "a", 0);
		const first = await service.readDesignBoard("racy-board", "a");
		expect(first?.revision).toBe(
			(await service.readDesignFile("racy-board")).boards[0]?.revision,
		);

		await replaceSameSize("racy-board", "a", "First", "Other");
		const second = await service.readDesignBoard("racy-board", "a");

		expect(second?.board.props["data-trickroom-name"]).toBe("Other");
		expect(second?.revision).not.toBe(first?.revision);
		expect(second?.revision).toBe(
			(await service.readDesignFile("racy-board")).boards[0]?.revision,
		);
	});

	it("reuses a settled file's cached contents and revision", async () => {
		await service.createDesignFile("settled", design(board("a", "First")));
		await freezeIdentity("settled", "a", settledFileAgeMs * 5);
		const first = await service.readDesignFile("settled");

		// Impossible on a real file system for a settled file (any change
		// after it settled gets later times); here it shows the cache is used.
		await replaceSameSize("settled", "a", "First", "Other");
		const second = await service.readDesignFile("settled");

		expect(second.design.boards[0]?.props["data-trickroom-name"]).toBe("First");
		expect(second.revision).toBe(first.revision);
	});

	it("detects a board changed in place when every file is settled", async () => {
		await service.createDesignFile(
			"settled-in-place",
			design(board("a"), board("b")),
		);
		await freezeIdentity("settled-in-place", "a", settledFileAgeMs * 5);
		await freezeIdentity("settled-in-place", "b", settledFileAgeMs * 5);
		const read = await service.readDesignFile("settled-in-place");
		// Reading twice leaves every cache warm with these exact objects' files.
		await service.readDesignFile("settled-in-place");

		const outcome = await service.updateDesignFile("settled-in-place", {
			expectedRevision: read.revision,
			read: async () => read,
			mutate: async (fresh) => {
				(fresh.design.boards[1] as Node).props["data-trickroom-name"] = "B2";
				return { design: fresh.design };
			},
		});

		expect(outcome.status).toBe("written");
		if (outcome.status !== "written") return;
		expect(outcome.write.changedBoardIds).toEqual(["b"]);
		fakeTimes.byPath.clear();
		const reread = await service.readDesignFile("settled-in-place");
		expect(reread.design.boards[1]?.props["data-trickroom-name"]).toBe("B2");
		expect(outcome.write.revision).toBe(reread.revision);
	});
});
