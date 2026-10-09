import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import {
	getTailwindSourceFiles,
	subscribeTailwindSourceFiles,
} from "../utils/tailwind-source-files";
import { createDesignFileService } from "./design-file-service";
import { calculateManifestRevision } from "./design-revision";
import { inspectDesignStorage } from "./design-storage";

export type TrickroomFileEvent = {
	/**
	 * What changed, relative to `.trickroom`. Design events name the design,
	 * `designs/<id>`, whatever files of it changed. For `tailwind-source`
	 * events, relative to the project root.
	 */
	file: string;
	/**
	 * `tailwind-source`: a stylesheet a system's Tailwind CSS reads (its
	 * entry or an imported file) changed, outside `.trickroom`.
	 */
	kind?: "tailwind-source";
	/**
	 * Opaque revision of the changed file or, for a design, the design's
	 * revision; null when it was deleted.
	 */
	revision: string | null;
	operation: "changed" | "deleted";
	/** Set on design events. */
	designId?: string;
	/**
	 * Boards of the design that changed since the previous event, with their
	 * revision (null when the board was removed). Order changes alone do not
	 * list boards; compare `revision` to see the design changed.
	 */
	boards?: { id: string; revision: string | null }[];
	/**
	 * Set on design events for a readable design: the manifest revision and
	 * every board's revision in board order, so a client can tell exactly
	 * which parts differ from what it holds, even across missed events.
	 */
	state?: {
		manifest: string;
		boards: { id: string; revision: string }[];
	};
};

export type TrickroomFileEventListener = (event: TrickroomFileEvent) => void;

const DEFAULT_DEBOUNCE_MS = 75;
/**
 * Longest a design's changes wait for its files to settle: a steady stream
 * of writes (an agent applying operations back to back) still produces an
 * event at least this often.
 */
const DEFAULT_MAX_WAIT_MS = 250;
/**
 * The watcher drops a path's repeated change events for 50 ms after one it
 * reports (with no trailing event). A design read sooner than this after
 * its last reported change may miss a write the watcher swallowed, so it is
 * followed by one more read.
 */
const WATCHER_REPEAT_WINDOW_MS = 60;

/** How long after watching a new folder its entries are checked once more. */
const ANCESTOR_RECHECK_MS = 150;

const toRevision = (contents: Buffer): string =>
	`sha256:${createHash("sha256").update(contents).digest("hex")}`;

const normalizeRelativeFile = (projectRoot: string, filePath: string) =>
	path
		.relative(path.join(projectRoot, ".trickroom"), filePath)
		.split(path.sep)
		.join("/");

type WatchedFile =
	| { kind: "file" }
	| { kind: "design"; designId: string; boardId: string | null };

/**
 * Classifies a path relative to `.trickroom`. Changes to any file of a
 * design (its manifest, board files and journal, or a legacy single file)
 * are design changes, batched per design; memory files, system files
 * (including `lint.json` and `lint-report.json`) and the project config are
 * reported as files.
 * Temporary files, lock files and saved conflicts are ignored.
 */
export const classifyTrickroomFile = (
	relativeFile: string,
): WatchedFile | null => {
	// The project config: `codegen.twMerge` decides how classes merge.
	if (relativeFile === "config.json") {
		return { kind: "file" };
	}
	if (relativeFile.startsWith("systems/")) {
		// Atomic writes (components.json, lint-report.json) go through a
		// `.tmp` sibling that is renamed into place; only the target matters.
		// Lock files (lint-report.json.lock, its `.lock.<pid>.<random>.tmp`
		// replacements and the `.reclaim` lock) only guard the write.
		return relativeFile.endsWith(".tmp") ||
			/\.(lock|reclaim)(\.|$)/u.test(relativeFile)
			? null
			: { kind: "file" };
	}
	if (!relativeFile.startsWith("designs/")) {
		return null;
	}
	const segments = relativeFile.slice("designs/".length).split("/");
	const [first = "", second, third] = segments;
	if (first.startsWith(".") || first.endsWith(".tmp")) {
		return null;
	}
	if (segments.length === 1) {
		if (first.endsWith(".memory.json")) {
			return { kind: "file" };
		}
		return first.endsWith(".json")
			? {
					kind: "design",
					designId: first.slice(0, -".json".length),
					boardId: null,
				}
			: null;
	}
	if (segments.length === 2) {
		if (second === "memory.json") {
			return { kind: "file" };
		}
		return second === "design.json" || second === ".journal.json"
			? { kind: "design", designId: first, boardId: null }
			: null;
	}
	if (
		segments.length === 3 &&
		second === "boards" &&
		third !== undefined &&
		!third.startsWith(".") &&
		third.endsWith(".json")
	) {
		return {
			kind: "design",
			designId: first,
			boardId: third.slice(0, -".json".length),
		};
	}
	return null;
};

