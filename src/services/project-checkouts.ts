import { type FSWatcher, watch } from "node:fs";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { resolveTrickroomHome } from "../app-state/home";
import {
	getProjectRegistryPath,
	listPresentProjectLocations,
	type ProjectLocationRef,
	readProjectRegistry,
	registerDiscoveredProjectLocations,
} from "../app-state/project-registry";
import { readProjectConfigReadOnly } from "../project";
import {
	type GitCheckout,
	listRepositoryWorktrees,
	readGitCheckout,
} from "./git-worktrees";

/** One folder a project is checked out in: a clone or a git worktree. */
export type ProjectCheckout = {
	locationId: string;
	projectRoot: string;
	/** The checked-out branch; null on a detached HEAD or without git. */
	branch: string | null;
	/** The abbreviated commit of a detached HEAD, otherwise null. */
	detachedHead: string | null;
	/** The git worktree's top folder; null without git. */
	worktreePath: string | null;
	/** False for a linked git worktree. */
	isMainWorktree: boolean;
	lastOpenedAt: string;
};

/** A project with every checkout of it present on this machine. */
export type WorkspaceProject = {
	projectId: string;
	name: string;
	/** Main worktree first, then by branch name. */
	checkouts: ProjectCheckout[];
};

export type WorkspaceSnapshot = {
	/** Most recently opened project first. */
	projects: WorkspaceProject[];
};

type LocatedCheckout = {
	location: ProjectLocationRef;
	git: GitCheckout | null;
};

const canonical = (filePath: string) =>
	realpath(filePath).catch(() => path.resolve(filePath));

const locateCheckouts = (locations: readonly ProjectLocationRef[]) =>
	Promise.all(
		locations.map(
			async (location): Promise<LocatedCheckout> => ({
				location,
				git: await readGitCheckout(location.root).catch(() => null),
			}),
		),
	);

/**
 * Registers the git worktrees of every registered project that are not in
 * the registry yet. A worktree counts as a checkout of the project when the
 * same folder inside it (the project may sit below the repository root) has
 * a `.trickroom/config.json` with the project's id. Reads only, apart from
 * the registry write. Returns the locations added.
 */
export const discoverProjectCheckouts = async (
	trickroomHome = resolveTrickroomHome(),
): Promise<ProjectLocationRef[]> => {
	const registry = await readProjectRegistry(trickroomHome);
	const located = await locateCheckouts(
		await listPresentProjectLocations(registry.locations),
	);
	const knownRoots = new Set<string>();
	// Per repository: where its projects sit inside a worktree.
	const repositories = new Map<
		string,
		Map<string, { projectId: string; relativeRoot: string }>
	>();
	for (const { location, git } of located) {
		const root = await canonical(location.root);
		knownRoots.add(root);
		knownRoots.add(path.resolve(location.root));
		if (!git) {
			continue;
		}
		const relativeRoot = path.relative(git.worktreePath, root);
		if (relativeRoot.startsWith("..") || path.isAbsolute(relativeRoot)) {
			continue;
		}
		const projects = repositories.get(git.commonDirectory) ?? new Map();
		projects.set(`${location.projectId}\0${relativeRoot}`, {
			projectId: location.projectId,
			relativeRoot,
		});
		repositories.set(git.commonDirectory, projects);
	}

	const found: { projectId: string; root: string; name: string }[] = [];
	await Promise.all(
		[...repositories].map(async ([commonDirectory, projects]) => {
			const worktrees = await listRepositoryWorktrees(commonDirectory);
			await Promise.all(
				worktrees.flatMap((worktree) =>
					[...projects.values()].map(async ({ projectId, relativeRoot }) => {
						const root = path.join(worktree.worktreePath, relativeRoot);
						if (knownRoots.has(root) || knownRoots.has(await canonical(root))) {
							return;
						}
						// A branch from before the project had designs has no config.
						const project = await readProjectConfigReadOnly(root).catch(
							() => null,
						);
						if (project?.config.projectId === projectId) {
							found.push({ projectId, root, name: project.config.name });
						}
					}),
				),
			);
		}),
	);

	return registerDiscoveredProjectLocations({
		trickroomHome,
		locations: found,
	});
};

const compareCheckouts = (a: ProjectCheckout, b: ProjectCheckout) =>
	Number(b.isMainWorktree) - Number(a.isMainWorktree) ||
	(a.branch ?? "￿").localeCompare(b.branch ?? "￿") ||
	a.projectRoot.localeCompare(b.projectRoot);

/**
 * The registered projects with their checkouts, and the folders whose
 * changes can alter that list (for `WorkspaceEvents`).
 */
export const readWorkspace = async (
	trickroomHome = resolveTrickroomHome(),
): Promise<{ snapshot: WorkspaceSnapshot; gitDirectories: string[] }> => {
	const registry = await readProjectRegistry(trickroomHome);
	const located = await locateCheckouts(
		await listPresentProjectLocations(registry.locations),
	);
	const projects = new Map<string, WorkspaceProject>();
	const gitDirectories = new Set<string>();
	// Registry order is most recently opened first, which orders the projects
	// and names each one after its most recent checkout.
	for (const { location, git } of located) {
		const project = projects.get(location.projectId) ?? {
			projectId: location.projectId,
			name: location.name,
			checkouts: [],
		};
		project.checkouts.push({
			locationId: location.locationId,
			projectRoot: location.root,
			branch: git?.branch ?? null,
			detachedHead: git?.detachedHead ?? null,
			worktreePath: git?.worktreePath ?? null,
			isMainWorktree: git?.isMainWorktree ?? true,
			lastOpenedAt: location.lastOpenedAt,
		});
		projects.set(location.projectId, project);
		if (git) {
			gitDirectories.add(git.gitDirectory);
			gitDirectories.add(git.commonDirectory);
			gitDirectories.add(path.join(git.commonDirectory, "worktrees"));
		}
	}
	for (const project of projects.values()) {
		project.checkouts.sort(compareCheckouts);
	}
	return {
		snapshot: { projects: [...projects.values()] },
		gitDirectories: [...gitDirectories],
	};
};

