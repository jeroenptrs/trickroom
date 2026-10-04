import { queryOptions } from "@tanstack/react-query";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export type SystemAssetSummary = {
	id: string;
	name: string;
	kind: "image";
	sourcePath: string;
	mimeType: string;
	width?: number;
	height?: number;
	alt?: string;
	createdAt: string;
	updatedAt: string;
};

export type SystemAssetsResponse = {
	systemId: string;
	systemName: string;
	assets: SystemAssetSummary[];
};

export type CreateSystemAssetParams = {
	assetId?: string;
	name: string;
	sourcePath: string;
	alt?: string | null;
};

export type CreateSystemAssetResponse = {
	systemId: string;
	systemName: string;
	asset: SystemAssetSummary;
};

export const systemAssetFileUrl = (systemId: string, assetId: string) =>
	`/api/trickroom/systems/${encodeURIComponent(systemId)}/assets/${encodeURIComponent(assetId)}/file`;

const fetchSystemAssets = async (systemId: string) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/assets`,
	);
	return readJsonOrThrow<SystemAssetsResponse>(response);
};

export const createSystemAsset = async (
	systemId: string,
	params: CreateSystemAssetParams,
) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/assets`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<CreateSystemAssetResponse>(response);
};

export const systemAssetsQueryKey = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) => withProjectQueryScope(["trickroom-system-assets", systemId], projectScope);

export const systemAssetsQueryOptions = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: systemAssetsQueryKey(systemId, projectScope),
		queryFn: () => fetchSystemAssets(systemId),
		retry: false,
	});
