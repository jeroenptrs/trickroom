import { z } from "zod";
import {
	applyMigrateSystemComponentInstance,
	DesignTransformError,
} from "../../services/design-transform-service";
import type { TrickroomDesign } from "../../types";
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
import { resolveToolSystem } from "../payloads/design-system";
import {
	describeNode,
	findElementContext,
	getRecipeAttachmentSummaries,
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
import { TOOL } from "../tool-names";
import {
	destructiveMutationAnnotations,
	mutationAnnotations,
	readOnlyClosedWorldAnnotations,
	SEARCH_HINT_META_KEY,
} from "./annotations";
import type { McpToolContext } from "./context";
import { systemNameInputSchema } from "./design-systems";
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
	mutationResponseInputSchema,
	withProjectScopedInput,
} from "./schemas";

const instanceLimitSchema = z
	.number()
	.int()
	.min(1)
	.max(1000)
	.optional()
	.describe("Instance rows per list (default 20); counts are always complete.");

const componentIdSchema = z
	.string()
	.min(1)
	.describe("System component id (cmp_…).");

/** The migrated instance root as a compact node. */
const describeMigratedElement = (
	design: TrickroomDesign,
	elementId: string,
) => {
	const element = findElementContext(design, elementId)?.element;
	return element
		? {
				element: describeNode(
					element,
					"compact",
					getRecipeAttachmentSummaries(design),
				),
			}
		: {};
};

