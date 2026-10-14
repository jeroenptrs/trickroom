import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { AnnotationScope } from "./annotations.types";

/** The scope of a detached HEAD or a project without git: one shared bucket. */
export const UNSCOPED_BRANCH = "*";

const branchRefPrefix = "ref: refs/heads/";

const canonical = (filePath: string) =>
	realpath(filePath).catch(() => path.resolve(filePath));

/**
 * The nearest `.git` at or above `start`: a folder in a main checkout, a
 * `gitdir:` file in a linked worktree or submodule.
 */
const findDotGit = async (start: string) => {
	let directory = path.resolve(start);
	for (;;) {
		const candidate = path.join(directory, ".git");
		const entry = await stat(candidate).catch(() => null);
		if (entry) {
			return { worktreePath: directory, dotGit: candidate, entry };
		}
		const parent = path.dirname(directory);
		if (parent === directory) return null;
		directory = parent;
	}
};

/** The git folder holding HEAD: `.git` itself, or the folder a `gitdir:` file names. */
const resolveGitDirectory = async (
	dotGit: string,
	isDirectory: boolean,
): Promise<string | null> => {
	if (isDirectory) return dotGit;
	const contents = await readFile(dotGit, "utf8").catch(() => null);
	const match = contents ? /^gitdir:\s*(.+?)\s*$/mu.exec(contents) : null;
	if (!match?.[1]) return null;
	return path.resolve(path.dirname(dotGit), match[1]);
};

/**
 * The branch checked out at `projectRoot` and the worktree it is in, read
 * from `.git/HEAD` without spawning git. Linked worktrees are followed
 * through their `gitdir:` file. A detached HEAD, an unreadable HEAD or no
 * git at all yield the unscoped branch `"*"`; without git the worktree path
 * is the project root.
 */
export const readCheckoutScope = async (
	projectRoot: string,
): Promise<AnnotationScope> => {
	const found = await findDotGit(projectRoot);
	if (!found) {
		return {
			branch: UNSCOPED_BRANCH,
			worktreePath: await canonical(projectRoot),
		};
	}
	const worktreePath = await canonical(found.worktreePath);
	const gitDirectory = await resolveGitDirectory(
		found.dotGit,
		found.entry.isDirectory(),
	);
	const head = gitDirectory
		? await readFile(path.join(gitDirectory, "HEAD"), "utf8").catch(() => null)
		: null;
	const line = head?.trim() ?? "";
	const branch = line.startsWith(branchRefPrefix)
		? line.slice(branchRefPrefix.length).trim()
		: "";
	return { branch: branch || UNSCOPED_BRANCH, worktreePath };
};
