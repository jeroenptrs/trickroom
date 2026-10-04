import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
	applyExtractSubtree,
	DesignTransformError,
	normalizeDesignForMutation,
} from "../../services/design-transform-service";
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
	compactElementTree,
	createBlankDesign,
	findElementContext,
	getDesignMetadata,
	readDesignFileForTool,
} from "../payloads/design-tree";
import { applyDesignOperationsPayload } from "../payloads/design-validation";
import { getProjectReference } from "../payloads/project";
import {
	assertCanUseSubtreeComponents,
	assertResourceReferencesExist,
} from "../payloads/references";
import { TOOL } from "../tool-names";
import { mutationAnnotations } from "./annotations";
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
		TOOL.designApply,
		{
			title: "Apply Design Operations",
			description: `Write to a design: an ordered list of operations, validated together and committed atomically against expectedRevision. One write, or none when a step fails or the plan adds error issues; errors the design already had do not block it (preExistingErrorCount). A single edit is a list of one. Returns newRevision for your next write, \`created\` ids per inserting step (root id, addSubtree tempId map, recipe slot ids), deletedCount, error issues, warningCount and grouped likely-typo warnings on touched elements; response "full" adds every warning and each step's summary. A failing step returns failedStepIndex, its error with hints and expectedParameters. Later steps reference elements created by earlier ones with $step:N, $step:N:tempId:<tempId> and $step:N:slot:<slot>. Parameters and examples: ${TOOL.guide}({ topic: "operations" }). Dry-run with ${TOOL.designValidate}. After a write the human should see, ${TOOL.editorFocus} points their editor at it.`,
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
