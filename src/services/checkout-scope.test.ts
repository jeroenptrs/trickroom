import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AnnotationScope } from "./annotations.types";
import {
	CheckoutScopeEvents,
	readCheckoutScope,
	readCheckoutScopeSync,
	UNSCOPED_BRANCH,
} from "./checkout-scope";

const sha = "0123456789abcdef0123456789abcdef01234567";

describe("readCheckoutScope", () => {
	let base: string;

	beforeEach(async () => {
		base = await realpath(
			await mkdtemp(path.join(os.tmpdir(), "trickroom-scope-")),
		);
	});

	afterEach(async () => {
		await rm(base, { recursive: true, force: true });
	});

	const write = async (file: string, contents: string) => {
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, contents);
	};

	it("reads the branch of a main checkout", async () => {
		const root = path.join(base, "repo");
		await write(path.join(root, ".git", "HEAD"), "ref: refs/heads/feature/x\n");
		expect(await readCheckoutScope(root)).toEqual({
			branch: "feature/x",
			worktreePath: await realpath(root),
		});
	});

	it("finds the repository above a nested project folder", async () => {
		const root = path.join(base, "repo");
		const nested = path.join(root, "apps", "web");
		await write(path.join(root, ".git", "HEAD"), "ref: refs/heads/develop\n");
		await mkdir(nested, { recursive: true });
		expect(await readCheckoutScope(nested)).toEqual({
			branch: "develop",
			worktreePath: await realpath(root),
		});
	});

	it("follows a relative gitdir file of a linked worktree", async () => {
		const gitDirectory = path.join(base, "main", ".git", "worktrees", "wt");
		await write(path.join(gitDirectory, "HEAD"), "ref: refs/heads/linked\n");
		const worktree = path.join(base, "wt");
		await write(
			path.join(worktree, ".git"),
			"gitdir: ../main/.git/worktrees/wt\n",
		);
		expect(await readCheckoutScope(worktree)).toEqual({
			branch: "linked",
			worktreePath: await realpath(worktree),
		});
	});

	it("follows an absolute gitdir file of a linked worktree", async () => {
		const gitDirectory = path.join(base, "main", ".git", "worktrees", "wt");
		await write(path.join(gitDirectory, "HEAD"), "ref: refs/heads/absolute\n");
		const worktree = path.join(base, "wt");
		await write(path.join(worktree, ".git"), `gitdir: ${gitDirectory}\n`);
		expect(await readCheckoutScope(worktree)).toEqual({
			branch: "absolute",
			worktreePath: await realpath(worktree),
		});
	});

	it("follows a gitdir file from a project nested in a linked worktree", async () => {
		const gitDirectory = path.join(base, "main", ".git", "worktrees", "wt");
		await write(path.join(gitDirectory, "HEAD"), "ref: refs/heads/nested\n");
		const worktree = path.join(base, "wt");
		await write(path.join(worktree, ".git"), `gitdir: ${gitDirectory}\n`);
		const nested = path.join(worktree, "packages", "ui");
		await mkdir(nested, { recursive: true });
		expect(await readCheckoutScope(nested)).toEqual({
			branch: "nested",
			worktreePath: await realpath(worktree),
		});
	});

	it("scopes a detached HEAD to the unscoped branch", async () => {
		const root = path.join(base, "repo");
		await write(path.join(root, ".git", "HEAD"), `${sha}\n`);
		expect(await readCheckoutScope(root)).toEqual({
			branch: UNSCOPED_BRANCH,
			worktreePath: await realpath(root),
		});
		expect(UNSCOPED_BRANCH).toBe("*");
	});

	it("scopes a repository without a readable HEAD to the unscoped branch", async () => {
		const root = path.join(base, "repo");
		await mkdir(path.join(root, ".git"), { recursive: true });
		expect(await readCheckoutScope(root)).toEqual({
			branch: "*",
			worktreePath: await realpath(root),
		});
	});

	it("scopes an unreadable or garbage gitdir file to the unscoped branch", async () => {
		const garbage = path.join(base, "garbage");
		await write(path.join(garbage, ".git"), "this is not a gitdir pointer\n");
		expect(await readCheckoutScope(garbage)).toEqual({
			branch: "*",
			worktreePath: await realpath(garbage),
		});

		const dangling = path.join(base, "dangling");
		await write(
			path.join(dangling, ".git"),
			"gitdir: ../does-not-exist/.git/worktrees/x\n",
		);
		expect(await readCheckoutScope(dangling)).toEqual({
			branch: "*",
			worktreePath: await realpath(dangling),
		});

		const empty = path.join(base, "empty");
		await write(path.join(empty, ".git"), "");
		expect((await readCheckoutScope(empty)).branch).toBe("*");
	});

	it("falls back to the project root when there is no git", async () => {
		const root = path.join(base, "plain", "project");
		await mkdir(root, { recursive: true });
		let directory = path.dirname(root);
		let gitAbove = false;
		for (;;) {
			if (existsSync(path.join(directory, ".git"))) gitAbove = true;
			const parent = path.dirname(directory);
			if (parent === directory) break;
			directory = parent;
		}
		if (gitAbove) return;
		expect(await readCheckoutScope(root)).toEqual({
			branch: "*",
			worktreePath: await realpath(root),
		});
	});
});

