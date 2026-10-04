import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readProjectRegistry } from "../../app-state/project-registry";
import { TrickroomProjectConfigError } from "../../project";
import { getProjectDetails, getProjectInfo } from "../payloads/project";
import { TrickroomMcpProjectResolverError } from "../project-resolver";
import type { TrickroomMcpServerContext } from "../server-types";
import { TOOL } from "../tool-names";
import {
	ALWAYS_LOAD_META_KEY,
	readOnlyClosedWorldAnnotations,
	SEARCH_HINT_META_KEY,
} from "./annotations";
import type { McpToolContext } from "./context";
import { createJsonResult, createProjectResolverErrorResult } from "./results";
import { projectRefSchema } from "./schemas";

const createProjectErrorResult = (
	code: string,
	message: string,
): CallToolResult => ({
	...createJsonResult({ status: "INVALID_OPERATION", code, message }),
	isError: true,
});

/** Resolver and config errors are answers, not crashes: report them. */
const withProjectErrors = async (
	fn: () => Promise<CallToolResult>,
): Promise<CallToolResult> => {
	try {
		return await fn();
	} catch (error) {
		if (error instanceof TrickroomMcpProjectResolverError) {
			return createProjectResolverErrorResult(error);
		}
		if (error instanceof TrickroomProjectConfigError) {
			return createProjectErrorResult(error.code, error.message);
		}
		throw error;
	}
};

export const registerProjectTools = (ctx: McpToolContext) => {
	const {
		server,
		trickroomHome,
		projectResolver,
		getSelectedContext,
		registerProjectFromPath,
		selectProject,
	} = ctx;

	server.registerTool(
		TOOL.projectList,
		{
			title: "List Projects",
			description: `Start here. Returns this session's selected project (ids, root, name) with what working in it needs: governance mode, default design system, configured systems, and a project memory summary when notes exist. \`projects\` lists every registered Trickroom project with projectId, locationId and root; \`selected\` marks this session's, \`appActive\` the one the browser app last opened. Pass project to get the same information for another registered project without selecting it. Switch with ${TOOL.projectSelect}.`,
			inputSchema: {
				project: projectRefSchema.describe(
					"A registered project ({ locationId } or { projectId }) to describe instead of the selected one.",
				),
			},
			annotations: readOnlyClosedWorldAnnotations,
			_meta: {
				[ALWAYS_LOAD_META_KEY]: true,
				[SEARCH_HINT_META_KEY]:
					"project info session selected current workspace systems governance",
			},
		},
		async ({ project }) =>
			withProjectErrors(async () => {
				const registry = await readProjectRegistry(trickroomHome);
				const selected = getSelectedContext();
				const described: TrickroomMcpServerContext | null =
					project?.locationId || project?.projectId
						? await projectResolver.resolveProject(project)
						: selected;
				return createJsonResult({
					selected: selected ? getProjectDetails(selected) : null,
					...(described && described !== selected
						? { project: getProjectDetails(described) }
						: {}),
					...(described
						? await getProjectInfo(described)
						: {
								hint: `No project is selected for this session. Call ${TOOL.projectSelect} with a locationId below, or with the path of a project that is not listed.`,
							}),
					projects: registry.locations.map((location) => ({
						projectId: location.projectId,
						locationId: location.locationId,
						projectRoot: location.root,
						name: location.name,
						lastOpenedAt: location.lastOpenedAt,
						...(selected?.locationId === location.locationId
							? { selected: true }
							: {}),
						...(location.locationId === registry.lastActiveLocationId
							? { appActive: true }
							: {}),
					})),
				});
			}),
	);

	server.registerTool(
		TOOL.projectSelect,
		{
			title: "Select Project",
			description: `Make a project this session's project: every other tool then works in it. Pass a locationId (preferred) or projectId from ${TOOL.projectList}, or the path of a local project root to register it first. The project needs .trickroom/config.json with mcp.enabled. Returns the project and the same information as ${TOOL.projectList}.`,
			inputSchema: {
				locationId: z
					.string()
					.min(1)
					.optional()
					.describe("Registered project location id."),
				projectId: z
					.string()
					.min(1)
					.optional()
					.describe("Stable project id. Ambiguous ids need locationId."),
				path: z
					.string()
					.min(1)
					.optional()
					.describe("Local project root to register and select."),
			},
			annotations: {
				readOnlyHint: false,
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			},
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"switch open register project workspace folder path",
			},
		},
		async ({ locationId, projectId, path }) =>
			withProjectErrors(async () => {
				const byId = locationId !== undefined || projectId !== undefined;
				if (byId === (path !== undefined)) {
					return createProjectErrorResult(
						"INVALID_OPERATION_PARAMETERS",
						"Pass a locationId or projectId to select a registered project, or a path to register one; not both, not neither.",
					);
				}
				let ref = { locationId, projectId };
				if (path !== undefined) {
					const { context } = await registerProjectFromPath(path);
					ref = { locationId: context.locationId, projectId: undefined };
				}
				const context = await selectProject(ref);
				return createJsonResult({
					project: getProjectDetails(context),
					selected: true,
					...(path !== undefined ? { registered: true } : {}),
					...(await getProjectInfo(context)),
				});
			}),
	);
};
