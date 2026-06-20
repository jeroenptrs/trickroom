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

export type UpdateSystemAssetParams = {
	alt?: string | null;
	name?: string;
	sourcePath?: string;
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

export type UpdateSystemAssetResponse = {
	systemId: string;
	systemName: string;
	asset: SystemAssetSummary;
};

export type SystemAssetUsedByResponse = {
	systemId: string;
	systemName: string;
	assetId: string;
	usedByCount: number;
};

export type DeleteSystemAssetResponse = {
	ok: true;
	systemId: string;
	systemName: string;
	assetId: string;
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

export const updateSystemAsset = async (
	systemId: string,
	assetId: string,
	params: UpdateSystemAssetParams,
) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/assets/${encodeURIComponent(assetId)}`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<UpdateSystemAssetResponse>(response);
};

export const deleteSystemAsset = async (systemId: string, assetId: string) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/assets/${encodeURIComponent(assetId)}`,
		{ method: "DELETE" },
	);
	return readJsonOrThrow<DeleteSystemAssetResponse>(response);
};

const fetchSystemAssetUsedBy = async (systemId: string, assetId: string) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/assets/${encodeURIComponent(assetId)}/used-by`,
	);
	return readJsonOrThrow<SystemAssetUsedByResponse>(response);
};

export const systemAssetsQueryKey = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) => withProjectQueryScope(["trickroom-system-assets", systemId], projectScope);

export const systemAssetUsedByQueryKey = (
	systemId: string,
	assetId: string,
	projectScope?: ProjectQueryScope,
) =>
	withProjectQueryScope(
		["trickroom-system-asset-used-by", systemId, assetId],
		projectScope,
	);

export const systemAssetsQueryOptions = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: systemAssetsQueryKey(systemId, projectScope),
		queryFn: () => fetchSystemAssets(systemId),
		retry: false,
	});

export const systemAssetUsedByQueryOptions = (
	systemId: string,
	assetId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: systemAssetUsedByQueryKey(systemId, assetId, projectScope),
		queryFn: () => fetchSystemAssetUsedBy(systemId, assetId),
		retry: false,
	});
