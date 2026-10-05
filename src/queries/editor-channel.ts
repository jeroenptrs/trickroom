import type {
	EditorContextReport,
	EditorFocusAck,
	EditorFocusEvent,
} from "../services/editor-channel.types";

// Browser side of the editor channel: the tab's identity and the requests it
// sends. The server learns which tabs exist from their SSE streams.

const createClientId = () =>
	typeof crypto.randomUUID === "function"
		? crypto.randomUUID()
		: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Identifies this tab for the lifetime of the page. Kept in memory rather than
 * sessionStorage, which a duplicated tab would copy.
 */
export const editorClientId = createClientId();

export const getProjectEventsUrl = () =>
	`/api/trickroom/events?clientId=${encodeURIComponent(editorClientId)}`;

const createSignal = <T>() => {
	const listeners = new Set<(value: T) => void>();
	return {
		emit(value: T) {
			for (const listener of listeners) {
				listener(value);
			}
		},
		subscribe(listener: (value: T) => void) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
};

/** The project SSE stream (re)connected: the server sees a new presence. */
export const editorChannelReady = createSignal<void>();
/** The server asked this tab to show a design, board or layer. */
export const editorFocusRequests = createSignal<EditorFocusEvent>();

const isNullableString = (value: unknown): value is string | null =>
	value === null || typeof value === "string";

/** Reads a `focus` SSE payload; null when it is malformed. */
export const parseEditorFocusEvent = (
	data: string,
): EditorFocusEvent | null => {
	let value: unknown;
	try {
		value = JSON.parse(data);
	} catch {
		return null;
	}
	if (
		typeof value !== "object" ||
		value === null ||
		!("requestId" in value) ||
		!("designFileId" in value) ||
		typeof value.requestId !== "string" ||
		typeof value.designFileId !== "string"
	) {
		return null;
	}
	const field = (key: string) => {
		const entry: unknown = Reflect.get(value, key);
		return isNullableString(entry) ? entry : null;
	};
	return {
		requestId: value.requestId,
		designFileId: value.designFileId,
		boardId: field("boardId"),
		elementId: field("elementId"),
		projectId: field("projectId"),
	};
};

export const postEditorContext = (report: EditorContextReport) =>
	fetch("/api/trickroom/editor-context", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(report),
		// Lets the last report before the tab is hidden or closed still land.
		keepalive: true,
	}).then(
		(response) => response.ok,
		() => false,
	);

export const postEditorFocusAck = (ack: Omit<EditorFocusAck, "clientId">) =>
	fetch("/api/trickroom/editor-focus/ack", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ ...ack, clientId: editorClientId }),
	}).then(
		(response) => response.ok,
		() => false,
	);
