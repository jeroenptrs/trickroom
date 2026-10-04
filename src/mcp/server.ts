import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
	registerDesignFileReadTools,
	registerDesignTreeReadTools,
} from "./tools/design-read";
import {
	registerDesignSystemReadTools,
	registerResourceUsageTools,
	registerSystemResourceManifestTools,
} from "./tools/design-systems";
import { registerDesignValidationTools } from "./tools/design-validation";
import { registerDesignBatchWriteTools } from "./tools/design-write-batch";
import {
	registerDesignNodeEditTools,
	registerDesignNodeInsertTools,
} from "./tools/design-write-nodes";
import { installToolInputValidation } from "./tools/input-validation";
import { registerMemoryTools } from "./tools/memory";
import { registerProjectTools } from "./tools/projects";
import { registerRegistryTools } from "./tools/registry";
import { registerScreenshotTools } from "./tools/screenshots";
import {
	registerSystemComponentDraftTools,
	registerSystemComponentMigrationTools,
	registerSystemComponentReadTools,
} from "./tools/system-components";

export {
	applyDesignOperationsPayload,
	validateCopySubtreePayload,
	validateOperationPlanPayload,
	validateSubtreePayload,
} from "./payloads/design-validation";
export type {
	TrickroomMcpServer,
	TrickroomMcpServerContext,
	TrickroomMcpServerOptions,
} from "./server-types";
export {
	addSubtreeOptionsSchema,
	addSubtreePayloadSchema,
	proposedElementNodeSchema,
	proposedRecipeNodeSchema,
	proposedSubtreeNodeSchema,
	validateCopySubtreeOptionsSchema,
	validateCopySubtreePayloadSchema,
	validateSubtreeOptionsSchema,
	validateSubtreePayloadSchema,
} from "./tools/operation-schemas";
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
			version: "0.1.0",
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

	registerDesignResourceHandlers(ctx);
	registerTrickroomPrompts(server);

	// tools/list reports tools in registration order, so groups that were
	// historically interleaved register in several slices to keep that order.
	registerProjectTools(ctx);
	registerDesignFileReadTools(ctx);
	registerScreenshotTools(ctx);
	registerDesignTreeReadTools(ctx);
	registerDesignValidationTools(ctx);
	registerRegistryTools(ctx);
	registerDesignSystemReadTools(ctx);
	registerSystemComponentReadTools(ctx);
	registerResourceUsageTools(ctx);
	registerSystemComponentDraftTools(ctx);
	registerSystemResourceManifestTools(ctx);
	registerMemoryTools(ctx);
	registerDesignBatchWriteTools(ctx);
	registerDesignNodeInsertTools(ctx);
	registerSystemComponentMigrationTools(ctx);
	registerDesignNodeEditTools(ctx);

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
