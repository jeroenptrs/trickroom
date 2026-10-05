import { z } from "zod";
import { DesignTransformError } from "../../services/design-transform-service";
import {
	readAsset,
	readAssetManifest,
} from "../../utils/asset-manifest-service";
import { findProjectResourceUsage } from "../../utils/design-resource-references";
import { readIcon, readIconManifest } from "../../utils/icon-manifest-service";
import { getMcpPolicy } from "../governance";
import type { TrickroomMcpServerContext } from "../server-types";
import { assertConfiguredSystem } from "./design-system";
import { getProjectReference } from "./project";

type ListFilterInput = {
	query?: string;
	limit?: number;
	offset?: number;
};

export const listQuerySchema = z
	.string()
	.optional()
	.describe(
		"Optional case-insensitive filter, applied before paging. Every whitespace-separated term must appear in the entry's id or name (or path/value where listed).",
	);

export const listLimitSchema = (defaultLimit: number) =>
	z
		.number()
		.int()
		.min(1)
		.max(5000)
		.optional()
		.describe(
			`Maximum entries to return. Defaults to ${defaultLimit}; prefer a query over a large limit.`,
		);

export const listOffsetSchema = z
	.number()
	.int()
	.min(0)
	.optional()
	.describe("Entries to skip before the page starts. Defaults to 0.");

/**
 * Filter and page a catalog list. Always reports totalCount (catalog size),
 * matchedCount (after query) and returnedCount; when entries remain, `next`
 * holds the offset for the following page.
 */
export const filterCatalogList = <T>(
	items: readonly T[],
	{ query, limit, offset = 0 }: ListFilterInput,
	getSearchText: (item: T) => string,
	defaultLimit: number,
	unfilteredHint = "Pass query to filter by id or name, or offset for the next page.",
) => {
	const terms = (query ?? "")
		.toLowerCase()
		.split(/\s+/u)
		.filter((term) => term.length > 0);
	const matched =
		terms.length === 0
			? items
			: items.filter((item) => {
					const text = getSearchText(item).toLowerCase();
					return terms.every((term) => text.includes(term));
				});
	const pageSize = limit ?? defaultLimit;
	const returned = matched.slice(offset, offset + pageSize);
	const nextOffset = offset + returned.length;
	const truncated = nextOffset < matched.length;
	return {
		items: returned,
		counts: {
			totalCount: items.length,
			matchedCount: matched.length,
			returnedCount: returned.length,
			...(offset > 0 ? { offset } : {}),
			truncated,
			...(truncated
				? {
						next: { offset: nextOffset },
						hint:
							terms.length === 0
								? unfilteredHint
								: "Narrow the query, or pass offset for the next page.",
					}
				: {}),
		},
	};
};

export const defaultAssetListLimit = 50;
export const defaultIconListLimit = 50;
export const defaultUsageListLimit = 100;

export const listSystemAssetsPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	filter: ListFilterInput = {},
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const manifest = await readAssetManifest(
		context.projectRoot,
		system.manifest.systemId,
	);
	const { items, counts } = filterCatalogList(
		Object.entries(manifest.assets).map(([id, asset]) => ({
			id,
			name: asset.name,
			sourcePath: asset.sourcePath,
			...(asset.width !== undefined && asset.height !== undefined
				? { width: asset.width, height: asset.height }
				: {}),
			...(asset.alt ? { alt: asset.alt } : {}),
		})),
		filter,
		(asset) =>
			`${asset.id} ${asset.name} ${asset.sourcePath} ${asset.alt ?? ""}`,
		defaultAssetListLimit,
	);
	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		...counts,
		assets: items,
	};
};

export const describeAssetPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	assetId: string,
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const asset = await readAsset(
		context.projectRoot,
		system.manifest.systemId,
		assetId,
	);
	if (!asset) {
		throw new DesignTransformError(
			"UNKNOWN_ASSET_ID",
			`Asset id "${assetId}" does not exist in system "${system.manifest.systemName}".`,
		);
	}

	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		asset: {
			id: assetId,
			...asset,
		},
	};
};

const getIconFileName = (iconId: string) =>
	iconId.slice(iconId.lastIndexOf("/") + 1);

export const listSystemIconsPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	filter: ListFilterInput = {},
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const manifest = await readIconManifest(
		context.projectRoot,
		system.manifest.systemId,
	);
	const { items, counts } = filterCatalogList(
		Object.entries(manifest.icons).map(([id, icon]) => ({
			id,
			name: icon.name,
			sourcePath: icon.sourcePath,
		})),
		filter,
		(icon) => `${icon.id} ${icon.name} ${icon.sourcePath}`,
		defaultIconListLimit,
	);
	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		iconFolderPaths: manifest.iconFolderPaths,
		...counts,
		// Names default to the id's last segment; listed only when they differ.
		icons: items.map((icon) =>
			icon.name === getIconFileName(icon.id)
				? { id: icon.id }
				: { id: icon.id, name: icon.name },
		),
		...(manifest.diagnostics.length > 0
			? { diagnostics: manifest.diagnostics }
			: {}),
	};
};

export const describeIconPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	iconId: string,
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const icon = await readIcon(
		context.projectRoot,
		system.manifest.systemId,
		iconId,
	);
	if (!icon) {
		throw new DesignTransformError(
			"UNKNOWN_ICON_ID",
			`Icon id "${iconId}" does not exist in system "${system.manifest.systemName}".`,
		);
	}

	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		icon: {
			id: iconId,
			...icon,
		},
	};
};

export const findResourceUsagePayload = async (
	context: TrickroomMcpServerContext,
	kind: "asset" | "icon",
	systemName: string,
	resourceId: string | undefined,
	page: { limit?: number; offset?: number } = {},
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const policy = getMcpPolicy(context.config);
	const usages = await findProjectResourceUsage(
		context.projectRoot,
		kind,
		system.manifest.systemId,
		resourceId,
		{ allowedDesignFileIds: policy.allowedDesignFileIds },
	);
	const { items, counts } = filterCatalogList(
		usages,
		page,
		() => "",
		defaultUsageListLimit,
		`Pass id to find one ${kind}'s usages, or offset for the next page.`,
	);
	const designs = new Map<
		string,
		{
			designFileId: string;
			name: string;
			elementIds?: string[];
			usages?: { elementId: string; resourceId: string | null }[];
		}
	>();
	for (const usage of items) {
		let design = designs.get(usage.designFileId);
		if (!design) {
			design = { designFileId: usage.designFileId, name: usage.designName };
			designs.set(usage.designFileId, design);
		}
		// With a resource filter every usage has the same id: list elements only.
		if (resourceId === undefined) {
			design.usages ??= [];
			design.usages.push({
				elementId: usage.elementId,
				resourceId: usage.resourceId,
			});
		} else {
			design.elementIds ??= [];
			design.elementIds.push(usage.elementId);
		}
	}

	const { totalCount: _totalCount, matchedCount, ...pageCounts } = counts;
	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		kind,
		resourceId: resourceId ?? null,
		usageCount: matchedCount,
		designCount: new Set(usages.map((usage) => usage.designFileId)).size,
		...pageCounts,
		designs: [...designs.values()],
	};
};
