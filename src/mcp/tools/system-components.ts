import { z } from "zod";
import { applyMigrateSystemComponentInstance } from "../../services/design-transform-service";
import {
	mcpPartialSystemComponentDraftPayloadInputSchema,
	mcpRecipeTemplateNodeInputSchema,
	mcpSystemComponentOverrideTargetsInputSchema,
	mcpSystemComponentSlotsInputSchema,
	mcpSystemComponentVariantSchemaInputSchema,
	partialSystemComponentDraftPayloadSchema,
	systemComponentDraftPatchSchema,
} from "../../utils/system-component-draft-schemas";
import { readSystemComponentManifest } from "../../utils/system-component-manifest-service";
import {
	createSystemComponentDraft,
	deleteSystemComponent,
	publishSystemComponentDraft,
	updateSystemComponentDraft,
} from "../../utils/system-component-operations";
import { assertCanUseSystemComponentInstanceSubtree } from "../design-operations";
import {
	assertCanReadDesignFile,
	assertCanWriteDesignFile,
	assertCanWriteProject,
	getMcpPolicy,
} from "../governance";
import { assertConfiguredSystem } from "../payloads/design-system";
import {
	getCompactElementSummary,
	getMutationContext,
} from "../payloads/design-tree";
import { getProjectReference } from "../payloads/project";
import { getSubtreeElementIds } from "../payloads/references";
import {
	bulkMigrateSystemComponentUsagesPayload,
	describeSystemComponentPayload,
	listStaleSystemComponentUsagesPayload,
	listSystemComponentsPayload,
	systemComponentMutationPayload,
} from "../payloads/system-components";
import {
	destructiveMutationAnnotations,
	mutationAnnotations,
	readOnlyClosedWorldAnnotations,
} from "./annotations";
import type { McpToolContext } from "./context";
import {
	getMutationDiagnostics,
	mutateDesignFile,
	skipDesignWrite,
	withMutationErrorHandling,
} from "./mutation-support";
import {
	createJsonResult,
	createSystemComponentDraftInputErrorResult,
} from "./results";
import {
	designFileIdSchema,
	expectedRevisionSchema,
	withMutationScopedInput,
	withProjectScopedInput,
} from "./schemas";

const instanceLimitSchema = z
	.number()
	.int()
	.min(1)
	.max(1000)
	.optional()
	.describe(
		"Maximum instance rows per list (default 20); counts are always complete.",
	);

export const registerSystemComponentReadTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		"listSystemComponents",
		{
			title: "List System Components",
			description:
				'Compact index of the components in a configured design system: id, slug, name, group, published version, draft state ("unpublished" or "changed" when publishing would change it), variant axes, and a one-line description, plus the manifest revision for later writes. Filter with query and group. Use describeSystemComponent for one component\'s interface.',
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				query: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Case-insensitive match on id, slug, name, group, or description.",
					),
				group: z
					.string()
					.min(1)
					.optional()
					.describe("Only components in this group (case-insensitive)."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, query, group, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await listSystemComponentsPayload(context, systemName, {
						query,
						group,
					}),
				),
			),
	);

	server.registerTool(
		"describeSystemComponent",
		{
			title: "Describe System Component",
			description:
				'Describe one component\'s interface for placing and varying instances: variant axes with values and defaults, slots, override targets, and props, from the current published version (or the draft when unpublished). Also returns the manifest revision, draft hashes, version history, and this component\'s diagnostics. Opt in with include: "template" (root tree, raw slots and override targets), "classes" (variant schema with classesByPath and compound variants), "record" (the stored record). Use source: "draft", include: ["template", "classes"] before updateSystemComponentDraft.',
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				componentId: z.string().min(1).describe("Stable system component id."),
				source: z
					.enum(["published", "draft"])
					.optional()
					.describe(
						"Which payload to describe. Defaults to the current published version, or the draft when nothing is published.",
					),
				include: z
					.array(z.enum(["template", "classes", "record"]))
					.optional()
					.describe(
						'Opt-in sections: "template", "classes", "record". Default: interface only.',
					),
				versions: z
					.enum(["current", "all"])
					.optional()
					.describe(
						'For the "record" section: "current" (default) keeps only the current published template; "all" returns every published version template and implies include "record".',
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, componentId, source, include, versions, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await describeSystemComponentPayload(
						context,
						systemName,
						componentId,
						{ source, include, versions },
					),
				),
			),
	);

	server.registerTool(
		"listStaleSystemComponentUsages",
		{
			title: "List Stale System Component Usages",
			description:
				"Report attached system component instances that reference an older published version: counts per status, component, and design, plus the first usage rows (limit). Read-only; does not migrate or write designs.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				componentId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional stable system component id."),
				designFileId: designFileIdSchema
					.optional()
					.describe(
						"Optional design file UUID filter. Must be readable by MCP policy.",
					),
				limit: instanceLimitSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, componentId, designFileId, limit, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await listStaleSystemComponentUsagesPayload(context, systemName, {
						componentId,
						designFileId,
						limit,
					}),
				),
			),
	);
};

