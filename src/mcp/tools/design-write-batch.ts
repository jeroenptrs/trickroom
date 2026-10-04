import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
	applyExtractSubtree,
	DesignTransformError,
	normalizeDesignForMutation,
} from "../../services/design-transform-service";
import { findDesignSystem } from "../../utils/design-system-store";
import { applyProjectDefaultSystemToDesign } from "../../utils/project-default-system";
import { OPERATION_PARAMETER_SHAPES } from "../design-operations";
import {
	assertCanReadDesignFile,
	assertCanWriteDesignFile,
	getMcpPolicy,
	McpPolicyError,
} from "../governance";
import { executeDesignOperation } from "../operation-plan";
import {
	assertConfiguredSystem,
	getDesignSystemDisplayName,
} from "../payloads/design-system";
import {
	compactElementTree,
	createBlankDesign,
	findElementContext,
	getCompactElementSummary,
	getDesignMetadata,
	getMutationContext,
	readDesignFileForTool,
} from "../payloads/design-tree";
import {
	applyDesignOperationsPayload,
	normalizeCopySubtreePayload,
} from "../payloads/design-validation";
import { getProjectReference } from "../payloads/project";
import {
	assertCanUseSubtreeComponents,
	assertResourceReferencesExist,
} from "../payloads/references";
import {
	destructiveMutationAnnotations,
	mutationAnnotations,
} from "./annotations";
import type { McpToolContext } from "./context";
import {
	createDesignFileForTool,
	createDesignOperationDependencies,
	getMutationDiagnostics,
	mutateDesignFile,
	mutateDesignWithOperation,
	withMutationErrorHandling,
} from "./mutation-support";
import {
	addSubtreePayloadSchema,
	createOperationPlanStepsInputSchema,
	validateCopySubtreePayloadSchema,
} from "./operation-schemas";
import { createJsonResult } from "./results";
import {
	designFileIdSchema,
	expectedRevisionSchema,
	mutationResponseInputSchema,
	mutationScopedInputSchema,
	projectScopedInputSchema,
	withMutationScopedInput,
	withProjectScopedInput,
} from "./schemas";

