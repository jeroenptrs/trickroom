import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
	createDesignFileService,
	DesignFileServiceError,
} from "../../services/design-file-service";
import {
	applyAddSubtree,
	applyCopySubtree,
	applyExtractSubtree,
	DesignTransformError,
	normalizeDesignForMutation,
} from "../../services/design-transform-service";
import { findDesignSystem } from "../../utils/design-system-store";
import { applyProjectDefaultSystemToDesign } from "../../utils/project-default-system";
import { stripHeavyTokenDiagnostics } from "../diagnostics";
import {
	assertCanReadDesignFile,
	assertCanWriteDesignFile,
	getMcpPolicy,
	McpPolicyError,
} from "../governance";
import {
	assertConfiguredSystem,
	canonicalizeDesignSystemReferenceForStorage,
	getDesignSystemDisplayName,
	summarizeDesignSystemReference,
} from "../payloads/design-system";
import {
	compactElementTree,
	createBlankDesign,
	findElementContext,
	getCompactElementSummary,
	getDesignMetadata,
	getDesignSystemHandle,
	getMutationContext,
} from "../payloads/design-tree";
import {
	applyDesignOperationsPayload,
	normalizeCopySubtreePayload,
	validateCopySubtreePayload,
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
	getMutationDiagnostics,
	withMutationErrorHandling,
} from "./mutation-support";
import {
	addSubtreePayloadSchema,
	createOperationPlanStepsInputSchema,
	validateCopySubtreePayloadSchema,
} from "./operation-schemas";
import {
	createInvalidOperationResult,
	createJsonResult,
	createRevisionMismatchResult,
} from "./results";
import {
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
				designFileId: z
					.string()
					.uuid()
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

						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(newDesignFileId);
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
						const write = await service.createDesignFile(file, design);
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
				designFileId: z.string().uuid().describe("Source design file UUID."),
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
				newDesignFileId: z
					.string()
					.uuid()
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

						const service = createDesignFileService(context.projectRoot);
						const sourceFile = service.getFileForUuid(designFileId);
						const sourceRead = await service.readDesignFile(sourceFile);
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
						const newDesign = await canonicalizeDesignSystemReferenceForStorage(
							context,
							result.newDesign,
						);
						await assertResourceReferencesExist(context, newDesign);

						const targetFile = service.getFileForUuid(targetDesignFileId);
						const write = await service.createDesignFile(targetFile, newDesign);
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
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}

						const result = applyAddSubtree(read.design, {
							parentId,
							index,
							subtree,
							options,
						});

						const insertedRootContext = findElementContext(
							result.design,
							result.rootElementId,
						);
						if (!insertedRootContext) {
							throw new DesignTransformError(
								"INVALID_OPERATION",
								"Failed to validate inserted subtree root after applying mutation.",
							);
						}
						assertCanUseSubtreeComponents(policy, insertedRootContext.element);
						await assertResourceReferencesExist(context, result.design);

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							rootElementId: result.rootElementId,
							idMap: result.idMap,
							inserted: result.inserted,
							recipeExpansions: result.recipeExpansions,
							changedElement: getCompactElementSummary(
								result.design,
								result.changedElementId,
							),
							context: getMutationContext(
								result.design,
								result.changedElementId,
							),
							...(await getMutationDiagnostics(
								context,
								write.design,
								response,
								result.inserted.elementIds,
							)),
						});
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
				"Copy an existing source subtree into a target design. Requires expectedRevision for the target and sourceExpectedRevision for cross-file copies. The idMap of old->new element IDs is always returned; responses include warningCount and likely-typo warnings on the inserted subtree by default, with more via the response field.",
			inputSchema: validateCopySubtreePayloadSchema
				.extend(projectScopedInputSchema)
				.extend({
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
				const responseOptions = input.response;
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
						const validation = await validateCopySubtreePayload(
							context,
							payload,
						);
						if (validation.status === "REVISION_MISMATCH") {
							return createRevisionMismatchResult(
								context,
								validation.currentRevision,
								payload.expectedRevision,
							);
						}
						if (validation.status === "SOURCE_REVISION_MISMATCH") {
							return createJsonResult(validation);
						}
						if (validation.status !== "success" || validation.valid !== true) {
							const firstError = validation.diagnostics.find(
								(diagnostic) => diagnostic.severity === "error",
							);
							const invalidPayload = {
								...validation,
								status: "INVALID_OPERATION",
								tokenDiagnostics: stripHeavyTokenDiagnostics(
									validation.tokenDiagnostics ?? null,
									responseOptions?.includeTokenDiagnostics ?? false,
								),
								...(firstError
									? {
											code: firstError.code,
											message: firstError.message,
										}
									: {}),
							};
							return {
								content: [
									{
										type: "text",
										text: JSON.stringify(invalidPayload),
									},
								],
								structuredContent: invalidPayload,
								isError: true,
							};
						}

						const sameDesign =
							payload.sourceDesignFileId === payload.targetDesignFileId;
						assertCanReadDesignFile(policy, payload.sourceDesignFileId);
						assertCanWriteDesignFile(policy, payload.targetDesignFileId);
						const service = createDesignFileService(context.projectRoot);
						const targetFile = service.getFileForUuid(
							payload.targetDesignFileId,
						);
						const targetRead = await service.readDesignFile(targetFile);
						const sourceRead = sameDesign
							? targetRead
							: await service.readDesignFile(
									service.getFileForUuid(payload.sourceDesignFileId),
								);

						if (targetRead.revision !== payload.expectedRevision) {
							return createRevisionMismatchResult(
								context,
								targetRead.revision,
								payload.expectedRevision,
							);
						}
						if (
							payload.sourceExpectedRevision !== undefined &&
							sourceRead.revision !== payload.sourceExpectedRevision
						) {
							return createJsonResult({
								status: "SOURCE_REVISION_MISMATCH",
								project: getProjectReference(context),
								sourceDesignFile: getDesignMetadata(
									payload.sourceDesignFileId,
									sourceRead,
								),
								targetDesignFile: getDesignMetadata(
									payload.targetDesignFileId,
									targetRead,
								),
								currentSourceRevision: sourceRead.revision,
								sourceExpectedRevision: payload.sourceExpectedRevision,
								expectedRevision: payload.expectedRevision,
								message:
									"Expected source revision does not match current revision.",
								suggestedReads: ["readDesignFile", "readDesignGraph"],
							});
						}

						const sourceElementContext = findElementContext(
							sourceRead.design,
							payload.sourceElementId,
						);
						if (!sourceElementContext) {
							throw new DesignTransformError(
								"ELEMENT_NOT_FOUND",
								`Element "${payload.sourceElementId}" not found.`,
							);
						}
						assertCanUseSubtreeComponents(policy, sourceElementContext.element);

						const result = await applyCopySubtree(
							sourceRead.design,
							targetRead.design,
							{
								sourceElementId: payload.sourceElementId,
								parentId: payload.parentId,
								index: payload.index,
								sameDesign,
								projectRoot: context.projectRoot,
							},
						);
						await assertResourceReferencesExist(context, result.design);

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(targetFile, nextDesign, {
								expectedRevision: payload.expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(targetFile);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									payload.expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							sourceDesignFile: getDesignMetadata(
								payload.sourceDesignFileId,
								sourceRead,
							),
							targetDesignFile: {
								id: payload.targetDesignFileId,
								file: write.file,
								name: write.design.name,
								systemId: write.design.systemId ?? null,
								systemName:
									(
										await summarizeDesignSystemReference(
											context,
											getDesignSystemHandle(write.design),
										)
									)?.systemName ?? null,
								revision: write.revision,
							},
							newRevision: write.revision,
							sourceElementId: payload.sourceElementId,
							rootElementId: result.rootElementId,
							idMap: result.idMap,
							inserted: result.inserted,
							changedElement: getCompactElementSummary(
								result.design,
								result.rootElementId,
							),
							context: getMutationContext(result.design, result.rootElementId),
							...(await getMutationDiagnostics(
								context,
								write.design,
								responseOptions,
								Object.values(result.idMap),
							)),
						});
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
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				name: z.string().min(1).describe("New design file name."),
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
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(context, {
									...read.design,
									name,
								});
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}
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
								[],
							)),
						});
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
				"Validate and commit an ordered list of design operations atomically against one expectedRevision. Performs exactly one persisted write when the full plan is valid and the starting revision still matches. Responses are compact by default: newRevision, per-step created ids (changedElementId, idMap for addSubtree tempIds, recipe roots), error issues, warningCount, and likely-typo warnings on touched elements; use the response field for all warnings, token diagnostics, or full step details.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current revision from a prior read."),
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
						try {
							const { status, valid, payload } =
								await applyDesignOperationsPayload(context, {
									designFileId,
									expectedRevision,
									operations,
									response,
									project,
								});
							if (
								status === "invalid" ||
								status === "REVISION_MISMATCH" ||
								status === "SOURCE_REVISION_MISMATCH" ||
								(status === "success" && valid === false)
							) {
								return {
									content: [
										{
											type: "text",
											text: JSON.stringify(payload),
										},
									],
									structuredContent: payload,
									isError: true,
								};
							}
							return createJsonResult(payload);
						} catch (error) {
							if (error instanceof DesignTransformError) {
								return createInvalidOperationResult(context, error);
							}
							throw error;
						}
					},
				);
			}),
	);
};
