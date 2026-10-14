import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCheckoutScope, UNSCOPED_BRANCH } from "./checkout-scope";

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
