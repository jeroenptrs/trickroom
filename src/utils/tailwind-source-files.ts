/**
 * The stylesheet files the server's Tailwind caches have read (entry CSS and
 * every file it imports), by absolute path, so the project file watcher can
 * report edits to a system's CSS that live outside `.trickroom`. The caches
 * already re-read changed files on the next use; the events let open
 * editors ask again.
 */

import { isMainThread } from "node:worker_threads";

type Listener = (files: readonly string[]) => void;

const files = new Set<string>();
const listeners = new Set<Listener>();

/**
 * Records files a load is about to read; listeners hear about the ones not
 * seen before. A no-op in a worker thread (the canonicalization worker
 * loads through the same loader): nothing watches there, and the main
 * thread records the same files when the canvas, codegen or lint load them.
 */
export const recordTailwindSourceFiles = (paths: Iterable<string>) => {
	if (!isMainThread) return;
	const added: string[] = [];
	for (const filePath of paths) {
		if (!files.has(filePath)) {
			files.add(filePath);
			added.push(filePath);
		}
	}
	if (added.length === 0) return;
	for (const listener of listeners) listener(added);
};

export const getTailwindSourceFiles = (): string[] => [...files];

export const subscribeTailwindSourceFiles = (listener: Listener) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
