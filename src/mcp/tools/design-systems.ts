import { z } from "zod";
import { DesignTransformError } from "../../services/design-transform-service";
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
import { formatDidYouMean, suggestClosest } from "../../utils/suggestions";
import { readDomainTokensReadonly } from "../../utils/tailwind-token-store";
import { assertCanWriteProject, getMcpPolicy } from "../governance";
import { resolveToolSystem } from "../payloads/design-system";
import { getProjectReference } from "../payloads/project";
import {
	describeAssetPayload,
	describeIconPayload,
	filterCatalogList,
	findResourceUsagePayload,
	listOffsetSchema,
	listQuerySchema,
	listSystemAssetsPayload,
	listSystemIconsPayload,
} from "../payloads/system-resources";
import { TOOL } from "../tool-names";
import {
	destructiveMutationAnnotations,
	readOnlyClosedWorldAnnotations,
	SEARCH_HINT_META_KEY,
} from "./annotations";
import type { McpToolContext } from "./context";
import { createJsonResult, createToolErrorResult } from "./results";
import { designFileIdSchema, withProjectScopedInput } from "./schemas";

const defaultTokenListLimit = 100;

/** systemName on every system tool: a name or id, defaulting sensibly. */
export const systemNameInputSchema = z
	.string()
	.min(1)
	.optional()
	.describe(
		"Design system name or id. Defaults to the project's default system, or its only one.",
	);

const requireParameters = (
	action: string,
	parameters: Record<string, unknown>,
	names: string[],
) => {
	const missing = names.filter((name) => parameters[name] === undefined);
	if (missing.length > 0) {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			`Action "${action}" needs ${missing.map((name) => `"${name}"`).join(", ")}.`,
			{ missingParameters: missing },
		);
	}
};

