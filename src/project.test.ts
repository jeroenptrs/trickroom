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
import { afterEach, describe, expect, it } from "vitest";
import {
	getTrickroomProjectPaths,
	openProject,
	readOrCreateProjectConfig,
	readOrMigrateProjectConfig,
	readProjectConfig,
	readProjectConfigReadOnly,
	writeProjectConfig,
} from "./project";
import type { TrickroomCodegenConfig } from "./types";

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

	describe("codegen block", () => {
		const codegen: TrickroomCodegenConfig = {
			version: 1,
			system: "foundation",
			outDir: "design-system/ui/src",
			fileName: "{slug}.variants.ts",
			tvImport: "./tv",
			shape: "auto",
			include: ["toast", "button"],
			exclude: ["topbar"],
			formatter: {
				command: "./node_modules/.bin/biome",
				args: ["format", "--stdin-file-path={file}"],
			},
		};

		const writeCurrentConfig = async (projectRoot: string, config: unknown) => {
			await mkdir(path.join(projectRoot, ".trickroom"), { recursive: true });
			const contents = `${JSON.stringify(config, null, "\t")}\n`;
			await writeFile(
				path.join(projectRoot, ".trickroom", "config.json"),
				contents,
				"utf8",
			);
			return contents;
		};

		const readCurrentConfig = (projectRoot: string) =>
			readFile(path.join(projectRoot, ".trickroom", "config.json"), "utf8");

		it("keeps a config without the block byte-for-byte on read and write", async () => {
			const projectRoot = await tempDir(".tmp-trickroom-project-");
			const contents = await writeCurrentConfig(projectRoot, {
				schemaVersion: 1,
				projectId: "proj_00000000-0000-4000-8000-000000000000",
				name: "Plain",
				mcp: { enabled: true, mode: "read-only" },
			});

			await writeProjectConfig(
				projectRoot,
				await readProjectConfig(projectRoot),
			);

			await expect(readCurrentConfig(projectRoot)).resolves.toBe(contents);
		});

		it("round-trips the block byte-for-byte on read and write", async () => {
			const projectRoot = await tempDir(".tmp-trickroom-project-");
			const contents = await writeCurrentConfig(projectRoot, {
				schemaVersion: 1,
				projectId: "proj_00000000-0000-4000-8000-000000000000",
				name: "Codegen",
				codegen,
			});

			await writeProjectConfig(
				projectRoot,
				await readProjectConfig(projectRoot),
			);

			await expect(readCurrentConfig(projectRoot)).resolves.toBe(contents);
		});

		it("keeps the block when migrating a legacy config with systems", async () => {
			const projectRoot = await tempDir(".tmp-trickroom-project-");
			await writeFile(
				path.join(projectRoot, "trickroom.config.json"),
				JSON.stringify({
					name: "Legacy",
					systems: { Core: "src/index.css" },
					codegen,
				}),
				"utf8",
			);

			const migrated = await readOrMigrateProjectConfig(projectRoot);

			expect(migrated.source).toBe("legacy");
			expect(migrated.config.codegen).toEqual(codegen);
			await expect(
				readCurrentConfig(projectRoot).then(JSON.parse),
			).resolves.toMatchObject({ codegen });
		});

		it("keeps the block when opening adds a missing projectId", async () => {
			const projectRoot = await tempDir(".tmp-trickroom-project-");
			await writeCurrentConfig(projectRoot, { name: "No Id", codegen });

			const opened = await readOrCreateProjectConfig(projectRoot);

			expect(opened.config.projectId).toMatch(/^proj_/);
			const stored = JSON.parse(await readCurrentConfig(projectRoot));
			expect(stored.projectId).toBe(opened.config.projectId);
			expect(stored.codegen).toEqual(codegen);
		});

		it("names the offending field when the block is invalid", async () => {
			const projectRoot = await tempDir(".tmp-trickroom-project-");
			await writeCurrentConfig(projectRoot, {
				name: "Bad",
				codegen: { version: 1, outDir: "../outside" },
			});

			await expect(readProjectConfig(projectRoot)).rejects.toThrow(
				/is invalid\. codegen\.outDir must stay inside the project/,
			);
			await expect(readProjectConfigReadOnly(projectRoot)).rejects.toThrow(
				/codegen\.outDir/,
			);
		});

		it("reads without writing, reporting what migration would change", async () => {
			const projectRoot = await tempDir(".tmp-trickroom-project-");
			await writeFile(
				path.join(projectRoot, "trickroom.config.json"),
				JSON.stringify({
					name: "Legacy",
					systems: { Core: "src/index.css" },
					codegen,
				}),
				"utf8",
			);
			const snapshot = async () => {
				const entries = await readdir(projectRoot, { recursive: true });
				return Promise.all(
					entries.sort().map(async (entry) => {
						const info = await stat(path.join(projectRoot, entry));
						return [entry, info.mtimeMs, info.size];
					}),
				);
			};
			const before = await snapshot();

			const project = await readProjectConfigReadOnly(projectRoot);

			expect(project.source).toBe("legacy");
			expect(project.migrationReasons).toEqual([
				"legacy-config",
				"missing-project-id",
				"legacy-systems",
			]);
			expect(project.config).not.toHaveProperty("projectId");
			expect(project.config.codegen).toEqual(codegen);
			await expect(snapshot()).resolves.toEqual(before);
			expect(before.map(([entry]) => entry)).toEqual(["trickroom.config.json"]);
		});

		it("reports no migration for a current config", async () => {
			const projectRoot = await tempDir(".tmp-trickroom-project-");
			await writeCurrentConfig(projectRoot, {
				schemaVersion: 1,
				projectId: "proj_00000000-0000-4000-8000-000000000000",
				name: "Current",
			});

			const project = await readProjectConfigReadOnly(projectRoot);

			expect(project.source).toBe("current");
			expect(project.migrationReasons).toEqual([]);
			expect(project.config).not.toHaveProperty("codegen");
		});
	});
});
