import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TRICKROOM_VERSION } from "../app-state/version";
import { isMcpEnabled, TrickroomProjectConfigError } from "../project";
import { registerTrickroomPrompts } from "./prompts";
import { registerDesignResourceHandlers } from "./resource-handlers";
import { TRICKROOM_MCP_SERVER_INSTRUCTIONS } from "./server-instructions";
import type {
	TrickroomMcpServer,
	TrickroomMcpServerContext,
	TrickroomMcpServerOptions,
} from "./server-types";
import {
	installMcpToolGroupControls,
	type McpToolControl,
} from "./tool-group-controls";
import { createMcpToolContext } from "./tools/context";
import {
	registerDesignExportTools,
	registerDesignReadTools,
} from "./tools/design-read";
import { registerDesignSystemTools } from "./tools/design-systems";
import { registerDesignValidationTools } from "./tools/design-validation";
import {
	registerDesignApplyTool,
	registerDesignCreateTool,
} from "./tools/design-write-batch";
import { registerEditorTools } from "./tools/editor";
import { registerFeedbackTools } from "./tools/feedback";
import { registerGuideTools } from "./tools/guide";
import { installToolInputValidation } from "./tools/input-validation";
import { registerLintTools } from "./tools/lint";
import { registerMemoryTools } from "./tools/memory";
import { registerProjectTools } from "./tools/projects";
import { registerScreenshotTools } from "./tools/screenshots";
import { registerSystemComponentTools } from "./tools/system-components";

export type {
	TrickroomMcpServer,
	TrickroomMcpServerContext,
	TrickroomMcpServerOptions,
} from "./server-types";
export {
	addSubtreeOptionsSchema,
	proposedElementNodeSchema,
	proposedRecipeNodeSchema,
	proposedSubtreeNodeSchema,
	validateCopySubtreeOptionsSchema,
} from "./subtree-schemas";
export { projectRefSchema } from "./tools/schemas";

export const createTrickroomMcpServer = (
	initialContext: TrickroomMcpServerContext | null,
	options: TrickroomMcpServerOptions = {},
): TrickroomMcpServer => {
	if (initialContext && !isMcpEnabled(initialContext.config)) {
		throw new TrickroomProjectConfigError(
			"MCP_DISABLED",
			`MCP is disabled for project ${initialContext.config.name}.`,
		);
	}

	const server = new McpServer(
		{
			name: "trickroom",
			version: TRICKROOM_VERSION,
		},
		{
			capabilities: {
				tools: {},
				prompts: {},
				resources: { listChanged: true },
			},
			instructions: TRICKROOM_MCP_SERVER_INSTRUCTIONS,
		},
	) as TrickroomMcpServer;
	installToolInputValidation(server);

	const mcpToolControls = new Map<string, McpToolControl>();
	const registerMcpTool = server.registerTool.bind(server);
	server.registerTool = ((name, config, handler) => {
		const registered = registerMcpTool(name, config, handler);
		mcpToolControls.set(name, {
			enable: () => registered.enable(),
			disable: () => registered.disable(),
		});
		return registered;
	}) as typeof server.registerTool;

	const ctx = createMcpToolContext(server, initialContext, options);
	server.getActiveContextSnapshot = () => ctx.getSelectedContext();
	server.flushCallLog = ctx.flushCallLog;

	registerDesignResourceHandlers(ctx);
	registerTrickroomPrompts(server);

	// tools/list reports tools in registration order, which is TOOL_NAMES
	// order (src/mcp/tool-names.ts): projects, guide, designs (with lint),
	// editor, memory, design systems, components, feedback.
	registerProjectTools(ctx);
	registerGuideTools(ctx);
	registerDesignReadTools(ctx);
	registerDesignApplyTool(ctx);
	registerDesignValidationTools(ctx);
	registerLintTools(ctx);
	registerDesignCreateTool(ctx);
	registerDesignExportTools(ctx, registerScreenshotTools(ctx));
	registerEditorTools(ctx);
	registerMemoryTools(ctx);
	registerDesignSystemTools(ctx);
	registerSystemComponentTools(ctx);
	registerFeedbackTools(ctx);

	const { trickroomHome, captureHosts } = ctx;
	if (trickroomHome) {
		server.stopMcpToolGroupControls = installMcpToolGroupControls({
			trickroomHome,
			toolControls: mcpToolControls,
			server,
		});
	}
	server.stopScreenshotHosts = () => captureHosts.close();

	return server;
};
