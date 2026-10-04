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
