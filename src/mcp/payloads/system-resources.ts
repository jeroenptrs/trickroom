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
};

export const listQuerySchema = z
	.string()
	.optional()
	.describe(
		"Optional case-insensitive filter. Every whitespace-separated term must appear in the entry's id, name, or other text fields.",
	);

export const listLimitSchema = z
	.number()
	.int()
	.min(1)
	.max(5000)
	.optional()
	.describe(
		"Optional maximum number of entries to return. Omit to return every match.",
	);

/**
 * Filter and cap a catalog list. Always reports totalCount (catalog size) and
 * matchedCount (after query) so callers know what a limit or query hid.
 */
export const filterCatalogList = <T>(
	items: readonly T[],
	{ query, limit }: ListFilterInput,
	getSearchText: (item: T) => string,
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
	const returned = limit === undefined ? matched : matched.slice(0, limit);
	return {
		items: returned,
		counts: {
			totalCount: items.length,
			matchedCount: matched.length,
			returnedCount: returned.length,
			truncated: returned.length < matched.length,
		},
	};
};

const getEntrySearchText = (entry: Record<string, unknown>) =>
	Object.values(entry)
		.filter((value): value is string => typeof value === "string")
		.join(" ");

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
			...asset,
		})),
		filter,
		getEntrySearchText,
	);
	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		updatedAt: manifest.metadata.updatedAt,
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
			...icon,
		})),
		filter,
		getEntrySearchText,
	);
	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		indexedAt: manifest.metadata.indexedAt,
		iconFolderPaths: manifest.iconFolderPaths,
		...counts,
		icons: items,
		diagnostics: manifest.diagnostics,
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

	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		kind,
		resourceId: resourceId ?? null,
		usages,
	};
};
