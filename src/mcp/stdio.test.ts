import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
	deleteProjectLocation,
	upsertProjectLocation,
} from "../app-state/project-registry";
import {
	readMcpEnabledProjectContext,
	type TrickroomProjectConfigError,
} from "../project";
import { createTrickroomMcpServer } from "./server";
import {
	createResourceListWatchers,
	runTrickroomMcpStdioServer,
} from "./stdio";

describe("trickroom MCP project gating", () => {
	const tempProjectRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempProjectRoots
				.splice(0)
				.map((projectRoot) =>
					rm(projectRoot, { force: true, recursive: true }),
				),
		);
	});

	const createProjectRoot = async () => {
		const projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-mcp-test-"),
		);
		tempProjectRoots.push(projectRoot);
		return projectRoot;
	};

	const createMcpProjectRoot = async (projectId: string) => {
		const projectRoot = await createProjectRoot();
		await writeFile(
			path.join(projectRoot, "trickroom.config.json"),
			JSON.stringify({
				projectId,
				name: "Project",
				mcp: { enabled: true },
			}),
			"utf8",
		);
		return projectRoot;
	};

	const createFakeWatchFactory = () => {
		const watchedPaths = new Map<string, (filename: string | null) => void>();
		return {
			watchedPaths,
			createWatchStop: (
				watchPath: string,
				onChange: (filename: string | null) => void,
			) => {
				watchedPaths.set(watchPath, onChange);
				return () => {
					watchedPaths.delete(watchPath);
				};
			},
		};
	};

	it("rejects MCP startup when the project config is missing", async () => {
		const projectRoot = await createProjectRoot();

		await expect(
			readMcpEnabledProjectContext(projectRoot),
		).rejects.toMatchObject({
			code: "CONFIG_NOT_FOUND",
		} satisfies Partial<TrickroomProjectConfigError>);
	});

	it("rejects MCP startup when the project config is invalid", async () => {
		const projectRoot = await createProjectRoot();
		await writeFile(
			path.join(projectRoot, "trickroom.config.json"),
			JSON.stringify({ name: "Project", mcp: { enabled: "yes" } }),
			"utf8",
		);

		await expect(
			readMcpEnabledProjectContext(projectRoot),
		).rejects.toMatchObject({
			code: "INVALID_CONFIG",
		} satisfies Partial<TrickroomProjectConfigError>);
	});

	it("rejects MCP startup when the project config does not enable MCP", async () => {
		const projectRoot = await createProjectRoot();
		await writeFile(
			path.join(projectRoot, "trickroom.config.json"),
			JSON.stringify({ name: "Project" }),
			"utf8",
		);

		await expect(
			readMcpEnabledProjectContext(projectRoot),
		).rejects.toMatchObject({
			code: "MCP_DISABLED",
		} satisfies Partial<TrickroomProjectConfigError>);
	});

	it("creates the MCP server when the project enables MCP", async () => {
		const projectRoot = await createProjectRoot();
		await writeFile(
			path.join(projectRoot, "trickroom.config.json"),
			JSON.stringify({
				name: "Project",
				systems: {
					Core: "src/index.css",
				},
				mcp: {
					enabled: true,
				},
			}),
			"utf8",
		);

		const context = await readMcpEnabledProjectContext(projectRoot);
		const server = createTrickroomMcpServer(context);

		expect(server).toBeDefined();
	});

	it("starts without a default project when registry active points at a disabled project", async () => {
		const trickroomHome = await createProjectRoot();
		const projectRoot = await createProjectRoot();
		await writeFile(
			path.join(projectRoot, "trickroom.config.json"),
			JSON.stringify({
				projectId: "proj_disabled",
				name: "Project",
				mcp: { enabled: false },
			}),
			"utf8",
		);
		await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_disabled",
			root: projectRoot,
			name: "Project",
		});

		const previousTrickroomHome = process.env.TRICKROOM_HOME;
		process.env.TRICKROOM_HOME = trickroomHome;

		const chunks: string[] = [];
		const stderr = new Writable({
			write(chunk, _encoding, callback) {
				chunks.push(String(chunk));
				callback();
			},
		});

		try {
			await expect(runTrickroomMcpStdioServer({ stderr })).resolves.toBe(0);
		} finally {
			if (previousTrickroomHome === undefined) {
				delete process.env.TRICKROOM_HOME;
			} else {
				process.env.TRICKROOM_HOME = previousTrickroomHome;
			}
		}

		expect(chunks.join("")).toBe("");
	});

	it("notifies registry changes without clearing the selected MCP project", async () => {
		const trickroomHome = await createProjectRoot();
		const projectRoot = await createMcpProjectRoot("proj_active");
		const { location } = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_active",
			root: projectRoot,
			name: "Project",
		});
		const server = createTrickroomMcpServer({
			...(await readMcpEnabledProjectContext(projectRoot)),
			trickroomHome,
			locationId: location.locationId,
		});
		const notifications: string[] = [];
		server.sendResourceListChanged = async () => {
			notifications.push("resource-list-changed");
		};
		const fakeWatch = createFakeWatchFactory();

		const stopWatchers = await createResourceListWatchers(server, trickroomHome, {
			createWatchStop: fakeWatch.createWatchStop,
		});

		try {
			await deleteProjectLocation({
				trickroomHome,
				locationId: location.locationId,
			});
			fakeWatch.watchedPaths
				.get(path.join(trickroomHome, "projects.json"))
				?.("projects.json");

			await expect
				.poll(() => notifications.length, { timeout: 2000, interval: 25 })
				.toBe(1);
			expect(server.getActiveContextSnapshot()).toMatchObject({
				config: { projectId: "proj_active" },
				locationId: location.locationId,
				projectRoot,
			});
		} finally {
			stopWatchers();
		}
	});

	it("stays quiet on startup for existing designs directories, then notifies on design changes", async () => {
		const trickroomHome = await createProjectRoot();
		const projectRoot = await createMcpProjectRoot("proj_active");
		const designsDir = path.join(projectRoot, ".trickroom", "designs");
		await mkdir(designsDir, { recursive: true });
		const { location } = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_active",
			root: projectRoot,
			name: "Project",
		});
		const server = createTrickroomMcpServer({
			...(await readMcpEnabledProjectContext(projectRoot)),
			trickroomHome,
			locationId: location.locationId,
		});
		const notifications: string[] = [];
		server.sendResourceListChanged = async () => {
			notifications.push("resource-list-changed");
		};
		const fakeWatch = createFakeWatchFactory();

		const stopWatchers = await createResourceListWatchers(server, trickroomHome, {
			createWatchStop: fakeWatch.createWatchStop,
		});

		try {
			// Existing designs directory should not emit an initial notification.
			await new Promise((resolve) => setTimeout(resolve, 250));
			expect(notifications).toHaveLength(0);

			// A single design change should emit exactly one notification.
			fakeWatch.watchedPaths
				.get(designsDir)
				?.("11111111-1111-4111-8111-111111111111.json");

			await expect
				.poll(() => notifications.length, { timeout: 2000, interval: 25 })
				.toBe(1);
			expect(notifications).toHaveLength(1);
		} finally {
			stopWatchers();
		}
	});

	it("arms the design watcher after the designs directory is created later", async () => {
		const trickroomHome = await createProjectRoot();
		const projectRoot = await createMcpProjectRoot("proj_active");
		const designsDir = path.join(projectRoot, ".trickroom", "designs");
		const { location } = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_active",
			root: projectRoot,
			name: "Project",
		});
		const server = createTrickroomMcpServer({
			...(await readMcpEnabledProjectContext(projectRoot)),
			trickroomHome,
			locationId: location.locationId,
		});
		const notifications: string[] = [];
		server.sendResourceListChanged = async () => {
			notifications.push("resource-list-changed");
		};
		const fakeWatch = createFakeWatchFactory();

		const stopWatchers = await createResourceListWatchers(server, trickroomHome, {
			createWatchStop: fakeWatch.createWatchStop,
		});

		try {
			const trickroomDir = path.dirname(designsDir);
			const parentWatchPath = fakeWatch.watchedPaths.has(trickroomDir)
				? trickroomDir
				: projectRoot;
			expect(fakeWatch.watchedPaths.has(parentWatchPath)).toBe(true);
			expect(fakeWatch.watchedPaths.has(designsDir)).toBe(false);

			await mkdir(designsDir, { recursive: true });
			fakeWatch.watchedPaths
				.get(parentWatchPath)
				?.(parentWatchPath === trickroomDir ? "designs" : ".trickroom");
			fakeWatch.watchedPaths
				.get(path.join(trickroomHome, "projects.json"))
				?.("projects.json");

			await expect
				.poll(() => fakeWatch.watchedPaths.has(designsDir), {
					timeout: 2000,
					interval: 25,
				})
				.toBe(true);
			expect(fakeWatch.watchedPaths.has(parentWatchPath)).toBe(false);

			await expect
				.poll(() => notifications.length, { timeout: 2000, interval: 25 })
				.toBe(1);
		} finally {
			stopWatchers();
		}
	});

	it("watches multiple MCP-enabled project design directories", async () => {
		const trickroomHome = await createProjectRoot();
		const projectRoot = await createMcpProjectRoot("proj_active");
		const designsDirA = path.join(projectRoot, ".trickroom", "designs");
		await mkdir(designsDirA, { recursive: true });
		const projectRootB = await createMcpProjectRoot("proj_other");
		const designsDirB = path.join(projectRootB, ".trickroom", "designs");
		await mkdir(designsDirB, { recursive: true });

		const locationA = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_active",
			root: projectRoot,
			name: "Project A",
		});
		await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_other",
			root: projectRootB,
			name: "Project B",
		});

		const server = createTrickroomMcpServer({
			...(await readMcpEnabledProjectContext(projectRoot)),
			trickroomHome,
			locationId: locationA.locationId,
		});
		const notifications: string[] = [];
		server.sendResourceListChanged = async () => {
			notifications.push("resource-list-changed");
		};
		const fakeWatch = createFakeWatchFactory();

		const stopWatchers = await createResourceListWatchers(server, trickroomHome, {
			createWatchStop: fakeWatch.createWatchStop,
		});

		try {
			expect(fakeWatch.watchedPaths.has(designsDirA)).toBe(true);
			expect(fakeWatch.watchedPaths.has(designsDirB)).toBe(true);

			fakeWatch.watchedPaths.get(designsDirB)?.("file.json");

			await expect
				.poll(() => notifications.length, { timeout: 2000, interval: 25 })
				.toBe(1);
		} finally {
			stopWatchers();
		}
	});

	it("continues watching readable projects when one project watch registration fails", async () => {
		const trickroomHome = await createProjectRoot();
		const projectRootA = await createMcpProjectRoot("proj_active");
		const designsDirA = path.join(projectRootA, ".trickroom", "designs");
		await mkdir(designsDirA, { recursive: true });
		const projectRootB = await createMcpProjectRoot("proj_other");
		const designsDirB = path.join(projectRootB, ".trickroom", "designs");
		await mkdir(designsDirB, { recursive: true });

		const locationA = await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_active",
			root: projectRootA,
			name: "Project A",
		});
		await upsertProjectLocation({
			trickroomHome,
			projectId: "proj_other",
			root: projectRootB,
			name: "Project B",
		});

		const server = createTrickroomMcpServer({
			...(await readMcpEnabledProjectContext(projectRootA)),
			trickroomHome,
			locationId: locationA.locationId,
		});
		const notifications: string[] = [];
		server.sendResourceListChanged = async () => {
			notifications.push("resource-list-changed");
		};
		const watchedPaths = new Map<string, (filename: string | null) => void>();
		const createWatchStop = (
			watchPath: string,
			onChange: (filename: string | null) => void,
		) => {
			if (watchPath === designsDirB) {
				return null;
			}

			watchedPaths.set(watchPath, onChange);
			return () => {
				watchedPaths.delete(watchPath);
			};
		};

		const stopWatchers = await createResourceListWatchers(server, trickroomHome, {
			createWatchStop,
		});

		try {
			expect(watchedPaths.has(designsDirA)).toBe(true);
			expect(watchedPaths.has(designsDirB)).toBe(false);

			watchedPaths.get(designsDirA)?.("file.json");

			await expect
				.poll(() => notifications.length, { timeout: 2000, interval: 25 })
				.toBe(1);
		} finally {
			stopWatchers();
		}
	});
});