export const registerSystemComponentDraftTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		"createSystemComponentDraft",
		{
			title: "Create System Component Draft",
			description:
				"Create a new draft component definition in a system component manifest using an expected manifest revision. Call getSystemComponentAuthoringContract before authoring draft payloads.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				expectedRevision: expectedRevisionSchema,
				slug: z.string().min(1).describe("Unique component slug."),
				name: z.string().min(1).describe("Human-readable component name."),
				description: z.string().optional(),
				group: z.string().optional(),
				order: z.number().finite().optional(),
				draft: mcpPartialSystemComponentDraftPayloadInputSchema,
			}),
			annotations: mutationAnnotations,
		},
		async ({
			systemName,
			expectedRevision,
			slug,
			name,
			description,
			group,
			order,
			draft,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const parsedDraft =
					draft === undefined
						? undefined
						: partialSystemComponentDraftPayloadSchema.safeParse(draft);
				if (parsedDraft !== undefined && !parsedDraft.success) {
					return createSystemComponentDraftInputErrorResult(
						context,
						parsedDraft.error,
					);
				}
				const result = await createSystemComponentDraft(
					context.projectRoot,
					system.manifest.systemId,
					{
						slug,
						name,
						description,
						group,
						order,
						...(parsedDraft !== undefined ? { draft: parsedDraft.data } : {}),
					},
					{ expectedRevision },
				);
				return createJsonResult(
					await systemComponentMutationPayload(
						context,
						systemName,
						result.componentId,
						{ kind: "created" },
					),
				);
			}),
	);

	server.registerTool(
		"updateSystemComponentDraft",
		{
			title: "Update System Component Draft",
			description:
				"Update a component draft template, slots, variants, or override targets using expected manifest revision and optional draft hashes. Call getSystemComponentAuthoringContract before authoring root, variants, slots, or overrideTargets.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				componentId: z.string().min(1).describe("Stable system component id."),
				expectedRevision: expectedRevisionSchema,
				expectedDraftTemplateHash: z.string().optional(),
				expectedDraftVariantSchemaHash: z.string().optional(),
				root: mcpRecipeTemplateNodeInputSchema,
				slots: mcpSystemComponentSlotsInputSchema,
				variants: mcpSystemComponentVariantSchemaInputSchema,
				overrideTargets: mcpSystemComponentOverrideTargetsInputSchema,
			}),
			annotations: mutationAnnotations,
		},
		async ({
			systemName,
			componentId,
			expectedRevision,
			expectedDraftTemplateHash,
			expectedDraftVariantSchemaHash,
			root,
			slots,
			variants,
			overrideTargets,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const parsedDraftPatch = systemComponentDraftPatchSchema.safeParse({
					...(root !== undefined ? { root } : {}),
					...(slots !== undefined ? { slots } : {}),
					...(variants !== undefined ? { variants } : {}),
					...(overrideTargets !== undefined ? { overrideTargets } : {}),
				});
				if (!parsedDraftPatch.success) {
					return createSystemComponentDraftInputErrorResult(
						context,
						parsedDraftPatch.error,
					);
				}
				const before = await readSystemComponentManifest(
					context.projectRoot,
					system.manifest.systemId,
				);
				const beforeDraft = before.manifest.components[componentId]?.draft;
				await updateSystemComponentDraft(
					context.projectRoot,
					system.manifest.systemId,
					componentId,
					parsedDraftPatch.data,
					{
						expectedRevision,
						expectedDraftTemplateHash,
						expectedDraftVariantSchemaHash,
					},
				);
				const replaced = Object.keys(parsedDraftPatch.data);
				return createJsonResult(
					await systemComponentMutationPayload(
						context,
						systemName,
						componentId,
						beforeDraft
							? { kind: "updated", before: beforeDraft, replaced }
							: { kind: "created" },
					),
				);
			}),
	);

	server.registerTool(
		"publishSystemComponent",
		{
			title: "Publish System Component",
			description:
				"Publish a component draft into the system component manifest using an expected manifest revision.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				componentId: z.string().min(1).describe("Stable system component id."),
				expectedRevision: expectedRevisionSchema,
			}),
			annotations: mutationAnnotations,
		},
		async ({ systemName, componentId, expectedRevision, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const result = await publishSystemComponentDraft(
					context.projectRoot,
					system.manifest.systemId,
					componentId,
					{ expectedRevision },
				);
				const publishedVersion =
					result.manifest.components[componentId]?.published?.versions[
						result.publishedVersion
					];
				return createJsonResult({
					...(await systemComponentMutationPayload(
						context,
						systemName,
						componentId,
						{
							kind: "published",
							previousVersion: publishedVersion?.previousVersion,
						},
					)),
					publishedVersion: result.publishedVersion,
				});
			}),
	);

	server.registerTool(
		"deleteSystemComponent",
		{
			title: "Delete System Component",
			description:
				"Delete one component definition from the system component manifest using an expected manifest revision.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				componentId: z.string().min(1).describe("Stable system component id."),
				expectedRevision: expectedRevisionSchema,
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ systemName, componentId, expectedRevision, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const result = await deleteSystemComponent(
					context.projectRoot,
					system.manifest.systemId,
					componentId,
					{ expectedRevision },
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					systemId: system.manifest.systemId,
					systemName: system.manifest.systemName,
					revision: result.revision,
					updatedAt: result.updatedAt,
					componentId: result.componentId,
					deleted: true,
				});
			}),
	);
};

