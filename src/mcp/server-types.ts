import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrickroomProjectContext } from "../project";
import type { ScreenshotRequest, ScreenshotResult } from "../screenshot/types";
import type {
	getEditorContext,
	requestEditorFocus,
} from "../services/editor-channel";
import type { TrickroomMcpProjectResolver } from "./project-resolver";

export type TrickroomMcpServerContext = TrickroomProjectContext & {
	trickroomHome?: string;
	locationId?: string;
};

export type TrickroomMcpServerOptions = {
	trickroomHome?: string;
	projectResolver?: TrickroomMcpProjectResolver;
	screenshotCapture?: (
		context: TrickroomMcpServerContext,
		request: ScreenshotRequest,
	) => Promise<ScreenshotResult>;
	/**
	 * Append every tool call to the call log; defaults to
	 * TRICKROOM_MCP_CALL_LOG, then mcp.callLog in settings.json.
	 */
	callLog?: boolean;
	/** The editor channel; tests replace it to fake a browser tab. */
	editorChannel?: {
		getEditorContext: typeof getEditorContext;
		requestEditorFocus: typeof requestEditorFocus;
	};
};

export type TrickroomMcpServer = McpServer & {
	getActiveContextSnapshot: () => TrickroomMcpServerContext | null;
	stopMcpToolGroupControls?: () => void;
	stopScreenshotHosts?: () => Promise<void>;
	/** Resolves once queued call log lines are written. */
	flushCallLog?: () => Promise<void>;
};
