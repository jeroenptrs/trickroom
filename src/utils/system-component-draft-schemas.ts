import { z } from "zod";
import type { RecipeTemplateNode } from "../types";
import type {
	SystemComponentDraftPayload,
	SystemComponentOverrideCapability,
	SystemComponentOverrideTarget,
	SystemComponentSlotDefinition,
	SystemComponentVariantSchema,
} from "./system-components";

const jsonPrimitiveSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
]);

export const recipeTemplateNodeSchema: z.ZodType<RecipeTemplateNode> = z.lazy(
	() =>
		z
			.object({
				path: z
					.string()
					.min(1)
					.describe(
						"Stable template path for this node. Use root for the root node and unique slashless identifiers for descendants.",
					),
				library: z
					.string()
					.min(1)
					.describe("Registry library id, for example trickroom or base-ui."),
				component: z
					.string()
					.min(1)
					.describe("Registry component id inside the selected library."),
				name: z
					.string()
					.optional()
					.describe("Optional human-readable layer name."),
				className: z
					.string()
					.optional()
					.describe("Optional Tailwind class string for this template node."),
				props: z
					.record(z.string(), jsonPrimitiveSchema)
					.optional()
					.describe("Optional JSON-primitive registry control props."),
				text: z
					.string()
					.optional()
					.describe("Text content for text-role template nodes."),
				slot: z
					.string()
					.min(1)
					.optional()
					.describe("Optional slot name marker for authored slot content."),
				children: z
					.array(recipeTemplateNodeSchema)
					.optional()
					.describe("Child template nodes for branch-role components."),
			})
			.strict(),
);

const systemComponentSlotHistoryEntrySchema = z
	.object({
		fromVersion: z.string().min(1),
		previousName: z.string().min(1).optional(),
		previousHostPath: z.string().min(1).optional(),
	})
	.strict();

export const systemComponentSlotDefinitionSchema: z.ZodType<SystemComponentSlotDefinition> =
	z
		.object({
			name: z
				.string()
				.min(1)
				.describe("Stable slot name. Must match the slots map key."),
			label: z
				.string()
				.optional()
				.describe("Optional human-readable slot label."),
			hostPath: z
				.string()
				.min(1)
				.describe("Template path that hosts inserted slot children."),
			defaultChildren: z
				.array(recipeTemplateNodeSchema)
				.optional()
				.describe("Optional default template children for the slot."),
			history: z
				.array(systemComponentSlotHistoryEntrySchema)
				.optional()
				.describe("Optional migration history for renamed or moved slots."),
		})
		.strict();

export const systemComponentSlotsSchema = z
	.record(z.string().min(1), systemComponentSlotDefinitionSchema)
	.describe("Slot definitions keyed by stable slot name.");

export const systemComponentVariantValueSchema = z
	.object({
		label: z.string().optional(),
		classesByPath: z
			.record(z.string().min(1), z.string())
			.optional()
			.describe("Tailwind class strings keyed by template path."),
	})
	.strict();

export const systemComponentVariantAxisSchema = z
	.object({
		label: z.string().min(1),
		defaultValue: z.string().min(1).optional(),
		values: z
			.record(z.string().min(1), systemComponentVariantValueSchema)
			.describe("Variant values keyed by stable value id."),
	})
	.strict();

export const systemComponentCompoundVariantSchema = z
	.object({
		when: z
			.record(z.string().min(1), z.union([z.string(), z.array(z.string())]))
			.describe("Axis/value requirements for this compound variant."),
		classesByPath: z
			.record(z.string().min(1), z.string())
			.describe("Tailwind class strings keyed by template path."),
	})
	.strict();

export const systemComponentVariantSchema: z.ZodType<SystemComponentVariantSchema> =
	z
		.object({
			axes: z
				.record(z.string().min(1), systemComponentVariantAxisSchema)
				.describe("Variant axes keyed by stable axis id."),
			compoundVariants: z
				.array(systemComponentCompoundVariantSchema)
				.optional()
				.describe("Classes applied for specific variant combinations."),
			defaultValues: z
				.record(z.string().min(1), z.string())
				.optional()
				.describe("Default variant value id by axis id."),
		})
		.strict();

export const systemComponentOverrideCapabilitySchema = z.enum([
	"className",
	"text",
	"icon",
	"asset",
] satisfies SystemComponentOverrideCapability[]);

const systemComponentOverrideTargetHistoryEntrySchema = z
	.object({
		fromVersion: z.string().min(1),
		previousTargetId: z.string().min(1).optional(),
		previousPath: z.string().min(1).optional(),
	})
	.strict();

export const systemComponentOverrideTargetSchema: z.ZodType<SystemComponentOverrideTarget> =
	z
		.object({
			targetId: z
				.string()
				.min(1)
				.describe("Stable override target id. Must match the map key."),
			label: z.string().min(1).describe("Human-readable target label."),
			path: z
				.string()
				.min(1)
				.describe("Template path this target allows instances to override."),
			capabilities: z
				.array(systemComponentOverrideCapabilitySchema)
				.optional()
				.describe(
					"Allowed override kinds. Defaults to className when omitted.",
				),
			history: z
				.array(systemComponentOverrideTargetHistoryEntrySchema)
				.optional()
				.describe("Optional migration history for renamed or moved targets."),
		})
		.strict();

