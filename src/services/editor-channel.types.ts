// Shapes shared by the browser tabs, the HTTP server and local clients (the MCP
// server) of the editor channel. Nothing here is persisted.

export type EditorStageMode = "canvas" | "responsive";

/** What a browser tab reports about itself, `POST /api/trickroom/editor-context`. */
export type EditorContextReport = {
	clientId: string;
	/** `projectId` of the project the tab is showing, or null on the home screen. */
	projectId: string | null;
	/** Design id (the design route's uuid), or null outside a design. */
	designFileId: string | null;
	activeBoardId: string | null;
	selectedId: string | null;
	stageMode: EditorStageMode | null;
	responsiveWidth: number | null;
	/** When the tab last gained focus or became visible, epoch ms on the tab's clock. */
	focusedAt: number | null;
	visible: boolean;
	/** When the tab sent the report, epoch ms on the tab's clock. */
	sentAt: number;
};

/** One connected tab, as returned by `GET /api/trickroom/editor-context`. */
export type EditorClientContext = {
	clientId: string;
	projectId: string | null;
	designFileId: string | null;
	activeBoardId: string | null;
	selectedId: string | null;
	stageMode: EditorStageMode | null;
	responsiveWidth: number | null;
	visible: boolean;
	/** ISO time on the server clock, corrected for the tab's clock offset. */
	focusedAt: string | null;
	/** ISO time the server received the latest report. */
	reportedAt: string;
	/** Milliseconds since the latest report. */
	ageMs: number;
};

export type EditorContextResponse = {
	/** The server's active project. */
	projectId: string | null;
	clients: EditorClientContext[];
	mostRecentlyFocusedClientId: string | null;
};

/** What to show: a design, optionally a board and a layer in it. */
export type EditorFocusTarget = {
	designFileId: string;
	boardId: string | null;
	elementId: string | null;
};

/** `POST /api/trickroom/editor-focus` body. */
export type EditorFocusRequest = EditorFocusTarget & {
	/** Target tab; defaults to the most recently focused tab on the project. */
	clientId?: string | null;
	/** Project the target belongs to; defaults to the server's active project. */
	projectId?: string | null;
};

/** Payload of the `focus` SSE event sent to one tab. */
export type EditorFocusEvent = EditorFocusTarget & {
	requestId: string;
	projectId: string | null;
};

/**
 * How the tab handled a focus request: `revealed` in the open design,
 * `navigated` to another design, or `queued` until the hidden tab is shown.
 */
export type EditorFocusOutcome = "revealed" | "navigated" | "queued";

/** `POST /api/trickroom/editor-focus/ack` body, sent by the tab. */
export type EditorFocusAck = {
	clientId: string;
	requestId: string;
	status: "ok" | "blocked_dirty" | "browser_on_other_project";
	outcome: EditorFocusOutcome | null;
};

export type EditorFocusStatus =
	| "ok"
	| "no_browser"
	| "browser_on_other_project"
	| "blocked_dirty"
	| "stale";

export type EditorFocusResponse = {
	status: EditorFocusStatus;
	clientId: string | null;
	requestId: string | null;
	outcome: EditorFocusOutcome | null;
	message: string | null;
};
