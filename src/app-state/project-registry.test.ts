import { spawn } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	clearActiveProjectLocation,
	deleteProjectLocation,
	getActiveProjectLocation,
	listPresentProjectLocations,
	PROJECT_LOCATION_MISSING_RETENTION_MS,
	readProjectRegistry,
	updateProjectLocationName,
	upsertProjectLocation,
} from "./project-registry";

const registryModuleUrl = pathToFileURL(
	fileURLToPath(new URL("./project-registry.ts", import.meta.url)),
).href;

// Worker processes load the real registry through Node's type stripping; the
// hook only adds the extensions the source omits.
const resolveHook = `
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

registerHooks({
	resolve(specifier, context, next) {
		if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
			const url = new URL(specifier, context.parentURL);
			const filePath = fileURLToPath(url);
			if (!existsSync(filePath) || !/\\.[cm]?[jt]s$/.test(filePath)) {
				for (const extension of [".ts", "/index.ts"]) {
					if (existsSync(filePath + extension)) {
						return next(url.href + extension, context);
					}
				}
			}
		}
		return next(specifier, context);
	},
});
`;

const upsertWorker = `
const [moduleUrl, trickroomHome, projectRoot, startAt] = process.argv.slice(2);
const { upsertProjectLocation } = await import(moduleUrl);
while (Date.now() < Number(startAt)) {}
const { location } = await upsertProjectLocation({
	trickroomHome,
	projectId: "proj_shared",
	root: projectRoot,
	name: "Worktree",
	markActive: false,
});
process.stdout.write(location.locationId);
`;

const day = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(ms).toISOString();

