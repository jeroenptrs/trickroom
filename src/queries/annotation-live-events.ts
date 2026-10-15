import type {
	AnnotationContainer,
	AnnotationFileEvent,
	AnnotationRoundFileEvent,
	AnnotationScope,
} from "../services/annotations.types";

// Routes `annotation` events from `/api/trickroom/events` to the editor
// that has the annotations of that design (or component) loaded, and asks
// it to compare with the store again after the stream reconnects. The
// checkout's scope travels the same way: `annotation-scope` events (another
// branch checked out), the `scope` of read answers and `SCOPE_CHANGED`
// refusals all reach `subscribeAnnotationScope`. `annotation-round` events
// (a round file changed) reach `subscribeAnnotationRound`.

type Listener<T> = (value: T) => void;

const eventListeners = new Set<Listener<AnnotationFileEvent>>();
const resyncListeners = new Set<Listener<void>>();
const scopeListeners = new Set<Listener<AnnotationScope>>();
const roundListeners = new Set<Listener<AnnotationRoundFileEvent>>();

/** A well-formed `{ branch, worktreePath }`, or null. */
export const parseAnnotationScope = (
	value: unknown,
): AnnotationScope | null => {
	if (typeof value !== "object" || value === null) return null;
	const scope = value as Record<string, unknown>;
	return typeof scope.branch === "string" &&
		typeof scope.worktreePath === "string"
		? { branch: scope.branch, worktreePath: scope.worktreePath }
		: null;
};

const isContainer = (value: unknown): value is AnnotationContainer => {
	if (typeof value !== "object" || value === null) return false;
	const container = value as Record<string, unknown>;
	return container.kind === "design"
		? typeof container.designId === "string"
		: container.kind === "component" &&
				typeof container.systemId === "string" &&
				typeof container.componentId === "string";
};

/** The `data` of an `annotation` SSE frame, or null when it is malformed. */
export const parseAnnotationFileEvent = (
	data: string,
): AnnotationFileEvent | null => {
	let value: unknown;
	try {
		value = JSON.parse(data);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	const event = value as Record<string, unknown>;
	if (
		typeof event.annotationId !== "string" ||
		!isContainer(event.container) ||
		(event.operation !== "changed" && event.operation !== "deleted") ||
		(event.revision !== null && typeof event.revision !== "string")
	) {
		return null;
	}
	return {
		annotationId: event.annotationId,
		container: event.container,
		operation: event.operation,
		revision: event.revision,
	};
};

export const subscribeAnnotationEvents = (
	listener: Listener<AnnotationFileEvent>,
) => {
	eventListeners.add(listener);
	return () => {
		eventListeners.delete(listener);
	};
};

export const deliverAnnotationEvent = (event: AnnotationFileEvent) => {
	for (const listener of eventListeners) listener(event);
};

/** Registers for "the stream reconnected; events may have been missed". */
export const subscribeAnnotationResync = (listener: Listener<void>) => {
	resyncListeners.add(listener);
	return () => {
		resyncListeners.delete(listener);
	};
};

export const requestAnnotationResync = () => {
	for (const listener of resyncListeners) listener();
};

/** Registers for the checkout scope the server reports (it may be the one held). */
export const subscribeAnnotationScope = (
	listener: Listener<AnnotationScope>,
) => {
	scopeListeners.add(listener);
	return () => {
		scopeListeners.delete(listener);
	};
};

export const deliverAnnotationScope = (scope: AnnotationScope) => {
	for (const listener of scopeListeners) listener(scope);
};

/** The `data` of an `annotation-round` SSE frame, or null when it is malformed. */
export const parseAnnotationRoundEvent = (
	data: string,
): AnnotationRoundFileEvent | null => {
	let value: unknown;
	try {
		value = JSON.parse(data);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null) return null;
	const event = value as Record<string, unknown>;
	if (typeof event.roundId !== "string" || !isContainer(event.container)) {
		return null;
	}
	return { roundId: event.roundId, container: event.container };
};

/** Registers for round file changes (a send, a close) of any container. */
export const subscribeAnnotationRound = (
	listener: Listener<AnnotationRoundFileEvent>,
) => {
	roundListeners.add(listener);
	return () => {
		roundListeners.delete(listener);
	};
};

export const deliverAnnotationRoundEvent = (
	event: AnnotationRoundFileEvent,
) => {
	for (const listener of roundListeners) listener(event);
};