export const registerSystemComponentTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling, withProjectContext } = ctx;

	server.registerTool(
		TOOL.componentRead,
		{
			title: "Read System Components",
			description: `Read a design system's components. view "index" (default without componentId): one row per component (id, slug, name, group, published version, draft state "unpublished" or "changed", variant axes, one-line description) and the manifest revision your writes pass as expectedRevision; filter with query and group. view "describe" (default with componentId): one component's interface for placing and varying instances (variant axes with values and defaults, slots, override targets, props) from the current published version, or the draft when unpublished, plus revision, draft hashes, version history and diagnostics; include "template", "classes" or "record" adds the template tree, variant classes or stored record; source "draft" describes the draft. view "stale": instances in designs that use an older published version, with counts per status, component and design. Authoring rules: ${TOOL.guide}({ topic: "component-authoring" }).`,
			inputSchema: withProjectScopedInput({
				view: z
					.enum(["index", "describe", "stale"])
					.optional()
					.describe('Defaults to "describe" with componentId, else "index".'),
				systemName: systemNameInputSchema,
				componentId: componentIdSchema.optional(),
				query: z
					.string()
					.min(1)
					.optional()
					.describe(
						"index: case-insensitive match on id, slug, name, group or description.",
					),
				group: z
					.string()
					.min(1)
					.optional()
					.describe("index: one group (case-insensitive)."),
				source: z
					.enum(["published", "draft"])
					.optional()
					.describe("describe: the published version (default) or the draft."),
				include: z
					.array(z.enum(["template", "classes", "record"]))
					.optional()
					.describe("describe: opt-in sections."),
				versions: z
					.enum(["current", "all"])
					.optional()
					.describe(
						'describe, with "record": only the current published template (default) or every version.',
					),
				designFileId: designFileIdSchema
					.optional()
					.describe("stale: only this design."),
				limit: instanceLimitSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"system component list describe variants slots overrides stale instances",
			},
		},
		async ({
			view,
			systemName,
			componentId,
			query,
			group,
			source,
			include,
			versions,
			designFileId,
			limit,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const system = await resolveToolSystem(context, { systemName });
				const systemId = system.manifest.systemId;
				const resolvedView =
					view ?? (componentId === undefined ? "index" : "describe");
				if (resolvedView === "stale") {
					return createJsonResult(
						await listStaleSystemComponentUsagesPayload(context, systemId, {
							componentId,
							designFileId,
							limit,
						}),
					);
				}
				if (resolvedView === "describe") {
					if (componentId === undefined) {
						throw new DesignTransformError(
							"INVALID_OPERATION_PARAMETERS",
							'view "describe" needs componentId.',
						);
					}
					return createJsonResult(
						await describeSystemComponentPayload(
							context,
							systemId,
							componentId,
							{ source, include, versions },
						),
					);
				}
				return createJsonResult(
					await listSystemComponentsPayload(context, systemId, {
						query,
						group,
					}),
				);
			}),
	);

	server.registerTool(
		TOOL.componentDraftCreate,
		{
			title: "Create System Component Draft",
			description: `Create a component draft in a design system: slug, name and optionally draft: { root, slots, variants, overrideTargets }. expectedRevision is the manifest revision from ${TOOL.componentRead}. Returns the component id, the new revision and a summary of the draft. Read ${TOOL.guide}({ topic: "component-authoring" }) first; publish with ${TOOL.componentPublish}.`,
			inputSchema: withProjectScopedInput({
				systemName: systemNameInputSchema,
				expectedRevision: expectedRevisionSchema,
				slug: z.string().min(1).describe("Unique component slug."),
				name: z.string().min(1).describe("Human-readable component name."),
				description: z.string().optional(),
				group: z.string().optional(),
				order: z.number().finite().optional(),
				draft: mcpPartialSystemComponentDraftPayloadInputSchema,
			}),
			annotations: { ...mutationAnnotations, idempotentHint: false },
			_meta: {
				[SEARCH_HINT_META_KEY]: "new system component author design system",
			},
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
				assertCanWriteProject(getMcpPolicy(context.config));
				const system = await resolveToolSystem(context, { systemName });
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
						system.manifest.systemId,
						result.componentId,
						{ kind: "created" },
					),
				);
			}),
	);

	server.registerTool(
		TOOL.componentDraftUpdate,
		{
			title: "Update System Component Draft",
			description: `Replace parts of a component's draft: root (template), slots, variants and/or overrideTargets; parts you omit stay. expectedRevision is the manifest revision; expectedDraftTemplateHash and expectedDraftVariantSchemaHash (from ${TOOL.componentRead} describe) guard against concurrent draft edits. Returns the new revision and what changed. Read the draft first with ${TOOL.componentRead}({ componentId, source: "draft", include: ["template", "classes"] }).`,
			inputSchema: withProjectScopedInput({
				systemName: systemNameInputSchema,
				componentId: componentIdSchema,
				expectedRevision: expectedRevisionSchema,
				expectedDraftTemplateHash: z.string().optional(),
				expectedDraftVariantSchemaHash: z.string().optional(),
				root: mcpRecipeTemplateNodeInputSchema,
				slots: mcpSystemComponentSlotsInputSchema,
				variants: mcpSystemComponentVariantSchemaInputSchema,
				overrideTargets: mcpSystemComponentOverrideTargetsInputSchema,
			}),
			annotations: { ...mutationAnnotations, idempotentHint: false },
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"edit system component template variants slots overrides",
			},
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
				assertCanWriteProject(getMcpPolicy(context.config));
				const system = await resolveToolSystem(context, { systemName });
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
						system.manifest.systemId,
						componentId,
						beforeDraft
							? { kind: "updated", before: beforeDraft, replaced }
							: { kind: "created" },
					),
				);
			}),
	);

	server.registerTool(
		TOOL.componentPublish,
		{
			title: "Publish System Component",
			description: `Publish a component's draft as its new current version. Instances already placed keep their version and show as stale until migrated (${TOOL.componentMigrate}). expectedRevision is the manifest revision. Returns the published version, the new revision and what changed since the previous version.`,
			inputSchema: withProjectScopedInput({
				systemName: systemNameInputSchema,
				componentId: componentIdSchema,
				expectedRevision: expectedRevisionSchema,
			}),
			annotations: { ...mutationAnnotations, idempotentHint: false },
		},
		async ({ systemName, componentId, expectedRevision, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				assertCanWriteProject(getMcpPolicy(context.config));
				const system = await resolveToolSystem(context, { systemName });
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
						system.manifest.systemId,
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
		TOOL.componentDelete,
		{
			title: "Delete System Component",
			description:
				"Delete a component from its design system's manifest, draft and published versions. Instances already placed in designs are not removed: they become instances of a missing component. expectedRevision is the manifest revision.",
			inputSchema: withProjectScopedInput({
				systemName: systemNameInputSchema,
				componentId: componentIdSchema,
				expectedRevision: expectedRevisionSchema,
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ systemName, componentId, expectedRevision, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				assertCanWriteProject(getMcpPolicy(context.config));
				const system = await resolveToolSystem(context, { systemName });
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

	server.registerTool(
		TOOL.componentMigrate,
		{
			title: "Migrate System Component Instances",
			description: `Move stale component instances to their component's current published version, with the same safe / review-required / blocked rules as the app. One instance: designFileId, expectedRevision and rootElementId (its root). Bulk: no rootElementId; every stale instance in the system, narrowed by componentId and/or designFileId, design by design. onlySafe (default true) leaves review-required instances unwritten and reports them; dryRun previews without writing. Bulk returns counts, a per-design rollup with new revisions, review-required instances and failures; includeInstances adds instance rows and previews. Find stale instances with ${TOOL.componentRead}({ view: "stale" }).`,
			inputSchema: withProjectScopedInput({
				systemName: systemNameInputSchema,
				componentId: componentIdSchema
					.optional()
					.describe("Bulk: only this component."),
				designFileId: designFileIdSchema
					.optional()
					.describe("The instance's design, or (bulk) only this design."),
				rootElementId: z
					.string()
					.min(1)
					.optional()
					.describe("One instance: its root element id."),
				expectedRevision: expectedRevisionSchema
					.optional()
					.describe("One instance: the design's revision."),
				onlySafe: z
					.boolean()
					.optional()
					.describe(
						"Default true: write only safe migrations, report review-required ones.",
					),
				dryRun: z.boolean().optional().describe("Preview without writing."),
				includeInstances: z
					.boolean()
					.optional()
					.describe(
						"Bulk: add changed, review-required and skipped instance rows, each capped at limit.",
					),
				limit: instanceLimitSchema,
				response: mutationResponseInputSchema,
			}),
			annotations: { ...mutationAnnotations, idempotentHint: false },
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"update stale outdated system component instances new version",
			},
		},
		async ({
			systemName,
			componentId,
			designFileId,
			rootElementId,
			expectedRevision,
			onlySafe,
			dryRun,
			includeInstances,
			limit,
			response,
			project,
		}) =>
			withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				if (rootElementId === undefined) {
					return withMutationErrorHandling(
						context,
						{
							toolName: TOOL.componentMigrate,
							operation: "bulk",
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
							const system = await resolveToolSystem(context, { systemName });
							return createJsonResult(
								await bulkMigrateSystemComponentUsagesPayload(
									context,
									system.manifest.systemId,
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
				}

				return withMutationErrorHandling(
					context,
					{
						toolName: TOOL.componentMigrate,
						operation: "instance",
						projectId: context.config.projectId ?? null,
						designFileId: designFileId ?? null,
						expectedRevision: expectedRevision ?? null,
						details: { rootElementId, onlySafe, dryRun },
					},
					async () => {
						if (designFileId === undefined || expectedRevision === undefined) {
							throw new DesignTransformError(
								"INVALID_OPERATION_PARAMETERS",
								"Migrating one instance needs designFileId and expectedRevision with rootElementId. Omit rootElementId to migrate in bulk.",
							);
						}
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
										...describeMigratedElement(
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
			}),
	);
};