describe("project registry", () => {
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

	it("reads an empty registry when app state has not been created", async () => {
		const trickroomHome = await tempDir(".tmp-trickroom-home-");

		const registry = await readProjectRegistry(trickroomHome);

		expect(registry).toEqual({ schemaVersion: 1, locations: [] });
	});

	it("upserts locations and keeps last active location", async () => {
		const trickroomHome = await tempDir(".tmp-trickroom-home-");
		const projectRoot = await tempDir(".tmp-trickroom-project-");

		const first = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_one",
			root: projectRoot,
			name: "Project One",
			now: "2026-01-01T00:00:00.000Z",
		});
		const second = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_one",
			root: projectRoot,
			name: "Project One Renamed",
			now: "2026-01-02T00:00:00.000Z",
		});

		expect(second.location.locationId).toBe(first.location.locationId);
		expect(second.registry.locations).toHaveLength(1);
		expect(getActiveProjectLocation(second.registry)).toMatchObject({
			locationId: first.location.locationId,
			name: "Project One Renamed",
		});
	});

	it("upserts catalog-only locations without changing active references", async () => {
		const trickroomHome = await tempDir(".tmp-trickroom-home-");
		const activeProjectRoot = await tempDir(".tmp-trickroom-project-");
		const catalogProjectRoot = await tempDir(".tmp-trickroom-project-");

		const active = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_active",
			root: activeProjectRoot,
			name: "Active Project",
			now: "2026-01-01T00:00:00.000Z",
		});
		const catalog = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_catalog",
			root: catalogProjectRoot,
			name: "Catalog Project",
			now: "2026-01-02T00:00:00.000Z",
			markActive: false,
		});

		expect(catalog.location.projectId).toBe("proj_catalog");
		expect(catalog.registry.lastActiveProjectId).toBe(
			active.location.projectId,
		);
		expect(catalog.registry.lastActiveLocationId).toBe(
			active.location.locationId,
		);
		expect(catalog.registry.locations).toHaveLength(2);
	});

	it("updates catalog-only locations without changing active references", async () => {
		const trickroomHome = await tempDir(".tmp-trickroom-home-");
		const activeProjectRoot = await tempDir(".tmp-trickroom-project-");
		const catalogProjectRoot = await tempDir(".tmp-trickroom-project-");

		const active = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_active",
			root: activeProjectRoot,
			name: "Active Project",
			now: "2026-01-01T00:00:00.000Z",
		});
		const catalog = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_catalog",
			root: catalogProjectRoot,
			name: "Catalog Project",
			now: "2026-01-02T00:00:00.000Z",
			markActive: false,
		});
		const refreshed = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_catalog",
			root: catalogProjectRoot,
			name: "Catalog Project Renamed",
			now: "2026-01-03T00:00:00.000Z",
			markActive: false,
		});

		expect(refreshed.location.locationId).toBe(catalog.location.locationId);
		expect(refreshed.location.name).toBe("Catalog Project Renamed");
		expect(refreshed.registry.lastActiveProjectId).toBe(
			active.location.projectId,
		);
		expect(refreshed.registry.lastActiveLocationId).toBe(
			active.location.locationId,
		);
		expect(refreshed.registry.locations).toHaveLength(2);
	});

	it("deletes locations and clears the active reference when needed", async () => {
		const trickroomHome = await tempDir(".tmp-trickroom-home-");
		const firstProjectRoot = await tempDir(".tmp-trickroom-project-");
		const secondProjectRoot = await tempDir(".tmp-trickroom-project-");

		const first = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_one",
			root: firstProjectRoot,
			name: "Project One",
			now: "2026-01-01T00:00:00.000Z",
		});
		const second = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_two",
			root: secondProjectRoot,
			name: "Project Two",
			now: "2026-01-02T00:00:00.000Z",
		});

		const deleted = await deleteProjectLocation({
			trickroomHome,
			locationId: second.location.locationId,
		});

		expect(deleted?.location).toMatchObject({ projectId: "proj_two" });
		expect(
			deleted?.registry.locations.map((location) => location.locationId),
		).toEqual([first.location.locationId]);
		expect(
			getActiveProjectLocation(deleted?.registry ?? first.registry),
		).toBeNull();
		expect(deleted?.registry.lastActiveProjectId).toBeUndefined();
		expect(deleted?.registry.lastActiveLocationId).toBeUndefined();
	});

	it("returns null when deleting an unknown location", async () => {
		const trickroomHome = await tempDir(".tmp-trickroom-home-");

		await expect(
			deleteProjectLocation({ trickroomHome, locationId: "loc_missing" }),
		).resolves.toBeNull();
	});

	it("updates a location name without changing active references", async () => {
		const trickroomHome = await tempDir(".tmp-trickroom-home-");
		const projectRoot = await tempDir(".tmp-trickroom-project-");
		const { location } = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_one",
			root: projectRoot,
			name: "Project One",
			now: "2026-01-01T00:00:00.000Z",
		});

		const renamed = await updateProjectLocationName({
			trickroomHome,
			locationId: location.locationId,
			name: "Renamed Project",
		});

		expect(renamed?.location).toMatchObject({
			locationId: location.locationId,
			name: "Renamed Project",
		});
		expect(renamed?.registry.lastActiveLocationId).toBe(location.locationId);
		if (!renamed) {
			throw new Error("Expected project location to be renamed.");
		}
		expect(getActiveProjectLocation(renamed.registry)).toMatchObject({
			name: "Renamed Project",
		});
	});

	it("clears the active reference without deleting recent locations", async () => {
		const trickroomHome = await tempDir(".tmp-trickroom-home-");
		const projectRoot = await tempDir(".tmp-trickroom-project-");
		const { location } = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_one",
			root: projectRoot,
			name: "Project One",
			now: "2026-01-01T00:00:00.000Z",
		});

		const registry = await clearActiveProjectLocation(trickroomHome);

		expect(registry.locations).toMatchObject([
			{ locationId: location.locationId },
		]);
		expect(getActiveProjectLocation(registry)).toBeNull();
		expect(registry.lastActiveProjectId).toBeUndefined();
		expect(registry.lastActiveLocationId).toBeUndefined();
	});

	it("reports corrupt registry JSON clearly", async () => {
		const trickroomHome = await tempDir(".tmp-trickroom-home-");
		await writeFile(path.join(trickroomHome, "projects.json"), "{", "utf8");

		await expect(readProjectRegistry(trickroomHome)).rejects.toThrow(
			/corrupt JSON/,
		);
	});

	describe("missing locations", () => {
		const start = Date.parse("2026-01-01T00:00:00.000Z");

		const registerTwo = async () => {
			const trickroomHome = await tempDir(".tmp-trickroom-home-");
			const keptRoot = await tempDir(".tmp-trickroom-project-");
			const goneRoot = await tempDir(".tmp-trickroom-project-");
			const gone = await upsertProjectLocation({
				trickroomHome,
				projectId: "proj_one",
				root: goneRoot,
				name: "Removed Worktree",
				now: at(start),
			});
			const kept = await upsertProjectLocation({
				trickroomHome,
				projectId: "proj_one",
				root: keptRoot,
				name: "Main Checkout",
				now: at(start),
				markActive: false,
			});
			return {
				trickroomHome,
				keptRoot,
				goneRoot,
				gone: gone.location,
				kept: kept.location,
			};
		};

		const touch = (trickroomHome: string, root: string, now: number) =>
			upsertProjectLocation({
				trickroomHome,
				projectId: "proj_one",
				root,
				name: "Main Checkout",
				now: at(now),
				markActive: false,
			});

		it("hides a missing root when listing and writes nothing", async () => {
			const { trickroomHome, goneRoot, kept } = await registerTwo();
			await rm(goneRoot, { recursive: true, force: true });
			const registryPath = path.join(trickroomHome, "projects.json");
			const before = await readFile(registryPath, "utf8");
			const beforeStat = await stat(registryPath);

			const registry = await readProjectRegistry(trickroomHome);
			const present = await listPresentProjectLocations(registry.locations);

			expect(present.map((location) => location.locationId)).toEqual([
				kept.locationId,
			]);
			expect(registry.locations).toHaveLength(2);
			await expect(readFile(registryPath, "utf8")).resolves.toBe(before);
			expect((await stat(registryPath)).mtimeMs).toBe(beforeStat.mtimeMs);
		});

		it("records missingSince on a write, clears it when the folder returns, and removes the entry after the retention period", async () => {
			const { trickroomHome, keptRoot, goneRoot, gone } = await registerTwo();
			const goneEntry = async () =>
				(await readProjectRegistry(trickroomHome)).locations.find(
					(location) => location.locationId === gone.locationId,
				);

			await rm(goneRoot, { recursive: true, force: true });
			await touch(trickroomHome, keptRoot, start + day);
			expect(await goneEntry()).toMatchObject({
				missingSince: at(start + day),
			});

			// A later write keeps the first sighting.
			await touch(trickroomHome, keptRoot, start + 2 * day);
			expect(await goneEntry()).toMatchObject({
				missingSince: at(start + day),
			});

			// The folder comes back: the mark goes.
			await mkdir(goneRoot);
			await touch(trickroomHome, keptRoot, start + 3 * day);
			expect(await goneEntry()).not.toHaveProperty("missingSince");

			await rm(goneRoot, { recursive: true, force: true });
			await touch(trickroomHome, keptRoot, start + 4 * day);
			expect(await goneEntry()).toMatchObject({
				missingSince: at(start + 4 * day),
			});

			await touch(
				trickroomHome,
				keptRoot,
				start + 4 * day + PROJECT_LOCATION_MISSING_RETENTION_MS - 1,
			);
			expect(await goneEntry()).toBeDefined();

			await touch(
				trickroomHome,
				keptRoot,
				start + 4 * day + PROJECT_LOCATION_MISSING_RETENTION_MS,
			);
			expect(await goneEntry()).toBeUndefined();
		});

		it("does not mark or remove anything on reads or on writes that do not reconcile", async () => {
			const { trickroomHome, goneRoot, kept } = await registerTwo();
			await rm(goneRoot, { recursive: true, force: true });

			await updateProjectLocationName({
				trickroomHome,
				locationId: kept.locationId,
				name: "Renamed",
			});

			const registry = await readProjectRegistry(trickroomHome);
			expect(registry.locations).toHaveLength(2);
			expect(registry.locations.some((location) => location.missingSince)).toBe(
				false,
			);
		});

		it("clears last-active pointers that lead to a removed location", async () => {
			const trickroomHome = await tempDir(".tmp-trickroom-home-");
			const goneRoot = await tempDir(".tmp-trickroom-project-");
			const otherRoot = await tempDir(".tmp-trickroom-project-");
			const gone = await upsertProjectLocation({
				trickroomHome,
				projectId: "proj_gone",
				root: goneRoot,
				name: "Gone",
				now: at(start),
			});
			await rm(goneRoot, { recursive: true, force: true });

			const first = await upsertProjectLocation({
				trickroomHome,
				projectId: "proj_other",
				root: otherRoot,
				name: "Other",
				now: at(start + day),
				markActive: false,
			});
			expect(first.registry.lastActiveLocationId).toBe(
				gone.location.locationId,
			);
			expect(first.registry.lastActiveProjectId).toBe("proj_gone");

			const pruned = await upsertProjectLocation({
				trickroomHome,
				projectId: "proj_other",
				root: otherRoot,
				name: "Other",
				now: at(start + day + PROJECT_LOCATION_MISSING_RETENTION_MS),
				markActive: false,
			});
			expect(pruned.registry.locations).toHaveLength(1);
			expect(pruned.registry).not.toHaveProperty("lastActiveLocationId");
			expect(pruned.registry).not.toHaveProperty("lastActiveProjectId");
		});

		it("keeps the last-active project while another of its locations remains", async () => {
			const { trickroomHome, keptRoot, goneRoot, gone } = await registerTwo();
			await rm(goneRoot, { recursive: true, force: true });
			await touch(trickroomHome, keptRoot, start + day);

			const pruned = await touch(
				trickroomHome,
				keptRoot,
				start + day + PROJECT_LOCATION_MISSING_RETENTION_MS,
			);

			expect(gone.locationId).not.toBe(pruned.location.locationId);
			expect(pruned.registry).not.toHaveProperty("lastActiveLocationId");
			expect(pruned.registry.lastActiveProjectId).toBe("proj_one");
		});
	});

	it("keeps fields it does not know through read-modify-write", async () => {
		const trickroomHome = await tempDir(".tmp-trickroom-home-");
		const projectRoot = await tempDir(".tmp-trickroom-project-");
		const otherRoot = await tempDir(".tmp-trickroom-project-");
		await writeFile(
			path.join(trickroomHome, "projects.json"),
			JSON.stringify({
				schemaVersion: 1,
				futureTopLevel: { keep: true },
				locations: [
					{
						locationId: "loc_known",
						projectId: "proj_one",
						root: projectRoot,
						name: "Project One",
						lastOpenedAt: "2026-01-01T00:00:00.000Z",
						pinned: true,
					},
				],
				lastActiveProjectId: "proj_one",
				lastActiveLocationId: "loc_known",
			}),
			"utf8",
		);

		await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_one",
			root: projectRoot,
			name: "Project One",
			now: "2026-01-02T00:00:00.000Z",
			markActive: false,
		});
		await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_two",
			root: otherRoot,
			name: "Project Two",
			now: "2026-01-03T00:00:00.000Z",
		});
		await updateProjectLocationName({
			trickroomHome,
			locationId: "loc_known",
			name: "Renamed",
		});
		await clearActiveProjectLocation(trickroomHome);

		const stored = JSON.parse(
			await readFile(path.join(trickroomHome, "projects.json"), "utf8"),
		);
		expect(stored.futureTopLevel).toEqual({ keep: true });
		expect(
			stored.locations.find(
				(location: { locationId: string }) =>
					location.locationId === "loc_known",
			),
		).toMatchObject({ pinned: true, name: "Renamed" });
	});

	it("accepts a registry written before missingSince existed", async () => {
		const trickroomHome = await tempDir(".tmp-trickroom-home-");
		const registry = {
			schemaVersion: 1,
			locations: [
				{
					locationId: "loc_old",
					projectId: "proj_old",
					root: "/somewhere/old",
					name: "Old",
					lastOpenedAt: "2025-06-01T00:00:00.000Z",
				},
			],
			lastActiveProjectId: "proj_old",
			lastActiveLocationId: "loc_old",
		};
		await writeFile(
			path.join(trickroomHome, "projects.json"),
			JSON.stringify(registry),
			"utf8",
		);

		await expect(readProjectRegistry(trickroomHome)).resolves.toEqual(registry);
	});

	it("keeps every registration when several processes upsert at once", async () => {
		const trickroomHome = await tempDir(".tmp-trickroom-home-");
		const scratch = await tempDir(".tmp-trickroom-workers-");
		const hookPath = path.join(scratch, "hook.mjs");
		const workerPath = path.join(scratch, "worker.mjs");
		await writeFile(hookPath, resolveHook, "utf8");
		await writeFile(workerPath, upsertWorker, "utf8");
		const roots = await Promise.all(
			Array.from({ length: 6 }, () => tempDir(".tmp-trickroom-project-")),
		);
		const startAt = Date.now() + 1_500;

		const locationIds = await Promise.all(
			roots.map(
				(root) =>
					new Promise<string>((resolve, reject) => {
						const child = spawn(
							process.execPath,
							[
								"--no-warnings",
								"--import",
								pathToFileURL(hookPath).href,
								workerPath,
								registryModuleUrl,
								trickroomHome,
								root,
								String(startAt),
							],
							{ stdio: ["ignore", "pipe", "pipe"] },
						);
						let stdout = "";
						let stderr = "";
						child.stdout.on("data", (chunk) => {
							stdout += chunk;
						});
						child.stderr.on("data", (chunk) => {
							stderr += chunk;
						});
						child.on("error", reject);
						child.on("exit", (code) => {
							if (code === 0) {
								resolve(stdout.trim());
							} else {
								reject(new Error(`worker exited ${code}: ${stderr}`));
							}
						});
					}),
			),
		);

		const registry = await readProjectRegistry(trickroomHome);
		expect(registry.locations.map((location) => location.root).sort()).toEqual(
			[...roots].sort(),
		);
		expect(
			registry.locations.map((location) => location.locationId).sort(),
		).toEqual([...locationIds].sort());
	}, 20_000);
});
