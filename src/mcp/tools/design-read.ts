import { z } from "zod";
import { exportDesignBoards } from "../../export/export-design";
import {
	ExportDestinationError,
	writeExportArtifacts,
} from "../../export/write-export-artifacts";
import {
	readMemoryManifest,
	summarizeMemoryManifest,
} from "../../utils/memory-manifest-service";
import {
	assertCanReadDesignFile,
	assertCanWriteProject,
	getMcpPolicy,
} from "../governance";
import {
	listDesignFilesPayload,
	readDesignFilePayload,
	readDesignGraphPayload,
	readElementPayload,
	readSubtreePayload,
	summarizeDesignFileReadText,
	summarizeDesignGraphReadText,
	summarizeSubtreeReadText,
} from "../payloads/design-reads";
import {
	getDesignMetadata,
	getNodeName,
	readDesignFileForTool,
} from "../payloads/design-tree";
import { getProjectReference } from "../payloads/project";
import {
	mutationAnnotations,
	readOnlyClosedWorldAnnotations,
} from "./annotations";
import type { McpToolContext } from "./context";
import {
	createJsonResult,
	createReadToolResult,
	createToolErrorResult,
} from "./results";
import {
	designFileIdSchema,
	mcpReadResponseFormatSchema,
	projectScopedInputSchema,
	withProjectScopedInput,
} from "./schemas";

export const registerDesignFileReadTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		"listDesignFiles",
		{
			title: "List Design Files",
			description:
				"List project-scoped Trickroom design files with UUID handles, file metadata, names, design-system references, and revisions.",
			inputSchema: projectScopedInputSchema,
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(await listDesignFilesPayload(context)),
			),
	);

	server.registerTool(
		"readDesignFile",
		{
			title: "Read Design File",
			description:
				"Read design metadata, board summaries, counts, and a bounded compact element tree for one design file. Defaults to depth 2 and 100 nodes; pass allowLarge to request deeper output.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				depth: z
					.number()
					.int()
					.min(0)
					.max(20)
					.optional()
					.describe("Maximum descendant depth to include. Defaults to 2."),
				maxNodes: z
					.number()
					.int()
					.min(1)
					.max(5000)
					.optional()
					.describe("Maximum elements to include. Defaults to 100."),
				allowLarge: z
					.boolean()
					.optional()
					.describe(
						"Set true to permit depth above 4, maxNodes above 500, or an unbounded read when depth/maxNodes are omitted.",
					),
				responseFormat: mcpReadResponseFormatSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			designFileId,
			depth,
			maxNodes,
			allowLarge,
			responseFormat,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const payload = await readDesignFilePayload(context, designFileId, {
					depth,
					maxNodes,
					allowLarge,
				});
				const designMemory = await readMemoryManifest(context.projectRoot, {
					kind: "design",
					designId: designFileId,
				});
				const memorySummary = summarizeMemoryManifest(designMemory.manifest);
				const payloadWithMemory = {
					...payload,
					memory: memorySummary,
					...(memorySummary.noteCount > 0
						? {
								memoryHint:
									"This design has memory notes describing its intent and rationale. Call listMemoryNotes({ scope: { kind: 'design', designFileId } }) before editing or explaining it.",
							}
						: {}),
				};
				return createReadToolResult(
					payloadWithMemory,
					responseFormat ?? "json",
					summarizeDesignFileReadText,
				);
			}),
	);

	server.registerTool(
		"exportDesignHtml",
		{
			title: "Export Design to HTML",
			description:
				"Export one or more boards of a design file to self-contained, interactive HTML on disk. One board writes a single .html file; multiple boards write one .zip containing one .html per board, matching the in-app export download behavior. Each document inlines the design system's compiled Tailwind and loads React + Base UI from a CDN (esm.sh), so it needs network access to that CDN to render. Absolute destinationDir paths are used as-is; project-relative paths resolve inside the project and must stay within the project root. Omit boardIds to export every board.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				destinationDir: z
					.string()
					.min(1)
					.describe(
						"Folder path where export files are written. Absolute paths are used as-is. Relative paths resolve inside the project directory.",
					),
				boardIds: z
					.array(z.string().min(1))
					.optional()
					.describe(
						"Board (root element) IDs to export. Omit or leave empty to export every board.",
					),
			}),
			annotations: mutationAnnotations,
		},
		async ({ designFileId, destinationDir, boardIds, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				assertCanReadDesignFile(policy, designFileId);
				const read = await readDesignFileForTool(context, designFileId);
				const requested = new Set(
					(boardIds ?? []).filter((id) => id.length > 0),
				);
				const boards =
					requested.size > 0
						? read.design.boards.filter((board) => requested.has(board.id))
						: read.design.boards;

				if (boards.length === 0) {
					return createToolErrorResult(
						context,
						"NO_MATCHING_BOARDS",
						requested.size > 0
							? "None of the requested boardIds match a board in this design file."
							: "This design file has no boards to export.",
						{
							availableBoardIds: read.design.boards.map((board) => board.id),
							availableBoards: read.design.boards.map((board) => ({
								id: board.id,
								name: getNodeName(board) ?? null,
							})),
						},
					);
				}

				const result = await exportDesignBoards({
					projectRoot: context.projectRoot,
					config: context.config,
					boards,
					systemId: read.design.systemId ?? null,
					projectName: context.config.name,
					designName: read.design.name,
				});

				try {
					const written = await writeExportArtifacts(
						context.projectRoot,
						destinationDir,
						context.config.name,
						read.design.name,
						result,
					);
					return createJsonResult({
						status: "success",
						project: getProjectReference(context),
						designFile: getDesignMetadata(designFileId, read),
						exportedAt: result.epoch,
						systemId: result.systemId,
						destinationDir: written.destinationDir,
						artifacts: written.artifacts,
					});
				} catch (error) {
					if (error instanceof ExportDestinationError) {
						return createToolErrorResult(context, error.code, error.message);
					}
					throw error;
				}
			}),
	);
};

