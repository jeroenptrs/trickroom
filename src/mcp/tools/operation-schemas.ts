import { z } from "zod";
import {
	describeOperationParameterSignatures,
	designOperationNameSchema,
} from "../design-operations";
import { STEP_REFERENCE_GUIDANCE } from "../guidance";
import {
	addSubtreeOptionsSchema,
	proposedSubtreeNodeSchema,
	validateCopySubtreeOptionsSchema,
	validateSubtreeOptionsSchema,
} from "../subtree-schemas";
import { systemComponentInstanceOverrideSchema } from "../system-component-schemas";
import {
	designFileIdSchema,
	expectedRevisionSchema,
	jsonPrimitiveSchema,
} from "./schemas";

export const validateSubtreePayloadSchema = z
	.object({
		designFileId: designFileIdSchema,
		expectedRevision: expectedRevisionSchema,
		parentId: z
			.string()
			.min(1)
			.nullable()
			.describe("Parent element ID, or null to validate root insertion."),
		index: z
			.number()
			.int()
			.min(0)
			.describe(
				"Strict insertion index within the parent's children or the root. Valid range is 0..childCount.",
			),
		subtree: proposedSubtreeNodeSchema,
		options: validateSubtreeOptionsSchema.optional(),
	})
	.strict();

export const addSubtreePayloadSchema = validateSubtreePayloadSchema.extend({
	options: addSubtreeOptionsSchema.optional(),
});

export const validateCopySubtreePayloadSchema = z
	.object({
		sourceDesignFileId: designFileIdSchema
			.optional()
			.describe(
				"Source design file UUID. Defaults to targetDesignFileId (a same-file copy).",
			),
		sourceElementId: z
			.string()
			.min(1)
			.describe("Source subtree root element ID."),
		sourceExpectedRevision: expectedRevisionSchema
			.optional()
			.describe(
				"Required for cross-file copies. Optional for same-file copies, where expectedRevision covers both source and target.",
			),
		targetDesignFileId: designFileIdSchema.describe("Target design file UUID."),
		expectedRevision: expectedRevisionSchema,
		parentId: z
			.string()
			.min(1)
			.nullable()
			.describe("Target parent element ID, or null to insert at root."),
		index: z
			.number()
			.int()
			.min(0)
			.describe(
				"Strict insertion index within the target parent's children or the root.",
			),
		options: validateCopySubtreeOptionsSchema.optional(),
	})
	.strict();

export const addRecipeOperationParameterSchema = {
	parentId: z
		.string()
		.min(1)
		.nullable()
		.describe("Parent element ID, or null to add at the design root."),
	index: z
		.number()
		.int()
		.min(0)
		.describe("Insertion index within the parent's children or the root."),
	library: z.string().min(1).describe("Registry library id, e.g. 'base-ui'."),
	recipe: z
		.string()
		.min(1)
		.describe(
			"Registry recipe id, e.g. 'avatar.default' or 'base-ui/avatar.default'.",
		),
} as const;

export const detachRecipeInstanceOperationParameterSchema = {
	elementId: z
		.string()
		.min(1)
		.describe("Any element ID inside the attached recipe structure to detach."),
} as const;

export const addSystemComponentOperationParameterSchema = {
	parentId: z
		.string()
		.min(1)
		.nullable()
		.describe("Parent element ID, or null to add at the design root."),
	index: z
		.number()
		.int()
		.min(0)
		.describe("Insertion index within the parent's children or the root."),
	systemId: z
		.string()
		.min(1)
		.describe("Design system id from the component manifest."),
	componentId: z.string().min(1).describe("Published system component id."),
	version: z
		.string()
		.min(1)
		.nullable()
		.optional()
		.describe(
			"Published component version. Omit or pass null to use the manifest currentVersion.",
		),
	variantValues: z
		.record(z.string(), z.string())
		.optional()
		.describe(
			"Initial variant axis values for the instance. Omitted axes remain unset unless the component schema defines defaults.",
		),
	unsetVariantAxes: z
		.array(z.string())
		.optional()
		.describe(
			"Variant axes to clear from initial variantValues before resolving schema defaults.",
		),
	overrides: z
		.record(z.string(), systemComponentInstanceOverrideSchema)
		.optional()
		.describe(
			"Initial instance overrides keyed by declared override target id.",
		),
} as const;

