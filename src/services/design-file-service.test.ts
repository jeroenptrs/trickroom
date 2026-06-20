import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TrickroomDesign } from "../types";
import {
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
				revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			},
			{
				uuid: "b",
				file: "b.json",
				name: "Design B",
				systemName: "Core",
				revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
			},
		]);
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
