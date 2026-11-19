import { execFileSync } from "node:child_process";
import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTrickroomApp } from "./server";

const git = (cwd: string, ...args: string[]) =>
	execFileSync("git", args, {
		cwd,
		stdio: "pipe",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "Test",
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.com",
		},
	});

type Workspace = {
	activeLocationId: string | null;
	projects: {
		projectId: string;
		name: string;
		checkouts: { locationId: string; projectRoot: string; branch: string }[];
	}[];
};

describe("workspace routes", () => {
	let temp: string;
	let home: string;
	let repo: string;
	let worktree: string;

	beforeEach(async () => {
		temp = await realpath(
			await mkdtemp(path.join(os.tmpdir(), "trickroom-workspace-")),
		);
		home = path.join(temp, "home");
		repo = path.join(temp, "repo");
		worktree = path.join(temp, "wt-feature");
		await mkdir(path.join(repo, ".trickroom"), { recursive: true });
		await writeFile(
			path.join(repo, ".trickroom", "config.json"),
			JSON.stringify({
				schemaVersion: 1,
				projectId: "proj_shop",
				name: "Shop",
			}),
		);
		git(repo, "init", "--initial-branch=main");
		git(repo, "add", ".");
		git(repo, "commit", "-m", "init");
		git(repo, "worktree", "add", "-b", "feature/cart", worktree);
	});

	afterEach(async () => {
		await rm(temp, { recursive: true, force: true });
	});

	const open = (app: ReturnType<typeof createTrickroomApp>, root: string) =>
		app.request("/api/trickroom/projects/open", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ path: root }),
		});

	const readWorkspace = async (app: ReturnType<typeof createTrickroomApp>) =>
		(await (await app.request("/api/trickroom/workspace")).json()) as Workspace;

	it("lists a project once, with every worktree as a checkout", async () => {
		const app = createTrickroomApp({ trickroomHome: home });
		expect((await open(app, repo)).status).toBe(200);

		const workspace = await readWorkspace(app);

		expect(workspace.projects).toHaveLength(1);
		expect(
			workspace.projects[0]?.checkouts.map((checkout) => [
				checkout.branch,
				checkout.projectRoot,
			]),
		).toEqual([
			["main", repo],
			["feature/cart", worktree],
		]);
		expect(workspace.activeLocationId).toBe(
			workspace.projects[0]?.checkouts[0]?.locationId,
		);
	});

	it("works without an open project", async () => {
		const app = createTrickroomApp({ trickroomHome: home });

		await expect(readWorkspace(app)).resolves.toEqual({
			projects: [],
			activeLocationId: null,
		});
	});

	it("closes the open checkout when its worktree is removed", async () => {
		const app = createTrickroomApp({ trickroomHome: home });
		await open(app, repo);
		expect((await open(app, worktree)).status).toBe(200);

		git(repo, "worktree", "remove", "--force", worktree);
		const workspace = await readWorkspace(app);

		expect(workspace.activeLocationId).toBeNull();
		expect(
			workspace.projects[0]?.checkouts.map((checkout) => checkout.branch),
		).toEqual(["main"]);
		const session = (await (
			await app.request("/api/trickroom/session")
		).json()) as { activeProject: unknown };
		expect(session.activeProject).toBeNull();
	});

	it("removes a project with all its checkouts, and keeps it removed", async () => {
		const app = createTrickroomApp({ trickroomHome: home });
		await open(app, repo);
		await readWorkspace(app);

		const response = await app.request(
			"/api/trickroom/workspace/projects/proj_shop/remove",
			{ method: "POST" },
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ removedLocations: 2 });
		await expect(readWorkspace(app)).resolves.toEqual({
			projects: [],
			activeLocationId: null,
		});
		const unknown = await app.request(
			"/api/trickroom/workspace/projects/proj_shop/remove",
			{ method: "POST" },
		);
		expect(unknown.status).toBe(404);
	});

	describe("requests that name a location", () => {
		const locationIds = async (app: ReturnType<typeof createTrickroomApp>) => {
			await open(app, repo);
			const { projects } = await readWorkspace(app);
			const idOf = (root: string) =>
				projects[0]?.checkouts.find((checkout) => checkout.projectRoot === root)
					?.locationId as string;
			return { main: idOf(repo), feature: idOf(worktree) };
		};

		const writeFeatureName = () =>
			writeFile(
				path.join(worktree, ".trickroom", "config.json"),
				JSON.stringify({
					schemaVersion: 1,
					projectId: "proj_shop",
					name: "Shop on the feature branch",
				}),
			);

		it("serves each tab its own checkout, whatever the active project is", async () => {
			const app = createTrickroomApp({ trickroomHome: home });
			const ids = await locationIds(app);
			await writeFeatureName();

			const readName = async (init?: RequestInit, query = "") =>
				(
					(await (
						await app.request(`/api/trickroom/config${query}`, init)
					).json()) as { name: string }
				).name;

			// The server's active project is the main worktree.
			expect(await readName()).toBe("Shop");
			expect(
				await readName({ headers: { "x-trickroom-location": ids.feature } }),
			).toBe("Shop on the feature branch");
			expect(
				await readName({ headers: { "x-trickroom-location": ids.main } }),
			).toBe("Shop");
			// Requests that cannot set a header name it in the URL, and a file
			// the pinned page loads is found by the page's address.
			expect(await readName(undefined, `?location=${ids.feature}`)).toBe(
				"Shop on the feature branch",
			);
			expect(
				await readName({
					headers: { referer: `http://localhost/p/${ids.feature}/design/x` },
				}),
			).toBe("Shop on the feature branch");
		});

		it("writes into the named checkout only", async () => {
			const app = createTrickroomApp({ trickroomHome: home });
			const ids = await locationIds(app);

			const response = await app.request("/api/trickroom/config/mcp", {
				method: "PUT",
				headers: {
					"content-type": "application/json",
					"x-trickroom-location": ids.feature,
				},
				body: JSON.stringify({ enabled: true, mode: "read-only" }),
			});

			expect(response.status).toBe(200);
			const read = async (root: string) =>
				JSON.parse(
					await readFile(path.join(root, ".trickroom", "config.json"), "utf8"),
				) as { mcp?: { enabled: boolean } };
			expect((await read(worktree)).mcp?.enabled).toBe(true);
			expect((await read(repo)).mcp).toBeUndefined();
		});

		it("answers the session with the named checkout", async () => {
			const app = createTrickroomApp({ trickroomHome: home });
			const ids = await locationIds(app);

			const session = (await (
				await app.request("/api/trickroom/session", {
					headers: { "x-trickroom-location": ids.feature },
				})
			).json()) as {
				activeProject: { locationId: string; projectRoot: string };
			};

			expect(session.activeProject).toMatchObject({
				locationId: ids.feature,
				projectRoot: worktree,
			});
		});

		it("has no project for a location that is not registered", async () => {
			const app = createTrickroomApp({ trickroomHome: home });
			await locationIds(app);
			const headers = { "x-trickroom-location": "loc_unknown" };

			expect(
				(await app.request("/api/trickroom/designs", { headers })).status,
			).toBe(409);
			const session = (await (
				await app.request("/api/trickroom/session", { headers })
			).json()) as { activeProject: unknown };
			expect(session.activeProject).toBeNull();
		});

		it("streams the file events of the named checkout", async () => {
			const app = createTrickroomApp({ trickroomHome: home });
			const ids = await locationIds(app);
			const response = await app.request(
				`/api/trickroom/events?location=${ids.feature}`,
			);
			const reader = response.body?.getReader();
			if (!reader) throw new Error("Expected an event stream.");
			const decoder = new TextDecoder();
			let received = "";
			const readUntil = async (text: string) => {
				while (!received.includes(text)) {
					const { value, done } = await reader.read();
					if (done) throw new Error(`Stream ended before "${text}".`);
					received += decoder.decode(value, { stream: true });
				}
			};

			try {
				await readUntil("event: ready");
				expect(received).toContain(JSON.stringify({ locationId: ids.feature }));
				await writeFeatureName();
				await readUntil("event: change");
				expect(received).toContain("config.json");
			} finally {
				await reader.cancel();
			}
		});
	});

	it("pushes an event when another checkout is opened", async () => {
		const app = createTrickroomApp({ trickroomHome: home });
		await open(app, repo);
		const response = await app.request("/api/trickroom/workspace/events");
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Expected an event stream.");
		const decoder = new TextDecoder();
		let received = "";
		const readUntil = async (text: string) => {
			while (!received.includes(text)) {
				const { value, done } = await reader.read();
				if (done) throw new Error(`Stream ended before "${text}".`);
				received += decoder.decode(value, { stream: true });
			}
		};

		try {
			await readUntil("event: ready");
			await open(app, worktree);
			await readUntil("event: active-project");
			const active = (await readWorkspace(app)).activeLocationId;
			expect(received).toContain(JSON.stringify({ locationId: active }));
		} finally {
			await reader.cancel();
		}
	});
});
