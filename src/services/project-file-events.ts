import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";

export type TrickroomFileEvent = {
	file: string;
	revision: `sha256:${string}` | null;
	operation: "changed" | "deleted";
};

export type TrickroomFileEventListener = (event: TrickroomFileEvent) => void;

const DEFAULT_DEBOUNCE_MS = 75;

const toRevision = (contents: Buffer): `sha256:${string}` =>
	`sha256:${createHash("sha256").update(contents).digest("hex")}`;

const normalizeRelativeFile = (projectRoot: string, filePath: string) =>
	path
		.relative(path.join(projectRoot, ".trickroom"), filePath)
		.split(path.sep)
		.join("/");

export const isWatchedTrickroomFile = (relativeFile: string) => {
	if (/^designs\/[^/]+\.json$/.test(relativeFile)) {
		return true;
	}

	return relativeFile.startsWith("systems/");
};

export class ProjectFileEvents {
	private readonly listeners = new Set<TrickroomFileEventListener>();
	private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();
	private watcher: FSWatcher | null = null;
	private projectRoot: string | null = null;
	private watcherGeneration = 0;
	private readonly debounceMs: number;

	constructor(debounceMs = DEFAULT_DEBOUNCE_MS) {
		this.debounceMs = debounceMs;
	}

	setProjectRoot(projectRoot: string | null) {
		const normalizedRoot = projectRoot ? path.resolve(projectRoot) : null;
		if (this.projectRoot === normalizedRoot) {
			return;
		}

		this.projectRoot = normalizedRoot;
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
		if (!isWatchedTrickroomFile(relativeFile)) {
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
	}
}
