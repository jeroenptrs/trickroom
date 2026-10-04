import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrickroomDesign } from "../types";
import { DESIGN_FILE_VERSION } from "./design-file-schema";
import {
	calculateDesignFileRevision,
	countDesignLayers,
	createDesignFileService,
	DesignFileServiceError,
} from "./design-file-service";

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

describe("DesignFileService", () => {
	let tempProjectRoot: string;
	let service: ReturnType<typeof createDesignFileService>;

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-design-service-test-"),
		);
		service = createDesignFileService(tempProjectRoot);
	});

	afterEach(async () => {
		await rm(tempProjectRoot, { force: true, recursive: true });
	});

	const legacyPath = (designId: string) =>
		path.join(service.designsDir, `${designId}.json`);

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
				revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			},
			{
				uuid: "b",
				file: "b.json",
				name: "Design B",
				systemName: "Core",
				boardsCount: 1,
				layersCount: 1,
				modifiedAt: expect.any(String),
				revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			},
			{
				uuid: "invalid",
				file: "invalid.json",
				name: "Invalid",
				boardsCount: 0,
				layersCount: 0,
				modifiedAt: expect.any(String),
				revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
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
		expect(firstRead.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
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

	it("writes validated designs atomically and returns the new revision", async () => {
		await mkdir(service.designsDir, { recursive: true });

		const written = await service.writeDesignFile("created", validDesign);
		const contents = await readFile(legacyPath("created"), "utf8");

		expect(written.design).toEqual(validDesign);
		expect(written.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(JSON.parse(contents)).toEqual({
			version: DESIGN_FILE_VERSION,
			...validDesign,
		});
	});

	it("creates the designs directory before writing a new design", async () => {
		const written = await service.writeDesignFile("created", validDesign);

		expect(written.path).toBe(legacyPath("created"));
		await expect(
			readFile(written.path, "utf8").then(JSON.parse),
		).resolves.toEqual({ version: DESIGN_FILE_VERSION, ...validDesign });
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
			expect(read.revision).toBe(calculateDesignFileRevision(before));
			await expect(readRaw("legacy")).resolves.toBe(before);
		});

		it("persists the current version on the next write", async () => {
			await writeRaw("legacy", validDesign);
			const read = await service.readDesignFile("legacy");

			const written = await service.writeDesignFile(
				"legacy",
				{ ...read.design, name: "Edited" },
				{ expectedRevision: read.revision },
			);

			const contents = await readRaw("legacy");
			expect(
				contents.startsWith(
					`{\n\t"version": ${DESIGN_FILE_VERSION},\n\t"name": "Edited"`,
				),
			).toBe(true);
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

			await expect(readRaw("a")).resolves.toBe(await readRaw("b"));
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
