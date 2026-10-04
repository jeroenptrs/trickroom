import { z } from "zod";
import {
	deleteAsset,
	normalizeAssetId,
	refreshAssetMetadata,
	registerAsset,
} from "../../utils/asset-manifest-service";
import { findProjectResourceUsage } from "../../utils/design-resource-references";
import {
	addIconFolderPath,
	removeIconFolderPath,
} from "../../utils/design-system-store";
import { syncIconManifest } from "../../utils/icon-manifest-service";
import {
	readMemoryManifest,
	summarizeMemoryManifest,
} from "../../utils/memory-manifest-service";
import { formatDidYouMean, suggestClosest } from "../../utils/suggestions";
import { readDomainTokensReadonly } from "../../utils/tailwind-token-store";
import { assertCanWriteProject, getMcpPolicy } from "../governance";
import {
	assertConfiguredSystem,
	getDesignSystemPayload,
} from "../payloads/design-system";
import { getProjectReference } from "../payloads/project";
import {
	defaultAssetListLimit,
	defaultIconListLimit,
	defaultUsageListLimit,
	describeAssetPayload,
	describeIconPayload,
	filterCatalogList,
	findResourceUsagePayload,
	listLimitSchema,
	listOffsetSchema,
	listQuerySchema,
	listSystemAssetsPayload,
	listSystemIconsPayload,
} from "../payloads/system-resources";
import {
	destructiveMutationAnnotations,
	mutationAnnotations,
	readOnlyClosedWorldAnnotations,
} from "./annotations";
import type { McpToolContext } from "./context";
import { createJsonResult, createToolErrorResult } from "./results";
import { designFileIdSchema, withProjectScopedInput } from "./schemas";

const defaultTokenListLimit = 100;

