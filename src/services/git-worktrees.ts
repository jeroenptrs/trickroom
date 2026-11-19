import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
	findCheckoutGitDirectory,
	readCheckoutScope,
	UNSCOPED_BRANCH,
} from "./checkout-scope";

/** What git says about the checkout a folder is in. */
export type GitCheckout = {
	/** The worktree's top folder. */
	worktreePath: string;
	/** The folder holding this worktree's `HEAD`. */
	gitDirectory: string;
	/** The repository's shared git folder; the same for all its worktrees. */
	commonDirectory: string;
	/** The checked-out branch, or null on a detached HEAD. */
	branch: string | null;
	/** The abbreviated commit of a detached HEAD, otherwise null. */
	detachedHead: string | null;
	/** Whether this is the repository's main worktree, not a linked one. */
	isMainWorktree: boolean;
};

export type GitWorktree = {
	worktreePath: string;
	isMainWorktree: boolean;
};

const readText = (filePath: string) =>
	readFile(filePath, "utf8").then(
		(contents) => contents.trim(),
		() => null,
	);

const isDirectory = (filePath: string) =>
	stat(filePath).then(
		(entry) => entry.isDirectory(),
		() => false,
	);

/**
 * The checkout `projectRoot` is in, read from the git folder without
 * spawning git, or null without git. A linked worktree names the shared
 * folder in its `commondir` file.
 */
export const readGitCheckout = async (
	projectRoot: string,
): Promise<GitCheckout | null> => {
	const gitDirectory = await findCheckoutGitDirectory(projectRoot);
	if (!gitDirectory) {
		return null;
	}

	const [scope, commonDirectoryFile, head] = await Promise.all([
		readCheckoutScope(projectRoot),
		readText(path.join(gitDirectory, "commondir")),
		readText(path.join(gitDirectory, "HEAD")),
	]);
	const commonDirectory = commonDirectoryFile
		? path.resolve(gitDirectory, commonDirectoryFile)
		: gitDirectory;
	const branch = scope.branch === UNSCOPED_BRANCH ? null : scope.branch;
	return {
		worktreePath: scope.worktreePath,
		gitDirectory,
		commonDirectory,
		branch,
		detachedHead:
			branch === null && head && /^[0-9a-f]{7,64}$/iu.test(head)
				? head.slice(0, 7)
				: null,
		isMainWorktree: commonDirectory === gitDirectory,
	};
};

/**
 * Every worktree of the repository whose shared git folder is
 * `commonDirectory`: the main one (unless the repository is bare) and each
 * linked one registered under `worktrees/`. A linked worktree whose folder is
 * gone, but which git has not pruned yet, is left out.
 */
export const listRepositoryWorktrees = async (
	commonDirectory: string,
): Promise<GitWorktree[]> => {
	const worktrees: GitWorktree[] = [];
	if (path.basename(commonDirectory) === ".git") {
		worktrees.push({
			worktreePath: path.dirname(commonDirectory),
			isMainWorktree: true,
		});
	}

	const entries = await readdir(path.join(commonDirectory, "worktrees")).catch(
		() => [] as string[],
	);
	const linked = await Promise.all(
		entries.map(async (entry) => {
			// `gitdir` holds the path of the worktree's own `.git` file.
			const dotGit = await readText(
				path.join(commonDirectory, "worktrees", entry, "gitdir"),
			);
			if (!dotGit) {
				return null;
			}
			const worktreePath = path.dirname(
				path.resolve(commonDirectory, "worktrees", entry, dotGit),
			);
			return (await isDirectory(worktreePath)) ? worktreePath : null;
		}),
	);
	for (const worktreePath of linked) {
		if (worktreePath) {
			worktrees.push({ worktreePath, isMainWorktree: false });
		}
	}
	return worktrees;
};
