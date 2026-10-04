import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { createDesignFileService } from "./design-file-service";
import { inspectDesignStorage } from "./design-storage";

export type TrickroomFileEvent = {
	/**
	 * What changed, relative to `.trickroom`. Design events name the design,
	 * `designs/<id>`, whatever files of it changed.
	 */
	file: string;
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
};

export type TrickroomFileEventListener = (event: TrickroomFileEvent) => void;

const DEFAULT_DEBOUNCE_MS = 75;

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
 * are design changes, batched per design; memory files and system files are
 * reported as files. Temporary files and saved conflicts are ignored.
 */
export const classifyTrickroomFile = (
	relativeFile: string,
): WatchedFile | null => {
	if (relativeFile.startsWith("systems/")) {
		return { kind: "file" };
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

type PendingDesign = {
	timer: ReturnType<typeof setTimeout>;
	boardIds: Set<string>;
};

export class ProjectFileEvents {
	private readonly listeners = new Set<TrickroomFileEventListener>();
	private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
	private readonly pendingDesigns = new Map<string, PendingDesign>();
	/**
	 * Each design's revision and board revisions at its last event, to tell
	 * which boards changed and to drop repeats of the same state.
	 */
	private readonly knownDesigns = new Map<
		string,
		{ revision: string; boards: Map<string, string> }
	>();
	private watcher: FSWatcher | null = null;
	private projectRoot: string | null = null;
	private watcherGeneration = 0;
	private readonly debounceMs: number;
	private readonly trickroomHome: string | undefined;

	constructor(
		debounceMs = DEFAULT_DEBOUNCE_MS,
		options: { trickroomHome?: string } = {},
	) {
		this.debounceMs = debounceMs;
		this.trickroomHome = options.trickroomHome;
	}

	setProjectRoot(projectRoot: string | null) {
		const normalizedRoot = projectRoot ? path.resolve(projectRoot) : null;
		if (this.projectRoot === normalizedRoot) {
			return;
		}

		this.projectRoot = normalizedRoot;
		this.knownDesigns.clear();
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
		const watcher = chokidar.watch(watchedRoot, {
			ignoreInitial: true,
			awaitWriteFinish: {
				stabilityThreshold: this.debounceMs,
				pollInterval: Math.max(10, Math.floor(this.debounceMs / 3)),
			},
		});
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
			this.scheduleDesign(projectRoot, watched.designId, watched.boardId);
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
	 * files settle and no journaled write is in progress, so listeners never
	 * see half of a multi-file write.
	 */
	private scheduleDesign(
		projectRoot: string,
		designId: string,
		boardId: string | null,
	) {
		const pending = this.pendingDesigns.get(designId);
		if (pending) {
			clearTimeout(pending.timer);
		}
		const boardIds = pending?.boardIds ?? new Set<string>();
		if (boardId !== null) {
			boardIds.add(boardId);
		}
		this.pendingDesigns.set(designId, {
			boardIds,
			timer: setTimeout(() => {
				void this.emitSettledDesign(projectRoot, designId, boardIds);
			}, this.debounceMs),
		});
	}

	private async emitSettledDesign(
		projectRoot: string,
		designId: string,
		boardIds: Set<string>,
	) {
		if (this.projectRoot !== projectRoot) {
			return;
		}
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
			this.scheduleDesign(projectRoot, designId, null);
			return;
		}
		if (this.pendingDesigns.get(designId)?.boardIds === boardIds) {
			this.pendingDesigns.delete(designId);
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
				return;
			}
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
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				this.knownDesigns.delete(designId);
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
				// A design that cannot be read still changed; report the
				// revision of its stored bytes.
				this.knownDesigns.delete(designId);
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
