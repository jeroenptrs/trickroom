import { z } from "zod";
import {
	describeOperationCatalogue,
	designOperationNameSchema,
	OPERATION_PARAMETER_SHAPES,
} from "../design-operations";
import {
	addSubtreeOptionsSchema,
	validateSubtreeOptionsSchema,
} from "../subtree-schemas";
import { designFileIdSchema, expectedRevisionSchema } from "./schemas";

const { copySubtree: copySubtreeShape, addSubtree: addSubtreeShape } =
	OPERATION_PARAMETER_SHAPES;

export const validateSubtreePayloadSchema = z
	.object({
		designFileId: designFileIdSchema,
		expectedRevision: expectedRevisionSchema,
		...addSubtreeShape,
		options: validateSubtreeOptionsSchema.optional(),
	})
	.strict();

export const addSubtreePayloadSchema = validateSubtreePayloadSchema.extend({
	options: addSubtreeOptionsSchema.optional(),
});

export const validateCopySubtreePayloadSchema = z
	.object({
		...copySubtreeShape,
		sourceDesignFileId: copySubtreeShape.sourceDesignFileId.optional(),
		sourceExpectedRevision: copySubtreeShape.sourceExpectedRevision.describe(
			"Source revision; required for cross-design copies.",
		),
		targetDesignFileId: designFileIdSchema.describe("Target design file UUID."),
		expectedRevision: expectedRevisionSchema,
	})
	.strict();

export type AddSubtreeOperationParameters = z.infer<
	z.ZodObject<typeof addSubtreeShape>
>;
export type CopySubtreeOperationParameters = z.infer<
	z.ZodObject<typeof copySubtreeShape>
>;

const OPERATIONS_TOPIC_HINT =
	'Full parameters and examples: getDesignAuthoringContract({ topic: "operations" }).';

/** One line per operation with its required parameters (… = optional ones). */
export const OPERATION_CATALOGUE_DESCRIPTION = `Operations and required parameters (… = optional ones):\n${describeOperationCatalogue()}\n${OPERATIONS_TOPIC_HINT}`;

export const createOperationPlanStepsInputSchema = (purpose: string) =>
	z
		.array(
			z.object({
				operation: designOperationNameSchema,
				parameters: z
					.record(z.string(), z.unknown())
					.optional()
					.describe("Parameters for this operation."),
			}),
		)
		.min(1)
		.describe(
			`${purpose} ${OPERATION_CATALOGUE_DESCRIPTION} Element id parameters accept $step:N, $step:N:tempId:<tempId> and $step:N:slot:<slot> references to earlier steps.`,
		);

export {
	addSubtreeOptionsSchema,
	proposedElementNodeSchema,
	proposedRecipeNodeSchema,
	proposedSubtreeNodeSchema,
	validateCopySubtreeOptionsSchema,
	validateSubtreeOptionsSchema,
} from "../subtree-schemas";
