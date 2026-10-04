import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { type AddressInfo, createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";
import {
	createServerDiscoveryPublisher,
	resolveRuntimeServersDir,
	type ServerDiscoveryRecord,
} from "../app-state/runtime-servers";
import { createTrickroomApp } from "../server";
import {
	discoverEditorServers,
	getEditorContext,
	requestEditorFocus,
	selectEditorServer,
} from "./editor-channel";
import type {
	EditorClientContext,
	EditorContextResponse,
} from "./editor-channel.types";

const record = (pid: number, url = "http://127.0.0.1:1/") =>
	({
		version: 1,
		pid,
		url,
		token: null,
		projectId: "proj_1",
		projectRoot: "/work/app",
		startedAt: "2026-10-04T00:00:00.000Z",
	}) satisfies ServerDiscoveryRecord;

const client = (
	clientId: string,
	overrides: Partial<EditorClientContext> = {},
): EditorClientContext => ({
	clientId,
	projectId: "proj_1",
	designFileId: "design-1",
	activeBoardId: "board-1",
	selectedId: null,
	stageMode: "canvas",
	responsiveWidth: 640,
	visible: true,
	focusedAt: "2026-10-04T10:00:00.000Z",
	reportedAt: "2026-10-04T10:00:00.000Z",
	ageMs: 100,
	...overrides,
});

const serverContext = (
	pid: number,
	projectId: string | null,
	clients: EditorClientContext[] | null,
) => ({
	server: {
		record: record(pid),
		projectId,
		projectRoot: projectId ? `/work/${projectId}` : null,
	},
	context:
		clients === null
			? null
			: ({
					projectId,
					clients,
					mostRecentlyFocusedClientId: clients[0]?.clientId ?? null,
				} satisfies EditorContextResponse),
});

describe("editor server selection", () => {
	it("reports no_server without running servers", () => {
		expect(selectEditorServer("proj_1", [])).toMatchObject({
			status: "no_server",
		});
	});

	it("reports browser_on_other_project when only other projects have tabs", () => {
		const selection = selectEditorServer("proj_1", [
			serverContext(1, "proj_2", [client("tab-a", { projectId: "proj_2" })]),
		]);
		expect(selection).toMatchObject({
			status: "browser_on_other_project",
			otherProjects: [{ projectId: "proj_2", projectRoot: "/work/proj_2" }],
		});
	});

	it("reports no_server when other projects' servers have no tabs", () => {
		expect(
			selectEditorServer("proj_1", [serverContext(1, "proj_2", [])]),
		).toMatchObject({ status: "no_server" });
	});

	it("reports no_browser for the project's server without tabs", () => {
		expect(
			selectEditorServer("proj_1", [serverContext(1, "proj_1", [])]),
		).toMatchObject({ status: "no_browser" });
	});

	it("reports browser_on_other_project for tabs left on another project", () => {
		expect(
			selectEditorServer("proj_1", [
				serverContext(1, "proj_1", [client("tab-a", { projectId: "proj_2" })]),
			]),
		).toMatchObject({ status: "browser_on_other_project" });
	});

	it("reports stale when the project's server does not answer", () => {
		expect(
			selectEditorServer("proj_1", [serverContext(1, "proj_1", null)]),
		).toMatchObject({ status: "stale" });
	});

	it("picks the server whose tab was focused most recently", () => {
		const selection = selectEditorServer("proj_1", [
			serverContext(1, "proj_1", [
				client("tab-old", { focusedAt: "2026-10-04T09:00:00.000Z" }),
			]),
			serverContext(2, "proj_1", [
				client("tab-idle", { focusedAt: null }),
				client("tab-new", { focusedAt: "2026-10-04T11:00:00.000Z" }),
			]),
			serverContext(3, "proj_2", [
				client("tab-other", {
					projectId: "proj_2",
					focusedAt: "2026-10-04T12:00:00.000Z",
				}),
			]),
		]);
		expect(selection.status).toBe("ok");
		if (selection.status !== "ok") return;
		expect(selection.server.record.pid).toBe(2);
		expect(selection.clients.map((entry) => entry.clientId)).toEqual([
			"tab-new",
			"tab-idle",
		]);
	});

	it("narrows to an explicit tab", () => {
		const contexts = [
			serverContext(1, "proj_1", [client("tab-a"), client("tab-b")]),
		];
		const selection = selectEditorServer("proj_1", contexts, "tab-b");
		expect(selection.status === "ok" && selection.clients).toEqual([
			client("tab-b"),
		]);
		expect(selectEditorServer("proj_1", contexts, "tab-z")).toMatchObject({
			status: "no_browser",
		});
	});
});

describe("editor channel client", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0).reverse()) {
			await cleanup();
		}
	});

	const tempDir = async (prefix: string) => {
		const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
		cleanups.push(() => rm(dir, { force: true, recursive: true }));
		return dir;
	};

	const deadPid = () => {
		const child = spawnSync(process.execPath, ["-e", ""]);
		return child.pid;
	};

	/** A port nothing listens on: bind an ephemeral one and release it. */
	const closedPort = () =>
		new Promise<number>((resolve) => {
			const probe = createServer().listen(0, "127.0.0.1", () => {
				const { port } = probe.address() as AddressInfo;
				probe.close(() => resolve(port));
			});
		});

	const recordFiles = async (home: string) =>
		(await readdir(resolveRuntimeServersDir(home)).catch(() => [])).sort();

	/** Starts a real HTTP server for a project and publishes its record. */
	const startServer = async (home: string, token: string | null = null) => {
		const projectRoot = await tempDir("trickroom-channel-project-");
		const app = createTrickroomApp({
			trickroomHome: home,
			initialProjectRoot: projectRoot,
			sessionToken: token,
		});
		const server = await new Promise<ReturnType<typeof serve>>((resolve) => {
			const started = serve(
				{ fetch: app.fetch, port: 0, hostname: "127.0.0.1" },
				() => resolve(started),
			);
		});
		const port = (server.address() as AddressInfo).port;
		const url = `http://127.0.0.1:${port}/`;
		const health = (await (
			await fetch(`${url}api/trickroom/health`, {
				headers: token ? { "x-trickroom-session": token } : {},
			})
		).json()) as { activeProject: { projectId: string } };
		const publisher = createServerDiscoveryPublisher({
			home,
			url,
			token,
			pid: process.pid,
			project: {
				projectId: health.activeProject.projectId,
				projectRoot,
			},
			handleProcessExit: false,
		});
		cleanups.push(async () => {
			publisher.dispose();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		});
		return { url, projectId: health.activeProject.projectId, token };
	};

	/** A browser tab: holds the SSE stream, reports context, acks focus. */
	const openTab = async (
		server: { url: string; projectId: string; token: string | null },
		clientId: string,
		answer: "ok" | "blocked_dirty" | null = "ok",
	) => {
		const headers: Record<string, string> = server.token
			? { "x-trickroom-session": server.token }
			: {};
		const controller = new AbortController();
		const response = await fetch(
			`${server.url}api/trickroom/events?clientId=${clientId}`,
			{ headers, signal: controller.signal },
		);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("no event stream");
		const focusEvents: unknown[] = [];
		const decoder = new TextDecoder();
		let buffer = "";
		const pump = (async () => {
			for (;;) {
				const chunk = await reader
					.read()
					.catch(() => ({ done: true }) as const);
				if (chunk.done) return;
				buffer += decoder.decode(chunk.value);
				let end = buffer.indexOf("\n\n");
				while (end !== -1) {
					const block = buffer.slice(0, end);
					buffer = buffer.slice(end + 2);
					end = buffer.indexOf("\n\n");
					if (!block.includes("event: focus")) continue;
					const data = JSON.parse(
						block
							.split("\n")
							.find((line) => line.startsWith("data: "))
							?.slice(6) ?? "null",
					) as { requestId: string };
					focusEvents.push(data);
					if (answer) {
						await fetch(`${server.url}api/trickroom/editor-focus/ack`, {
							method: "POST",
							headers: { ...headers, "content-type": "application/json" },
							body: JSON.stringify({
								clientId,
								requestId: data.requestId,
								status: answer,
								outcome: answer === "ok" ? "revealed" : null,
							}),
						});
					}
				}
			}
		})();
		await fetch(`${server.url}api/trickroom/editor-context`, {
			method: "POST",
			headers: { ...headers, "content-type": "application/json" },
			body: JSON.stringify({
				clientId,
				projectId: server.projectId,
				designFileId: "design-1",
				activeBoardId: "board-1",
				selectedId: "layer-1",
				stageMode: "canvas",
				responsiveWidth: 640,
				focusedAt: Date.now(),
				visible: true,
				sentAt: Date.now(),
			}),
		});
		const close = async () => {
			controller.abort();
			await reader.cancel().catch(() => undefined);
			await pump;
		};
		cleanups.push(close);
		return { focusEvents, close };
	};

	it("reports no_server and deletes records of dead or vanished servers", async () => {
		const home = await tempDir("trickroom-channel-home-");
		expect(await getEditorContext("proj_1", { home })).toMatchObject({
			status: "no_server",
		});

		const dead = createServerDiscoveryPublisher({
			home,
			pid: deadPid(),
			url: "http://127.0.0.1:1/",
			token: null,
			handleProcessExit: false,
		});
		// Alive pid, but nothing listens at the URL any more.
		const vanished = createServerDiscoveryPublisher({
			home,
			pid: process.pid,
			url: `http://127.0.0.1:${await closedPort()}/`,
			token: null,
			handleProcessExit: false,
		});
		expect(await recordFiles(home)).toHaveLength(2);

		expect(await discoverEditorServers({ home })).toEqual([]);
		expect(await recordFiles(home)).toEqual([]);
		expect(
			await requestEditorFocus(
				{ projectId: "proj_1", designFileId: "design-1" },
				{ home },
			),
		).toMatchObject({ status: "no_server" });
		dead.dispose();
		vanished.dispose();
	});

	it("reports no_browser, then the focused tab, and delivers focus to it", async () => {
		const home = await tempDir("trickroom-channel-home-");
		const server = await startServer(home, "secret");

		expect(await getEditorContext(server.projectId, { home })).toMatchObject({
			status: "no_browser",
			server: { url: server.url },
		});
		expect(await getEditorContext("proj_other", { home })).toMatchObject({
			status: "no_server",
		});

		const tabA = await openTab(server, "tab-a");
		await new Promise((resolve) => setTimeout(resolve, 5));
		const tabB = await openTab(server, "tab-b");

		const context = await getEditorContext(server.projectId, { home });
		expect(context).toMatchObject({
			status: "ok",
			server: { url: server.url, projectId: server.projectId },
			focused: {
				clientId: "tab-b",
				designFileId: "design-1",
				selectedId: "layer-1",
			},
		});
		expect(await getEditorContext("proj_other", { home })).toMatchObject({
			status: "browser_on_other_project",
		});

		const focus = await requestEditorFocus(
			{
				projectId: server.projectId,
				designFileId: "design-2",
				elementId: "layer-9",
			},
			{ home },
		);
		expect(focus).toMatchObject({
			status: "ok",
			clientId: "tab-b",
			outcome: "revealed",
		});
		expect(tabA.focusEvents).toEqual([]);
		expect(tabB.focusEvents).toEqual([
			expect.objectContaining({
				designFileId: "design-2",
				elementId: "layer-9",
				boardId: null,
			}),
		]);

		await tabB.close();
		await tabA.close();
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(await getEditorContext(server.projectId, { home })).toMatchObject({
			status: "no_browser",
		});
	});

	it("passes blocked_dirty through and reports stale for a silent tab", async () => {
		const home = await tempDir("trickroom-channel-home-");
		const server = await startServer(home);
		const dirty = await openTab(server, "tab-dirty", "blocked_dirty");
		expect(
			await requestEditorFocus(
				{ projectId: server.projectId, designFileId: "design-2" },
				{ home },
			),
		).toMatchObject({ status: "blocked_dirty", clientId: "tab-dirty" });
		await dirty.close();

		await openTab(server, "tab-silent", null);
		expect(
			await requestEditorFocus(
				{ projectId: server.projectId, designFileId: "design-2" },
				{ home },
			),
		).toMatchObject({ status: "stale", clientId: "tab-silent" });
	});
});
