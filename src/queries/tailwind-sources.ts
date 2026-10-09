import { useSyncExternalStore } from "react";

/**
 * Bumped whenever a stylesheet a system's Tailwind CSS reads changes on disk
 * (a `tailwind-source` file event), so compiled canvas styles rebuild even
 * when the rendered classes did not change.
 */
let revision = 0;
const listeners = new Set<() => void>();

export const bumpTailwindSourceRevision = () => {
	revision += 1;
	for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const getTailwindSourceRevision = () => revision;

export const useTailwindSourceRevision = () =>
	useSyncExternalStore(
		subscribe,
		getTailwindSourceRevision,
		getTailwindSourceRevision,
	);
