import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
	applyExtractSubtree,
	DesignTransformError,
	normalizeDesignForMutation,
} from "../../services/design-transform-service";
import { createElementNotFoundError } from "../../services/element-lookup-hints";
import type { TrickroomDesign } from "../../types";
import { findDesignSystem } from "../../utils/design-system-store";
import { applyProjectDefaultSystemToDesign } from "../../utils/project-default-system";
import {
	assertCanReadDesignFile,
	assertCanWriteDesignFile,
	getMcpPolicy,
	McpPolicyError,
} from "../governance";
import { assertConfiguredSystem } from "../payloads/design-system";
import {
	createBlankDesign,
	describeNode,
	findElementContext,
	getDesignHeader,
	getRecipeAttachmentSummaries,
	readDesignFileForTool,
} from "../payloads/design-tree";
import { applyDesignOperationsPayload } from "../payloads/design-validation";
import { getProjectReference } from "../payloads/project";
import {
	assertCanUseSubtreeComponents,
	assertResourceReferencesExist,
} from "../payloads/references";
import { TOOL } from "../tool-names";
import {
	ALWAYS_LOAD_META_KEY,
	mutationAnnotations,
	SEARCH_HINT_META_KEY,
} from "./annotations";
import type { McpToolContext } from "./context";
import {
	createDesignFileForTool,
	getMutationDiagnostics,
	withMutationErrorHandling,
} from "./mutation-support";
import { createOperationPlanStepsInputSchema } from "./operation-schemas";
import { createJsonResult } from "./results";
import {
	designFileIdSchema,
	expectedRevisionSchema,
	mutationResponseInputSchema,
	withMutationScopedInput,
	withProjectScopedInput,
} from "./schemas";

export const registerDesignCreateTool = (ctx: McpToolContext) => {
	const { server, notifyResourceListChanged, withProjectContext } = ctx;

	server.registerTool(
		TOOL.designCreate,
		{
			title: "Create Design File",
			description: `Create a design file. With a name it starts empty: add boards with ${TOOL.designApply} (parentId null). A board is one responsive view or interaction state (page, sheet open, dialog open), not a breakpoint. With from: { designFileId, elementId }, the new design starts with a copy of that element and its subtree as its board, with new ids; the source is not changed, and name defaults to the element's layer name. systemName links a design system: omit it to inherit the project default (or the source design's), pass null for none. Returns the new design's id, name and revision (newRevision, for your first write), its boards as compact nodes, and warnings on the new content.`,
			inputSchema: withMutationScopedInput({
				name: z
					.string()
					.min(1)
					.optional()
					.describe("Design name. Required unless from is set."),
				systemName: z
					.string()
					.min(1)
					.nullable()
					.optional()
					.describe(
						"Design system name or id. Omit to inherit; null for an unlinked design.",
					),
				designFileId: designFileIdSchema
					.optional()
					.describe(
						"UUID for the new design. Required when policy restricts design ids.",
					),
				from: z
					.object({
						designFileId: designFileIdSchema.describe("Source design."),
						elementId: z
							.string()
							.min(1)
							.describe("Element to copy with its subtree."),
					})
					.strict()
					.optional()
					.describe("Start from a copy of an existing element."),
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"new design file extract copy subtree into new design",
			},
		},
		async ({ name, systemName, designFileId, from, response, project }) =>
			withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const newDesignFileId = designFileId ?? randomUUID();
				const normalizedSystemName =
					typeof systemName === "string" ? systemName.trim() : systemName;

				return withMutationErrorHandling(
					context,
					{
						toolName: TOOL.designCreate,
						operation: from ? "extract" : "create",
						projectId: context.config.projectId ?? null,
						designFileId: newDesignFileId,
						expectedRevision: null,
						details: {
							requestedName: name ?? null,
							requestedSystemName:
								systemName === undefined ? "inherit" : normalizedSystemName,
							requestedDesignFileId: designFileId ?? null,
							...(from
								? {
										sourceDesignFileId: from.designFileId,
										sourceElementId: from.elementId,
									}
								: {}),
						},
					},
					async () => {
						if (policy.mode === "read-only") {
							throw new McpPolicyError(
								"MCP_READ_ONLY",
								"MCP is configured in read-only mode for this project.",
							);
						}
						if (
							policy.allowedDesignFileIds !== null &&
							designFileId === undefined
						) {
							throw new McpPolicyError(
								"MCP_DESIGN_FILE_NOT_ALLOWED",
								"Creating a design needs a designFileId listed in allowedDesignFileIds when project policy restricts design files.",
							);
						}
						if (from) {
							assertCanReadDesignFile(policy, from.designFileId);
						}
						assertCanWriteDesignFile(policy, newDesignFileId);

						const trimmedName = name?.trim();
						if (trimmedName === "" || (trimmedName === undefined && !from)) {
							throw new DesignTransformError(
								"INVALID_OPERATION_PARAMETERS",
								from
									? 'Parameter "name" must not be blank.'
									: 'Parameter "name" is required unless from is set, and must not be blank.',
							);
						}
						if (normalizedSystemName === "") {
							throw new DesignTransformError(
								"INVALID_OPERATION_PARAMETERS",
								'Parameter "systemName" must not be blank when provided.',
							);
						}
						const requestedSystem = normalizedSystemName
							? await assertConfiguredSystem(context, normalizedSystemName)
							: null;

						let design: TrickroomDesign;
						let idMap: Record<string, string> | undefined;
						if (from) {
							const sourceRead = await readDesignFileForTool(
								context,
								from.designFileId,
							);
							normalizeDesignForMutation(sourceRead.design);
							const sourceElement = findElementContext(
								sourceRead.design,
								from.elementId,
							);
							if (!sourceElement) {
								throw createElementNotFoundError(
									sourceRead.design,
									from.elementId,
								);
							}
							assertCanUseSubtreeComponents(policy, sourceElement.element);
							const result = await applyExtractSubtree(sourceRead.design, {
								elementId: from.elementId,
								name: trimmedName,
								...(normalizedSystemName === undefined
									? {}
									: {
											systemId: requestedSystem?.manifest.systemId ?? null,
										}),
								projectRoot: context.projectRoot,
							});
							await assertResourceReferencesExist(context, result.newDesign);
							design = result.newDesign;
							idMap = result.idMap;
						} else {
							design = await applyProjectDefaultSystemToDesign(
								context.projectRoot,
								context.config,
								createBlankDesign(
									trimmedName as string,
									normalizedSystemName === undefined
										? undefined
										: (requestedSystem?.manifest.systemId ?? null),
								),
							);
						}

						const write = await createDesignFileForTool(
							context,
							newDesignFileId,
							design,
						);
						await notifyResourceListChanged();
						const system = write.design.systemId
							? await findDesignSystem(
									context.projectRoot,
									write.design.systemId,
								)
							: null;
						const recipeSummaries = getRecipeAttachmentSummaries(write.design);

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							designFile: getDesignHeader(newDesignFileId, write),
							system: system
								? {
										systemId: system.manifest.systemId,
										systemName: system.manifest.systemName,
									}
								: null,
							boards: write.design.boards.map((board) =>
								describeNode(board, "compact", recipeSummaries),
							),
							...(idMap && response === "full" ? { idMap } : {}),
							...(await getMutationDiagnostics(
								context,
								write.design,
								response,
							)),
						});
					},
				);
			}),
	);
};