export const registerDesignSystemTools = (ctx: McpToolContext) => {
	const { server, withPolicyErrorHandling } = ctx;

	server.registerTool(
		TOOL.systemRead,
		{
			title: "Read Design System",
			description: `Read a design system's catalogs. view "tokens": stored design tokens as { <domain>: { <name>: value } } with per-domain counts (filter with domain, e.g. color or spacing, and query). view "assets": raster images (id, name, sourcePath, size, alt); "icons": SVG icon ids. With id, assets and icons return that one entry in full. view "asset_usage" / "icon_usage": design elements that use the system's assets or icons, grouped by design; id narrows to one. Lists page with query, limit and offset and always report totalCount, matchedCount and returnedCount. Address the system by systemName, or by designFileId for the system a design is linked to. Never returns image bytes or SVG source.`,
			inputSchema: withProjectScopedInput({
				view: z
					.enum(["tokens", "assets", "icons", "asset_usage", "icon_usage"])
					.describe("What to read."),
				systemName: systemNameInputSchema,
				designFileId: designFileIdSchema
					.optional()
					.describe("Read the system this design is linked to."),
				id: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Asset or icon id: one entry in full, or one resource's usages.",
					),
				domain: z
					.string()
					.min(1)
					.optional()
					.describe(
						"tokens only: one domain, e.g. color, spacing, font, text, radius, shadow.",
					),
				query: listQuerySchema,
				limit: z
					.number()
					.int()
					.min(1)
					.max(5000)
					.optional()
					.describe(
						"Entries per page: defaults to 100 tokens, 50 assets or icons, 100 usages.",
					),
				offset: listOffsetSchema,
			}),
			annotations: readOnlyClosedWorldAnnotations,
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"tokens colors spacing theme assets images icons svg catalog usage",
			},
		},
		async ({
			view,
			systemName,
			designFileId,
			id,
			domain,
			query,
			limit,
			offset,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const system = await resolveToolSystem(context, {
					systemName,
					designFileId,
				});
				const systemId = system.manifest.systemId;
				const filter = { query, limit, offset };
				switch (view) {
					case "assets":
						return createJsonResult(
							id === undefined
								? await listSystemAssetsPayload(context, systemId, filter)
								: await describeAssetPayload(context, systemId, id),
						);
					case "icons":
						return createJsonResult(
							id === undefined
								? await listSystemIconsPayload(context, systemId, filter)
								: await describeIconPayload(context, systemId, id),
						);
					case "asset_usage":
					case "icon_usage":
						return createJsonResult(
							await findResourceUsagePayload(
								context,
								view === "asset_usage" ? "asset" : "icon",
								systemId,
								id,
								{ limit, offset },
							),
						);
				}

				const storedTokens = await readDomainTokensReadonly(
					context.projectRoot,
					systemId,
				);
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
					filter,
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
					project: getProjectReference(context),
					systemId,
					systemName: system.manifest.systemName,
					storageStatus: storedTokens ? "stored" : "not_stored",
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
			}),
	);

	server.registerTool(
		TOOL.systemUpdate,
		{
			title: "Update Design System Resources",
			description: `Change a design system's asset and icon catalogs. action "add_asset" registers an image file (name, sourcePath, optional assetId and alt); "remove_asset" removes an asset no design uses (assetId); "refresh_asset" re-reads an asset file's image metadata (assetId). "add_icon_folder" adds a project-relative folder of SVGs and rebuilds the icon catalog (folderPath); "remove_icon_folder" removes one (folderPath). Paths are project-relative. Read the catalogs with ${TOOL.systemRead}.`,
			inputSchema: withProjectScopedInput({
				action: z
					.enum([
						"add_asset",
						"remove_asset",
						"refresh_asset",
						"add_icon_folder",
						"remove_icon_folder",
					])
					.describe("What to change."),
				systemName: systemNameInputSchema,
				assetId: z.string().min(1).optional().describe("Asset id."),
				name: z
					.string()
					.min(1)
					.optional()
					.describe("add_asset: human-readable asset name."),
				sourcePath: z
					.string()
					.min(1)
					.optional()
					.describe("add_asset: project-relative image file path."),
				alt: z.string().optional().describe("add_asset: default alt text."),
				folderPath: z
					.string()
					.min(1)
					.optional()
					.describe("Project-relative folder of SVG icons."),
			}),
			annotations: destructiveMutationAnnotations,
			_meta: {
				[SEARCH_HINT_META_KEY]:
					"add remove register asset image icon folder svg refresh metadata",
			},
		},
		async ({
			action,
			systemName,
			assetId,
			name,
			sourcePath,
			alt,
			folderPath,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				assertCanWriteProject(getMcpPolicy(context.config));
				const parameters = { assetId, name, sourcePath, folderPath };
				const system = await resolveToolSystem(context, { systemName });
				const systemId = system.manifest.systemId;
				const header = {
					status: "success",
					project: getProjectReference(context),
					action,
					systemId,
					systemName: system.manifest.systemName,
				};

				if (action === "add_icon_folder" || action === "remove_icon_folder") {
					requireParameters(action, parameters, ["folderPath"]);
					const manifest = await (action === "add_icon_folder"
						? addIconFolderPath
						: removeIconFolderPath)(
						context.projectRoot,
						systemId,
						folderPath as string,
					);
					const icons = await syncIconManifest(context.projectRoot, systemId);
					return createJsonResult({
						...header,
						iconFolderPaths:
							action === "add_icon_folder"
								? (manifest.iconFolderPaths ?? [])
								: icons.iconFolderPaths,
						iconCount: Object.keys(icons.icons).length,
					});
				}

				if (action === "add_asset") {
					requireParameters(action, parameters, ["name", "sourcePath"]);
					const result = await registerAsset(context.projectRoot, systemId, {
						assetId,
						name: name as string,
						sourcePath: sourcePath as string,
						alt,
					});
					return createJsonResult({
						...header,
						asset: { id: result.assetId, ...result.asset },
					});
				}

				requireParameters(action, parameters, ["assetId"]);
				if (action === "refresh_asset") {
					const result = await refreshAssetMetadata(
						context.projectRoot,
						systemId,
						assetId as string,
					);
					return createJsonResult({
						...header,
						asset: { id: result.assetId, ...result.asset },
					});
				}

				const usages = await findProjectResourceUsage(
					context.projectRoot,
					"asset",
					systemId,
					assetId,
				);
				if (usages.length > 0) {
					return createToolErrorResult(
						context,
						"ASSET_IN_USE",
						`Asset "${assetId}" is still used by designs. Find them with ${TOOL.systemRead}({ view: "asset_usage", id }).`,
						{ usageCount: usages.length },
					);
				}
				await deleteAsset(context.projectRoot, systemId, assetId as string);
				return createJsonResult({
					...header,
					assetId: normalizeAssetId(assetId as string),
				});
			}),
	);
};
