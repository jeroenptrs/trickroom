/**
 * The stylesheet files the server's Tailwind caches have read (entry CSS and
 * every file it imports), by absolute path, so the project file watcher can
 * report edits to a system's CSS that live outside `.trickroom`. The caches
 * already re-read changed files on the next use; the events let open
 * editors ask again.
 */

type Listener = (files: readonly string[]) => void;

const files = new Set<string>();
const listeners = new Set<Listener>();

/** Records files a load read; listeners hear about the ones not seen before. */
export const recordTailwindSourceFiles = (paths: Iterable<string>) => {
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
