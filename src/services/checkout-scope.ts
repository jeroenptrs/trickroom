import { type FSWatcher, watch } from "node:fs";
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

/** Whether two scopes are the same checkout: branch and worktree. */
export const isSameScope = (a: AnnotationScope, b: AnnotationScope) =>
	a.branch === b.branch && a.worktreePath === b.worktreePath;

/**
 * The git folder whose `HEAD` names the branch checked out at
 * `projectRoot` (a linked worktree's own folder under the main `.git`), or
 * null without git.
 */
export const findCheckoutGitDirectory = async (projectRoot: string) => {
	const found = await findDotGit(projectRoot);
	return found
		? resolveGitDirectory(found.dotGit, found.entry.isDirectory())
		: null;
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

/** Repeated `HEAD` events within this window are read once. */
const HEAD_DEBOUNCE_MS = 50;

export type CheckoutScopeListener = (scope: AnnotationScope) => void;

/**
 * Reports when the checkout's scope (`readCheckoutScope`) changes, for the
 * editor: a `git checkout` or `git switch` with a design open. Watches the
 * one git folder holding `HEAD` (not recursively, and only while someone
 * listens) and reads the scope again when `HEAD` is written; listeners hear
 * a scope only when it differs from the last one. Without git there is
 * nothing to watch and the scope never changes.
 */
export class CheckoutScopeEvents {
	private readonly listeners = new Set<CheckoutScopeListener>();
	private projectRoot: string | null = null;
	private watcher: FSWatcher | null = null;
	private generation = 0;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private last: AnnotationScope | null = null;
	private watching: Promise<void> = Promise.resolve();
	private readonly debounceMs: number;

	constructor(debounceMs = HEAD_DEBOUNCE_MS) {
		this.debounceMs = debounceMs;
	}

	setProjectRoot(projectRoot: string | null) {
		const next = projectRoot ? path.resolve(projectRoot) : null;
		if (next === this.projectRoot) return;
		this.projectRoot = next;
		if (this.listeners.size > 0) this.watching = this.restart();
	}

	subscribe(listener: CheckoutScopeListener) {
		this.listeners.add(listener);
		if (this.listeners.size === 1) this.watching = this.restart();
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				this.generation += 1;
				this.close();
			}
		};
	}

	/** Resolves once the watcher started by the last subscribe is in place. */
	whenWatched() {
		return this.watching;
	}

	private close() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		this.watcher?.close();
		this.watcher = null;
	}

	private async restart() {
		const generation = ++this.generation;
		this.close();
		const projectRoot = this.projectRoot;
		if (!projectRoot) return;
		const [scope, gitDirectory] = await Promise.all([
			readCheckoutScope(projectRoot),
			findCheckoutGitDirectory(projectRoot),
		]);
		if (generation !== this.generation) return;
		this.last = scope;
		if (!gitDirectory) return;
		try {
			// `HEAD` is replaced by rename (`HEAD.lock`), so the folder is
			// watched rather than the file.
			const watcher = watch(gitDirectory, (_event, file) => {
				if (file !== null && file !== "HEAD") return;
				if (this.timer) clearTimeout(this.timer);
				this.timer = setTimeout(() => {
					this.timer = null;
					void this.check(generation, projectRoot);
				}, this.debounceMs);
			});
			watcher.on("error", () => {
				if (this.watcher === watcher) this.close();
			});
			this.watcher = watcher;
		} catch {
			// An unreadable git folder: the scope is read per request anyway.
		}
	}

	private async check(generation: number, projectRoot: string) {
		const scope = await readCheckoutScope(projectRoot);
		if (generation !== this.generation) return;
		if (this.last && isSameScope(this.last, scope)) return;
		this.last = scope;
		for (const listener of this.listeners) listener(scope);
	}
}