export const systemComponentOverrideTargetsSchema = z
	.record(z.string().min(1), systemComponentOverrideTargetSchema)
	.describe("Override targets keyed by stable target id.");

const systemComponentVariantMigrationHintSchema = z
	.object({
		fromAxis: z.string().min(1),
		toAxis: z.string().min(1).optional(),
		valueMappings: z
			.array(
				z
					.object({
						fromValue: z.string().min(1),
						toValue: z.string().min(1).optional(),
					})
					.strict(),
			)
			.optional(),
	})
	.strict();

const systemComponentSlotMigrationHintSchema = z
	.object({
		fromName: z.string().min(1),
		toName: z.string().min(1).optional(),
		hostPathMappings: z
			.array(
				z
					.object({
						fromPath: z.string().min(1),
						toPath: z.string().min(1).optional(),
					})
					.strict(),
			)
			.optional(),
	})
	.strict();

const systemComponentOverrideTargetMigrationHintSchema = z
	.object({
		fromTargetId: z.string().min(1),
		toTargetId: z.string().min(1).optional(),
		pathMappings: z
			.array(
				z
					.object({
						fromPath: z.string().min(1),
						toPath: z.string().min(1).optional(),
					})
					.strict(),
			)
			.optional(),
	})
	.strict();

const systemComponentMigrationHintsSchema = z
	.object({
		variantAxes: z.array(systemComponentVariantMigrationHintSchema).optional(),
		slots: z.array(systemComponentSlotMigrationHintSchema).optional(),
		overrideTargets: z
			.array(systemComponentOverrideTargetMigrationHintSchema)
			.optional(),
	})
	.strict();

export const systemComponentDraftPayloadSchema: z.ZodType<SystemComponentDraftPayload> =
	z
		.object({
			baseVersion: z.string().min(1).optional(),
			root: recipeTemplateNodeSchema,
			slots: systemComponentSlotsSchema.optional(),
			props: z.record(z.string(), z.unknown()).optional(),
			variants: systemComponentVariantSchema.optional(),
			overrideTargets: systemComponentOverrideTargetsSchema.optional(),
			migrationHints: systemComponentMigrationHintsSchema.optional(),
		})
		.strict();

export const partialSystemComponentDraftPayloadSchema =
	systemComponentDraftPayloadSchema.partial();

export const systemComponentDraftPatchSchema = z
	.object({
		root: recipeTemplateNodeSchema.optional(),
		slots: systemComponentSlotsSchema.nullable().optional(),
		variants: systemComponentVariantSchema.nullable().optional(),
		overrideTargets: systemComponentOverrideTargetsSchema.nullable().optional(),
	})
	.strict();

const publishAsShapeButValidateInHandler = <Schema extends z.ZodType>(
	schema: Schema,
) => z.union([schema, z.unknown()]);

export const mcpPartialSystemComponentDraftPayloadInputSchema =
	publishAsShapeButValidateInHandler(partialSystemComponentDraftPayloadSchema)
		.optional()
		.describe(
			"Optional partial component draft payload. Call getSystemComponentAuthoringContract for shape details.",
		);

export const mcpRecipeTemplateNodeInputSchema =
	publishAsShapeButValidateInHandler(recipeTemplateNodeSchema)
		.optional()
		.describe(
			"RecipeTemplateNode root template. Call getSystemComponentAuthoringContract for path and child rules.",
		);

export const mcpSystemComponentSlotsInputSchema =
	publishAsShapeButValidateInHandler(systemComponentSlotsSchema)
		.nullable()
		.optional()
		.describe("Slot map, null to clear slots.");

export const mcpSystemComponentVariantSchemaInputSchema =
	publishAsShapeButValidateInHandler(systemComponentVariantSchema)
		.nullable()
		.optional()
		.describe("Variant schema, null to clear variants.");

export const mcpSystemComponentOverrideTargetsInputSchema =
	publishAsShapeButValidateInHandler(systemComponentOverrideTargetsSchema)
		.nullable()
		.optional()
		.describe("Override target map, null to clear override targets.");

export type SystemComponentDraftInputDiagnostic = {
	code: "INVALID_SYSTEM_COMPONENT_DRAFT_INPUT";
	severity: "error";
	path: string;
	message: string;
};

const formatPath = (path: PropertyKey[]): string => {
	if (path.length === 0) {
		return "$";
	}

	return path.reduce((accumulator, segment) => {
		if (typeof segment === "number") {
			return `${accumulator}[${segment}]`;
		}
		const key = String(segment);
		return accumulator.length === 0 ? key : `${accumulator}.${key}`;
	}, "");
};

export const systemComponentDraftInputDiagnosticsFromZodError = (
	error: z.ZodError,
): SystemComponentDraftInputDiagnostic[] =>
	error.issues.map((issue) => ({
		code: "INVALID_SYSTEM_COMPONENT_DRAFT_INPUT",
		severity: "error",
		path: formatPath(issue.path),
		message:
			issue.path.length === 0
				? issue.message
				: `${formatPath(issue.path)}: ${issue.message}`,
	}));
