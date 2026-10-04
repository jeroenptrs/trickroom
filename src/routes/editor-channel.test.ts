import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTrickroomApp } from "../server";
import type { EditorContextResponse } from "../services/editor-channel.types";

describe("editor channel routes", () => {
	let projectRoot: string;
	let trickroomHome: string;
	const openStreams: Array<() => Promise<void>> = [];

	beforeEach(async () => {
		projectRoot = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-editor-channel-project-"),
		);
		trickroomHome = await mkdtemp(
			path.join(process.cwd(), ".tmp-trickroom-editor-channel-home-"),
		);
	});

	afterEach(async () => {
		await Promise.all(openStreams.splice(0).map((close) => close()));
		await rm(projectRoot, { force: true, recursive: true });
		await rm(trickroomHome, { force: true, recursive: true });
	});

	// Waits for the initial project to open, so no write lands after cleanup.
	const createApp = async (sessionToken?: string) => {
		const app = createTrickroomApp({
			trickroomHome,
			initialProjectRoot: projectRoot,
			sessionToken,
		});
		await app.request("/api/trickroom/health", {
			headers: sessionToken ? { "x-trickroom-session": sessionToken } : {},
		});
		return app;
	};

	type App = Awaited<ReturnType<typeof createApp>>;

	/** Opens a tab's SSE stream and reads it until the `ready` event. */
	const connectTab = async (app: App, clientId: string) => {
		const controller = new AbortController();
		const response = await app.request(
			`/api/trickroom/events?clientId=${clientId}`,
			{ signal: controller.signal },
		);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("event stream body is unavailable");
		const decoder = new TextDecoder();
		let buffer = "";
		while (!buffer.includes("event: ready")) {
			const chunk = await reader.read();
			if (chunk.done) throw new Error("event stream ended early");
			buffer += decoder.decode(chunk.value);
		}
		let closed = false;
		const close = async () => {
			if (closed) return;
			closed = true;
			controller.abort();
			await reader.cancel().catch(() => undefined);
		};
		openStreams.push(close);
		return {
			close,
			/** Resolves with the next event of the given type. */
			async next(event: string) {
				while (!buffer.includes(`event: ${event}`)) {
					const chunk = await reader.read();
					if (chunk.done) throw new Error("event stream ended");
					buffer += decoder.decode(chunk.value);
				}
				const start = buffer.indexOf(`event: ${event}`);
				const end = buffer.indexOf("\n\n", start);
				const block = buffer.slice(start, end);
				buffer = buffer.slice(end + 2);
				const data = block
					.split("\n")
					.find((line) => line.startsWith("data: "))
					?.slice("data: ".length);
				return JSON.parse(data ?? "null") as unknown;
			},
		};
	};

	const postContext = (app: App, body: Record<string, unknown>) =>
		app.request("/api/trickroom/editor-context", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				projectId: null,
				designFileId: null,
				activeBoardId: null,
				selectedId: null,
				stageMode: null,
				responsiveWidth: null,
				focusedAt: null,
				visible: true,
				sentAt: Date.now(),
				...body,
			}),
		});

	const getContext = async (app: App) => {
		const response = await app.request("/api/trickroom/editor-context");
		expect(response.status).toBe(200);
		return (await response.json()) as EditorContextResponse;
	};

	const waitFor = async (check: () => Promise<boolean>) => {
		for (let attempt = 0; attempt < 50; attempt += 1) {
			if (await check()) return;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		throw new Error("condition not met");
	};

	it("reports connected tabs and forgets a tab when its stream closes", async () => {
		const app = await createApp();
		const tab = await connectTab(app, "tab-a");
		const health = (await (
			await app.request("/api/trickroom/health")
		).json()) as { activeProject: { projectId: string } };

		const posted = await postContext(app, {
			clientId: "tab-a",
			projectId: health.activeProject.projectId,
			designFileId: "design-1",
			activeBoardId: "board-1",
			selectedId: "layer-1",
			stageMode: "canvas",
			responsiveWidth: 640,
			focusedAt: Date.now(),
		});
		expect(posted.status).toBe(200);

		const context = await getContext(app);
		expect(context.projectId).toBe(health.activeProject.projectId);
		expect(context.mostRecentlyFocusedClientId).toBe("tab-a");
		expect(context.clients).toEqual([
			expect.objectContaining({
				clientId: "tab-a",
				projectId: health.activeProject.projectId,
				designFileId: "design-1",
				activeBoardId: "board-1",
				selectedId: "layer-1",
				stageMode: "canvas",
				responsiveWidth: 640,
				visible: true,
				ageMs: expect.any(Number),
			}),
		]);

		await tab.close();
		await waitFor(async () => (await getContext(app)).clients.length === 0);
	});

	it("rejects malformed context reports", async () => {
		const app = await createApp();
		const response = await postContext(app, { clientId: "not valid!" });
		expect(response.status).toBe(400);
	});

	it("requires the session token", async () => {
		const app = await createApp("secret");
		const response = await app.request("/api/trickroom/editor-context");
		expect(response.status).toBe(403);
		const allowed = await app.request("/api/trickroom/editor-context", {
			headers: { "x-trickroom-session": "secret" },
		});
		expect(allowed.status).toBe(200);
	});
});
