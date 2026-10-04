import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TrickroomProjectContext } from "../project";
import type { ScreenshotRequest, ScreenshotResult } from "../screenshot/types";
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
};

export type TrickroomMcpServer = McpServer & {
	getActiveContextSnapshot: () => TrickroomMcpServerContext | null;
	stopMcpToolGroupControls?: () => void;
	stopScreenshotHosts?: () => Promise<void>;
};