export const registerDesignApplyTool = (ctx: McpToolContext) => {
	const { server, notifyResourceListChanged, withProjectContext } = ctx;

	server.registerTool(
		TOOL.designApply,
		{
			title: "Apply Design Operations",
			description: `Write to a design: an ordered list of operations, validated together and committed atomically against expectedRevision, checked per board: boards you do not change may have changed since. One write, or none when a step fails or the plan adds error issues; errors the design already had do not block it (preExistingErrorCount). A single edit is a list of one. Returns newRevision for your next write, \`created\` ids per inserting step (root id, addSubtree tempId map, recipe slot ids), deletedCount, error issues, warningCount and grouped likely-typo warnings on touched elements; response "full" adds every warning and each step's summary. A failing step returns failedStepIndex, its error with hints and expectedParameters. REVISION_MISMATCH names the stale boards (staleBoards) and the reads to retry from (next). Later steps reference elements created by earlier ones with $step:N, $step:N:tempId:<tempId> and $step:N:slot:<slot>. Parameters and examples: ${TOOL.guide}({ topic: "operations" }). Dry-run with ${TOOL.designValidate}. After a write the human should see, ${TOOL.editorFocus} points their editor at it.`,
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				expectedRevision: expectedRevisionSchema,
				operations: createOperationPlanStepsInputSchema(
					"Ordered operations to commit.",
				),
				response: mutationResponseInputSchema,
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: true,
				idempotentHint: false,
			},
			_meta: {
				[ALWAYS_LOAD_META_KEY]: true,
				[SEARCH_HINT_META_KEY]:
					"edit write insert add update move delete copy rename element recipe component batch",
			},
		},
		async ({ designFileId, expectedRevision, operations, response, project }) =>
			withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: TOOL.designApply,
						operation:
							operations.length === 1 ? operations[0].operation : "batch",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: {
							operationCount: operations.length,
							operations: operations.map((step) => step.operation),
						},
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return applyDesignOperationsPayload(context, {
							designFileId,
							expectedRevision,
							operations,
							response,
							onRename: notifyResourceListChanged,
						});
					},
				);
			}),
	);
};
