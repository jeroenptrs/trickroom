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
	listDesignFilesToolPayload,
	readDesignFileDefaults,
	readDesignFilePayload,
	readDesignGraphDefaults,
	readDesignGraphPayload,
	readElementPayload,
	readSubtreeDefaults,
	readSubtreePayload,
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
import { createJsonResult, createToolErrorResult } from "./results";
import {
	designFileIdSchema,
	projectScopedInputSchema,
	withProjectScopedInput,
} from "./schemas";

const depthSchema = (defaultDepth: number | null) =>
	z
		.number()
		.int()
		.min(0)
		.max(20)
		.optional()
		.describe(
			`Maximum descendant depth to include. Defaults to ${defaultDepth ?? "none"}.`,
		);

const maxNodesSchema = (defaultMaxNodes: number) =>
	z
		.number()
		.int()
		.min(1)
		.max(5000)
		.optional()
		.describe(
			`Maximum elements to include, taken breadth first. Defaults to ${defaultMaxNodes}; above 500 needs allowLarge.`,
		);

const allowLargeSchema = z
	.boolean()
	.optional()
	.describe(
		"Set true to permit depth above 4, maxNodes above 500, or an unbounded read when depth/maxNodes are omitted.",
	);

const detailSchema = z
	.enum(["compact", "full"])
	.optional()
	.describe(
		'"compact" (default): id, name (omitted when it is the component default), component ("<library>/<component>", "trickroom/" prefix omitted), className, text (cut at 160 chars, with textLength), props that are not markers or registry defaults, and systemComponent/recipe/slot instance summaries. "full": id, every stored prop including markers, and full text.',
	);

export const registerDesignFileReadTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		"listDesignFiles",
		{
			title: "List Design Files",
			description:
				"List design files with id, name, revision, systemId (omitted when it is the project's defaultSystemId; names in `systems`), layer count, modifiedAt, and board ids/names. Unreadable files keep a `diagnostic`.",
			inputSchema: projectScopedInputSchema,
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(await listDesignFilesToolPayload(context)),
			),
	);

	server.registerTool(
		"readDesignFile",
		{
			title: "Read Design File",
			description:
				"Read one design file: header with revision, a board index (id, name, elementCount), and a bounded compact element tree taken breadth first. Defaults to depth 2 and 50 nodes. Pass boardId to read one board. Elements with `more` have unread descendants; `read.next` gives the exact follow-up call.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				boardId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Board (root element) id to read. Omit to read every board within the same bounds.",
					),
				depth: depthSchema(readDesignFileDefaults.depth),
				maxNodes: maxNodesSchema(readDesignFileDefaults.maxNodes),
				allowLarge: allowLargeSchema,
				detail: detailSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			designFileId,
			boardId,
			depth,
			maxNodes,
			allowLarge,
			detail,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const payload = await readDesignFilePayload(context, designFileId, {
					boardId,
					depth,
					maxNodes,
					allowLarge,
					detail,
				});
				const designMemory = await readMemoryManifest(context.projectRoot, {
					kind: "design",
					designId: designFileId,
				});
				const memorySummary = summarizeMemoryManifest(designMemory.manifest);
				return createJsonResult(
					memorySummary.noteCount > 0
						? {
								...payload,
								memory: memorySummary,
								memoryHint:
									"This design has memory notes describing its intent and rationale. Call listMemoryNotes({ scope: { kind: 'design', designFileId } }) before editing or explaining it.",
							}
						: payload,
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
				"Read a flat, bounded outline of a design: elements keyed by id in breadth-first order with parentId, childCount, and the compact fields minus className (default 100 elements). Prefer readSubtree to inspect or style an area; use this for a structural overview. Scope with rootElementId (any element or board id).",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				rootElementId: z
					.string()
					.min(1)
					.optional()
					.describe("Element or board id to scope the graph to its subtree."),
				depth: depthSchema(readDesignGraphDefaults.depth),
				maxNodes: maxNodesSchema(readDesignGraphDefaults.maxNodes),
				allowLarge: allowLargeSchema,
				includeProps: z
					.boolean()
					.optional()
					.describe(
						"Replace compact fields with every stored prop, markers included. Defaults to false.",
					),
				includeText: z
					.boolean()
					.optional()
					.describe(
						"Include text (cut at 160 chars) for text elements. Defaults to true.",
					),
				includeAddresses: z
					.boolean()
					.optional()
					.describe(
						"Include each element's JSON Pointer address in the design file (/boards/0/children/1). Defaults to false.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			designFileId,
			rootElementId,
			depth,
			maxNodes,
			allowLarge,
			includeProps,
			includeText,
			includeAddresses,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await readDesignGraphPayload(context, designFileId, {
						rootElementId,
						depth,
						maxNodes,
						allowLarge,
						includeProps,
						includeText,
						includeAddresses,
					}),
				),
			),
	);

	server.registerTool(
		"readElement",
		{
			title: "Read Element",
			description:
				"Read one element (compact by default: see readSubtree's detail), its childIds, and its placement: parentId, boardId, index, siblingCount.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				elementId: z.string().min(1).describe("Element ID inside the design."),
				detail: detailSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, elementId, detail, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await readElementPayload(context, designFileId, elementId, {
						detail,
					}),
				),
			),
	);

	server.registerTool(
		"readSubtree",
		{
			title: "Read Subtree",
			description:
				"Read a bounded element subtree rooted at elementId, taken breadth first. Defaults to depth 3, 100 nodes, and compact nodes. Elements with `more` have unread descendants; `read.next` gives the exact follow-up call.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				elementId: z.string().min(1).describe("Element ID inside the design."),
				depth: depthSchema(readSubtreeDefaults.depth),
				maxNodes: maxNodesSchema(readSubtreeDefaults.maxNodes),
				allowLarge: allowLargeSchema,
				detail: detailSchema,
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
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await readSubtreePayload(context, designFileId, elementId, {
						depth,
						maxNodes,
						allowLarge,
						detail,
					}),
				),
			),
	);
};
