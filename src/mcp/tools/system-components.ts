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
	systemComponentManifestRevisionSchema,
	withMutationScopedInput,
	withProjectScopedInput,
} from "./schemas";

export const registerSystemComponentReadTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		"listSystemComponents",
		{
			title: "List System Components",
			description:
				"List stable component definitions in a configured design system, including manifest revision metadata for later writes.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await listSystemComponentsPayload(context, systemName),
				),
			),
	);

	server.registerTool(
		"describeSystemComponent",
		{
			title: "Describe System Component",
			description:
				'Describe one stable component definition, including draft hashes, validation diagnostics, and current manifest revision. Returns only the current published version\'s template by default, with versionHistory summarizing older versions; pass versions: "all" for every published template.',
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				componentId: z.string().min(1).describe("Stable system component id."),
				versions: z
					.enum(["current", "all"])
					.optional()
					.describe(
						'"current" (default) returns only the current published version in record.published.versions plus a versionHistory summary; "all" returns every published version template.',
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, componentId, versions, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await describeSystemComponentPayload(
						context,
						systemName,
						componentId,
						versions ?? "current",
					),
				),
			),
	);

	server.registerTool(
		"listStaleSystemComponentUsages",
		{
			title: "List Stale System Component Usages",
			description:
				"Report attached system component instances that reference an older published version. Read-only; does not migrate or write designs.",
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
				designFileId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Optional design file UUID filter. Must be readable by MCP policy.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, componentId, designFileId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await listStaleSystemComponentUsagesPayload(context, systemName, {
						componentId,
						designFileId,
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
				expectedRevision: systemComponentManifestRevisionSchema,
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
				expectedRevision: systemComponentManifestRevisionSchema,
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
				return createJsonResult(
					await systemComponentMutationPayload(
						context,
						systemName,
						componentId,
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
				expectedRevision: systemComponentManifestRevisionSchema,
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
				return createJsonResult(
					await systemComponentMutationPayload(
						context,
						systemName,
						componentId,
						{
							publishedVersion: result.publishedVersion,
						},
					),
				);
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
				expectedRevision: systemComponentManifestRevisionSchema,
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
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
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
				"Bulk migrate stale attached system component instances for a system, optionally filtered by component or design file. Uses the same safe/review-required/blocked diagnostics as the UI. onlySafe defaults to true so review-required instances are reported but not written.",
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
				designFileId: z
					.string()
					.min(1)
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
								},
							),
						);
					},
				);
			}),
	);
};
