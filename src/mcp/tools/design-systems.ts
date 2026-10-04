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
	getCategoryForTokenName,
	getDesignSystemPayload,
	isTokenOverrideConfirmed,
} from "../payloads/design-system";
import { getProjectReference } from "../payloads/project";
import {
	describeAssetPayload,
	describeIconPayload,
	filterCatalogList,
	findResourceUsagePayload,
	listLimitSchema,
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
import { withProjectScopedInput } from "./schemas";

export const registerDesignSystemReadTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		"getDesignSystemForDesignFile",
		{
			title: "Get Design System For Design File",
			description:
				"Resolve the design system linked from a design file and report configured CSS path plus token storage metadata.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().min(1).describe("Design file UUID."),
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
				return createJsonResult({
					...payload,
					memory: summarizeMemoryManifest(systemMemory.manifest),
					memoryHint:
						"System memory captures usage conventions and constraints for this design system. Call listMemoryNotes({ scope: { kind: 'system', systemName } }) before authoring with it.",
				});
			}),
	);

	server.registerTool(
		"listDesignTokens",
		{
			title: "List Design Tokens",
			description:
				"List stored design tokens for the design system linked to a design file. Pass domain (e.g. color, spacing, font), query, and/or limit to bound the list; totalCount and matchedCount are always reported.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().min(1).describe("Design file UUID."),
				domain: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Optional token domain to list, e.g. color, spacing, font, text, radius, shadow. The domains summary is limited to it as well.",
					),
				query: listQuerySchema,
				limit: listLimitSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, domain, query, limit, project }) => {
			return withPolicyErrorHandling(project, async (context) => {
				const designSystemPayload = await getDesignSystemPayload(
					context,
					designFileId,
				);
				const systemName =
					designSystemPayload.designSystem === null
						? null
						: designSystemPayload.designSystem.systemName;
				const systemId =
					designSystemPayload.designSystem === null
						? null
						: designSystemPayload.designSystem.systemId;
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
				const { items: tokens, counts } = filterCatalogList(
					domains && storedTokens
						? Object.entries(domains).flatMap(([tokenDomain, domainStorage]) =>
								Object.entries(domainStorage.tokens).map(([name, value]) => ({
									domain: tokenDomain,
									category: getCategoryForTokenName(name),
									name,
									value,
									overrideConfirmed: isTokenOverrideConfirmed(
										tokenDomain,
										name,
										domainStorage.overrides,
									),
									syncedAt: storedTokens.metadata.syncedAt,
									reviewRequired: storedTokens.metadata.reviewRequired,
								})),
							)
						: [],
					{ query, limit },
					(token) => `${token.name} ${String(token.value)}`,
				);

				return createJsonResult({
					...designSystemPayload,
					storageStatus:
						systemName === null
							? "not_linked"
							: storedTokens
								? "stored"
								: "not_stored",
					...counts,
					tokens,
					domains: domains
						? Object.fromEntries(
								Object.entries(domains).map(([tokenDomain, domainStorage]) => [
									tokenDomain,
									{
										tokenCount: Object.keys(domainStorage.tokens).length,
										overrides: domainStorage.overrides,
										baselineDiff: domainStorage.baselineDiff,
									},
								]),
							)
						: {},
				});
			});
		},
	);

	server.registerTool(
		"listSystemAssets",
		{
			title: "List System Assets",
			description:
				"List system-scoped referenced raster image assets without exposing file bytes. Pass query and/or limit to bound large catalogs; totalCount and matchedCount are always reported.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				query: listQuerySchema,
				limit: listLimitSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, query, limit, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await listSystemAssetsPayload(context, systemName, { query, limit }),
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
			description:
				'List generated system-scoped SVG icon catalog metadata and diagnostics. Raw SVG is not returned. Pass query (e.g. "arrow left") and/or limit to bound large icon libraries; totalCount and matchedCount are always reported.',
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				query: listQuerySchema,
				limit: listLimitSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, query, limit, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await listSystemIconsPayload(context, systemName, { query, limit }),
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
			description:
				"Find design elements that reference assets in a system. Optionally filter to one asset id.",
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
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, assetId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await findResourceUsagePayload(context, "asset", systemName, assetId),
				),
			),
	);

	server.registerTool(
		"findIconUsage",
		{
			title: "Find Icon Usage",
			description:
				"Find design elements that reference icons in a system. Optionally filter to one icon id.",
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
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, iconId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await findResourceUsagePayload(context, "icon", systemName, iconId),
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
