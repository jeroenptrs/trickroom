import type {
	AnnotationContainer,
	AnnotationFileEvent,
} from "../services/annotations.types";

// Routes `annotation` events from `/api/trickroom/events` to the editor
// that has the annotations of that design (or component) loaded, and asks
// it to compare with the store again after the stream reconnects.

type Listener<T> = (value: T) => void;

const eventListeners = new Set<Listener<AnnotationFileEvent>>();
const resyncListeners = new Set<Listener<void>>();

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