export const registerDesignTreeReadTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		"readDesignGraph",
		{
			title: "Read Design Graph",
			description:
				"Read a flat graph representation of a design file with element IDs, parent/child maps, and canonical JSON Pointer-style addresses.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				rootElementId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional element ID to scope the graph to a subtree."),
				includeProps: z
					.boolean()
					.optional()
					.describe("Include full props for each element. Defaults to false."),
				includeText: z
					.boolean()
					.optional()
					.describe(
						"Include full text for text role elements. Defaults to true.",
					),
				responseFormat: mcpReadResponseFormatSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			designFileId,
			rootElementId,
			includeProps,
			includeText,
			responseFormat,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const payload = await readDesignGraphPayload(context, designFileId, {
					rootElementId,
					includeProps,
					includeText,
				});
				return createReadToolResult(
					payload,
					responseFormat ?? "json",
					summarizeDesignGraphReadText,
				);
			}),
	);

	server.registerTool(
		"readElement",
		{
			title: "Read Element",
			description:
				"Read one full design element with props, text or child IDs, and parent/sibling context.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				elementId: z.string().min(1).describe("Element ID inside the design."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, elementId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await readElementPayload(context, designFileId, elementId),
				),
			),
	);

	server.registerTool(
		"readSubtree",
		{
			title: "Read Subtree",
			description:
				'Read a bounded detailed element subtree rooted at the selected element. Defaults to depth 2 and 100 nodes; pass allowLarge to request deeper output. Pass detail: "compact" for id/name/component/className/text-preview nodes without full props.',
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				elementId: z.string().min(1).describe("Element ID inside the design."),
				depth: z
					.number()
					.int()
					.min(0)
					.max(20)
					.optional()
					.describe("Maximum descendant depth to include. Defaults to 2."),
				maxNodes: z
					.number()
					.int()
					.min(1)
					.max(5000)
					.optional()
					.describe("Maximum elements to include. Defaults to 100."),
				allowLarge: z
					.boolean()
					.optional()
					.describe(
						"Set true to permit depth above 4, maxNodes above 500, or an unbounded read when depth/maxNodes are omitted.",
					),
				detail: z
					.enum(["full", "compact"])
					.optional()
					.describe(
						'"full" (default) returns every prop per node, recipe attachment summaries, and full text. "compact" returns the readDesignFile node shape: id, name, library, component, role, className, and a text preview.',
					),
				responseFormat: mcpReadResponseFormatSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			designFileId,
			elementId,
			depth,
			maxNodes,
			allowLarge,
			detail,
			responseFormat,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const payload = await readSubtreePayload(
					context,
					designFileId,
					elementId,
					{
						depth,
						maxNodes,
						allowLarge,
						detail,
					},
				);
				return createReadToolResult(
					payload,
					responseFormat ?? "json",
					summarizeSubtreeReadText,
				);
			}),
	);
};