describe("CheckoutScopeEvents", () => {
	let base: string;
	let events: CheckoutScopeEvents;
	let unsubscribe: (() => void) | null;

	beforeEach(async () => {
		base = await realpath(
			await mkdtemp(path.join(os.tmpdir(), "trickroom-scope-events-")),
		);
		events = new CheckoutScopeEvents(10);
		unsubscribe = null;
	});

	afterEach(async () => {
		unsubscribe?.();
		await rm(base, { recursive: true, force: true });
	});

	/** As git writes HEAD: a lock file renamed into place. */
	const writeHead = async (gitDirectory: string, contents: string) => {
		await mkdir(gitDirectory, { recursive: true });
		await writeFile(path.join(gitDirectory, "HEAD.lock"), contents);
		await rename(
			path.join(gitDirectory, "HEAD.lock"),
			path.join(gitDirectory, "HEAD"),
		);
	};

	const listen = async (projectRoot: string) => {
		const heard: AnnotationScope[] = [];
		events.setProjectRoot(projectRoot);
		unsubscribe = events.subscribe((scope) => heard.push(scope));
		await events.whenWatched();
		return heard;
	};

	const waitFor = async (predicate: () => boolean) => {
		const deadline = Date.now() + 3_000;
		while (!predicate() && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	};

	const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

	it("reports a checkout of another branch, once", async () => {
		const root = path.join(base, "repo");
		await writeHead(path.join(root, ".git"), "ref: refs/heads/a\n");
		const heard = await listen(root);
		await writeHead(path.join(root, ".git"), "ref: refs/heads/b\n");
		await waitFor(() => heard.length > 0);
		await settle();
		expect(heard).toEqual([{ branch: "b", worktreePath: root }]);
	});

	it("stays quiet for other git files and for HEAD rewritten unchanged", async () => {
		const root = path.join(base, "repo");
		await writeHead(path.join(root, ".git"), "ref: refs/heads/a\n");
		const heard = await listen(root);
		await writeFile(path.join(root, ".git", "index"), "x");
		await writeHead(path.join(root, ".git"), "ref: refs/heads/a\n");
		await settle();
		expect(heard).toEqual([]);
	});

	it("follows a linked worktree's own HEAD, and a detached one", async () => {
		const gitDirectory = path.join(base, "main", ".git", "worktrees", "wt");
		await writeHead(gitDirectory, "ref: refs/heads/a\n");
		const worktree = path.join(base, "wt");
		await mkdir(worktree, { recursive: true });
		await writeFile(
			path.join(worktree, ".git"),
			"gitdir: ../main/.git/worktrees/wt\n",
		);
		const heard = await listen(worktree);
		await writeHead(gitDirectory, `${sha}\n`);
		await waitFor(() => heard.length > 0);
		expect(heard).toEqual([
			{ branch: UNSCOPED_BRANCH, worktreePath: worktree },
		]);
	});

	it("stops watching once nobody listens", async () => {
		const root = path.join(base, "repo");
		await writeHead(path.join(root, ".git"), "ref: refs/heads/a\n");
		const heard = await listen(root);
		unsubscribe?.();
		unsubscribe = null;
		await writeHead(path.join(root, ".git"), "ref: refs/heads/b\n");
		await settle();
		expect(heard).toEqual([]);
	});
});

describe("readCheckoutScopeSync", () => {
	let base: string;

	beforeEach(async () => {
		base = await realpath(
			await mkdtemp(path.join(os.tmpdir(), "trickroom-scope-sync-")),
		);
	});

	afterEach(async () => {
		await rm(base, { recursive: true, force: true });
	});

	it("answers as readCheckoutScope: a branch, a worktree, a detached HEAD", async () => {
		const main = path.join(base, "main");
		await mkdir(path.join(main, ".git"), { recursive: true });
		await writeFile(path.join(main, ".git", "HEAD"), "ref: refs/heads/x\n");
		const gitDirectory = path.join(main, ".git", "worktrees", "wt");
		await mkdir(gitDirectory, { recursive: true });
		await writeFile(path.join(gitDirectory, "HEAD"), `${sha}\n`);
		const worktree = path.join(base, "wt");
		await mkdir(path.join(worktree, "nested"), { recursive: true });
		await writeFile(
			path.join(worktree, ".git"),
			"gitdir: ../main/.git/worktrees/wt\n",
		);
		for (const root of [main, worktree, path.join(worktree, "nested")]) {
			expect(readCheckoutScopeSync(root)).toEqual(
				await readCheckoutScope(root),
			);
		}
		expect(readCheckoutScopeSync(main).branch).toBe("x");
		expect(readCheckoutScopeSync(worktree).branch).toBe(UNSCOPED_BRANCH);
	});
});
