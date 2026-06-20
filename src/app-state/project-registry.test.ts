import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	clearActiveProjectLocation,
	deleteProjectLocation,
	getActiveProjectLocation,
	readProjectRegistry,
	updateProjectLocationName,
	upsertProjectLocation,
} from "./project-registry";

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
		expect(catalog.registry.lastActiveProjectId).toBe(active.location.projectId);
		expect(catalog.registry.lastActiveLocationId).toBe(active.location.locationId);
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
		expect(refreshed.registry.lastActiveProjectId).toBe(active.location.projectId);
		expect(refreshed.registry.lastActiveLocationId).toBe(active.location.locationId);
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
});