export const registerSystemComponentMigrationTools = (ctx: McpToolContext) => {
	const { server, withProjectContext } = ctx;

	server.registerTool(
		"migrateSystemComponentInstance",
		{
			title: "Migrate System Component Instance",
			description:
				"Migrate one stale attached system component instance to the current published version using the same guarded domain rules as the UI. Blocked unsafe migrations are rejected. Review-required migrations are not written unless onlySafe is false.",
			inputSchema: withMutationScopedInput({
				designFileId: designFileIdSchema,
				expectedRevision: expectedRevisionSchema,
				rootElementId: z
					.string()
					.min(1)
					.describe("Attached system component root element ID."),
				onlySafe: z
					.boolean()
					.optional()
					.describe(
						"When true (default), skip review-required migrations and return them without writing.",
					),
				dryRun: z
					.boolean()
					.optional()
					.describe(
						"When true, preview migration diagnostics without writing the design file.",
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
			expectedRevision,
			rootElementId,
			onlySafe,
			dryRun,
			response,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "migrateSystemComponentInstance",
						operation: "migrateSystemComponentInstance",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { rootElementId, onlySafe, dryRun },
					},
					async () => {
						assertCanReadDesignFile(policy, designFileId);
						if (!dryRun) {
							assertCanWriteDesignFile(policy, designFileId);
						}
						return mutateDesignFile(
							context,
							{ designFileId, expectedRevision },
							{
								mutate: async (read) => {
									assertCanUseSystemComponentInstanceSubtree(
										policy,
										read.design,
										rootElementId,
									);

									const result = await applyMigrateSystemComponentInstance(
										read.design,
										{
											projectRoot: context.projectRoot,
											rootElementId,
											onlySafe,
											dryRun,
										},
									);

									const targetDesign =
										result.prospectiveDesign ?? result.design;
									assertCanUseSystemComponentInstanceSubtree(
										policy,
										targetDesign,
										result.rootElementId,
									);

									if (!result.applied) {
										return skipDesignWrite(
											createJsonResult({
												status:
													result.outcome === "review-required"
														? "REVIEW_REQUIRED"
														: "DRY_RUN",
												project: getProjectReference(context),
												applied: false,
												outcome: result.outcome,
												systemComponent: {
													systemId: result.systemId,
													componentId: result.componentId,
													instanceId: result.instanceId,
													rootElementId: result.rootElementId,
													fromVersion: result.fromVersion,
													toVersion: result.toVersion,
												},
												preview: result.preview,
												revision: read.revision,
											}),
										);
									}
									return result;
								},
								respond: async (result, write) =>
									createJsonResult({
										status: "success",
										project: getProjectReference(context),
										applied: true,
										outcome: result.outcome,
										newRevision: write.revision,
										systemComponent: {
											systemId: result.systemId,
											componentId: result.componentId,
											instanceId: result.instanceId,
											rootElementId: result.rootElementId,
											fromVersion: result.fromVersion,
											toVersion: result.toVersion,
										},
										componentMigration: result.componentMigration,
										preview: result.preview,
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
											getSubtreeElementIds(write.design, result.rootElementId),
										)),
									}),
							},
						);
					},
				);
			});
		},
	);

	server.registerTool(
		"bulkMigrateSystemComponentUsages",
		{
			title: "Bulk Migrate System Component Usages",
			description:
				"Bulk migrate stale attached system component instances for a system, optionally filtered by component or design file. Uses the same safe/review-required/blocked diagnostics as the UI. onlySafe defaults to true so review-required instances are reported but not written. Returns counts, a per-design rollup with new revisions, review-required instances, and failures; includeInstances adds instance rows and migration previews.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				componentId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional stable system component id."),
				designFileId: designFileIdSchema
					.optional()
					.describe(
						"Optional design file UUID filter. Must be readable and writable by MCP policy.",
					),
				onlySafe: z
					.boolean()
					.optional()
					.describe(
						"When true (default), migrate only safe instances and report review-required separately.",
					),
				dryRun: z
					.boolean()
					.optional()
					.describe(
						"When true, report predicted changes without persisting design files.",
					),
				includeInstances: z
					.boolean()
					.optional()
					.describe(
						"When true, add changed, review-required (with previews), and non-current skipped instance rows, each capped at limit.",
					),
				limit: instanceLimitSchema,
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			systemName,
			componentId,
			designFileId,
			onlySafe,
			dryRun,
			includeInstances,
			limit,
			project,
		}) =>
			withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "bulkMigrateSystemComponentUsages",
						operation: "bulkMigrateSystemComponentUsages",
						projectId: context.config.projectId ?? null,
						details: {
							systemName,
							componentId,
							designFileId,
							onlySafe,
							dryRun,
						},
					},
					async () => {
						if (designFileId) {
							assertCanReadDesignFile(policy, designFileId);
							if (!dryRun) {
								assertCanWriteDesignFile(policy, designFileId);
							}
						} else if (!dryRun) {
							assertCanWriteProject(policy);
						}

						return createJsonResult(
							await bulkMigrateSystemComponentUsagesPayload(
								context,
								systemName,
								{
									componentId,
									designFileId,
									onlySafe,
									dryRun,
									includeInstances,
									limit,
								},
							),
						);
					},
				);
			}),
	);
};