export const registerDesignSystemReadTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		"getDesignSystemForDesignFile",
		{
			title: "Get Design System For Design File",
			description:
				"Resolve the design system linked from a design file and report configured CSS path plus token storage metadata.",
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const payload = await getDesignSystemPayload(context, designFileId);
				const systemId =
					payload.designSystem === null ? null : payload.designSystem.systemId;
				if (!systemId) {
					return createJsonResult(payload);
				}
				const systemMemory = await readMemoryManifest(context.projectRoot, {
					kind: "system",
					systemHandle: systemId,
				});
				const memory = summarizeMemoryManifest(systemMemory.manifest);
				return createJsonResult(
					memory.noteCount > 0
						? {
								...payload,
								memory,
								memoryHint:
									"System memory captures usage conventions and constraints for this design system. Call listMemoryNotes({ scope: { kind: 'system', systemName } }) before authoring with it.",
							}
						: payload,
				);
			}),
	);

	server.registerTool(
		"listDesignTokens",
		{
			title: "List Design Tokens",
			description: `List stored design tokens for the design system linked to a design file, as \`tokens: { <domain>: { <name>: <value> } }\` plus per-domain counts. Returns ${defaultTokenListLimit} tokens by default: pass domain (e.g. color, spacing, font), query, limit, or offset to page. Counts are always reported.`,
			inputSchema: withProjectScopedInput({
				designFileId: designFileIdSchema,
				domain: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Optional token domain to list, e.g. color, spacing, font, text, radius, shadow. The domains summary is limited to it as well.",
					),
				query: listQuerySchema,
				limit: listLimitSchema(defaultTokenListLimit),
				offset: listOffsetSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, domain, query, limit, offset, project }) => {
			return withPolicyErrorHandling(project, async (context) => {
				const { designSystem } = await getDesignSystemPayload(
					context,
					designFileId,
				);
				const systemId = designSystem?.systemId ?? null;
				const storedTokens = systemId
					? await readDomainTokensReadonly(context.projectRoot, systemId)
					: null;
				const allDomains = storedTokens?.domains;
				if (
					domain !== undefined &&
					allDomains &&
					!Object.hasOwn(allDomains, domain)
				) {
					const availableDomains = Object.keys(allDomains).sort();
					const suggestions = suggestClosest(domain, availableDomains);
					return createToolErrorResult(
						context,
						"UNKNOWN_TOKEN_DOMAIN",
						`Unknown token domain "${domain}".${formatDidYouMean(suggestions)}`,
						{ suggestions, availableDomains },
					);
				}
				const domains =
					allDomains && domain !== undefined
						? { [domain]: allDomains[domain as keyof typeof allDomains] }
						: allDomains;
				const { items, counts } = filterCatalogList(
					domains
						? Object.entries(domains).flatMap(([tokenDomain, domainStorage]) =>
								Object.entries(domainStorage.tokens).map(([name, value]) => ({
									domain: tokenDomain,
									name,
									value,
								})),
							)
						: [],
					{ query, limit, offset },
					(token) => `${token.name} ${String(token.value)}`,
					defaultTokenListLimit,
					"Pass domain or query to filter, or offset for the next page.",
				);
				const tokens: Record<string, Record<string, unknown>> = {};
				for (const token of items) {
					tokens[token.domain] ??= {};
					tokens[token.domain][token.name] = token.value;
				}

				return createJsonResult({
					designFileId,
					systemId,
					systemName: designSystem?.systemName ?? null,
					storageStatus:
						designSystem === null
							? "not_linked"
							: storedTokens
								? "stored"
								: "not_stored",
					...(storedTokens
						? {
								syncedAt: storedTokens.metadata.syncedAt,
								reviewRequired: storedTokens.metadata.reviewRequired,
							}
						: {}),
					// Token count per domain; empty domains are left out.
					domains: domains
						? Object.fromEntries(
								Object.entries(domains)
									.map(
										([tokenDomain, domainStorage]) =>
											[
												tokenDomain,
												Object.keys(domainStorage.tokens).length,
											] as const,
									)
									.filter(([, tokenCount]) => tokenCount > 0),
							)
						: {},
					...counts,
					tokens,
				});
			});
		},
	);

	server.registerTool(
		"listSystemAssets",
		{
			title: "List System Assets",
			description: `List system raster image assets (id, name, sourcePath, size, alt) without file bytes. Returns ${defaultAssetListLimit} by default: pass query, limit, or offset to page. Counts are always reported.`,
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				query: listQuerySchema,
				limit: listLimitSchema(defaultAssetListLimit),
				offset: listOffsetSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, query, limit, offset, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await listSystemAssetsPayload(context, systemName, {
						query,
						limit,
						offset,
					}),
				),
			),
	);

	server.registerTool(
		"describeAsset",
		{
			title: "Describe Asset",
			description:
				"Describe one system-scoped raster asset by stable id. Does not expose file bytes.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				assetId: z.string().min(1).describe("Stable system asset id."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, assetId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await describeAssetPayload(context, systemName, assetId),
				),
			),
	);

	server.registerTool(
		"listSystemIcons",
		{
			title: "List System Icons",
			description: `List system SVG icon ids (name only when it differs from the id's last segment) and catalog diagnostics; raw SVG is not returned. Returns ${defaultIconListLimit} by default: pass query (e.g. "arrow left", matched against id, name, and source path), limit, or offset to page. Counts are always reported; describeIcon has the full record.`,
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				query: listQuerySchema,
				limit: listLimitSchema(defaultIconListLimit),
				offset: listOffsetSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, query, limit, offset, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await listSystemIconsPayload(context, systemName, {
						query,
						limit,
						offset,
					}),
				),
			),
	);

	server.registerTool(
		"describeIcon",
		{
			title: "Describe Icon",
			description:
				"Describe one generated system icon by stable id. Raw SVG is not returned.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				iconId: z.string().min(1).describe("Stable system icon id."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, iconId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await describeIconPayload(context, systemName, iconId),
				),
			),
	);
};

export const registerResourceUsageTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		"findAssetUsage",
		{
			title: "Find Asset Usage",
			description: `Find design elements that reference assets in a system, grouped by design. Pass assetId for one asset. Returns ${defaultUsageListLimit} usages by default: pass limit or offset to page; usageCount and designCount are always reported.`,
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				assetId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional stable system asset id."),
				limit: listLimitSchema(defaultUsageListLimit),
				offset: listOffsetSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, assetId, limit, offset, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await findResourceUsagePayload(
						context,
						"asset",
						systemName,
						assetId,
						{
							limit,
							offset,
						},
					),
				),
			),
	);

	server.registerTool(
		"findIconUsage",
		{
			title: "Find Icon Usage",
			description: `Find design elements that reference icons in a system, grouped by design. Pass iconId for one icon. Returns ${defaultUsageListLimit} usages by default: pass limit or offset to page; usageCount and designCount are always reported.`,
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				iconId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional stable system icon id."),
				limit: listLimitSchema(defaultUsageListLimit),
				offset: listOffsetSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, iconId, limit, offset, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await findResourceUsagePayload(context, "icon", systemName, iconId, {
						limit,
						offset,
					}),
				),
			),
	);
};

