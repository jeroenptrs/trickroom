import type { EditorContextReport } from "../services/editor-channel.types";

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

/** Events from the project SSE stream that editor-channel code listens to. */
export const editorChannelEvents = new EventTarget();
export const editorChannelReadyEvent = "ready";

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
