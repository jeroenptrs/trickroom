import { z } from "zod";
import {
	describeOperationCatalogue,
	designOperationNameSchema,
} from "../design-operations";
import { TOOL } from "../tool-names";

const OPERATIONS_TOPIC_HINT = `Full parameters and examples: ${TOOL.guide}({ topic: "operations" }).`;

/** One line per operation with its required parameters (… = optional ones). */
export const OPERATION_CATALOGUE_DESCRIPTION = `Operations and required parameters (… = optional ones):\n${describeOperationCatalogue()}\n${OPERATIONS_TOPIC_HINT}`;

/**
 * The operations array of design_apply and design_validate. Only the write
 * tool carries the operation catalogue in its description; the dry-run
 * points at it, so the catalogue is not paid for twice.
 */
export const createOperationPlanStepsInputSchema = (
	purpose: string,
	options: { catalogue?: boolean } = {},
) =>
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
			options.catalogue === false
				? purpose
				: `${purpose} ${OPERATION_CATALOGUE_DESCRIPTION} Element id parameters accept $step:N, $step:N:tempId:<tempId> and $step:N:slot:<slot> references to earlier steps.`,
		);
