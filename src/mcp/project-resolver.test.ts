import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	readProjectRegistry,
	upsertProjectLocation,
} from "../app-state/project-registry";
import {
	createTrickroomMcpProjectResolver,
	inferMcpProjectContextFromCwd,
	TrickroomMcpProjectResolverError,
} from "./project-resolver";

describe("Trickroom MCP project resolver", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
		);
	});

	const createTempRoot = async (prefix: string) => {
		const root = await mkdtemp(path.join(process.cwd(), prefix));
		tempRoots.push(root);
		return root;
	};

	const writeCurrentProjectConfig = async (
		projectRoot: string,
		config: {
			projectId?: string;
			name: string;
			mcp?: { enabled: boolean };
		},
	) => {
		const configPath = path.join(projectRoot, ".trickroom", "config.json");
		await mkdir(path.dirname(configPath), { recursive: true });
		await writeFile(configPath, JSON.stringify(config), "utf8");
	};

	it("infers and catalog-registers a direct CWD project without marking it registry-active", async () => {
		const trickroomHome = await createTempRoot(".tmp-trickroom-mcp-home-");
		const activeProjectRoot = await createTempRoot(".tmp-trickroom-mcp-active-");
		const cwdProjectRoot = await createTempRoot(".tmp-trickroom-mcp-cwd-");
		await writeCurrentProjectConfig(activeProjectRoot, {
			projectId: "proj_active",
			name: "Active Project",
			mcp: { enabled: true },
		});
		await writeCurrentProjectConfig(cwdProjectRoot, {
			projectId: "proj_cwd",
			name: "CWD Project",
			mcp: { enabled: true },
		});
		const { location: activeLocation } = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_active",
			root: activeProjectRoot,
			name: "Active Project",
		});

		const context = await inferMcpProjectContextFromCwd({
			cwd: cwdProjectRoot,
			trickroomHome,
		});

		expect(context).toMatchObject({
			projectRoot: cwdProjectRoot,
			locationId: expect.stringMatching(/^loc_/),
		});
		const registry = await readProjectRegistry(trickroomHome);
		expect(registry.lastActiveProjectId).toBe("proj_active");
		expect(registry.lastActiveLocationId).toBe(activeLocation.locationId);
		expect(
			registry.locations.find((location) => location.root === cwdProjectRoot),
		).toMatchObject({
			projectId: "proj_cwd",
			locationId: context?.locationId,
		});
	});

	it("infers and registers a MCP-enabled project from CWD without an explicit projectId", async () => {
		const trickroomHome = await createTempRoot(".tmp-trickroom-mcp-home-");
		const cwdProjectRoot = await createTempRoot(".tmp-trickroom-mcp-cwd-");
		await writeCurrentProjectConfig(cwdProjectRoot, {
			name: "Generated Project",
			mcp: { enabled: true },
		});

		const context = await inferMcpProjectContextFromCwd({
			cwd: cwdProjectRoot,
			trickroomHome,
		});
		expect(context?.config.projectId).toMatch(/^proj_/);
		expect(context).toMatchObject({
			projectRoot: cwdProjectRoot,
			locationId: expect.stringMatching(/^loc_/),
			config: expect.objectContaining({
				projectId: context?.config.projectId,
				name: "Generated Project",
				mcp: { enabled: true },
			}),
		});
		const persistedConfig = JSON.parse(
			await readFile(path.join(cwdProjectRoot, ".trickroom", "config.json"), "utf8"),
		);
		expect(persistedConfig.projectId).toBe(context?.config.projectId);
	});

	it("infers and registers from legacy config when no direct config exists", async () => {
		const trickroomHome = await createTempRoot(".tmp-trickroom-mcp-home-");
		const cwdProjectRoot = await createTempRoot(".tmp-trickroom-mcp-cwd-");
		await mkdir(path.join(cwdProjectRoot, ".trickroom"), { recursive: true });
		await writeFile(
			path.join(cwdProjectRoot, "trickroom.config.json"),
			JSON.stringify({
				projectId: "proj_legacy",
				name: "Legacy Project",
				mcp: { enabled: true },
			}),
			"utf8",
		);

		const context = await inferMcpProjectContextFromCwd({
			cwd: cwdProjectRoot,
			trickroomHome,
		});

		expect(context).toMatchObject({
			projectRoot: cwdProjectRoot,
			locationId: expect.stringMatching(/^loc_/),
			config: expect.objectContaining({
				projectId: "proj_legacy",
				name: "Legacy Project",
			}),
		});

		const migratedConfig = JSON.parse(
			await readFile(path.join(cwdProjectRoot, ".trickroom", "config.json"), "utf8"),
		);
		expect(migratedConfig.projectId).toBe("proj_legacy");
	});

	it("does not infer from outside a direct .trickroom/config.json project", async () => {
		const trickroomHome = await createTempRoot(".tmp-trickroom-mcp-home-");
		const outsideRoot = await createTempRoot(".tmp-trickroom-mcp-outside-");

		await expect(
			inferMcpProjectContextFromCwd({ cwd: outsideRoot, trickroomHome }),
		).resolves.toBeNull();
	});

	it("rejects ambiguous projectId refs with candidate locationIds", async () => {
		const trickroomHome = await createTempRoot(".tmp-trickroom-mcp-home-");
		const firstRoot = await createTempRoot(".tmp-trickroom-mcp-first-");
		const secondRoot = await createTempRoot(".tmp-trickroom-mcp-second-");
		await writeCurrentProjectConfig(firstRoot, {
			projectId: "proj_shared",
			name: "First",
			mcp: { enabled: true },
		});
		await writeCurrentProjectConfig(secondRoot, {
			projectId: "proj_shared",
			name: "Second",
			mcp: { enabled: true },
		});
		const first = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_shared",
			root: firstRoot,
			name: "First",
		});
		const second = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_shared",
			root: secondRoot,
			name: "Second",
		});
		const resolver = createTrickroomMcpProjectResolver({ trickroomHome });

		await expect(
			resolver.resolveProject({ projectId: "proj_shared" }),
		).rejects.toMatchObject({
			code: "AMBIGUOUS_PROJECT_ID",
			details: {
				candidates: expect.arrayContaining([
					expect.objectContaining({ locationId: first.location.locationId }),
					expect.objectContaining({ locationId: second.location.locationId }),
				]),
			},
		} satisfies Partial<TrickroomMcpProjectResolverError>);
	});

	it("errors when the registered location no longer resolves to the requested projectId", async () => {
		const trickroomHome = await createTempRoot(".tmp-trickroom-mcp-home-");
		const projectRoot = await createTempRoot(".tmp-trickroom-mcp-stale-");
		await writeCurrentProjectConfig(projectRoot, {
			projectId: "proj_old",
			name: "Registry Project",
			mcp: { enabled: true },
		});
		await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_old",
			root: projectRoot,
			name: "Registry Project",
		});
		await writeCurrentProjectConfig(projectRoot, {
			projectId: "proj_new",
			name: "Registry Project",
			mcp: { enabled: true },
		});

		const resolver = createTrickroomMcpProjectResolver({ trickroomHome });

		await expect(
			resolver.resolveProject({ projectId: "proj_old" }),
		).rejects.toMatchObject({
			code: "STALE_PROJECT_LOCATION",
			details: {
				projectId: "proj_old",
				requestedProjectId: "proj_old",
				actualProjectId: "proj_new",
				locationId: expect.any(String),
			},
		} satisfies Partial<TrickroomMcpProjectResolverError>);
	});
});
