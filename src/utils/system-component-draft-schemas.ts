import { z } from "zod";
import { TOOL } from "../mcp/tool-names";
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
			insertIndex: z
				.number()
				.int()
				.nonnegative()
				.optional()
				.describe(
					"Optional index within the host's declared children where slot content is spliced (clamped to declared-children length). Omitted appends after declared children.",
				),
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
			.record(z.string().min(1), z.string().min(1))
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
			.record(
				z.string().min(1),
				z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
			)
			.describe("Axis/value requirements for this compound variant."),
		classesByPath: z
			.record(z.string().min(1), z.string().min(1))
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
			props: z
				.array(z.string().min(1))
				.optional()
				.describe("Registry control prop names that instances may override."),
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

// Published MCP input shapes. Handlers validate with the strict schemas
// above, and the guide's component topics document every field, so
// these only outline the keys: no per-field descriptions, no migration
// history (still accepted), and one shared class map.
const docString = z.string();
const docClassesByPath = z.record(docString, docString);
const docTemplateNode: z.ZodType<RecipeTemplateNode> = z.lazy(() =>
	z.object({
		path: docString,
		library: docString,
		component: docString,
		name: docString.optional(),
		className: docString.optional(),
		props: z.record(docString, jsonPrimitiveSchema).optional(),
		text: docString.optional(),
		slot: docString.optional(),
		children: z.array(docTemplateNode).optional(),
	}),
);
const docSlots = z.record(
	docString,
	z.object({
		name: docString,
		hostPath: docString,
		label: docString.optional(),
		insertIndex: z.number().optional(),
		defaultChildren: z.array(docTemplateNode).optional(),
	}),
);
const docVariants = z.object({
	axes: z.record(
		docString,
		z.object({
			label: docString,
			defaultValue: docString.optional(),
			values: z.record(
				docString,
				z.object({
					label: docString.optional(),
					classesByPath: docClassesByPath.optional(),
				}),
			),
		}),
	),
	compoundVariants: z
		.array(
			z.object({
				when: z.record(docString, z.union([docString, z.array(docString)])),
				classesByPath: docClassesByPath,
			}),
		)
		.optional(),
	defaultValues: z.record(docString, docString).optional(),
});
const docOverrideTargets = z.record(
	docString,
	z.object({
		targetId: docString,
		label: docString,
		path: docString,
		capabilities: z.array(systemComponentOverrideCapabilitySchema).optional(),
		props: z.array(docString).optional(),
	}),
);

const publishAsShapeButValidateInHandler = <Schema extends z.ZodType>(
	schema: Schema,
) => z.union([schema, z.unknown()]);

export const mcpPartialSystemComponentDraftPayloadInputSchema =
	publishAsShapeButValidateInHandler(
		z.object({
			baseVersion: docString.optional(),
			root: docTemplateNode.optional(),
			slots: docSlots.optional(),
			props: z.record(docString, z.unknown()).optional(),
			variants: docVariants.optional(),
			overrideTargets: docOverrideTargets.optional(),
			migrationHints: z.record(docString, z.unknown()).optional(),
		}),
	)
		.optional()
		.describe(
			`Optional partial component draft payload. Shapes: ${TOOL.guide}({ topic: "component-authoring" }).`,
		);

export const mcpRecipeTemplateNodeInputSchema =
	publishAsShapeButValidateInHandler(docTemplateNode)
		.optional()
		.describe(
			`RecipeTemplateNode root template. Path and child rules: ${TOOL.guide}({ topic: "component-template" }).`,
		);

export const mcpSystemComponentSlotsInputSchema =
	publishAsShapeButValidateInHandler(docSlots)
		.nullable()
		.optional()
		.describe("Slot map, null to clear slots.");

export const mcpSystemComponentVariantSchemaInputSchema =
	publishAsShapeButValidateInHandler(docVariants)
		.nullable()
		.optional()
		.describe("Variant schema, null to clear variants.");

export const mcpSystemComponentOverrideTargetsInputSchema =
	publishAsShapeButValidateInHandler(docOverrideTargets)
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