export const isWatchedTrickroomFile = (relativeFile: string) =>
	classifyTrickroomFile(relativeFile) !== null;

type DesignEventTiming = {
	lastChangeAt: number;
	/** Read before the files settled: possibly mid-write, look again. */
	unsettled: boolean;
};

type PendingDesign = {
	timer: ReturnType<typeof setTimeout>;
	boardIds: Set<string>;
	/** When the first change of this batch arrived. */
	since: number;
	/** When the last change of this batch arrived (0 for none). */
	lastChangeAt: number;
};

export class ProjectFileEvents {
	private readonly listeners = new Set<TrickroomFileEventListener>();
	private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly pendingDesigns = new Map<string, PendingDesign>();
	/** Each design's event in progress, so its events go out in order. */
	private readonly emittingDesigns = new Map<string, Promise<void>>();
	/**
	 * Each design's revision and board revisions at its last event, to tell
	 * which boards changed and to drop repeats of the same state.
	 */
	private readonly knownDesigns = new Map<
		string,
		{ revision: string; boards: Map<string, string> }
	>();
	/** Designs whose last event reported them deleted, to drop repeats. */
	private readonly deletedDesigns = new Set<string>();
	private watcher: FSWatcher | null = null;
	/** Watches the system stylesheets the Tailwind caches have read. */
	private sourceWatcher: FSWatcher | null = null;
	private ancestorWatcher: FSWatcher | null = null;
	/** The folders `ancestorWatcher` watches, with how many files wait on each. */
	private stylesheetAncestorRefs: Map<string, number> = new Map();
	private unsubscribeSources: (() => void) | null = null;
	private projectRoot: string | null = null;
	private watcherGeneration = 0;
	private readonly debounceMs: number;
	private readonly maxWaitMs: number;
	/** How long after a change a design's files count as settled. */
	private readonly settleMs: number;
	private readonly trickroomHome: string | undefined;

	constructor(
		debounceMs = DEFAULT_DEBOUNCE_MS,
		options: { trickroomHome?: string; maxWaitMs?: number } = {},
	) {
		this.debounceMs = debounceMs;
		this.maxWaitMs = Math.max(
			debounceMs,
			options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS,
		);
		this.settleMs = Math.max(debounceMs, WATCHER_REPEAT_WINDOW_MS);
		this.trickroomHome = options.trickroomHome;
	}

	setProjectRoot(projectRoot: string | null) {
		const normalizedRoot = projectRoot ? path.resolve(projectRoot) : null;
		if (this.projectRoot === normalizedRoot) {
			return;
		}

		this.projectRoot = normalizedRoot;
		this.knownDesigns.clear();
		this.deletedDesigns.clear();
		if (this.listeners.size > 0) {
			void this.restartWatcher();
		}
	}

