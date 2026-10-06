import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	utimes,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import { DESIGN_FILE_VERSION } from "./design-file-schema";
import {
	calculateDesignFileRevision,
	countDesignLayers,
	createDesignFileService,
	DesignFileServiceError,
	skipDesignUpdate,
} from "./design-file-service";
import { calculateDesignRevision } from "./design-revision";

const validDesign = {
	name: "Valid Design",
	systemName: "Core",
	boards: [
		{
			id: "root",
			props: {
				"data-trickroom-name": "Root",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [
				{
					id: "title",
					props: {
						"data-trickroom-name": "Title",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "text",
						"data-trickroom-role": "text",
					},
					children: "Demo UI",
				},
			],
		},
	],
} satisfies TrickroomDesign;

const boardNode = (id: string, name: string): Node => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
	},
	children: [],
});

const twoBoardDesign = {
	name: "Two boards",
	boards: [boardNode("board-a", "A"), boardNode("board-b", "B")],
} satisfies TrickroomDesign;

const threeBoardDesign = {
	name: "Three boards",
	boards: [
		boardNode("board-a", "A"),
		boardNode("board-b", "B"),
		boardNode("board-c", "C"),
	],
} satisfies TrickroomDesign;

const withBoardName = (
	design: TrickroomDesign,
	boardId: string,
	name: string,
): TrickroomDesign => ({
	...design,
	boards: design.boards.map((board) =>
		board.id === boardId
			? { ...board, props: { ...board.props, "data-trickroom-name": name } }
			: board,
	),
});

const boardNames = (design: TrickroomDesign) =>
	design.boards.map((board) => board.props["data-trickroom-name"]);

/** The `updatedAt` this suite's service stamps on writes. */
const writtenAt = "2026-10-01T10:00:00.000Z";

