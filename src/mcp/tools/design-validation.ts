import { z } from "zod";
import { designOperationNameSchema } from "../design-operations";
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
	OPERATION_CATALOGUE_DESCRIPTION,
	validateCopySubtreePayloadSchema,
	validateSubtreePayloadSchema,
} from "./operation-schemas";
import { createJsonResult } from "./results";
import {
	designFileIdSchema,
	expectedRevisionSchema,
	mutationResponseInputSchema,
	projectScopedInputSchema,
	withProjectScopedInput,
} from "./schemas";

// Validation results share one shape (see createValidationResult): status,
// valid, a per-code summary, error issues, grouped warnings, then
// tool-specific fields. Dry-runs scope warnings to the elements they touch.
export const registerDesignValidationTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		"validateDesignFile",
		{
			title: "Validate Design File",
			description:
				"Validate an existing design file without mutation: payload integrity, duplicate element IDs, registry and design-system references, and class tokens. Returns a per-code summary, every error, and warnings grouped by code and class.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				response: mutationResponseInputSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, response, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await validateDesignFilePayload(context, designFileId, {
						detail: response,
					}),
				),
			),
	);

	server.registerTool(
		"validateOperation",
		{
			title: "Validate Operation",
			description:
				"Dry-run one design operation against the current revision without writing, returning what it would change and the diagnostics on the elements it touches.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				expectedRevision: expectedRevisionSchema,
				operation: designOperationNameSchema.describe(
					"Operation type to dry-run.",
				),
				parameters: z
					.record(z.string(), z.unknown())
					.optional()
					.describe(OPERATION_CATALOGUE_DESCRIPTION),
				response: mutationResponseInputSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			operation,
			parameters,
			response,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await validateOperationPayload(
						context,
						designFileId,
						expectedRevision,
						operation,
						parameters,
						response,
					),
				),
			),
	);

	server.registerTool(
		"validateOperationPlan",
		{
			title: "Validate Operation Plan",
			description:
				"Dry-run an ordered list of design operations (the applyDesignOperations steps) against one starting revision without writing. Returns the diagnostics on the elements the plan touches, or the first failing step.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				expectedRevision: expectedRevisionSchema,
				operations: createOperationPlanStepsInputSchema(
					"Ordered design operations to dry-run.",
				),
				response: mutationResponseInputSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, expectedRevision, operations, response, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await validateOperationPlanPayload(context, {
						designFileId,
						expectedRevision,
						operations,
						detail: response,
					}),
				),
			),
	);

	server.registerTool(
		"validateSubtree",
		{
			title: "Validate Subtree",
			description:
				"Validate a candidate subtree insertion against expected revision without mutation.",
			inputSchema: validateSubtreePayloadSchema
				.extend(projectScopedInputSchema)
				.extend({ response: mutationResponseInputSchema }),
			annotations: readOnlyClosedWorldAnnotations,
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
						detail: response,
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
			inputSchema: validateCopySubtreePayloadSchema
				.extend(projectScopedInputSchema)
				.extend({ response: mutationResponseInputSchema }),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async (input) =>
			withPolicyErrorHandling(input.project, async (context) =>
				createJsonResult(
					await validateCopySubtreePayload(context, {
						...normalizeCopySubtreePayload(input),
						detail: input.response,
					}),
				),
			),
	);
};
