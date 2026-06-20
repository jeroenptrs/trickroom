import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrickroomDesign } from "../types";
import {
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

	const writeDesignFixture = async (
		file: string,
		design: TrickroomDesign = validDesign,
	) => {
		const designPath = service.resolveDesignFilePath(file);
		await mkdir(path.dirname(designPath), { recursive: true });
		await writeFile(
			designPath,
			`${JSON.stringify(design, null, "\t")}\n`,
			"utf8",
		);
	};

	it("maps UUIDs to JSON files without accepting path segments", () => {
		expect(service.getFileForUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(
			"123e4567-e89b-12d3-a456-426614174000.json",
		);
		expect(service.getUuidFromFile("123.json")).toBe("123");
		expect(service.getUuidFromFile("123.txt")).toBeNull();

		expect(() => service.getFileForUuid("../outside")).toThrow(
			DesignFileServiceError,
		);
	});

	it("keeps resolved design paths inside the project-scoped designs directory", () => {
		expect(service.resolveDesignFilePath("one.json")).toBe(
			path.join(tempProjectRoot, ".trickroom", "designs", "one.json"),
		);

		expect(() => service.resolveDesignFilePath("../one.json")).toThrow(
			DesignFileServiceError,
		);
		expect(() =>
			service.resolveDesignFilePath(path.resolve("one.json")),
		).toThrow(DesignFileServiceError);
	});

	it("lists valid JSON design summaries in filename order and includes revisions", async () => {
		await writeDesignFixture("b.json", { ...validDesign, name: "Design B" });
		await writeDesignFixture("a.json", {
			...validDesign,
			name: "Design A",
			systemName: null,
		});
		await writeFile(
			service.resolveDesignFilePath("invalid.json"),
			JSON.stringify({ name: "Invalid" }),
			"utf8",
		);
		await writeFile(service.resolveDesignFilePath("notes.txt"), "{}", "utf8");

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
		]);
		for (const summary of summaries) {
			expect(Date.parse(summary.modifiedAt)).not.toBeNaN();
		}
	});

	it("refreshes cached summaries when a design file changes", async () => {
		await writeDesignFixture("cached.json", {
			...validDesign,
			name: "Cached Before",
		});
		expect(await service.listDesignSummaries()).toMatchObject([
			{
				name: "Cached Before",
				layersCount: 1,
			},
		]);

		await writeDesignFixture("cached.json", {
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
		await writeDesignFixture("cached.json");
		expect(await service.listDesignSummaries()).toHaveLength(1);

		await writeFile(
			service.resolveDesignFilePath("cached.json"),
			JSON.stringify({
				name: "Invalid after cache with more bytes",
				boards: "not an array",
			}),
			"utf8",
		);

		await expect(service.listDesignSummaries()).resolves.toEqual([]);
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
		await writeDesignFixture("stable.json");

		const firstRead = await service.readDesignFile("stable.json");
		const secondRead = await service.readDesignFile("stable.json");

		expect(firstRead.revision).toBe(secondRead.revision);
		expect(firstRead.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
	});

	it("writes validated designs atomically and returns the new revision", async () => {
		await mkdir(service.designsDir, { recursive: true });

		const written = await service.writeDesignFile("created.json", validDesign);
		const contents = await readFile(
			service.resolveDesignFilePath("created.json"),
			"utf8",
		);

		expect(written.design).toEqual(validDesign);
		expect(written.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
		expect(JSON.parse(contents)).toEqual(validDesign);
	});

	it("creates the designs directory before writing a new design", async () => {
		const written = await service.writeDesignFile("created.json", validDesign);

		expect(written.path).toBe(service.resolveDesignFilePath("created.json"));
		await expect(
			readFile(written.path, "utf8").then(JSON.parse),
		).resolves.toEqual(validDesign);
	});

	it("creates a design file exclusively without overwriting an existing file", async () => {
		const written = await service.createDesignFile("created.json", validDesign);

		expect(written.design.name).toBe("Valid Design");
		await expect(
			service.createDesignFile("created.json", {
				...validDesign,
				name: "Overwrite Attempt",
			}),
		).rejects.toMatchObject({
			code: "DESIGN_FILE_ALREADY_EXISTS",
		});
		await expect(service.readDesignFile("created.json")).resolves.toMatchObject(
			{
				design: {
					name: "Valid Design",
				},
			},
		);
	});

	it("allows only one concurrent exclusive create for the same design file", async () => {
		const attempts = await Promise.allSettled([
			service.createDesignFile("raced.json", {
				...validDesign,
				name: "Race Attempt A",
			}),
			service.createDesignFile("raced.json", {
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
		await expect(service.readDesignFile("raced.json")).resolves.toMatchObject({
			design: {
				name: expect.stringMatching(/^Race Attempt [AB]$/),
			},
		});
	});

	it("rejects invalid design payloads without writing a file", async () => {
		await mkdir(service.designsDir, { recursive: true });

		await expect(
			service.writeDesignFile("invalid.json", { name: "Invalid" }),
		).rejects.toMatchObject({
			code: "INVALID_DESIGN_PAYLOAD",
		});

		await expect(
			readFile(service.resolveDesignFilePath("invalid.json")),
		).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("rejects stale expected revisions without overwriting the current file", async () => {
		await writeDesignFixture("checked.json", {
			...validDesign,
			name: "Current",
		});
		const current = await service.readDesignFile("checked.json");

		await writeDesignFixture("checked.json", {
			...validDesign,
			name: "Concurrent Update",
		});

		await expect(
			service.writeDesignFile(
				"checked.json",
				{ ...validDesign, name: "Stale Update" },
				{ expectedRevision: current.revision },
			),
		).rejects.toMatchObject({
			code: "REVISION_MISMATCH",
		});

		await expect(service.readDesignFile("checked.json")).resolves.toMatchObject(
			{
				design: {
					name: "Concurrent Update",
				},
			},
		);
	});
});