export const registerDesignBatchWriteTools = (ctx: McpToolContext) => {
	const { server, notifyResourceListChanged, withProjectContext } = ctx;

	server.registerTool(
		"createDesignFile",
		{
			title: "Create Design File",
			description:
				"Create a new empty Trickroom design file with no boards. Add root boards afterwards with addElement/addRecipe/addSubtree using parentId: null — do not nest boards inside a wrapper layer. Boards are views or interaction states (page, sheet open, dialog open), not breakpoints: build one responsive board and review it at several viewport widths. Pass systemName at creation when the design will use a specific system; omit systemName to inherit the project default system when configured, or pass null to explicitly create an unlinked design. Uses exclusive create semantics instead of expectedRevision because the file must not already exist.",
			inputSchema: withMutationScopedInput({
				name: z.string().min(1).describe("Design file name."),
				systemName: z
					.string()
					.min(1)
					.nullable()
					.optional()
					.describe(
						"Optional configured design system name. Omit to inherit the project default system when configured. Pass null to explicitly create an unlinked design.",
					),
				designFileId: designFileIdSchema
					.optional()
					.describe(
						"Optional UUID to use for the new design file. Required when allowedDesignFileIds restricts MCP to explicit IDs.",
					),
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({ name, systemName, designFileId, response, project }) =>
			withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const newDesignFileId = designFileId ?? randomUUID();
				const requestedSystemName = systemName ?? null;
				const normalizedAuditSystemName =
					typeof systemName === "string"
						? systemName.trim()
						: requestedSystemName;

				return withMutationErrorHandling(
					context,
					{
						toolName: "createDesignFile",
						operation: "createDesignFile",
						projectId: context.config.projectId ?? null,
						designFileId: newDesignFileId,
						expectedRevision: null,
						details: {
							systemName: normalizedAuditSystemName,
							requestedSystemName,
							requestedDesignFileId: designFileId ?? null,
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
								"MCP design file creation requires a designFileId listed in allowedDesignFileIds when project policy restricts design files.",
							);
						}

						assertCanWriteDesignFile(policy, newDesignFileId);

						const trimmedName = name.trim();
						if (trimmedName.length === 0) {
							throw new DesignTransformError(
								"INVALID_OPERATION_PARAMETERS",
								'Parameter "name" must not be blank.',
							);
						}

						const normalizedSystemName =
							systemName === undefined || systemName === null
								? systemName
								: systemName.trim();
						if (normalizedSystemName === "") {
							throw new DesignTransformError(
								"INVALID_OPERATION_PARAMETERS",
								'Parameter "systemName" must not be blank when provided.',
							);
						}
						if (normalizedSystemName) {
							await assertConfiguredSystem(context, normalizedSystemName);
						}

						const system =
							normalizedSystemName === undefined ||
							normalizedSystemName === null
								? null
								: await assertConfiguredSystem(context, normalizedSystemName);
						const design = await applyProjectDefaultSystemToDesign(
							context.projectRoot,
							context.config,
							createBlankDesign(
								trimmedName,
								normalizedSystemName === undefined
									? undefined
									: (system?.manifest.systemId ?? null),
							),
						);
						const linkedSystem =
							system ??
							(design.systemId
								? await findDesignSystem(context.projectRoot, design.systemId)
								: null);
						const write = await createDesignFileForTool(
							context,
							newDesignFileId,
							design,
						);
						await notifyResourceListChanged();

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							designFile: {
								id: newDesignFileId,
								file: write.file,
								name: write.design.name,
								systemId: write.design.systemId ?? null,
								systemName: linkedSystem?.manifest.systemName ?? null,
								revision: write.revision,
							},
							rootElementIds: write.design.boards.map((board) => board.id),
							elementTree: write.design.boards.map(compactElementTree),
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

	server.registerTool(
		"extractSubtree",
		{
			title: "Extract Subtree",
			description:
				"Copy an element subtree into a new Trickroom design file with regenerated element IDs. The source design is not modified.",
			inputSchema: withMutationScopedInput({
				designFileId: designFileIdSchema.describe("Source design file UUID."),
				elementId: z
					.string()
					.min(1)
					.describe("Root element ID of the subtree to extract."),
				name: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Optional new design file name. Defaults to the source layer name, then Untitled.",
					),
				systemName: z
					.string()
					.min(1)
					.nullable()
					.optional()
					.describe(
						"Optional design system override. Omit to inherit the source design system; pass null to explicitly create an unlinked design.",
					),
				newDesignFileId: designFileIdSchema
					.optional()
					.describe(
						"Optional UUID to use for the new design file. Required when allowedDesignFileIds restricts MCP to explicit IDs.",
					),
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			elementId,
			name,
			systemName,
			newDesignFileId,
			response,
			project,
		}) =>
			withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const targetDesignFileId = newDesignFileId ?? randomUUID();
				const normalizedAuditSystemName =
					typeof systemName === "string" ? systemName.trim() : systemName;

				return withMutationErrorHandling(
					context,
					{
						toolName: "extractSubtree",
						operation: "extractSubtree",
						projectId: context.config.projectId ?? null,
						designFileId: targetDesignFileId,
						expectedRevision: null,
						details: {
							sourceDesignFileId: designFileId,
							sourceElementId: elementId,
							requestedName: name ?? null,
							requestedSystemName:
								systemName === undefined
									? "inherit"
									: normalizedAuditSystemName,
							requestedNewDesignFileId: newDesignFileId ?? null,
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
							newDesignFileId === undefined
						) {
							throw new McpPolicyError(
								"MCP_DESIGN_FILE_NOT_ALLOWED",
								"MCP design file creation requires a newDesignFileId listed in allowedDesignFileIds when project policy restricts design files.",
							);
						}

						assertCanReadDesignFile(policy, designFileId);
						assertCanWriteDesignFile(policy, targetDesignFileId);

						const normalizedName = name === undefined ? undefined : name.trim();
						if (normalizedName === "") {
							throw new DesignTransformError(
								"INVALID_OPERATION_PARAMETERS",
								'Parameter "name" must not be blank.',
							);
						}
						const normalizedSystemName =
							systemName === undefined || systemName === null
								? systemName
								: systemName.trim();
						if (normalizedSystemName === "") {
							throw new DesignTransformError(
								"INVALID_OPERATION_PARAMETERS",
								'Parameter "systemName" must not be blank when provided.',
							);
						}
						if (normalizedSystemName) {
							await assertConfiguredSystem(context, normalizedSystemName);
						}

						const sourceRead = await readDesignFileForTool(
							context,
							designFileId,
						);
						normalizeDesignForMutation(sourceRead.design);
						const sourceElementContext = findElementContext(
							sourceRead.design,
							elementId,
						);
						if (!sourceElementContext) {
							throw new DesignTransformError(
								"ELEMENT_NOT_FOUND",
								`Element "${elementId}" not found.`,
							);
						}
						assertCanUseSubtreeComponents(policy, sourceElementContext.element);
						const targetSystem =
							normalizedSystemName === undefined ||
							normalizedSystemName === null
								? null
								: await assertConfiguredSystem(context, normalizedSystemName);
						const designSystemOverride =
							normalizedSystemName === undefined
								? {}
								: { systemId: targetSystem?.manifest.systemId ?? null };

						const result = await applyExtractSubtree(sourceRead.design, {
							elementId,
							name: normalizedName,
							...designSystemOverride,
							projectRoot: context.projectRoot,
						});
						await assertResourceReferencesExist(context, result.newDesign);
						const write = await createDesignFileForTool(
							context,
							targetDesignFileId,
							result.newDesign,
						);
						const writtenSystem =
							write.design.systemId === undefined ||
							write.design.systemId === null
								? null
								: await findDesignSystem(
										context.projectRoot,
										write.design.systemId,
									);

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							sourceDesignFile: getDesignMetadata(designFileId, sourceRead),
							newRevision: write.revision,
							designFile: {
								id: targetDesignFileId,
								file: write.file,
								name: write.design.name,
								systemId: write.design.systemId ?? null,
								systemName: writtenSystem?.manifest.systemName ?? null,
								revision: write.revision,
							},
							sourceElementId: elementId,
							rootElementIds: write.design.boards.map((board) => board.id),
							idMap: result.idMap,
							elementTree: write.design.boards.map(compactElementTree),
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

	server.registerTool(
		"addSubtree",
		{
			title: "Add Subtree",
			description:
				"Insert a candidate element or recipe subtree. Requires expectedRevision from a prior read.",
			inputSchema: addSubtreePayloadSchema.extend(mutationScopedInputSchema),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			expectedRevision,
			parentId,
			index,
			subtree,
			options,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "addSubtree",
						operation: "addSubtree",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: {
							parentId,
							index,
							options: options === undefined ? null : options,
						},
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return mutateDesignWithOperation(
							context,
							{ designFileId, expectedRevision },
							"addSubtree",
							{ parentId, index, subtree, options },
							async (execution, write) => {
								const rootElementId = String(execution.summary.rootElementId);
								const elementIds = execution.insertedElementIds ?? [];
								return createJsonResult({
									status: "success",
									project: getProjectReference(context),
									newRevision: write.revision,
									rootElementId,
									idMap: execution.idMap ?? {},
									inserted: {
										nodeCount: elementIds.length,
										rootElementId,
										elementIds,
									},
									recipeExpansions: execution.recipeExpansions ?? [],
									...(execution.changedElementId
										? {
												changedElement: getCompactElementSummary(
													execution.design,
													execution.changedElementId,
												),
												context: getMutationContext(
													execution.design,
													execution.changedElementId,
												),
											}
										: {}),
									...(await getMutationDiagnostics(
										context,
										write.design,
										response,
										execution.affectedElementIds,
									)),
								});
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"copySubtree",
		{
			title: "Copy Subtree",
			description:
				"Copy an existing source subtree into a target design. Requires expectedRevision for the target and sourceExpectedRevision for cross-file copies. Returns the new rootElementId and nodeCount; pass includeIdMap for the source->copy id map. Warnings cover the inserted copy.",
			inputSchema: validateCopySubtreePayloadSchema
				.extend(projectScopedInputSchema)
				.extend({
					includeIdMap: z
						.boolean()
						.optional()
						.describe("Also return the source->copy element id map."),
					response: mutationResponseInputSchema,
				}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async (input) => {
			return withProjectContext(input.project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const payload = normalizeCopySubtreePayload(input);
				const sameDesign =
					payload.sourceDesignFileId === payload.targetDesignFileId;
				return withMutationErrorHandling(
					context,
					{
						toolName: "copySubtree",
						operation: "copySubtree",
						projectId: context.config.projectId ?? null,
						designFileId: payload.targetDesignFileId,
						expectedRevision: payload.expectedRevision,
						details: {
							sourceDesignFileId: payload.sourceDesignFileId,
							sourceElementId: payload.sourceElementId,
							sourceExpectedRevision: payload.sourceExpectedRevision ?? null,
							parentId: payload.parentId,
							index: payload.index,
							options: payload.options ?? null,
						},
					},
					async () => {
						assertCanReadDesignFile(policy, payload.sourceDesignFileId);
						assertCanWriteDesignFile(policy, payload.targetDesignFileId);
						if (!sameDesign && payload.sourceExpectedRevision === undefined) {
							throw new DesignTransformError(
								"SOURCE_REVISION_REQUIRED",
								"sourceExpectedRevision is required for cross-design copySubtree.",
							);
						}
						return mutateDesignFile(
							context,
							{
								designFileId: payload.targetDesignFileId,
								expectedRevision: payload.expectedRevision,
							},
							{
								// One read per design: the target read doubles as the
								// source of a same-design copy.
								load: async (targetRead, readDesignFile) =>
									sameDesign
										? targetRead
										: await readDesignFile(payload.sourceDesignFileId),
								mutate: async (targetRead, sourceRead) => {
									if (
										payload.sourceExpectedRevision !== undefined &&
										sourceRead.revision !== payload.sourceExpectedRevision
									) {
										throw new DesignTransformError(
											"SOURCE_REVISION_MISMATCH",
											"The copy source design changed since your last read. Re-read it and retry with its current revision.",
											{
												currentSourceRevision: sourceRead.revision,
												sourceExpectedRevision: payload.sourceExpectedRevision,
											},
										);
									}
									const execution = await executeDesignOperation(
										createDesignOperationDependencies(context),
										targetRead.design,
										"copySubtree",
										{
											sourceDesignFileId: payload.sourceDesignFileId,
											sourceElementId: payload.sourceElementId,
											parentId: payload.parentId,
											index: payload.index,
											options: payload.options,
										},
										{
											designFileId: payload.targetDesignFileId,
											sourceDesigns: new Map([
												[payload.sourceDesignFileId, sourceRead.design],
											]),
										},
									);
									return { design: execution.design, execution };
								},
								respond: async ({ execution }, write) =>
									createJsonResult({
										status: "success",
										project: getProjectReference(context),
										newRevision: write.revision,
										rootElementId: String(execution.summary.rootElementId),
										nodeCount: execution.insertedElementIds?.length ?? 0,
										...(input.includeIdMap || input.response === "full"
											? { idMap: execution.idMap ?? {} }
											: {}),
										...(await getMutationDiagnostics(
											context,
											write.design,
											input.response,
											execution.affectedElementIds,
										)),
									}),
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"renameDesignFile",
		{
			title: "Rename Design File",
			description:
				"Rename a design file by updating its design-level name. Requires expectedRevision from a prior read.",
			inputSchema: withMutationScopedInput({
				designFileId: designFileIdSchema,
				expectedRevision: expectedRevisionSchema,
				...OPERATION_PARAMETER_SHAPES.renameDesignFile,
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ designFileId, expectedRevision, name, response, project }) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "renameDesignFile",
						operation: "renameDesignFile",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return mutateDesignWithOperation(
							context,
							{ designFileId, expectedRevision },
							"renameDesignFile",
							{ name },
							async (execution, write) => {
								await notifyResourceListChanged();

								return createJsonResult({
									status: "success",
									project: getProjectReference(context),
									newRevision: write.revision,
									designFile: {
										id: designFileId,
										file: write.file,
										name: write.design.name,
										systemId: write.design.systemId ?? null,
										systemName: await getDesignSystemDisplayName(
											context,
											write.design,
										),
										revision: write.revision,
									},
									...(await getMutationDiagnostics(
										context,
										write.design,
										response,
										execution.affectedElementIds,
									)),
								});
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"applyDesignOperations",
		{
			title: "Apply Design Operations",
			description:
				"Validate and commit an ordered list of design operations atomically against one expectedRevision; one write, or none if any step fails. Returns newRevision, `created` ids per inserting step (root id, addSubtree tempId map, recipe slot ids), deletedCount, error issues, warningCount and grouped likely-typo warnings on touched elements. A failing step returns failedStepIndex, its error and expectedParameters.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				expectedRevision: expectedRevisionSchema,
				operations: createOperationPlanStepsInputSchema(
					"Ordered design operations to commit.",
				),
				response: mutationResponseInputSchema,
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: true,
				idempotentHint: false,
			},
		},
		async ({ designFileId, expectedRevision, operations, response, project }) =>
			withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "applyDesignOperations",
						operation: "applyDesignOperations",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: {
							operationCount: operations.length,
						},
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						return applyDesignOperationsPayload(context, {
							designFileId,
							expectedRevision,
							operations,
							response,
						});
					},
				);
			}),
	);
};
