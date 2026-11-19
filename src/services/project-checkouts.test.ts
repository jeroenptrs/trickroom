import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	readProjectRegistry,
	upsertProjectLocation,
} from "../app-state/project-registry";
import { listRepositoryWorktrees, readGitCheckout } from "./git-worktrees";
import {
	discoverProjectCheckouts,
	readWorkspace,
	WorkspaceEvents,
	type WorkspaceSnapshot,
} from "./project-checkouts";

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
	})
		.toString()
		.trim();

const writeConfig = async (projectRoot: string, projectId: string) => {
	await mkdir(path.join(projectRoot, ".trickroom"), { recursive: true });
	await writeFile(
		path.join(projectRoot, ".trickroom", "config.json"),
		JSON.stringify({ schemaVersion: 1, projectId, name: "Shop" }),
	);
};

const waitFor = async (check: () => boolean, timeoutMs = 5_000) => {
	const startedAt = Date.now();
	while (!check()) {
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error("Timed out waiting for the workspace to change.");
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
};

describe("project checkouts", () => {
	let temp: string;
	let home: string;
	let repo: string;

	beforeEach(async () => {
		temp = await realpath(
			await mkdtemp(path.join(os.tmpdir(), "trickroom-checkouts-")),
		);
		home = path.join(temp, "home");
		repo = path.join(temp, "repo");
		await mkdir(repo, { recursive: true });
		git(repo, "init", "--initial-branch=main");
		await writeConfig(repo, "proj_shop");
		git(repo, "add", ".");
		git(repo, "commit", "-m", "init");
		await upsertProjectLocation({
			trickroomHome: home,
			projectId: "proj_shop",
			root: repo,
			name: "Shop",
		});
	});

	afterEach(async () => {
		await rm(temp, { recursive: true, force: true });
	});

	it("reads the branch and the shared git folder of a linked worktree", async () => {
		const worktree = path.join(temp, "wt-feature");
		git(repo, "worktree", "add", "-b", "feature/cart", worktree);

		expect(await readGitCheckout(repo)).toMatchObject({
			branch: "main",
			isMainWorktree: true,
			commonDirectory: path.join(repo, ".git"),
		});
		expect(await readGitCheckout(worktree)).toMatchObject({
			branch: "feature/cart",
			detachedHead: null,
			isMainWorktree: false,
			worktreePath: worktree,
			commonDirectory: path.join(repo, ".git"),
		});
		expect(await listRepositoryWorktrees(path.join(repo, ".git"))).toEqual([
			{ worktreePath: repo, isMainWorktree: true },
			{ worktreePath: worktree, isMainWorktree: false },
		]);
	});

	it("reports a detached HEAD by its commit", async () => {
		const worktree = path.join(temp, "wt-detached");
		git(repo, "worktree", "add", "--detach", worktree);

		expect(await readGitCheckout(worktree)).toMatchObject({
			branch: null,
			detachedHead: git(repo, "rev-parse", "HEAD").slice(0, 7),
		});
	});

	it("registers the other worktrees of a registered project", async () => {
		const worktree = path.join(temp, "wt-feature");
		git(repo, "worktree", "add", "-b", "feature/cart", worktree);

		const added = await discoverProjectCheckouts(home);

		expect(added.map((location) => location.root)).toEqual([worktree]);
		expect(added[0]?.projectId).toBe("proj_shop");
		// A second pass finds nothing new, and the active pointer stays put.
		expect(await discoverProjectCheckouts(home)).toEqual([]);
		const registry = await readProjectRegistry(home);
		expect(registry.locations).toHaveLength(2);
		expect(
			registry.locations.find(
				(location) => location.locationId === registry.lastActiveLocationId,
			)?.root,
		).toBe(repo);
	});

	it("skips a worktree whose branch has no Trickroom config or another project", async () => {
		git(repo, "checkout", "-b", "no-designs");
		git(repo, "rm", "-r", "-q", ".trickroom");
		git(repo, "commit", "-m", "remove designs");
		git(repo, "checkout", "main");
		const bare = path.join(temp, "wt-bare");
		git(repo, "worktree", "add", bare, "no-designs");
		const other = path.join(temp, "wt-other");
		git(repo, "worktree", "add", "-b", "other", other);
		await writeConfig(other, "proj_other");

		expect(await discoverProjectCheckouts(home)).toEqual([]);
	});

	it("finds a project that sits below the repository root", async () => {
		const nested = path.join(repo, "apps", "web");
		await writeConfig(nested, "proj_web");
		git(repo, "add", ".");
		git(repo, "commit", "-m", "nested project");
		await upsertProjectLocation({
			trickroomHome: home,
			projectId: "proj_web",
			root: nested,
			name: "Web",
		});
		const worktree = path.join(temp, "wt-feature");
		git(repo, "worktree", "add", "-b", "feature/cart", worktree);

		const added = await discoverProjectCheckouts(home);

		expect(added.map((location) => location.root).sort()).toEqual([
			worktree,
			path.join(worktree, "apps", "web"),
		]);
	});

	it("groups checkouts by project, main worktree first", async () => {
		git(repo, "worktree", "add", "-b", "b-branch", path.join(temp, "wt-b"));
		git(repo, "worktree", "add", "-b", "a-branch", path.join(temp, "wt-a"));
		await discoverProjectCheckouts(home);

		const { snapshot } = await readWorkspace(home);

		expect(snapshot.projects).toHaveLength(1);
		expect(snapshot.projects[0]).toMatchObject({
			projectId: "proj_shop",
			name: "Shop",
		});
		expect(
			snapshot.projects[0]?.checkouts.map((checkout) => [
				checkout.branch,
				checkout.isMainWorktree,
			]),
		).toEqual([
			["main", true],
			["a-branch", false],
			["b-branch", false],
		]);
	});

	it("reports worktrees added and removed, and branch checkouts", async () => {
		const events = new WorkspaceEvents({
			trickroomHome: home,
			debounceMs: 10,
			pollMs: 60_000,
		});
		const snapshots: WorkspaceSnapshot[] = [];
		const unsubscribe = events.subscribe((snapshot) =>
			snapshots.push(snapshot),
		);
		const branches = () =>
			snapshots.at(-1)?.projects[0]?.checkouts.map((c) => c.branch) ?? [];
		try {
			await events.refresh();
			const worktree = path.join(temp, "wt-feature");
			git(repo, "worktree", "add", "-b", "feature/cart", worktree);
			await waitFor(() => branches().includes("feature/cart"));

			git(worktree, "checkout", "-b", "feature/checkout");
			await waitFor(() => branches().includes("feature/checkout"));

			git(repo, "worktree", "remove", "--force", worktree);
			await waitFor(() => snapshots.length > 0 && branches().join() === "main");
		} finally {
			unsubscribe();
		}
	});

	it("notices a worktree folder deleted without git on the next read", async () => {
		const worktree = path.join(temp, "wt-feature");
		git(repo, "worktree", "add", "-b", "feature/cart", worktree);
		const events = new WorkspaceEvents({ trickroomHome: home });
		expect((await events.refresh()).projects[0]?.checkouts).toHaveLength(2);

		await rm(worktree, { recursive: true, force: true });

		expect((await events.refresh()).projects[0]?.checkouts).toHaveLength(1);
	});
});
