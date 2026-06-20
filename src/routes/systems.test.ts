import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrickroomDesign } from "../types";

const tinyPng = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
	"base64",
);
const safeSvg =
	'<svg viewBox="0 0 24 24" fill="none"><path d="M4 12h16" stroke="currentColor" stroke-width="2"/></svg>';

async function linkNodeModulesForTest(projectRoot: string) {
	const source = path.join(process.cwd(), "node_modules");
	const target = path.join(projectRoot, "node_modules");

	if (process.platform === "win32") {
		await cp(source, target, { recursive: true });
		return;
	}

	try {
		await symlink(source, target);
	} catch {
		await cp(source, target, { recursive: true });
	}
}

describe("system asset routes", () => {
	let tempProjectRoot: string;
	let previousProjectDirOverride: string | undefined;

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-system-routes-"),
		);
		previousProjectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
		process.env.TRICKROOM_PROJECT_DIR = tempProjectRoot;
		vi.resetModules();
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/index.css" },
			}),
			"utf8",
		);
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
		const { default: app } = await import("../server");
		return app;
	};

	const writeDesignFile = async (uuid: string, design: TrickroomDesign) => {
		await mkdir(path.join(tempProjectRoot, ".trickroom", "designs"), {
			recursive: true,
		});
		await writeFile(
			path.join(tempProjectRoot, ".trickroom", "designs", `${uuid}.json`),
			JSON.stringify(design),
			"utf8",
		);
	};

	it("creates, renames, and deletes configured systems", async () => {
		const app = await importTestServer();

		const createResponse = await app.request("/api/trickroom/systems", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				systemName: "Brand",
				cssPath: "src/brand.css",
			}),
		});
		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as {
			systemId: string;
			systemName: string;
			cssPath: string;
		};
		expect(created).toMatchObject({
			systemId: expect.stringMatching(/^sys_/),
			systemName: "Brand",
			cssPath: "src/brand.css",
		});

		const renameResponse = await app.request("/api/trickroom/systems/Brand", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				systemName: "Marketing System",
			}),
		});
		expect(renameResponse.status).toBe(200);
		await expect(renameResponse.json()).resolves.toMatchObject({
			systemId: created.systemId,
			systemName: "Marketing System",
			cssPath: "src/brand.css",
		});

		const cssPathResponse = await app.request(
			"/api/trickroom/systems/Marketing%20System",
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					cssPath: "src/marketing.css",
				}),
			},
		);
		expect(cssPathResponse.status).toBe(200);
		await expect(cssPathResponse.json()).resolves.toMatchObject({
			systemId: created.systemId,
			systemName: "Marketing System",
			cssPath: "src/marketing.css",
		});

		const configAfterRename = JSON.parse(
			await readFile(
				path.join(tempProjectRoot, ".trickroom", "config.json"),
				"utf8",
			),
		) as { systems?: Record<string, string> };
		expect(configAfterRename.systems).toBeUndefined();
		const renamedManifest = JSON.parse(
			await readFile(
				path.join(
					tempProjectRoot,
					".trickroom",
					"systems",
					"brand",
					"system.json",
				),
				"utf8",
			),
		);
		expect(renamedManifest).toMatchObject({
			systemId: created.systemId,
			systemName: "Marketing System",
			cssPath: "src/marketing.css",
		});

		const deleteResponse = await app.request(
			"/api/trickroom/systems/Marketing%20System",
			{ method: "DELETE" },
		);
		expect(deleteResponse.status).toBe(200);

		const configAfterDelete = JSON.parse(
			await readFile(
				path.join(tempProjectRoot, ".trickroom", "config.json"),
				"utf8",
			),
		) as { systems?: Record<string, string> };
		expect(configAfterDelete.systems).toBeUndefined();
	});

	it("registers, lists, describes, and serves system assets by id", async () => {
		const imagePath = path.join(tempProjectRoot, "src", "assets", "hero.png");
		await mkdir(path.dirname(imagePath), { recursive: true });
		await writeFile(imagePath, tinyPng);
		const app = await importTestServer();

		const createResponse = await app.request(
			"/api/trickroom/systems/Core/assets",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					assetId: "ast_hero",
					name: "Hero",
					sourcePath: "src/assets/hero.png",
					alt: "Hero image",
				}),
			},
		);

		expect(createResponse.status).toBe(201);
		await expect(createResponse.json()).resolves.toMatchObject({
			asset: {
				id: "ast_hero",
				sourcePath: "src/assets/hero.png",
				mimeType: "image/png",
				width: 1,
				height: 1,
			},
		});

		const listResponse = await app.request(
			"/api/trickroom/systems/Core/assets",
		);
		await expect(listResponse.json()).resolves.toMatchObject({
			systemName: "Core",
			assets: [{ id: "ast_hero", name: "Hero" }],
		});

		const fileResponse = await app.request(
			"/api/trickroom/systems/Core/assets/ast_hero/file",
		);
		expect(fileResponse.status).toBe(200);
		expect(fileResponse.headers.get("content-type")).toBe("image/png");
		expect(Buffer.from(await fileResponse.arrayBuffer()).length).toBe(
			tinyPng.length,
		);
	});

	it("supports bulk asset creation, bulk metadata refresh, and bulk delete", async () => {
		const firstPath = path.join(tempProjectRoot, "src", "assets", "first.png");
		const secondPath = path.join(
			tempProjectRoot,
			"src",
			"assets",
			"second.png",
		);
		await mkdir(path.dirname(firstPath), { recursive: true });
		await writeFile(firstPath, tinyPng);
		await writeFile(secondPath, tinyPng);
		const app = await importTestServer();

		const createResponse = await app.request(
			"/api/trickroom/systems/Core/assets/bulk",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					assets: [
						{
							assetId: "ast_first",
							name: "First",
							sourcePath: "src/assets/first.png",
						},
						{
							assetId: "ast_second",
							name: "Second",
							sourcePath: "src/assets/second.png",
						},
					],
				}),
			},
		);
		expect(createResponse.status).toBe(201);

		const refreshResponse = await app.request(
			"/api/trickroom/systems/Core/assets/refresh",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ assetIds: ["ast_first", "ast_second"] }),
			},
		);
		expect(refreshResponse.status).toBe(200);
		await expect(refreshResponse.json()).resolves.toMatchObject({
			assets: [
				{ id: "ast_first", width: 1, height: 1 },
				{ id: "ast_second", width: 1, height: 1 },
			],
		});

		const deleteResponse = await app.request(
			"/api/trickroom/systems/Core/assets",
			{
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ assetIds: ["ast_first", "ast_second"] }),
			},
		);
		expect(deleteResponse.status).toBe(200);
		await expect(
			app
				.request("/api/trickroom/systems/Core/assets")
				.then((response) => response.json()),
		).resolves.toMatchObject({ assets: [] });
	});

	it("does not delete any bulk assets when a requested asset id is missing", async () => {
		const firstPath = path.join(tempProjectRoot, "src", "assets", "first.png");
		const secondPath = path.join(
			tempProjectRoot,
			"src",
			"assets",
			"second.png",
		);
		await mkdir(path.dirname(firstPath), { recursive: true });
		await writeFile(firstPath, tinyPng);
		await writeFile(secondPath, tinyPng);
		const app = await importTestServer();

		await app.request("/api/trickroom/systems/Core/assets/bulk", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				assets: [
					{
						assetId: "ast_first",
						name: "First",
						sourcePath: "src/assets/first.png",
					},
					{
						assetId: "ast_second",
						name: "Second",
						sourcePath: "src/assets/second.png",
					},
				],
			}),
		});

		const deleteResponse = await app.request(
			"/api/trickroom/systems/Core/assets",
			{
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ assetIds: ["ast_first", "ast_missing"] }),
			},
		);

		expect(deleteResponse.status).toBe(404);
		await expect(
			app
				.request("/api/trickroom/systems/Core/assets")
				.then((response) => response.json()),
		).resolves.toMatchObject({
			assets: expect.arrayContaining([
				expect.objectContaining({ id: "ast_first" }),
				expect.objectContaining({ id: "ast_second" }),
			]),
		});
	});

	it("rejects path traversal during registration", async () => {
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/systems/Core/assets", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "Secret",
				sourcePath: "../secret.png",
			}),
		});

		expect(response.status).toBe(400);
	});

	it("rejects requests for systems that are not configured", async () => {
		const app = await importTestServer();

		const listResponse = await app.request(
			"/api/trickroom/systems/Other/assets",
		);
		expect(listResponse.status).toBe(404);

		const createResponse = await app.request(
			"/api/trickroom/systems/Other/assets",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "Other",
					sourcePath: "src/assets/other.png",
				}),
			},
		);
		expect(createResponse.status).toBe(404);
	});

	it("returns a missing-file state through the safe file route", async () => {
		const app = await importTestServer();
		const createResponse = await app.request(
			"/api/trickroom/systems/Core/assets",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					assetId: "ast_missing",
					name: "Missing",
					sourcePath: "src/assets/missing.png",
				}),
			},
		);
		expect(createResponse.status).toBe(201);

		const fileResponse = await app.request(
			"/api/trickroom/systems/Core/assets/ast_missing/file",
		);
		expect(fileResponse.status).toBe(404);
	});

	it("refuses to delete assets still referenced by linked designs", async () => {
		const imagePath = path.join(tempProjectRoot, "src", "assets", "hero.png");
		await mkdir(path.dirname(imagePath), { recursive: true });
		await writeFile(imagePath, tinyPng);
		const design = {
			name: "Uses Asset",
			systemName: "Core",
			boards: [
				{
					id: "board",
					props: {
						"data-trickroom-name": "Board",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
					},
					children: [
						{
							id: "asset",
							props: {
								"data-trickroom-name": "Hero",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "asset",
								"data-trickroom-role": "leaf",
								"data-trickroom-asset-id": " AST_HERO ",
								alt: "Hero",
							},
							children: [],
						},
					],
				},
			],
		} satisfies TrickroomDesign;
		await writeDesignFile("00000000-0000-4000-8000-000000000001", design);
		const app = await importTestServer();
		await app.request("/api/trickroom/systems/Core/assets", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				assetId: "ast_hero",
				name: "Hero",
				sourcePath: "src/assets/hero.png",
			}),
		});

		const response = await app.request(
			"/api/trickroom/systems/Core/assets/ast_hero",
			{ method: "DELETE" },
		);

		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toMatchObject({
			usages: [
				{
					designFileId: "00000000-0000-4000-8000-000000000001",
					elementId: "asset",
				},
			],
		});
	});

	it("refuses to delete assets referenced by legacy-name designs after a subsequent system rename", async () => {
		const imagePath = path.join(tempProjectRoot, "src", "assets", "hero.png");
		await mkdir(path.dirname(imagePath), { recursive: true });
		await writeFile(imagePath, tinyPng);
		const app = await importTestServer();

		const firstRenameResponse = await app.request(
			"/api/trickroom/systems/Core",
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ systemName: "Marketing" }),
			},
		);
		expect(firstRenameResponse.status).toBe(200);

		await app.request("/api/trickroom/systems/Marketing/assets", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				assetId: "ast_hero",
				name: "Hero",
				sourcePath: "src/assets/hero.png",
			}),
		});
		await writeDesignFile("00000000-0000-4000-8000-000000000005", {
			name: "Legacy Marketing Asset",
			systemName: "Marketing",
			boards: [
				{
					id: "board",
					props: {
						"data-trickroom-name": "Board",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
					},
					children: [
						{
							id: "asset",
							props: {
								"data-trickroom-name": "Hero",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "asset",
								"data-trickroom-role": "leaf",
								"data-trickroom-asset-id": "ast_hero",
							},
							children: [],
						},
					],
				},
			],
		});

		const renameResponse = await app.request(
			"/api/trickroom/systems/Marketing",
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ systemName: "Brand" }),
			},
		);
		expect(renameResponse.status).toBe(200);

		const deleteResponse = await app.request(
			"/api/trickroom/systems/Brand/assets/ast_hero",
			{ method: "DELETE" },
		);

		expect(deleteResponse.status).toBe(409);
		await expect(deleteResponse.json()).resolves.toMatchObject({
			usages: [
				{
					designFileId: "00000000-0000-4000-8000-000000000005",
					elementId: "asset",
				},
			],
		});
	});

	it("returns 404 before usage checks for unknown asset deletes", async () => {
		await writeDesignFile("00000000-0000-4000-8000-000000000006", {
			name: "References Missing Asset",
			systemName: "Core",
			boards: [
				{
					id: "board",
					props: {
						"data-trickroom-name": "Board",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
					},
					children: [
						{
							id: "asset",
							props: {
								"data-trickroom-name": "Missing Hero",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "asset",
								"data-trickroom-role": "leaf",
								"data-trickroom-asset-id": "ast_missing",
							},
							children: [],
						},
					],
				},
			],
		});
		const app = await importTestServer();

		const response = await app.request(
			"/api/trickroom/systems/Core/assets/ast_missing",
			{ method: "DELETE" },
		);

		expect(response.status).toBe(404);
	});

	it("counts linked asset references for individual assets", async () => {
		const imagePath = path.join(tempProjectRoot, "src", "assets", "hero.png");
		await mkdir(path.dirname(imagePath), { recursive: true });
		await writeFile(imagePath, tinyPng);
		await writeDesignFile("00000000-0000-4000-8000-000000000001", {
			name: "Uses Asset",
			systemName: "Core",
			boards: [
				{
					id: "board",
					props: {
						"data-trickroom-name": "Board",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
					},
					children: [
						{
							id: "asset",
							props: {
								"data-trickroom-name": "Hero",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "asset",
								"data-trickroom-role": "leaf",
								"data-trickroom-asset-id": "ast_hero",
							},
							children: [],
						},
						{
							id: "asset-duplicate",
							props: {
								"data-trickroom-name": "Hero Duplicate",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "asset",
								"data-trickroom-role": "leaf",
								"data-trickroom-asset-id": "ast_hero",
							},
							children: [],
						},
					],
				},
			],
		});
		const app = await importTestServer();
		await app.request("/api/trickroom/systems/Core/assets", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				assetId: "ast_hero",
				name: "Hero",
				sourcePath: "src/assets/hero.png",
			}),
		});

		const response = await app.request(
			"/api/trickroom/systems/Core/assets/ast_hero/used-by",
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			assetId: "ast_hero",
			usedByCount: 2,
		});
	});

	it("counts all linked designs for system used-by, including token-only designs", async () => {
		const app = await importTestServer();
		const systemListResponse = await app.request("/api/trickroom/systems");
		const systemList = (await systemListResponse.json()) as {
			systems: Array<{ systemId: string; systemName: string }>;
		};
		const coreSystem = systemList.systems.find(
			(system) => system.systemName === "Core",
		);
		expect(coreSystem).toBeDefined();

		await writeDesignFile("00000000-0000-4000-8000-000000000002", {
			name: "Uses Asset",
			systemId: coreSystem?.systemId,
			boards: [
				{
					id: "board",
					props: {
						"data-trickroom-name": "Board",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
					},
					children: [
						{
							id: "asset",
							props: {
								"data-trickroom-name": "Hero",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "asset",
								"data-trickroom-role": "leaf",
								"data-trickroom-asset-id": "ast_hero",
							},
							children: [],
						},
					],
				},
			],
		});
		await writeDesignFile("00000000-0000-4000-8000-000000000003", {
			name: "Token Only",
			systemName: "Core",
			boards: [],
		});
		await writeDesignFile("00000000-0000-4000-8000-000000000004", {
			name: "Other System",
			systemName: "Other",
			boards: [],
		});

		const response = await app.request("/api/trickroom/systems/Core/used-by");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			systemName: "Core",
			usedByCount: 2,
		});
	});

	it("returns zero used-by count for systems without linked designs", async () => {
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/systems/Core/used-by");

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			systemName: "Core",
			usedByCount: 0,
		});
	});

	it("returns 404 for missing system used-by requests", async () => {
		const app = await importTestServer();

		const response = await app.request("/api/trickroom/systems/Other/used-by");

		expect(response.status).toBe(404);
	});

	it("syncs, lists, describes, and serves sanitized icons by id", async () => {
		const iconPath = path.join(tempProjectRoot, "src", "icons", "search.svg");
		await mkdir(path.dirname(iconPath), { recursive: true });
		await writeFile(iconPath, safeSvg);
		await mkdir(path.join(tempProjectRoot, ".trickroom", "systems", "core"), {
			recursive: true,
		});
		await writeFile(
			path.join(
				tempProjectRoot,
				".trickroom",
				"systems",
				"core",
				"system.json",
			),
			JSON.stringify({
				version: 1,
				systemName: "Core",
				iconFolderPaths: ["src/icons"],
			}),
			"utf8",
		);
		const app = await importTestServer();

		const syncResponse = await app.request(
			"/api/trickroom/systems/Core/icons/sync",
			{ method: "POST" },
		);
		expect(syncResponse.status).toBe(200);
		await expect(syncResponse.json()).resolves.toMatchObject({
			icons: [
				{
					id: "src/search",
					sourcePath: "src/icons/search.svg",
					paint: "stroke",
				},
			],
		});

		const listResponse = await app.request("/api/trickroom/systems/Core/icons");
		await expect(listResponse.json()).resolves.toMatchObject({
			systemName: "Core",
			icons: [{ id: "src/search" }],
		});

		const svgResponse = await app.request(
			`/api/trickroom/systems/Core/icons/${encodeURIComponent("src/search")}/svg`,
		);
		expect(svgResponse.status).toBe(200);
		expect(svgResponse.headers.get("content-type")).toContain("image/svg+xml");
		expect(await svgResponse.text()).toBe(safeSvg);
	});

	it("adds, reorders, and removes icon folder paths", async () => {
		const iconPath = path.join(tempProjectRoot, "src", "icons", "search.svg");
		const actionIconPath = path.join(
			tempProjectRoot,
			"src",
			"action-icons",
			"search.svg",
		);
		await mkdir(path.dirname(iconPath), { recursive: true });
		await mkdir(path.dirname(actionIconPath), { recursive: true });
		await writeFile(iconPath, safeSvg);
		await writeFile(actionIconPath, safeSvg);
		const app = await importTestServer();

		const addResponse = await app.request(
			"/api/trickroom/systems/Core/icons/folders",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ folderPath: "src/icons" }),
			},
		);
		expect(addResponse.status).toBe(200);
		await expect(addResponse.json()).resolves.toMatchObject({
			iconFolderPaths: ["src/icons"],
			icons: [{ id: "src/search" }],
		});

		const reorderResponse = await app.request(
			"/api/trickroom/systems/Core/icons/folders",
			{
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					folderPaths: ["src/action-icons", "src/icons"],
				}),
			},
		);
		expect(reorderResponse.status).toBe(200);
		await expect(reorderResponse.json()).resolves.toMatchObject({
			iconFolderPaths: ["src/action-icons", "src/icons"],
			icons: [
				{
					id: "action-icons/search",
					sourcePath: "src/action-icons/search.svg",
				},
				{ id: "src/search", sourcePath: "src/icons/search.svg" },
			],
		});

		const removeResponse = await app.request(
			"/api/trickroom/systems/Core/icons/folders",
			{
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					folderPaths: ["src/action-icons", "src/icons"],
				}),
			},
		);
		expect(removeResponse.status).toBe(200);
		await expect(removeResponse.json()).resolves.toMatchObject({
			iconFolderPaths: [],
			icons: [],
		});
	});
});