describe("DesignFileService", () => {
	let tempProjectRoot: string;
	let service: ReturnType<typeof createDesignFileService>;

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-design-service-test-"),
		);
		service = createDesignFileService(tempProjectRoot, {
			now: () => new Date(writtenAt),
		});
	});

	afterEach(async () => {
		await rm(tempProjectRoot, { force: true, recursive: true });
	});

	const legacyPath = (designId: string) =>
		path.join(service.designsDir, `${designId}.json`);

	const readFolderFile = (designId: string, file: string) =>
		readFile(path.join(service.designsDir, designId, file), "utf8");

	const writeDesignFixture = async (
		designId: string,
		design: TrickroomDesign = validDesign,
	) => {
		const designPath = legacyPath(designId);
		await mkdir(path.dirname(designPath), { recursive: true });
		await writeFile(
			designPath,
			`${JSON.stringify(design, null, "\t")}\n`,
			"utf8",
		);
	};

	it("addresses designs by id without accepting path segments", async () => {
		expect(service.assertDesignId("123e4567-e89b-12d3-a456-426614174000")).toBe(
			"123e4567-e89b-12d3-a456-426614174000",
		);
		for (const unsafe of ["", " a", ".", "..", "../outside", "a/b", "a\\b"]) {
			expect(() => service.assertDesignId(unsafe)).toThrow(
				DesignFileServiceError,
			);
		}
		await expect(service.readDesignFile("../outside")).rejects.toMatchObject({
			code: "INVALID_DESIGN_UUID",
		});
	});

	it("lists JSON design summaries in filename order, flagging unreadable files", async () => {
		await writeDesignFixture("b", { ...validDesign, name: "Design B" });
		await writeDesignFixture("a", {
			...validDesign,
			name: "Design A",
			systemName: null,
		});
		await writeFile(
			legacyPath("invalid"),
			JSON.stringify({ name: "Invalid" }),
			"utf8",
		);
		await writeFile(path.join(service.designsDir, "notes.txt"), "{}", "utf8");
		await writeFile(
			path.join(service.designsDir, "a.memory.json"),
			"{}",
			"utf8",
		);

		const summaries = await service.listDesignSummaries();

		expect(summaries).toEqual([
			{
				uuid: "a",
				file: "a.json",
				name: "Design A",
				systemName: null,
				boardsCount: 1,
				layersCount: 1,
				modifiedAt: expect.any(String),
				revision: expect.stringMatching(/^r2\./),
				boards: [{ id: "root", name: "Root", revision: expect.any(String) }],
			},
			{
				uuid: "b",
				file: "b.json",
				name: "Design B",
				systemName: "Core",
				boardsCount: 1,
				layersCount: 1,
				modifiedAt: expect.any(String),
				revision: expect.stringMatching(/^r2\./),
				boards: [{ id: "root", name: "Root", revision: expect.any(String) }],
			},
			{
				uuid: "invalid",
				file: "invalid.json",
				name: "Invalid",
				boardsCount: 0,
				layersCount: 0,
				modifiedAt: expect.any(String),
				revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
				boards: [],
				diagnostic: {
					code: "INVALID_DESIGN_PAYLOAD",
					message: expect.any(String),
					version: 0,
				},
			},
		]);
		for (const summary of summaries) {
			expect(Date.parse(summary.modifiedAt)).not.toBeNaN();
		}
	});

	it("refreshes cached summaries when a design file changes", async () => {
		await writeDesignFixture("cached", {
			...validDesign,
			name: "Cached Before",
		});
		expect(await service.listDesignSummaries()).toMatchObject([
			{
				name: "Cached Before",
				layersCount: 1,
			},
		]);

		await writeDesignFixture("cached", {
			...validDesign,
			name: "Cached After With More Bytes",
			boards: [
				{
					...validDesign.boards[0],
					children: [
						...(Array.isArray(validDesign.boards[0].children)
							? validDesign.boards[0].children
							: []),
						{
							id: "subtitle",
							props: {
								"data-trickroom-name": "Subtitle",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "text",
								"data-trickroom-role": "text",
							},
							children: "Subtitle",
						},
					],
				},
			],
		});

		expect(await service.listDesignSummaries()).toMatchObject([
			{
				name: "Cached After With More Bytes",
				layersCount: 2,
			},
		]);
	});

	it("lists a design's updatedAt as modifiedAt, and the file time without one", async () => {
		await writeDesignFixture("legacy");
		await service.createDesignFile("stamped", validDesign);
		await mkdir(path.join(service.designsDir, "hand-edited", "boards"), {
			recursive: true,
		});
		await writeFile(
			path.join(service.designsDir, "hand-edited", "design.json"),
			JSON.stringify({
				version: DESIGN_FILE_VERSION,
				name: "Hand edited",
				updatedAt: "last tuesday",
			}),
			"utf8",
		);
		// A git checkout gives every file a fresh modification time.
		const checkedOutAt = new Date("2026-10-05T08:00:00.000Z");
		await utimes(
			path.join(service.designsDir, "stamped", "design.json"),
			checkedOutAt,
			checkedOutAt,
		);

		const summaries = await service.listDesignSummaries();
		const byId = new Map(summaries.map((summary) => [summary.uuid, summary]));

		expect(byId.get("stamped")).toMatchObject({
			modifiedAt: writtenAt,
			updatedAt: writtenAt,
		});
		for (const id of ["legacy", "hand-edited"]) {
			const summary = byId.get(id);
			expect(summary?.modifiedAt).not.toBe(writtenAt);
			expect(Date.parse(summary?.modifiedAt ?? "")).not.toBeNaN();
		}
		expect(byId.get("legacy")).not.toHaveProperty("updatedAt");
	});

	it("does not return cached summaries after a design file becomes invalid", async () => {
		await writeDesignFixture("cached");
		expect(await service.listDesignSummaries()).toHaveLength(1);

		await writeFile(
			legacyPath("cached"),
			JSON.stringify({
				name: "Invalid after cache with more bytes",
				boards: "not an array",
			}),
			"utf8",
		);

		await expect(service.listDesignSummaries()).resolves.toMatchObject([
			{
				file: "cached.json",
				name: "Invalid after cache with more bytes",
				diagnostic: { code: "INVALID_DESIGN_PAYLOAD" },
			},
		]);
	});

	it("counts descendant layers recursively without counting board roots", () => {
		const design = {
			...validDesign,
			boards: [
				validDesign.boards[0],
				{
					...validDesign.boards[0],
					id: "second-root",
					children: [
						{
							id: "group",
							props: {
								"data-trickroom-name": "Group",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "container",
							},
							children: [
								{
									id: "nested",
									props: {
										"data-trickroom-name": "Nested",
										"data-trickroom-library": "trickroom",
										"data-trickroom-component": "text",
										"data-trickroom-role": "text",
									},
									children: "Nested text",
								},
							],
						},
					],
				},
			],
		} satisfies TrickroomDesign;

		expect(countDesignLayers(design)).toBe(3);
	});

	it("returns an empty summary list when the designs directory does not exist", async () => {
		await expect(service.listDesignSummaries()).resolves.toEqual([]);
	});

	it("returns stable content-hash revisions for unchanged design files", async () => {
		await writeDesignFixture("stable");

		const firstRead = await service.readDesignFile("stable");
		const secondRead = await service.readDesignFile("stable");

		expect(firstRead.revision).toBe(secondRead.revision);
		expect(firstRead.revision).toBe(calculateDesignRevision(validDesign));
	});

	it("reads and lists legacy null component migration policies canonically", async () => {
		const designPath = legacyPath("legacy-policy");
		await mkdir(path.dirname(designPath), { recursive: true });
		await writeFile(
			designPath,
			JSON.stringify({
				...validDesign,
				componentMigrationPolicy: null,
			}),
			"utf8",
		);

		const read = await service.readDesignFile("legacy-policy");
		expect(read.design).not.toHaveProperty("componentMigrationPolicy");
		await expect(service.listDesignSummaries()).resolves.toMatchObject([
			{
				file: "legacy-policy.json",
				name: validDesign.name,
			},
		]);
	});

	it("writes a design as a manifest plus one file per board", async () => {
		const written = await service.writeDesignFile("created", validDesign);

		expect(written.design).toEqual({ ...validDesign, updatedAt: writtenAt });
		expect(written.revision).toBe(calculateDesignRevision(validDesign));
		expect(written.path).toBe(path.join(service.designsDir, "created"));
		expect(written.file).toBe("created/design.json");
		await expect(readFolderFile("created", "design.json")).resolves.toBe(
			`{\n\t"version": ${DESIGN_FILE_VERSION},\n\t"name": "Valid Design",\n\t"systemName": "Core",\n\t"updatedAt": "${writtenAt}"\n}\n`,
		);
		const { boards: _boards, ...manifest } = validDesign;
		void _boards;
		await expect(
			readFolderFile("created", "design.json").then(JSON.parse),
		).resolves.toEqual({
			version: DESIGN_FILE_VERSION,
			...manifest,
			updatedAt: writtenAt,
		});
		await expect(
			readFolderFile("created", "boards/root.json").then(JSON.parse),
		).resolves.toEqual({
			version: DESIGN_FILE_VERSION,
			order: expect.any(String),
			board: validDesign.boards[0],
		});
		await expect(readdir(path.join(service.designsDir))).resolves.toEqual([
			"created",
		]);
	});

	it("creates a design file exclusively without overwriting an existing file", async () => {
		const written = await service.createDesignFile("created", validDesign);

		expect(written.design.name).toBe("Valid Design");
		await expect(
			service.createDesignFile("created", {
				...validDesign,
				name: "Overwrite Attempt",
			}),
		).rejects.toMatchObject({
			code: "DESIGN_FILE_ALREADY_EXISTS",
		});
		await expect(service.readDesignFile("created")).resolves.toMatchObject({
			design: {
				name: "Valid Design",
			},
		});
	});

	it("allows only one concurrent exclusive create for the same design file", async () => {
		const attempts = await Promise.allSettled([
			service.createDesignFile("raced", {
				...validDesign,
				name: "Race Attempt A",
			}),
			service.createDesignFile("raced", {
				...validDesign,
				name: "Race Attempt B",
			}),
		]);

		const fulfilled = attempts.filter(
			(attempt) => attempt.status === "fulfilled",
		);
		const rejected = attempts.filter(
			(attempt) => attempt.status === "rejected",
		);
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]).toMatchObject({
			reason: {
				code: "DESIGN_FILE_ALREADY_EXISTS",
			},
		});
		await expect(service.readDesignFile("raced")).resolves.toMatchObject({
			design: {
				name: expect.stringMatching(/^Race Attempt [AB]$/),
			},
		});
	});

	it("rejects invalid design payloads without writing a file", async () => {
		await mkdir(service.designsDir, { recursive: true });

		await expect(
			service.writeDesignFile("invalid", { name: "Invalid" }),
		).rejects.toMatchObject({
			code: "INVALID_DESIGN_PAYLOAD",
		});

		await expect(readFile(legacyPath("invalid"))).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("rejects stale expected revisions without overwriting the current file", async () => {
		await writeDesignFixture("checked", {
			...validDesign,
			name: "Current",
		});
		const current = await service.readDesignFile("checked");

		await writeDesignFixture("checked", {
			...validDesign,
			name: "Concurrent Update",
		});

		await expect(
			service.writeDesignFile(
				"checked",
				{ ...validDesign, name: "Stale Update" },
				{ expectedRevision: current.revision },
			),
		).rejects.toMatchObject({
			code: "REVISION_MISMATCH",
		});

		await expect(service.readDesignFile("checked")).resolves.toMatchObject({
			design: {
				name: "Concurrent Update",
			},
		});
	});

	describe("board-level revision checks", () => {
		it("keeps another writer's board when a whole design is saved from an older read", async () => {
			await writeDesignFixture("merge", twoBoardDesign);
			const browserRead = await service.readDesignFile("merge");
			await service.writeDesignFile(
				"merge",
				withBoardName(browserRead.design, "board-b", "B by agent"),
				{ expectedRevision: browserRead.revision },
			);

			const saved = await service.writeDesignFile(
				"merge",
				withBoardName(browserRead.design, "board-a", "A by human"),
				{ expectedRevision: browserRead.revision },
			);

			expect(saved.merged).toBe(true);
			expect(saved.changedBoardIds).toEqual(["board-a"]);
			expect(boardNames(saved.design)).toEqual(["A by human", "B by agent"]);
			await expect(service.readDesignFile("merge")).resolves.toMatchObject({
				revision: saved.revision,
				design: saved.design,
			});
		});

		it("refuses a save that changes a board changed since the read", async () => {
			await writeDesignFixture("conflict", twoBoardDesign);
			const browserRead = await service.readDesignFile("conflict");
			await service.writeDesignFile(
				"conflict",
				withBoardName(browserRead.design, "board-a", "A by agent"),
				{ expectedRevision: browserRead.revision },
			);
			const current = await service.readDesignFile("conflict");

			const attempt = service.writeDesignFile(
				"conflict",
				withBoardName(browserRead.design, "board-a", "A by human"),
				{ expectedRevision: browserRead.revision },
			);

			await expect(attempt).rejects.toMatchObject({
				code: "REVISION_MISMATCH",
				mismatch: {
					staleBoardIds: ["board-a"],
					manifest: false,
					order: false,
					currentRevision: current.revision,
				},
			});
			await expect(service.readDesignFile("conflict")).resolves.toMatchObject({
				revision: current.revision,
			});
		});

		it("keeps boards another writer added and respects boards it deleted", async () => {
			await writeDesignFixture("sets", twoBoardDesign);
			const browserRead = await service.readDesignFile("sets");
			const [boardA] = browserRead.design.boards;
			await service.writeDesignFile(
				"sets",
				{
					...browserRead.design,
					boards: [
						boardA as Node,
						{ ...(boardA as Node), id: "board-c", children: [] },
					],
				},
				{ expectedRevision: browserRead.revision },
			);

			const saved = await service.writeDesignFile(
				"sets",
				{ ...browserRead.design, name: "Renamed" },
				{ expectedRevision: browserRead.revision },
			);

			expect(saved.design.name).toBe("Renamed");
			expect(saved.design.boards.map((board) => board.id)).toEqual([
				"board-a",
				"board-c",
			]);
		});

		it("refuses to delete a board another writer changed", async () => {
			await writeDesignFixture("delete", twoBoardDesign);
			const browserRead = await service.readDesignFile("delete");
			await service.writeDesignFile(
				"delete",
				withBoardName(browserRead.design, "board-b", "B by agent"),
				{ expectedRevision: browserRead.revision },
			);

			await expect(
				service.writeDesignFile(
					"delete",
					{
						...browserRead.design,
						boards: browserRead.design.boards.slice(0, 1),
					},
					{ expectedRevision: browserRead.revision },
				),
			).rejects.toMatchObject({
				code: "REVISION_MISMATCH",
				mismatch: { staleBoardIds: ["board-b"] },
			});
		});

		it("applies a reorder unless the order changed on disk too", async () => {
			await writeDesignFixture("order", threeBoardDesign);
			const read = await service.readDesignFile("order");
			const [a, b, c] = read.design.boards as [Node, Node, Node];

			const reordered = await service.writeDesignFile(
				"order",
				{ ...read.design, boards: [c, a, b] },
				{ expectedRevision: read.revision },
			);
			expect(reordered.design.boards.map((board) => board.id)).toEqual([
				"board-c",
				"board-a",
				"board-b",
			]);

			await expect(
				service.writeDesignFile(
					"order",
					{ ...read.design, boards: [b, a, c] },
					{ expectedRevision: read.revision },
				),
			).rejects.toMatchObject({
				code: "REVISION_MISMATCH",
				mismatch: { order: true },
			});
		});

		it("checks every change strictly against a revision it cannot decode", async () => {
			await writeDesignFixture("legacy-token", twoBoardDesign);
			const read = await service.readDesignFile("legacy-token");

			await expect(
				service.writeDesignFile(
					"legacy-token",
					withBoardName(read.design, "board-a", "Changed"),
					{ expectedRevision: "sha256:0000" },
				),
			).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
			await expect(
				service.writeDesignFile("legacy-token", read.design, {
					expectedRevision: "sha256:0000",
				}),
			).resolves.toMatchObject({ revision: read.revision });
		});
	});

	describe("updateDesignFile", () => {
		it("applies a mutation to a fresh read and writes the prepared design", async () => {
			await writeDesignFixture("updated");
			const read = await service.readDesignFile("updated");

			const outcome = await service.updateDesignFile("updated", {
				expectedRevision: read.revision,
				mutate: async (current) => ({
					design: { ...current.design, name: "Mutated" },
				}),
				prepare: async (design) => ({ ...design, name: `${design.name}!` }),
			});

			expect(outcome).toMatchObject({
				status: "written",
				write: { design: { name: "Mutated!" } },
			});
			await expect(service.readDesignFile("updated")).resolves.toMatchObject({
				design: { name: "Mutated!" },
			});
		});

		it("writes a change to one board while another board changed since the read", async () => {
			await writeDesignFixture("boards", twoBoardDesign);
			const before = await service.readDesignFile("boards");
			// Another writer edits board B after the caller read the design.
			await service.writeDesignFile(
				"boards",
				withBoardName(before.design, "board-b", "B by agent"),
				{ expectedRevision: before.revision },
			);

			const outcome = await service.updateDesignFile("boards", {
				expectedRevision: before.revision,
				mutate: async (current) => ({
					design: withBoardName(current.design, "board-a", "A by human"),
				}),
			});

			expect(outcome.status).toBe("written");
			const after = await service.readDesignFile("boards");
			expect(boardNames(after.design)).toEqual(["A by human", "B by agent"]);
			expect(outcome.status === "written" && outcome.write.revision).toBe(
				after.revision,
			);
		});

		it("reports the boards the caller changed that are stale", async () => {
			await writeDesignFixture("stale", twoBoardDesign);
			const before = await service.readDesignFile("stale");
			await service.writeDesignFile(
				"stale",
				withBoardName(before.design, "board-a", "A elsewhere"),
				{ expectedRevision: before.revision },
			);
			const current = await service.readDesignFile("stale");

			const outcome = await service.updateDesignFile("stale", {
				expectedRevision: before.revision,
				mutate: async (read) => ({
					design: withBoardName(read.design, "board-a", "A stale"),
				}),
			});

			expect(outcome).toEqual({
				status: "revision-mismatch",
				expectedRevision: before.revision,
				currentRevision: current.revision,
				staleBoardIds: ["board-a"],
				manifest: false,
				order: false,
			});
			await expect(service.readDesignFile("stale")).resolves.toMatchObject({
				revision: current.revision,
			});
		});

		it("keeps another writer's board that lands between the read and the write", async () => {
			await writeDesignFixture("raced-update", twoBoardDesign);
			const read = await service.readDesignFile("raced-update");

			const outcome = await service.updateDesignFile("raced-update", {
				expectedRevision: read.revision,
				mutate: async (current) => {
					await writeDesignFixture(
						"raced-update",
						withBoardName(current.design, "board-a", "A by winner"),
					);
					return {
						design: withBoardName(current.design, "board-b", "B by caller"),
					};
				},
			});

			expect(outcome).toMatchObject({
				status: "written",
				write: { merged: true },
			});
			const after = await service.readDesignFile("raced-update");
			expect(boardNames(after.design)).toEqual(["A by winner", "B by caller"]);
		});

		it("reports a board another writer changed between the read and the write", async () => {
			await writeDesignFixture("raced-update", twoBoardDesign);
			const read = await service.readDesignFile("raced-update");

			const outcome = await service.updateDesignFile("raced-update", {
				expectedRevision: read.revision,
				mutate: async (current) => {
					await writeDesignFixture(
						"raced-update",
						withBoardName(current.design, "board-b", "B by winner"),
					);
					return {
						design: withBoardName(current.design, "board-b", "B by loser"),
					};
				},
			});

			const after = await service.readDesignFile("raced-update");
			expect(outcome).toEqual({
				status: "revision-mismatch",
				expectedRevision: read.revision,
				currentRevision: after.revision,
				staleBoardIds: ["board-b"],
				manifest: false,
				order: false,
			});
			expect(boardNames(after.design)).toEqual(["A", "B by winner"]);
		});

		it("ends without writing when the mutation skips", async () => {
			await writeDesignFixture("skipped");
			const read = await service.readDesignFile("skipped");

			const outcome = await service.updateDesignFile("skipped", {
				expectedRevision: read.revision,
				mutate: async () => skipDesignUpdate("nothing to do"),
			});

			expect(outcome).toMatchObject({
				status: "skipped",
				value: "nothing to do",
			});
			await expect(service.readDesignFile("skipped")).resolves.toMatchObject({
				revision: read.revision,
			});
		});
	});

	describe("schema versions", () => {
		const readRaw = (file: string) => readFile(legacyPath(file), "utf8");

		const writeRaw = async (file: string, value: unknown) => {
			const designPath = legacyPath(file);
			await mkdir(path.dirname(designPath), { recursive: true });
			await writeFile(designPath, JSON.stringify(value), "utf8");
		};

		it("migrates a legacy file in memory without writing it", async () => {
			await writeRaw("legacy", {
				...validDesign,
				componentMigrationPolicy: null,
			});
			const before = await readRaw("legacy");

			const read = await service.readDesignFile("legacy");

			expect(read.storedVersion).toBe(0);
			expect(read.migrated).toBe(true);
			expect(read.design).toEqual(validDesign);
			expect(read.revision).toBe(calculateDesignRevision(validDesign));
			await expect(readRaw("legacy")).resolves.toBe(before);
		});

		it("persists the current version and layout on the next write", async () => {
			await writeRaw("legacy", validDesign);
			const read = await service.readDesignFile("legacy");

			const written = await service.writeDesignFile(
				"legacy",
				{ ...read.design, name: "Edited" },
				{ expectedRevision: read.revision },
			);

			const contents = await readFolderFile("legacy", "design.json");
			expect(
				contents.startsWith(
					`{\n\t"version": ${DESIGN_FILE_VERSION},\n\t"name": "Edited"`,
				),
			).toBe(true);
			await expect(readRaw("legacy")).rejects.toMatchObject({
				code: "ENOENT",
			});
			expect(written.design).not.toHaveProperty("version");
			const reread = await service.readDesignFile("legacy");
			expect(reread.storedVersion).toBe(DESIGN_FILE_VERSION);
			expect(reread.migrated).toBe(false);
			expect(reread.revision).toBe(written.revision);
		});

		it("writes deterministic bytes regardless of key order", async () => {
			const { boards, name, systemName } = validDesign;
			await service.writeDesignFile("a", { boards, systemName, name });
			await service.writeDesignFile("b", {
				name,
				version: DESIGN_FILE_VERSION,
				systemName,
				boards,
			});

			for (const file of ["design.json", "boards/root.json"]) {
				await expect(readFolderFile("a", file)).resolves.toBe(
					await readFolderFile("b", file),
				);
			}
		});

		it("lists, refuses, and never down-converts a design from a newer Trickroom", async () => {
			const newer = { ...validDesign, version: DESIGN_FILE_VERSION + 1 };
			await writeRaw("newer", newer);
			const before = await readRaw("newer");
			const revision = calculateDesignFileRevision(before);

			await expect(service.listDesignSummaries()).resolves.toEqual([
				expect.objectContaining({
					file: "newer.json",
					name: validDesign.name,
					revision,
					diagnostic: {
						code: "UNSUPPORTED_DESIGN_VERSION",
						message: expect.stringContaining(
							`version ${DESIGN_FILE_VERSION + 1}`,
						),
						version: DESIGN_FILE_VERSION + 1,
					},
				}),
			]);
			await expect(service.readDesignFile("newer")).rejects.toMatchObject({
				code: "UNSUPPORTED_DESIGN_VERSION",
			});
			await expect(
				service.writeDesignFile("newer", validDesign, {
					expectedRevision: revision,
				}),
			).rejects.toMatchObject({ code: "UNSUPPORTED_DESIGN_VERSION" });
			await expect(
				service.writeDesignFile("newer", validDesign),
			).rejects.toMatchObject({ code: "UNSUPPORTED_DESIGN_VERSION" });
			await expect(readRaw("newer")).resolves.toBe(before);
		});

		it("rejects writes that carry a newer version", async () => {
			await expect(
				service.createDesignFile("payload", {
					...validDesign,
					version: DESIGN_FILE_VERSION + 1,
				}),
			).rejects.toMatchObject({ code: "UNSUPPORTED_DESIGN_VERSION" });
		});

		it("lists files that are not valid JSON", async () => {
			await writeDesignFixture("valid");
			await writeFile(legacyPath("broken"), "{ not json", "utf8");

			await expect(service.listDesignSummaries()).resolves.toMatchObject([
				{
					file: "broken.json",
					name: "broken",
					diagnostic: { code: "INVALID_DESIGN_JSON" },
				},
				{ file: "valid.json", name: validDesign.name },
			]);
		});
	});
});
