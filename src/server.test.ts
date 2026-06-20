import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isTrickroomConfig, isTrickroomDesign } from "./server-utils";

const validDesign = {
	name: "Valid Design",
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
};

describe("server design validation", () => {
	it("accepts the registry-backed serialized design shape", () => {
		expect(isTrickroomDesign(validDesign)).toBe(true);
	});

	// TODO: this can be deleted
	it("rejects deprecated node host type", () => {
		expect(
			isTrickroomDesign({
				...validDesign,
				boards: [{ ...validDesign.boards[0], type: "div" }],
			}),
		).toBe(false);
	});

	// TODO: this can be deleted
	it("rejects deprecated data-trickroom-type props", () => {
		expect(
			isTrickroomDesign({
				...validDesign,
				boards: [
					{
						...validDesign.boards[0],
						props: {
							...validDesign.boards[0].props,
							"data-trickroom-type": "container",
						},
					},
				],
			}),
		).toBe(false);
	});

	it("rejects invalid component role metadata", () => {
		expect(
			isTrickroomDesign({
				...validDesign,
				boards: [
					{
						...validDesign.boards[0],
						props: {
							...validDesign.boards[0].props,
							"data-trickroom-role": "text",
						},
						children: "Root text",
					},
				],
			}),
		).toBe(false);
	});
});

describe("server config validation", () => {
	it("accepts a config with optional systems", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				systems: {
					Core: "src/index.css",
				},
			}),
		).toBe(true);
	});

	it("accepts a config without systems", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
			}),
		).toBe(true);
	});

	it("accepts a config with MCP enabled", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				mcp: {
					enabled: true,
				},
			}),
		).toBe(true);
	});

	it("rejects empty project names", () => {
		expect(
			isTrickroomConfig({
				name: " ",
				systems: {
					Core: "src/index.css",
				},
			}),
		).toBe(false);
	});

	it("rejects empty system names", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				systems: {
					" ": "src/index.css",
				},
			}),
		).toBe(false);
	});

	it("rejects empty system css paths", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				systems: {
					Core: " ",
				},
			}),
		).toBe(false);
	});

	it("rejects deprecated tailwind roots", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				tailwindRoot: "src/index.css",
			}),
		).toBe(false);
	});

	it("rejects invalid MCP config shapes", () => {
		expect(
			isTrickroomConfig({
				name: "Valid Project",
				mcp: {
					enabled: "yes",
				},
			}),
		).toBe(false);
	});
});

describe("server design routes", () => {
	let tempProjectRoot: string;
	let previousProjectDirOverride: string | undefined;

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-design-route-test-"),
		);
		previousProjectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
		process.env.TRICKROOM_PROJECT_DIR = tempProjectRoot;
		vi.resetModules();
	});

	afterEach(async () => {
		if (previousProjectDirOverride === undefined) {
			delete process.env.TRICKROOM_PROJECT_DIR;
		} else {
			process.env.TRICKROOM_PROJECT_DIR = previousProjectDirOverride;
		}

		await rm(tempProjectRoot, { force: true, recursive: true });
	});

	const importTestServer = async () => {
		const { default: app } = await import("./server");
		return app;
	};

	const writeDesign = async (file: string, design: unknown) => {
		const designPath = path.join(
			tempProjectRoot,
			".trickroom",
			"designs",
			file,
		);
		await mkdir(path.dirname(designPath), { recursive: true });
		await writeFile(designPath, JSON.stringify(design), "utf8");
	};

	it("lists only valid design summaries without leaking service revisions", async () => {
		await writeDesign("b.json", { ...validDesign, name: "Design B" });
		await writeDesign("a.json", {
			...validDesign,
			name: "Design A",
			systemName: null,
		});
		await writeDesign("invalid.json", { name: "Invalid" });
		await writeDesign("notes.txt", validDesign);
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/designs");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual([
			{
				uuid: "a",
				file: "a.json",
				name: "Design A",
				systemName: null,
			},
			{
				uuid: "b",
				file: "b.json",
				name: "Design B",
			},
		]);
	});

	it("keeps design reads scoped to the project designs directory", async () => {
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/design?file=../x.json");

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: "Design file path must be inside .trickroom/designs",
		});
	});

	it("writes valid design payloads through the extracted service", async () => {
		await mkdir(path.join(tempProjectRoot, ".trickroom", "designs"), {
			recursive: true,
		});
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/design?file=new.json", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(validDesign),
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual(validDesign);
		await expect(
			readFile(
				path.join(tempProjectRoot, ".trickroom", "designs", "new.json"),
				"utf8",
			).then(JSON.parse),
		).resolves.toEqual(validDesign);
	});
});