/** Events within this window lead to one read. */
const WORKSPACE_DEBOUNCE_MS = 150;
/**
 * A worktree folder deleted without git (`rm -rf`) changes no watched
 * folder, so the list is also read on this interval while someone listens.
 */
const WORKSPACE_POLL_MS = 10_000;

export type WorkspaceListener = (snapshot: WorkspaceSnapshot) => void;

/**
 * Keeps the list of projects and checkouts in line with the disk and reports
 * when it changes: a worktree added or removed, a branch checked out, a
 * project registered by another process (an agent's MCP session). While
 * someone listens it watches the registry file and, per repository, the git
 * folders that hold `HEAD` and `worktrees/` (never recursively), and reads
 * again on an interval. Each read first registers worktrees not seen before
 * (`discoverProjectCheckouts`).
 */
export class WorkspaceEvents {
	private readonly listeners = new Set<WorkspaceListener>();
	private readonly watchers = new Map<string, FSWatcher>();
	private readonly trickroomHome: string;
	private readonly debounceMs: number;
	private readonly pollMs: number;
	private timer: ReturnType<typeof setTimeout> | null = null;
	private poll: ReturnType<typeof setInterval> | null = null;
	private reading: Promise<WorkspaceSnapshot> | null = null;
	private readAgain = false;
	private lastSignature: string | null = null;

	constructor({
		trickroomHome = resolveTrickroomHome(),
		debounceMs = WORKSPACE_DEBOUNCE_MS,
		pollMs = WORKSPACE_POLL_MS,
	}: { trickroomHome?: string; debounceMs?: number; pollMs?: number } = {}) {
		this.trickroomHome = trickroomHome;
		this.debounceMs = debounceMs;
		this.pollMs = pollMs;
	}

	subscribe(listener: WorkspaceListener) {
		this.listeners.add(listener);
		if (this.listeners.size === 1) {
			this.poll = setInterval(() => void this.refresh(), this.pollMs);
			this.poll.unref?.();
			void this.refresh();
		}
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				this.close();
			}
		};
	}

	/**
	 * Reads the disk now and returns the current list. Listeners hear it when
	 * it differs from the last one they heard. Concurrent calls share a read.
	 */
	refresh(): Promise<WorkspaceSnapshot> {
		if (this.reading) {
			this.readAgain = true;
			return this.reading;
		}
		this.reading = this.read().finally(() => {
			this.reading = null;
			if (this.readAgain) {
				this.readAgain = false;
				if (this.listeners.size > 0) void this.refresh();
			}
		});
		return this.reading;
	}

	private async read() {
		await discoverProjectCheckouts(this.trickroomHome).catch(() => []);
		const { snapshot, gitDirectories } = await readWorkspace(
			this.trickroomHome,
		);
		if (this.listeners.size > 0) {
			this.watch([this.registryDirectory, ...gitDirectories]);
		}
		const signature = JSON.stringify(snapshot);
		const changed =
			this.lastSignature !== null && this.lastSignature !== signature;
		this.lastSignature = signature;
		if (changed) {
			for (const listener of this.listeners) listener(snapshot);
		}
		return snapshot;
	}

	private schedule() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.refresh();
		}, this.debounceMs);
	}

	private get registryDirectory() {
		return path.dirname(getProjectRegistryPath(this.trickroomHome));
	}

	/**
	 * Whether a change of `file` in a watched folder can alter the list. A
	 * git folder changes on every git command (`index.lock`, `ORIG_HEAD`);
	 * only `HEAD` and the `worktrees` folder matter.
	 */
	private isRelevant(directory: string, file: string | null) {
		if (file === null || path.basename(directory) === "worktrees") {
			return true;
		}
		if (directory === this.registryDirectory) {
			return file === path.basename(getProjectRegistryPath(this.trickroomHome));
		}
		return file === "HEAD" || file === "worktrees";
	}

	/** Watches exactly `directories`, closing the watchers of any other. */
	private watch(directories: readonly string[]) {
		const wanted = new Set(directories);
		for (const [directory, watcher] of this.watchers) {
			if (!wanted.has(directory)) {
				watcher.close();
				this.watchers.delete(directory);
			}
		}
		for (const directory of wanted) {
			if (this.watchers.has(directory)) continue;
			try {
				const watcher = watch(directory, (_event, file) => {
					if (this.isRelevant(directory, file)) this.schedule();
				});
				watcher.on("error", () => {
					if (this.watchers.get(directory) === watcher) {
						watcher.close();
						this.watchers.delete(directory);
					}
				});
				this.watchers.set(directory, watcher);
			} catch {
				// A folder that does not exist yet (`worktrees/` before the first
				// linked worktree): its parent is watched, and the poll covers it.
			}
		}
	}

	private close() {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		if (this.poll) clearInterval(this.poll);
		this.poll = null;
		for (const watcher of this.watchers.values()) watcher.close();
		this.watchers.clear();
		this.lastSignature = null;
	}
}