export const updateSystemComponentInstanceOperationParameterSchema = {
	rootElementId: z
		.string()
		.min(1)
		.describe("Attached system component root element ID."),
	variantValues: z
		.record(z.string(), z.string())
		.optional()
		.describe(
			"Variant axis values to merge into the instance. Missing keys leave existing values unchanged.",
		),
	unsetVariantAxes: z
		.array(z.string())
		.optional()
		.describe("Variant axes to clear from the instance."),
	overrides: z
		.record(z.string(), systemComponentInstanceOverrideSchema)
		.optional()
		.describe(
			"Instance overrides keyed by declared override target id. Replaces the full override map when provided.",
		),
} as const;

export const detachSystemComponentOperationParameterSchema = {
	elementId: z
		.string()
		.min(1)
		.describe(
			"Any element ID inside the attached system component instance to detach.",
		),
} as const;

export const updateRecipeInstanceOperationParameterSchema = {
	elementId: z
		.string()
		.min(1)
		.describe("Any element ID inside the stale attached recipe instance."),
} as const;

export const updateRecipeControlOperationParameterSchema = {
	instanceId: z.string().min(1).describe("Attached recipe instance ID."),
	path: z
		.string()
		.min(1)
		.describe("Declared recipe template path for the control target."),
	prop: z.string().min(1).describe("Declared recipe control prop."),
	value: jsonPrimitiveSchema.describe("New recipe control value."),
} as const;

const addSubtreeOperationParametersSchema = z.object({
	parentId: z
		.string()
		.min(1)
		.nullable()
		.describe("Target parent element ID, or null to validate root insertion."),
	index: z
		.number()
		.int()
		.min(0)
		.describe(
			"Strict insertion index within the target parent's children or the root. Valid range is 0..childCount.",
		),
	subtree: proposedSubtreeNodeSchema,
	options: addSubtreeOptionsSchema.optional(),
});

const copySubtreeOperationParametersSchema = z.object({
	sourceDesignFileId: designFileIdSchema.describe("Source design file UUID."),
	sourceElementId: z
		.string()
		.min(1)
		.describe("Source subtree root element ID."),
	sourceExpectedRevision: expectedRevisionSchema
		.optional()
		.describe(
			"Required for cross-file copies. Optional for same-file copies, where expectedRevision covers both source and target.",
		),
	parentId: z
		.string()
		.min(1)
		.nullable()
		.describe("Target parent element ID, or null to insert at root."),
	index: z
		.number()
		.int()
		.min(0)
		.describe(
			"Strict insertion index within the target parent's children or the root.",
		),
	options: validateCopySubtreeOptionsSchema.optional(),
});

export type AddSubtreeOperationParameters = z.infer<
	typeof addSubtreeOperationParametersSchema
>;
export type CopySubtreeOperationParameters = z.infer<
	typeof copySubtreeOperationParametersSchema
>;

export const createOperationPlanStepsInputSchema = (purpose: string) =>
	z
		.array(
			z.object({
				operation: designOperationNameSchema,
				parameters: z
					.record(z.string(), z.unknown())
					.optional()
					.describe(
						"Parameters for this operation; see the per-operation signatures on the operations field.",
					),
			}),
		)
		.min(1)
		.describe(
			`${purpose} Parameters per operation (? = optional, primitive = string | number | boolean | null): ${describeOperationParameterSignatures()}. ${STEP_REFERENCE_GUIDANCE}`,
		);

export {
	addSubtreeOptionsSchema,
	proposedElementNodeSchema,
	proposedRecipeNodeSchema,
	proposedSubtreeNodeSchema,
	validateCopySubtreeOptionsSchema,
	validateSubtreeOptionsSchema,
} from "../subtree-schemas";
