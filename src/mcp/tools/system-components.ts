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
	createMetadataToValidate,
	createSystemComponentDraft,
	deleteSystemComponent,
	publishSystemComponentDraft,
	SYSTEM_COMPONENT_DESCRIPTION_MAX_LENGTH,
	SYSTEM_COMPONENT_GROUP_MAX_LENGTH,
	SYSTEM_COMPONENT_NAME_MAX_LENGTH,
	type SystemComponentMetadataProblem,
	systemComponentMetadataProblems,
	updateSystemComponent,
} from "../../utils/system-component-operations";
import { assertCanUseSystemComponentInstanceSubtree } from "../design-operations";
import {
	assertCanReadDesignFile,
	assertCanWriteDesignFile,
	assertCanWriteProject,
	getMcpPolicy,
} from "../governance";
import { extractComponentDraftPayload } from "../payloads/component-extraction";
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
	diffSystemComponentMetadata,
	listStaleSystemComponentUsagesPayload,
	listSystemComponentsPayload,
	systemComponentMutationPayload,
} from "../payloads/system-components";
import type { TrickroomMcpServerContext } from "../server-types";
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
	createToolErrorResult,
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

const createMetadataErrorResult = (
	context: TrickroomMcpServerContext,
	problems: readonly SystemComponentMetadataProblem[],
) =>
	createToolErrorResult(
		context,
		"VALIDATION_FAILED",
		"System component name, group or description is invalid.",
		{
			diagnostics: problems.map((problem) => ({
				code: "INVALID_SYSTEM_COMPONENT_METADATA",
				severity: "error",
				path: problem.field,
				message: problem.message,
			})),
		},
	);

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
			description: `Create a component draft in a design system: slug, name and optionally draft: { root, slots, variants, overrideTargets }. expectedRevision is the manifest revision from ${TOOL.componentRead}. Or extract one from a design: from: { designFileId, elementId } turns that layer and its subtree into the draft's template (recipe and component instances inside become plain elements); name defaults to the layer name, slug to the name, the system to the design's. The design is not changed: a draft is unpublished and cannot be placed. With from.replace: true and from.expectedRevision (the design revision), it also publishes the draft and replaces the layer with an instance of it through the same path as ${TOOL.designApply}; everything checkable is checked before the first write. If a later step still fails, what was written stays and the result has partial and next (the call that finishes). Returns the component id, the new manifest revision, a summary of the draft, and with replace the published version and the instance root. Read ${TOOL.guide}({ topic: "component-authoring" }) first; publish with ${TOOL.componentPublish}.`,
			inputSchema: withProjectScopedInput({
				systemName: systemNameInputSchema,
				expectedRevision: expectedRevisionSchema,
				slug: z
					.string()
					.min(1)
					.optional()
					.describe("Unique component slug. Required without from."),
				name: z
					.string()
					.min(1)
					.optional()
					.describe("Human-readable component name. Required without from."),
				description: z.string().optional(),
				group: z.string().optional(),
				order: z.number().finite().optional(),
				draft: mcpPartialSystemComponentDraftPayloadInputSchema,
				from: z
					.object({
						designFileId: designFileIdSchema,
						elementId: z
							.string()
							.min(1)
							.describe("The layer (any element, boards included) to extract."),
						replace: z
							.boolean()
							.optional()
							.describe(
								"Also publish the draft and replace the layer with an instance of it.",
							),
						expectedRevision: expectedRevisionSchema
							.optional()
							.describe("With replace: the design revision."),
					})
					.strict()
					.optional()
					.describe("Extract the draft from a design layer instead of draft."),
			}),
			annotations: { ...mutationAnnotations, idempotentHint: false },
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"new system component author design system extract promote layer reusable",
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
			from,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				assertCanWriteProject(getMcpPolicy(context.config));
				const metadataProblems = systemComponentMetadataProblems(
					createMetadataToValidate({ name, group, description }),
				);
				if (metadataProblems.length > 0) {
					return createMetadataErrorResult(context, metadataProblems);
				}
				if (from !== undefined) {
					if (draft !== undefined) {
						throw new DesignTransformError(
							"INVALID_OPERATION_PARAMETERS",
							"Pass draft or from, not both: from builds the draft from a layer.",
						);
					}
					const system = await resolveToolSystem(context, {
						systemName,
						designFileId: from.designFileId,
					});
					return extractComponentDraftPayload(context, {
						systemId: system.manifest.systemId,
						expectedRevision,
						slug,
						name,
						description,
						group,
						order,
						from,
					});
				}
				if (slug === undefined || name === undefined) {
					throw new DesignTransformError(
						"INVALID_OPERATION_PARAMETERS",
						"slug and name are required without from.",
						{
							missingParameters: [
								...(slug === undefined ? ["slug"] : []),
								...(name === undefined ? ["name"] : []),
							],
						},
					);
				}
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
			title: "Update System Component",
			description: `Replace parts of a component's draft: root (template), slots, variants and/or overrideTargets; parts you omit stay. Also renames or regroups a component: name, group (slash-separated folders like "organisms/sidebar") and description, each optional and usable alone; null clears group or description. These are labels, outside the template and its hashes: they take effect at once, with no publish and no new version, and a call with only them leaves the draft as it is (or absent). slug and componentId never change. expectedRevision is the manifest revision; expectedDraftTemplateHash and expectedDraftVariantSchemaHash (from ${TOOL.componentRead} describe) guard against concurrent draft edits. Returns the new revision and what changed. Read the draft first with ${TOOL.componentRead}({ componentId, source: "draft", include: ["template", "classes"] }).`,
			inputSchema: withProjectScopedInput({
				systemName: systemNameInputSchema,
				componentId: componentIdSchema,
				expectedRevision: expectedRevisionSchema,
				expectedDraftTemplateHash: z.string().optional(),
				expectedDraftVariantSchemaHash: z.string().optional(),
				name: z
					.string()
					.optional()
					.describe(
						`New display name, at most ${SYSTEM_COMPONENT_NAME_MAX_LENGTH} characters. The slug stays.`,
					),
				group: z
					.string()
					.nullable()
					.optional()
					.describe(
						`Folder path like "organisms/sidebar", at most ${SYSTEM_COMPONENT_GROUP_MAX_LENGTH} characters; null clears it.`,
					),
				description: z
					.string()
					.nullable()
					.optional()
					.describe(
						`At most ${SYSTEM_COMPONENT_DESCRIPTION_MAX_LENGTH} characters; null clears it.`,
					),
				root: mcpRecipeTemplateNodeInputSchema,
				slots: mcpSystemComponentSlotsInputSchema,
				variants: mcpSystemComponentVariantSchemaInputSchema,
				overrideTargets: mcpSystemComponentOverrideTargetsInputSchema,
			}),
			annotations: { ...mutationAnnotations, idempotentHint: false },
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"edit system component template variants slots overrides rename group description",
			},
		},
		async ({
			systemName,
			componentId,
			expectedRevision,
			expectedDraftTemplateHash,
			expectedDraftVariantSchemaHash,
			name,
			group,
			description,
			root,
			slots,
			variants,
			overrideTargets,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				assertCanWriteProject(getMcpPolicy(context.config));
				const system = await resolveToolSystem(context, { systemName });
				const draftPatch = {
					...(root !== undefined ? { root } : {}),
					...(slots !== undefined ? { slots } : {}),
					...(variants !== undefined ? { variants } : {}),
					...(overrideTargets !== undefined ? { overrideTargets } : {}),
				};
				const metadata = {
					...(name !== undefined ? { name } : {}),
					...(group !== undefined ? { group } : {}),
					...(description !== undefined ? { description } : {}),
				};
				const updatesDraft = Object.keys(draftPatch).length > 0;
				if (!updatesDraft && Object.keys(metadata).length === 0) {
					throw new DesignTransformError(
						"INVALID_OPERATION_PARAMETERS",
						"Nothing to update: pass name, group or description, and/or draft parts root, slots, variants or overrideTargets.",
					);
				}
				const parsedDraftPatch =
					systemComponentDraftPatchSchema.safeParse(draftPatch);
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
				const beforeRecord = before.manifest.components[componentId];
				const metadataProblems = systemComponentMetadataProblems(
					metadata,
					beforeRecord,
				);
				if (metadataProblems.length > 0) {
					return createMetadataErrorResult(context, metadataProblems);
				}
				const result = await updateSystemComponent(
					context.projectRoot,
					system.manifest.systemId,
					componentId,
					{
						metadata,
						...(updatesDraft ? { draft: parsedDraftPatch.data } : {}),
					},
					{
						expectedRevision,
						expectedDraftTemplateHash,
						expectedDraftVariantSchemaHash,
					},
				);
				const afterRecord = result.manifest.components[componentId];
				return createJsonResult(
					await systemComponentMutationPayload(
						context,
						system.manifest.systemId,
						componentId,
						{
							kind: "updated",
							...(updatesDraft ? { before: beforeRecord?.draft } : {}),
							replaced: Object.keys(parsedDraftPatch.data),
							...(beforeRecord && afterRecord
								? {
										metadata: diffSystemComponentMetadata(
											beforeRecord,
											afterRecord,
										),
									}
								: {}),
						},
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
			_meta: {
				[SEARCH_HINT_META_KEY]: "release new version system component draft",
			},
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
