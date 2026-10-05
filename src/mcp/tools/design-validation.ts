import { DesignTransformError } from "../../services/design-transform-service";
import {
	validateDesignFilePayload,
	validateOperationPlanPayload,
} from "../payloads/design-validation";
import { TOOL } from "../tool-names";
import {
	readOnlyClosedWorldAnnotations,
	SEARCH_HINT_META_KEY,
} from "./annotations";
import type { McpToolContext } from "./context";
import { createOperationPlanStepsInputSchema } from "./operation-schemas";
import { createJsonResult } from "./results";
import {
	designFileIdSchema,
	expectedRevisionSchema,
	mutationResponseInputSchema,
	withProjectScopedInput,
} from "./schemas";

// Validation results share one shape (see createValidationResult): status,
// valid, a per-code summary, error issues, grouped warnings, then
// tool-specific fields. Dry-runs scope warnings to the elements they touch.
export const registerDesignValidationTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		TOOL.designValidate,
		{
			title: "Validate Design",
			description: `Validate without writing. Without operations: check the whole design file (payload integrity, duplicate ids, registry and design-system references, class tokens) and return every issue. With operations and expectedRevision: dry-run ${TOOL.designApply}'s steps against that revision with the same executor, and return what each step would do (\`predicted\`) and the issues on the elements they touch, or the first failing step. Results share one shape: status, valid, a per-code summary, error issues, and warnings grouped by code and class; response "full" lists warnings ungrouped and adds token diagnostics and step details. Dry-runs never return generated ids.`,
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				operations: createOperationPlanStepsInputSchema(
					`Steps to dry-run, exactly as ${TOOL.designApply} takes them (its operations parameter lists every operation). Omit to validate the whole file.`,
					{ catalogue: false },
				).optional(),
				expectedRevision: expectedRevisionSchema
					.optional()
					.describe("Revision to dry-run against. Required with operations."),
				response: mutationResponseInputSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"check lint errors warnings dry-run preview test operations",
			},
		},
		async ({ designFileId, operations, expectedRevision, response, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				if (operations === undefined) {
					return createJsonResult(
						await validateDesignFilePayload(context, designFileId, {
							detail: response,
						}),
					);
				}
				if (expectedRevision === undefined) {
					throw new DesignTransformError(
						"INVALID_OPERATION_PARAMETERS",
						"expectedRevision is required with operations: pass the revision from your last read.",
					);
				}
				return createJsonResult(
					await validateOperationPlanPayload(context, {
						designFileId,
						expectedRevision,
						operations,
						detail: response,
					}),
				);
			}),
	);
};
