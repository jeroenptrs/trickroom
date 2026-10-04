import { z } from "zod";
import { readProjectRegistry } from "../../app-state/project-registry";
import { getProjectDetails } from "../payloads/project";
import { TrickroomMcpProjectResolverError } from "../project-resolver";
import { readOnlyClosedWorldAnnotations } from "./annotations";
import type { McpToolContext } from "./context";
import {
	createJsonResult,
	createProjectInfoResult,
	createProjectResolverErrorResult,
} from "./results";
import { projectScopedInputSchema } from "./schemas";

export const registerProjectTools = (ctx: McpToolContext) => {
	const {
		server,
		trickroomHome,
		projectResolver,
		notifyResourceListChanged,
		registerProjectFromPath,
		selectProjectFromRef,
		createGetSelectedProjectResult,
		withPolicyErrorHandling,
	} = ctx;

	server.registerTool(
		"listProjects",
		{
			title: "List Projects",
			description:
				"List projects registered in Trickroom app state with stable project and local location references. `activeProjectId` and `activeLocationId` are registry app-state values (not the MCP session selection).",
			annotations: readOnlyClosedWorldAnnotations,
		},
		async () => {
			const registry = await readProjectRegistry(trickroomHome);
			return createJsonResult({
				activeProjectId: registry.lastActiveProjectId ?? null,
				activeLocationId: registry.lastActiveLocationId ?? null,
				projects: registry.locations.map((location) => ({
					projectId: location.projectId,
					locationId: location.locationId,
					projectRoot: location.root,
					name: location.name,
					lastOpenedAt: location.lastOpenedAt,
					active: location.locationId === registry.lastActiveLocationId,
				})),
			});
		},
	);

	server.registerTool(
		"registerProject",
		{
			title: "Register Project",
			description:
				"Register a local Trickroom project path in app state without changing session selection.",
			inputSchema: {
				path: z.string().min(1).describe("Local project root path to open."),
			},
			annotations: {
				readOnlyHint: false,
				openWorldHint: false,
				idempotentHint: true,
			},
		},
		async ({ path: projectPath }) => {
			const { context, isRegistryActive } =
				await registerProjectFromPath(projectPath);
			await notifyResourceListChanged();
			return createJsonResult({
				project: getProjectDetails(context),
				selected: false,
				active: isRegistryActive,
				migration:
					"Use registerProject(path) and selectProject({ projectId | locationId }) to switch the MCP session project.",
			});
		},
	);

	server.registerTool(
		"selectProject",
		{
			title: "Select Project",
			description: "Select a registered project for MCP session-scoped tools.",
			inputSchema: {
				locationId: z
					.string()
					.min(1)
					.optional()
					.describe("Local Trickroom project location ID."),
				projectId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Stable Trickroom project ID. Ambiguous IDs require locationId.",
					),
			},
			annotations: {
				readOnlyHint: false,
				openWorldHint: false,
				idempotentHint: true,
			},
		},
		async ({ locationId, projectId }) => {
			try {
				return await selectProjectFromRef({
					...(locationId ? { locationId } : {}),
					...(projectId ? { projectId } : {}),
				});
			} catch (error) {
				if (error instanceof TrickroomMcpProjectResolverError) {
					return createProjectResolverErrorResult(error);
				}
				throw error;
			}
		},
	);

	server.registerTool(
		"getSelectedProject",
		{
			title: "Get Selected Project",
			description:
				"Return the project currently selected for MCP session-scoped tools.",
			annotations: readOnlyClosedWorldAnnotations,
		},
		createGetSelectedProjectResult,
	);

	server.registerTool(
		"getActiveProject",
		{
			title: "Get Active Project",
			description:
				"Compatibility alias for getSelectedProject. Prefer getSelectedProject for MCP session visibility.",
			annotations: readOnlyClosedWorldAnnotations,
		},
		createGetSelectedProjectResult,
	);

	server.registerTool(
		"resolveProject",
		{
			title: "Resolve Project",
			description:
				"Resolve a registered project reference to an MCP-enabled local project location.",
			inputSchema: {
				locationId: z
					.string()
					.min(1)
					.optional()
					.describe("Local Trickroom project location ID."),
				projectId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Stable Trickroom project ID. Ambiguous IDs require locationId.",
					),
			},
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ locationId, projectId }) => {
			try {
				const context = await projectResolver.resolveProject({
					...(locationId ? { locationId } : {}),
					...(projectId ? { projectId } : {}),
				});
				return createJsonResult({
					project: getProjectDetails(context),
				});
			} catch (error) {
				if (error instanceof TrickroomMcpProjectResolverError) {
					return createProjectResolverErrorResult(error);
				}

				throw error;
			}
		},
	);

	server.registerTool(
		"openProject",
		{
			title: "Open Project",
			description:
				"Deprecated alias that registers and selects a local project for this MCP session. Use registerProject + selectProject instead.",
			inputSchema: {
				path: z.string().min(1).describe("Local project root path to open."),
			},
			annotations: {
				readOnlyHint: false,
				openWorldHint: false,
				idempotentHint: true,
			},
		},
		async ({ path: projectPath }) => {
			const { context } = await registerProjectFromPath(projectPath);
			await selectProjectFromRef({ locationId: context.locationId });
			return createJsonResult({
				project: getProjectDetails(context),
				selected: true,
				active: true,
				migration:
					"Deprecated alias: use registerProject(path) then selectProject({ projectId | locationId }) for explicit project selection.",
			});
		},
	);

	server.registerTool(
		"trickroom_project_info",
		{
			title: "Project Info",
			description:
				"Return the current Trickroom project root, config path, and configured system names.",
			inputSchema: projectScopedInputSchema,
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ project }) =>
			withPolicyErrorHandling(project, createProjectInfoResult),
	);
};