describe("system font routes", () => {
	let tempProjectRoot: string;
	let previousProjectDirOverride: string | undefined;

	beforeEach(async () => {
		tempProjectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-system-font-routes-"),
		);
		previousProjectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
		process.env.TRICKROOM_PROJECT_DIR = tempProjectRoot;
		vi.resetModules();
		await writeFile(
			path.join(tempProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Test Project",
				systems: { Core: "src/index.css" },
			}),
			"utf8",
		);
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
		const { default: app } = await import("../server");
		return app;
	};

	const tinyWoff2 = Buffer.from("d09GMgABAAAAAA", "base64");

	it("registers, lists, serves, and imports system fonts", async () => {
		const fontPath = path.join(tempProjectRoot, "src", "fonts", "brand.woff2");
		await mkdir(path.dirname(fontPath), { recursive: true });
		await writeFile(fontPath, tinyWoff2);
		const app = await importTestServer();

		const createResponse = await app.request(
			"/api/trickroom/systems/Core/fonts",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					fontId: "brand",
					name: "Brand",
					family: "Brand Sans",
					faces: [
						{
							style: "normal",
							weight: "400",
							display: "swap",
							sources: [
								{
									kind: "remoteStylesheet",
									url: "https://fonts.googleapis.com/css2?family=Brand+Sans",
								},
								{
									kind: "projectFile",
									path: "src/fonts/brand.woff2",
									format: "woff2",
								},
							],
						},
					],
				}),
			},
		);
		expect(createResponse.status).toBe(201);

		const listResponse = await app.request("/api/trickroom/systems/Core/fonts");
		await expect(listResponse.json()).resolves.toMatchObject({
			systemName: "Core",
			fonts: [{ id: "brand", family: "Brand Sans" }],
		});

		const projectFileResponse = await app.request(
			"/api/trickroom/systems/Core/fonts/project-file?path=src%2Ffonts%2Fbrand.woff2",
		);
		expect(projectFileResponse.status).toBe(200);
		expect(projectFileResponse.headers.get("content-type")).toBe("font/woff2");

		const outsideDir = await mkdtemp(
			path.join(tempProjectRoot, ".tmp-outside-font-route-"),
		);
		const outsideFont = path.join(outsideDir, "picked.woff2");
		await writeFile(outsideFont, tinyWoff2);

		const importResponse = await app.request(
			"/api/trickroom/systems/Core/fonts/import",
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					absoluteSourcePath: outsideFont,
					targetRelativePath: "fonts/imported/picked.woff2",
				}),
			},
		);
		expect(importResponse.status).toBe(200);

		const managedFileResponse = await app.request(
			"/api/trickroom/systems/Core/fonts/managed-file?path=fonts%2Fimported%2Fpicked.woff2",
		);
		expect(managedFileResponse.status).toBe(200);
		expect(managedFileResponse.headers.get("content-type")).toBe("font/woff2");

		await rm(outsideDir, { force: true, recursive: true });
	});

	it("syncs @fontsource imports from the system stylesheet into fonts.json", async () => {
		await mkdir(path.join(tempProjectRoot, "src"), { recursive: true });
		await writeFile(
			path.join(tempProjectRoot, "src", "index.css"),
			[
				'@import "@fontsource/ibm-plex-sans/latin-400.css";',
				'@import "@fontsource/ibm-plex-mono/latin-400.css";',
			].join("\n"),
			"utf8",
		);
		await linkNodeModulesForTest(tempProjectRoot);

		const app = await importTestServer();
		const syncResponse = await app.request(
			"/api/trickroom/systems/Core/fonts/sync-from-stylesheet",
			{ method: "POST" },
		);
		expect(syncResponse.status).toBe(200);
		const syncBody = (await syncResponse.json()) as {
			fonts: Array<{ id: string; family: string }>;
			sync: { addedFontIds: string[] };
		};
		expect(syncBody.sync.addedFontIds.length).toBeGreaterThanOrEqual(2);
		expect(syncBody.fonts.map((font) => font.family).sort()).toEqual(
			["IBM Plex Mono", "IBM Plex Sans"],
		);

		const listResponse = await app.request("/api/trickroom/systems/Core/fonts");
		expect(listResponse.status).toBe(200);
		const listBody = (await listResponse.json()) as {
			fonts: Array<{ id: string }>;
		};
		expect(listBody.fonts.length).toBeGreaterThanOrEqual(2);
	});

	it("returns 400 for malformed font manifest faces in stored fonts.json", async () => {
		const app = await importTestServer();
		const { resolveDesignSystemFontsPath } = await import(
			"../utils/design-system-store"
		);
		const fontsPath = resolveDesignSystemFontsPath(tempProjectRoot, "Core");
		await mkdir(path.dirname(fontsPath), { recursive: true });
		await writeFile(
			fontsPath,
			JSON.stringify({
				version: 1,
				metadata: { updatedAt: "2026-05-25T00:00:00.000Z" },
				fonts: {
					broken: {
						name: "Broken",
						family: "Broken",
						faces: [null],
						createdAt: "2026-05-25T00:00:00.000Z",
						updatedAt: "2026-05-25T00:00:00.000Z",
					},
				},
			}),
			"utf8",
		);

		const response = await app.request("/api/trickroom/systems/Core/fonts");
		expect(response.status).toBe(400);
	});

	it("rejects unsafe remote font URLs", async () => {
		const app = await importTestServer();
		const response = await app.request("/api/trickroom/systems/Core/fonts", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				name: "Unsafe",
				family: "Unsafe",
				faces: [
					{
						style: "normal",
						weight: "400",
						sources: [
							{
								kind: "remoteStylesheet",
								url: "javascript:alert(1)",
							},
						],
					},
				],
			}),
		});
		expect(response.status).toBe(400);
	});
});
