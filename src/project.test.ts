import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getTrickroomProjectPaths,
	openProject,
	readOrCreateProjectConfig,
	readProjectConfig,
	writeProjectConfig,
} from "./project";

describe("project config paths and migration", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots
				.splice(0)
				.map((root) => rm(root, { force: true, recursive: true })),
		);
	});

	const tempDir = async (prefix: string) => {
		const root = await mkdtemp(path.join(process.cwd(), prefix));
		tempRoots.push(root);
		return root;
	};

	it("uses .trickroom/config.json and .trickroom/designs", async () => {
		const projectRoot = await tempDir(".tmp-trickroom-project-");

		expect(getTrickroomProjectPaths(projectRoot)).toMatchObject({
			projectRoot,
			trickroomDir: path.join(projectRoot, ".trickroom"),
			configPath: path.join(projectRoot, ".trickroom", "config.json"),
			legacyConfigPath: path.join(projectRoot, "trickroom.config.json"),
			designsDir: path.join(projectRoot, ".trickroom", "designs"),
		});
	});

	it("creates new config with stable generated project id", async () => {
		const projectRoot = await tempDir(".tmp-trickroom-project-");

		const first = await readOrCreateProjectConfig(projectRoot, {
			defaultName: "Created Project",
		});
		const second = await readOrCreateProjectConfig(projectRoot);

		expect(first.config.projectId).toMatch(/^proj_/);
		expect(second.config.projectId).toBe(first.config.projectId);
		await expect(
			readFile(
				path.join(projectRoot, ".trickroom", "config.json"),
				"utf8",
			).then(JSON.parse),
		).resolves.toMatchObject({
			schemaVersion: 1,
			projectId: first.config.projectId,
			name: "Created Project",
		});
	});

	it("migrates legacy config without deleting the legacy file", async () => {
		const projectRoot = await tempDir(".tmp-trickroom-project-");
		const legacyConfigPath = path.join(projectRoot, "trickroom.config.json");
		await writeFile(
			legacyConfigPath,
			JSON.stringify({
				name: "Legacy Project",
				systems: { Core: "src/index.css" },
				mcp: { enabled: true },
			}),
			"utf8",
		);

		const migrated = await readOrCreateProjectConfig(projectRoot);

		expect(migrated.source).toBe("legacy");
		expect(migrated.config).toMatchObject({
			schemaVersion: 1,
			name: "Legacy Project",
			mcp: { enabled: true },
		});
		expect(migrated.config).not.toHaveProperty("systems");
		expect(migrated.config.projectId).toMatch(/^proj_/);
		await expect(
			readFile(
				path.join(projectRoot, ".trickroom", "systems", "core", "system.json"),
				"utf8",
			).then(JSON.parse),
		).resolves.toMatchObject({
			systemId: expect.stringMatching(/^sys_/),
			systemName: "Core",
			cssPath: "src/index.css",
		});
		await expect(readFile(legacyConfigPath, "utf8")).resolves.toContain(
			"Legacy Project",
		);
	});

	it("writes only the new config path", async () => {
		const projectRoot = await tempDir(".tmp-trickroom-project-");
		const written = await writeProjectConfig(projectRoot, {
			name: "New Project",
		});

		expect(written.projectId).toMatch(/^proj_/);
		await expect(readProjectConfig(projectRoot)).resolves.toMatchObject({
			name: "New Project",
			projectId: written.projectId,
		});
	});

	it("registers opened project locations in app state", async () => {
		const trickroomHome = await tempDir(".tmp-trickroom-home-");
		const projectRoot = await tempDir(".tmp-trickroom-project-");
		await mkdir(projectRoot, { recursive: true });

		const opened = await openProject({ trickroomHome, projectRoot });

		expect(opened.locationId).toMatch(/^loc_/);
		await expect(
			readFile(path.join(trickroomHome, "projects.json"), "utf8").then(
				JSON.parse,
			),
		).resolves.toMatchObject({
			lastActiveLocationId: opened.locationId,
			locations: [
				{
					projectId: opened.config.projectId,
					root: projectRoot,
					name: path.basename(projectRoot),
				},
			],
		});
	});
});
