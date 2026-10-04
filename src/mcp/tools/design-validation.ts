import { z } from "zod";
import { DesignTransformError } from "../../services/design-transform-service";
import {
	type DesignOperationName,
	describeOperationParameterSignatures,
} from "../design-operations";
import {
	normalizeCopySubtreePayload,
	validateCopySubtreePayload,
	validateDesignFilePayload,
	validateOperationPayload,
	validateOperationPlanPayload,
	validateSubtreePayload,
} from "../payloads/design-validation";
import { readOnlyClosedWorldAnnotations } from "./annotations";
import type { McpToolContext } from "./context";
import {
	createOperationPlanStepsInputSchema,
	validateCopySubtreePayloadSchema,
	validateSubtreePayloadSchema,
} from "./operation-schemas";
import { createInvalidOperationResult, createJsonResult } from "./results";
import { projectScopedInputSchema, withProjectScopedInput } from "./schemas";

export const registerDesignValidationTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		"validateDesignFile",
		{
			title: "Validate Design File",
			description:
				"Validate an existing design file without mutation, including payload integrity, duplicate element IDs, registry references, and design-system references.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				includeTokenDiagnostics: z
					.boolean()
					.optional()
					.describe(
						"Include heavy token diagnostics such as custom utility catalogs. Defaults to false.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, includeTokenDiagnostics, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await validateDesignFilePayload(context, designFileId, {
						includeTokenDiagnostics,
					}),
				),
			),
	);

	server.registerTool(
		"validateOperation",
		{
			title: "Validate Operation",
			description:
				"Dry-run one design operation against the current revision without writing, returning predicted changes and diagnostics.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current revision from a prior read."),
				operation: z
					.enum([
						"renameDesignFile",
						"addElement",
						"addRecipe",
						"addSystemComponent",
						"updateSystemComponentInstance",
						"detachSystemComponent",
						"addSubtree",
						"updateElementProps",
						"updateRecipeControl",
						"updateRecipeInstance",
						"updateElementText",
						"moveElement",
						"deleteElement",
						"copySubtree",
						"detachRecipeInstance",
					])
					.describe("Operation type to dry-run."),
				parameters: z
					.record(z.string(), z.unknown())
					.optional()
					.describe(
						`Operation-specific parameters (? = optional): ${describeOperationParameterSignatures()}.`,
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			operation,
			parameters,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				try {
					return createJsonResult(
						await validateOperationPayload(
							context,
							designFileId,
							expectedRevision,
							operation as DesignOperationName,
							parameters,
						),
					);
				} catch (error) {
					if (error instanceof DesignTransformError) {
						return createInvalidOperationResult(context, error);
					}
					throw error;
				}
			}),
	);

	server.registerTool(
		"validateOperationPlan",
		{
			title: "Validate Operation Plan",
			description:
				"Dry-run an ordered list of design operations against one starting revision without writing. Returns per-step summaries, aggregate change metadata, and final diagnostics. Later steps may reference earlier step outputs using $step:N, $step:N:rootElementId, $step:N:tempId:<tempId>, or $step:N:slot:<slotName>.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current revision from a prior read."),
				operations: createOperationPlanStepsInputSchema(
					"Ordered design operations to dry-run.",
				),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, expectedRevision, operations, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				try {
					return createJsonResult(
						await validateOperationPlanPayload(context, {
							designFileId,
							expectedRevision,
							operations,
						}),
					);
				} catch (error) {
					if (error instanceof DesignTransformError) {
						return createInvalidOperationResult(context, error);
					}
					throw error;
				}
			}),
	);

	server.registerTool(
		"validateSubtree",
		{
			title: "Validate Subtree",
			description:
				"Validate a candidate subtree insertion against expected revision without mutation.",
			inputSchema: validateSubtreePayloadSchema.extend(
				projectScopedInputSchema,
			),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			parentId,
			index,
			subtree,
			options,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await validateSubtreePayload(context, {
						designFileId,
						expectedRevision,
						parentId,
						index,
						subtree,
						options,
					}),
				),
			),
	);

	server.registerTool(
		"validateCopySubtree",
		{
			title: "Validate Copy Subtree",
			description:
				"Validate copying an existing source subtree into a target design insertion point without mutation.",
			inputSchema: validateCopySubtreePayloadSchema.extend(
				projectScopedInputSchema,
			),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async (input) =>
			withPolicyErrorHandling(input.project, async (context) =>
				createJsonResult(
					await validateCopySubtreePayload(
						context,
						normalizeCopySubtreePayload(input),
					),
				),
			),
	);
};
