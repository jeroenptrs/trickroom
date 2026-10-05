import type { TrickroomFileEvent } from "../hooks/useProjectFileEvents";

// Routes design change events to the editor that has the design open, which
// reloads only the parts that changed instead of refetching the design.

type Listener<T> = (value: T) => void;

const eventListeners = new Map<string, Set<Listener<TrickroomFileEvent>>>();
const resyncListeners = new Map<string, Set<Listener<void>>>();

const subscribeTo = <T>(
	registry: Map<string, Set<Listener<T>>>,
	designId: string,
	listener: Listener<T>,
) => {
	const listeners = registry.get(designId) ?? new Set();
	listeners.add(listener);
	registry.set(designId, listeners);
	return () => {
		listeners.delete(listener);
		if (listeners.size === 0) registry.delete(designId);
	};
};

/** Registers the open editor of a design for its change events. */
export const subscribeDesignEvents = (
	designId: string,
	listener: Listener<TrickroomFileEvent>,
) => subscribeTo(eventListeners, designId, listener);

/**
 * Hands a design change event to the open editor of that design. Returns
 * false when no editor has it open (the caller then refetches the design).
 */
export const deliverDesignEvent = (event: TrickroomFileEvent) => {
	const listeners =
		event.designId !== undefined ? eventListeners.get(event.designId) : null;
	if (!listeners || listeners.size === 0) {
		return false;
	}
	for (const listener of listeners) listener(event);
	return true;
};

/** Registers the open editor of a design for resync requests. */
export const subscribeDesignResync = (
	designId: string,
	listener: Listener<void>,
) => subscribeTo(resyncListeners, designId, listener);

/** Asks the open editor of a design to compare itself with the disk again. */
export const requestDesignResync = (designId: string) => {
	for (const listener of resyncListeners.get(designId) ?? []) listener();
};