	subscribe(listener: TrickroomFileEventListener) {
		this.listeners.add(listener);
		if (this.listeners.size === 1) {
			void this.restartWatcher();
		}

		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0) {
				void this.stopWatcher();
			}
		};
	}

	private async restartWatcher() {
		const generation = ++this.watcherGeneration;
		await this.closeWatcher();
		if (generation !== this.watcherGeneration) {
			return;
		}
		if (!this.projectRoot || this.listeners.size === 0) {
			return;
		}

		const watchedRoot = path.join(this.projectRoot, ".trickroom");
		// No `awaitWriteFinish`: it holds a path's events back until the file
		// stops changing, so a steady stream of writes to one board would show
		// nothing until it ends. The debounces below wait for files to settle
		// instead, and design reads take a consistent snapshot.
		const watcher = chokidar.watch(watchedRoot, { ignoreInitial: true });
		if (generation !== this.watcherGeneration) {
			await watcher.close();
			return;
		}
		this.watcher = watcher;

		let ready = false;
		watcher.on("ready", () => {
			ready = true;
		});
		const schedule = (filePath: string) => {
			if (ready) {
				this.schedule(filePath);
			}
		};
		watcher.on("add", schedule);
		watcher.on("change", schedule);
		watcher.on("unlink", schedule);

		this.watchTailwindSources(this.projectRoot);
	}

	/**
	 * Reports edits to the stylesheets a system's Tailwind CSS reads (its entry
	 * and the files it imports) that live in the project but outside
	 * `.trickroom`, as `tailwind-source` events. Files join as the Tailwind
	 * caches resolve them, before reading them, so a missing import is watched
	 * too and creating it (or its folder) lets a failed load recover. Files
	 * outside the project and packages under `node_modules` are left out.
	 */
	private watchTailwindSources(projectRoot: string) {
		const sourceWatcher = chokidar.watch([], { ignoreInitial: true });
		this.sourceWatcher = sourceWatcher;
		const trickroomDir = path.join(projectRoot, ".trickroom") + path.sep;
		const isProjectSource = (filePath: string) => {
			const relative = path.relative(projectRoot, filePath);
			return (
				relative.length > 0 &&
				!relative.startsWith("..") &&
				!path.isAbsolute(relative) &&
				!filePath.startsWith(trickroomDir) &&
				!relative.split(path.sep).includes("node_modules")
			);
		};
		const schedule = (filePath: string) =>
			this.scheduleTailwindSource(projectRoot, filePath);
		/**
		 * Files whose folder does not exist yet, each with the nearest existing
		 * folder above it, which `ancestorWatcher` watches (only its direct
		 * entries) to see the next folder appear. Folders are counted and
		 * dropped once no file waits on them; the watcher exists only while a
		 * file waits.
		 */
		const waiting = new Map<string, string>();
		/** Files whose folder appeared before they did, checked once more. */
		const settling = new Set<string>();
		const ancestorRefs = new Map<string, number>();
		this.stylesheetAncestorRefs = ancestorRefs;
		const nearestExistingAncestor = (filePath: string) => {
			let ancestor = path.dirname(path.dirname(filePath));
			while (
				!existsSync(ancestor) &&
				ancestor.length > projectRoot.length &&
				ancestor !== path.dirname(ancestor)
			) {
				ancestor = path.dirname(ancestor);
			}
			return ancestor;
		};
		// A folder created right after its parent joins the watcher, before
		// chokidar watches it, reports nothing: look again shortly after.
		const recheckKey = "tailwind-source-ancestors";
		const scheduleRecheck = () => {
			if (this.pending.has(recheckKey)) return;
			this.pending.set(
				recheckKey,
				setTimeout(() => {
					this.pending.delete(recheckKey);
					if (this.sourceWatcher !== sourceWatcher) return;
					onAddDir();
					// Files whose folder appeared before they did: written before
					// their watch was ready, they report nothing either.
					for (const filePath of settling) {
						if (existsSync(filePath)) schedule(filePath);
					}
					settling.clear();
				}, ANCESTOR_RECHECK_MS),
			);
		};
		/** The folders the current ancestor watcher watches. */
		let watchedAncestors = new Set<string>();
		// Brings the ancestor watcher in line with the counted folders. New
		// folders are added; when one is no longer needed the watcher is
		// replaced, since chokidar's unwatch also ignores everything below the
		// folder, where other waiting files may be. No folder, no watcher.
		const syncAncestorWatcher = () => {
			const needed = new Set(ancestorRefs.keys());
			const removed = [...watchedAncestors].some((dir) => !needed.has(dir));
			if (needed.size === 0 || removed) {
				const watcher = this.ancestorWatcher;
				this.ancestorWatcher = null;
				watchedAncestors = new Set();
				if (watcher) void watcher.close();
				if (needed.size === 0) return;
			}
			const added = [...needed].filter((dir) => !watchedAncestors.has(dir));
			if (added.length === 0) return;
			if (!this.ancestorWatcher) {
				const watcher = chokidar.watch([], { ignoreInitial: true, depth: 0 });
				watcher.on("addDir", onAddDir);
				this.ancestorWatcher = watcher;
			}
			this.ancestorWatcher.add(added);
			for (const dir of added) watchedAncestors.add(dir);
			scheduleRecheck();
		};
		const retain = (ancestor: string) => {
			ancestorRefs.set(ancestor, (ancestorRefs.get(ancestor) ?? 0) + 1);
		};
		const release = (ancestor: string) => {
			const count = (ancestorRefs.get(ancestor) ?? 0) - 1;
			if (count > 0) ancestorRefs.set(ancestor, count);
			else ancestorRefs.delete(ancestor);
		};
		const wait = (filePath: string) => {
			const ancestor = nearestExistingAncestor(filePath);
			const previous = waiting.get(filePath);
			if (previous === ancestor) return;
			waiting.set(filePath, ancestor);
			retain(ancestor);
			if (previous !== undefined) release(previous);
		};
		function onAddDir() {
			for (const [filePath, ancestor] of [...waiting]) {
				if (!existsSync(path.dirname(filePath))) {
					wait(filePath);
					continue;
				}
				// The folder exists now: watch the file afresh, and report it
				// when it was created along with its folder.
				waiting.delete(filePath);
				release(ancestor);
				sourceWatcher.unwatch(filePath);
				sourceWatcher.add(filePath);
				if (existsSync(filePath)) {
					schedule(filePath);
				} else {
					settling.add(filePath);
					scheduleRecheck();
				}
			}
			syncAncestorWatcher();
		}
		const add = (files: readonly string[]) => {
			const watched = files.filter(isProjectSource);
			if (watched.length === 0) return;
			sourceWatcher.add(watched);
			for (const filePath of watched) {
				if (!existsSync(path.dirname(filePath))) wait(filePath);
			}
			syncAncestorWatcher();
		};
		add(getTailwindSourceFiles());
		this.unsubscribeSources = subscribeTailwindSourceFiles(add);
		sourceWatcher.on("add", schedule);
		sourceWatcher.on("change", schedule);
		sourceWatcher.on("unlink", schedule);
	}

	/**
	 * The folders watched for missing stylesheet folders to appear; null
	 * while no stylesheet waits for its folder. For tests.
	 */
	getWatchedStylesheetAncestors(): string[] | null {
		return this.ancestorWatcher
			? [...this.stylesheetAncestorRefs.keys()].sort()
			: null;
	}

	private scheduleTailwindSource(projectRoot: string, filePath: string) {
		const key = `tailwind-source:${filePath}`;
		const previous = this.pending.get(key);
		if (previous) {
			clearTimeout(previous);
		}
		this.pending.set(
			key,
			setTimeout(() => {
				this.pending.delete(key);
				void this.emitTailwindSource(projectRoot, filePath);
			}, this.debounceMs),
		);
	}

	private async emitTailwindSource(projectRoot: string, filePath: string) {
		if (this.projectRoot !== projectRoot) {
			return;
		}
		const file = path.relative(projectRoot, filePath).split(path.sep).join("/");
		let event: TrickroomFileEvent;
		try {
			event = {
				file,
				kind: "tailwind-source",
				revision: toRevision(await readFile(filePath)),
				operation: "changed",
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				return;
			}
			event = {
				file,
				kind: "tailwind-source",
				revision: null,
				operation: "deleted",
			};
		}
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private schedule(filePath: string) {
		const projectRoot = this.projectRoot;
		if (!projectRoot) {
			return;
		}

		const relativeFile = normalizeRelativeFile(projectRoot, filePath);
		const watched = classifyTrickroomFile(relativeFile);
		if (!watched) {
			return;
		}
		if (watched.kind === "design") {
			this.scheduleDesign(
				projectRoot,
				watched.designId,
				watched.boardId === null ? [] : [watched.boardId],
				{ changedAt: Date.now() },
			);
			return;
		}

		const previous = this.pending.get(relativeFile);
		if (previous) {
			clearTimeout(previous);
		}

		this.pending.set(
			relativeFile,
			setTimeout(() => {
				this.pending.delete(relativeFile);
				void this.emitSettledFile(projectRoot, relativeFile);
			}, this.debounceMs),
		);
	}

	/**
	 * Collects changes to one design's files into one event, emitted once its
	 * files settle (no change for `debounceMs`) or, during a steady stream of
	 * changes, once the batch is `maxWaitMs` old, and only when no journaled
	 * write is in progress, so listeners never see half of a multi-file write.
	 */
	private scheduleDesign(
		projectRoot: string,
		designId: string,
		boardIds: Iterable<string>,
		{ delayMs, changedAt }: { delayMs?: number; changedAt?: number } = {},
	) {
		const pending = this.pendingDesigns.get(designId);
		if (pending) {
			clearTimeout(pending.timer);
		}
		const batch = pending?.boardIds ?? new Set<string>();
		for (const boardId of boardIds) {
			batch.add(boardId);
		}
		const since = pending?.since ?? Date.now();
		const lastChangeAt = Math.max(pending?.lastChangeAt ?? 0, changedAt ?? 0);
		const wait =
			delayMs ??
			Math.max(
				0,
				Math.min(this.debounceMs, since + this.maxWaitMs - Date.now()),
			);
		const entry: PendingDesign = {
			boardIds: batch,
			since,
			lastChangeAt,
			timer: setTimeout(() => {
				if (this.pendingDesigns.get(designId) === entry) {
					this.pendingDesigns.delete(designId);
				}
				this.queueDesignEvent(projectRoot, designId, batch, {
					lastChangeAt,
					unsettled: Date.now() - lastChangeAt < this.settleMs,
				});
			}, wait),
		};
		this.pendingDesigns.set(designId, entry);
	}

	/** Runs a design's events one at a time, in the order they were due. */
	private queueDesignEvent(
		projectRoot: string,
		designId: string,
		boardIds: Set<string>,
		options: DesignEventTiming,
	) {
		const previous = this.emittingDesigns.get(designId) ?? Promise.resolve();
		const next = previous
			.then(() =>
				this.emitSettledDesign(projectRoot, designId, boardIds, options),
			)
			.catch(() => undefined)
			.finally(() => {
				if (this.emittingDesigns.get(designId) === next) {
					this.emittingDesigns.delete(designId);
				}
			});
		this.emittingDesigns.set(designId, next);
	}

	private async emitSettledDesign(
		projectRoot: string,
		designId: string,
		boardIds: Set<string>,
		{ lastChangeAt, unsettled }: DesignEventTiming,
	) {
		if (this.projectRoot !== projectRoot) {
			return;
		}
		// A read before the files settled is followed by one more once they
		// have: a write landing right after it may not announce itself again
		// (see WATCHER_REPEAT_WINDOW_MS). Repeats of a revision are dropped.
		const followUp = () => {
			if (unsettled && !this.pendingDesigns.has(designId)) {
				this.scheduleDesign(projectRoot, designId, [], {
					delayMs: this.settleMs,
				});
			}
		};
		const service = createDesignFileService(projectRoot, {
			...(this.trickroomHome ? { trickroomHome: this.trickroomHome } : {}),
		});
		let paths: ReturnType<typeof service.getDesignPaths>;
		try {
			paths = service.getDesignPaths(designId);
		} catch {
			this.pendingDesigns.delete(designId);
			return;
		}
		if ((await inspectDesignStorage(paths)).journal) {
			// A multi-file write is still being applied; wait for it.
			this.scheduleDesign(projectRoot, designId, boardIds, {
				delayMs: this.debounceMs,
				changedAt: lastChangeAt,
			});
			return;
		}

		const known = this.knownDesigns.get(designId);
		const previous = known?.boards;
		let event: TrickroomFileEvent;
		try {
			const read = await service.readDesignFile(designId);
			const current = new Map(
				read.boards.map((board) => [board.id, board.revision]),
			);
			const candidates = previous
				? new Set([...previous.keys(), ...current.keys(), ...boardIds])
				: read.layout === "legacy"
					? new Set(current.keys())
					: boardIds;
			const boards = [...candidates]
				.filter((id) => !previous || previous.get(id) !== current.get(id))
				.map((id) => ({ id, revision: current.get(id) ?? null }));
			if (known?.revision === read.revision) {
				// Late file events from a write that was already reported.
				followUp();
				return;
			}
			this.deletedDesigns.delete(designId);
			this.knownDesigns.set(designId, {
				revision: read.revision,
				boards: current,
			});
			event = {
				file: `designs/${designId}`,
				designId,
				revision: read.revision,
				operation: "changed",
				boards,
				state: {
					manifest: calculateManifestRevision(read.design),
					boards: read.boards.map(({ id, revision }) => ({ id, revision })),
				},
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				if (this.deletedDesigns.has(designId)) {
					// Late file events from a deletion that was already reported.
					return;
				}
				this.knownDesigns.delete(designId);
				this.deletedDesigns.add(designId);
				event = {
					file: `designs/${designId}`,
					designId,
					revision: null,
					operation: "deleted",
					boards: [...(previous?.keys() ?? [])].map((id) => ({
						id,
						revision: null,
					})),
				};
			} else {
				if (unsettled) {
					// Possibly a file still being written by a tool that does not
					// replace files atomically: look again once it settles.
					followUp();
					return;
				}
				// A design that cannot be read still changed; report the
				// revision of its stored bytes.
				this.knownDesigns.delete(designId);
				this.deletedDesigns.delete(designId);
				const raw = await service.readRawDesign(designId).catch(() => null);
				if (!raw || this.projectRoot !== projectRoot) {
					return;
				}
				event = {
					file: `designs/${designId}`,
					designId,
					revision: raw.revision,
					operation: "changed",
					boards: [],
				};
			}
		}

		if (this.projectRoot !== projectRoot) {
			return;
		}
		for (const listener of this.listeners) {
			listener(event);
		}
		followUp();
	}

	private async emitSettledFile(projectRoot: string, relativeFile: string) {
		if (this.projectRoot !== projectRoot) {
			return;
		}

		const filePath = path.join(projectRoot, ".trickroom", relativeFile);
		let event: TrickroomFileEvent;
		try {
			const contents = await readFile(filePath);
			event = {
				file: relativeFile,
				revision: toRevision(contents),
				operation: "changed",
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				return;
			}
			event = { file: relativeFile, revision: null, operation: "deleted" };
		}

		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private async stopWatcher() {
		this.watcherGeneration += 1;
		await this.closeWatcher();
	}

	private async closeWatcher() {
		const watcher = this.watcher;
		this.watcher = null;
		if (watcher) {
			await watcher.close();
		}
		this.unsubscribeSources?.();
		this.unsubscribeSources = null;
		const sourceWatcher = this.sourceWatcher;
		this.sourceWatcher = null;
		if (sourceWatcher) {
			await sourceWatcher.close();
		}
		const ancestorWatcher = this.ancestorWatcher;
		this.ancestorWatcher = null;
		if (ancestorWatcher) {
			await ancestorWatcher.close();
		}

		for (const timer of this.pending.values()) {
			clearTimeout(timer);
		}
		this.pending.clear();
		for (const pending of this.pendingDesigns.values()) {
			clearTimeout(pending.timer);
		}
		this.pendingDesigns.clear();
	}
}