export const registerSystemResourceManifestTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		"addSystemIconFolder",
		{
			title: "Add System Icon Folder",
			description:
				"Add one project-relative folder to a design system's iconFolderPaths and refresh the icon manifest.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				folderPath: z
					.string()
					.min(1)
					.describe("Project-relative folder path containing SVG icons."),
			}),
			annotations: mutationAnnotations,
		},
		async ({ systemName, folderPath, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const manifest = await addIconFolderPath(
					context.projectRoot,
					system.manifest.systemId,
					folderPath,
				);
				const icons = await syncIconManifest(
					context.projectRoot,
					system.manifest.systemId,
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					systemId: manifest.systemId,
					systemName: manifest.systemName,
					iconFolderPaths: manifest.iconFolderPaths ?? [],
					iconCount: Object.keys(icons.icons).length,
				});
			}),
	);

	server.registerTool(
		"removeSystemIconFolder",
		{
			title: "Remove System Icon Folder",
			description:
				"Remove one project-relative folder from a design system's iconFolderPaths.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				folderPath: z
					.string()
					.min(1)
					.describe("Project-relative icon folder path to remove."),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ systemName, folderPath, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const manifest = await removeIconFolderPath(
					context.projectRoot,
					system.manifest.systemId,
					folderPath,
				);
				const icons = await syncIconManifest(
					context.projectRoot,
					system.manifest.systemId,
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					systemId: manifest.systemId,
					systemName: manifest.systemName,
					iconFolderPaths: icons.iconFolderPaths,
					iconCount: Object.keys(icons.icons).length,
				});
			}),
	);

	server.registerTool(
		"addSystemAsset",
		{
			title: "Add System Asset",
			description:
				"Register one image asset in a configured design system asset manifest.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				assetId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional stable asset id."),
				name: z.string().min(1).describe("Human-readable asset name."),
				sourcePath: z
					.string()
					.min(1)
					.describe("Project-relative image file path."),
				alt: z.string().optional().describe("Optional default alt text."),
			}),
			annotations: mutationAnnotations,
		},
		async ({ systemName, assetId, name, sourcePath, alt, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const result = await registerAsset(
					context.projectRoot,
					system.manifest.systemId,
					{
						assetId,
						name,
						sourcePath,
						alt,
					},
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					systemId: system.manifest.systemId,
					systemName: system.manifest.systemName,
					asset: { id: result.assetId, ...result.asset },
				});
			}),
	);

	server.registerTool(
		"removeSystemAsset",
		{
			title: "Remove System Asset",
			description:
				"Remove one asset from a configured design system if it is not used by designs.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				assetId: z.string().min(1).describe("Asset id to remove."),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ systemName, assetId, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const usages = await findProjectResourceUsage(
					context.projectRoot,
					"asset",
					system.manifest.systemId,
					assetId,
				);
				if (usages.length > 0) {
					return createToolErrorResult(
						context,
						"ASSET_IN_USE",
						`Asset "${assetId}" is still used by designs.`,
					);
				}
				await deleteAsset(
					context.projectRoot,
					system.manifest.systemId,
					assetId,
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					systemId: system.manifest.systemId,
					systemName: system.manifest.systemName,
					assetId: normalizeAssetId(assetId),
				});
			}),
	);

	server.registerTool(
		"refreshSystemAssetMetadata",
		{
			title: "Refresh System Asset Metadata",
			description:
				"Re-read one asset file's image metadata and update the asset updatedAt timestamp.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				assetId: z.string().min(1).describe("Asset id to refresh."),
			}),
			annotations: mutationAnnotations,
		},
		async ({ systemName, assetId, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const result = await refreshAssetMetadata(
					context.projectRoot,
					system.manifest.systemId,
					assetId,
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					systemId: system.manifest.systemId,
					systemName: system.manifest.systemName,
					asset: { id: result.assetId, ...result.asset },
				});
			}),
	);
};
