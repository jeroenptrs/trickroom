import {
	ErrorCode,
	ListResourcesRequestSchema,
	McpError,
	ReadResourceRequestSchema,
	type ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { DesignFileServiceError } from "../services/design-file-service";
import { McpPolicyError } from "./governance";
import {
	listDesignFilesPayload,
	readDesignSummaryPayload,
	toDesignFileResources,
} from "./payloads/design-reads";
import {
	getDesignResourceLocationId,
	getProjectReference,
} from "./payloads/project";
import {
	listMcpEnabledProjectContexts,
	TrickroomMcpProjectResolverError,
} from "./project-resolver";
import { parseDesignResourceUri } from "./resources";
import type { TrickroomMcpServerContext } from "./server-types";
import type { McpToolContext } from "./tools/context";

export const registerDesignResourceHandlers = (ctx: McpToolContext) => {
	const { server, trickroomHome, projectResolver, getSelectedContext } = ctx;

	server.server.setRequestHandler(ListResourcesRequestSchema, async () => {
		const selectedContext = getSelectedContext();
		const contexts = await listMcpEnabledProjectContexts({
			trickroomHome,
			includeContext: selectedContext,
		});
		const resourceGroups = await Promise.all(
			contexts.map(async (context) => {
				try {
					const payload = await listDesignFilesPayload(context);
					return toDesignFileResources(context, payload);
				} catch {
					return [];
				}
			}),
		);
		return { resources: resourceGroups.flat() };
	});

	server.server.setRequestHandler(
		ReadResourceRequestSchema,
		async (request): Promise<ReadResourceResult> => {
			const selectedContext = getSelectedContext();
			const uri = request.params.uri;
			let parsedUri: ReturnType<typeof parseDesignResourceUri>;
			try {
				parsedUri = parseDesignResourceUri(uri);
			} catch (error) {
				throw new McpError(ErrorCode.InvalidParams, "Invalid resource URI.", {
					code: "INVALID_RESOURCE_URI",
					message: error instanceof Error ? error.message : String(error),
					uri,
				});
			}

			let context: TrickroomMcpServerContext;
			try {
				const selectedResourceLocationId = selectedContext
					? getDesignResourceLocationId(selectedContext)
					: null;
				context =
					selectedContext && selectedResourceLocationId === parsedUri.locationId
						? selectedContext
						: await projectResolver.resolveProject({
								locationId: parsedUri.locationId,
							});
			} catch (error) {
				if (error instanceof TrickroomMcpProjectResolverError) {
					throw new McpError(ErrorCode.InvalidParams, error.message, {
						...error.details,
						uri,
					});
				}

				throw error;
			}

			try {
				const payload = await readDesignSummaryPayload(
					context,
					parsedUri.designId,
				);
				return {
					contents: [
						{
							uri,
							mimeType: "application/json",
							text: JSON.stringify(payload),
						},
					],
				};
			} catch (error) {
				if (error instanceof McpPolicyError) {
					throw new McpError(ErrorCode.InvalidRequest, error.message, {
						code: error.code,
						uri,
						designFileId: parsedUri.designId,
						project: getProjectReference(context),
					});
				}
				if (error instanceof DesignFileServiceError) {
					throw new McpError(ErrorCode.InvalidParams, error.message, {
						code: error.code,
						uri,
						designFileId: parsedUri.designId,
						project: getProjectReference(context),
					});
				}
				throw error;
			}
		},
	);
};
