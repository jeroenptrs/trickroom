import { queryOptions } from "@tanstack/react-query";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export type SystemIconSummary = {
	id: string;
	name: string;
	sourcePath: string;
	viewBox?: string;
	paint: "fill" | "mixed" | "stroke" | "unknown";
	hash: string;
};

export type SystemIconsResponse = {
	systemId: string;
	systemName: string;
	indexedAt: string;
	iconFolderPaths: string[];
	icons: SystemIconSummary[];
	diagnostics: {
		code: string;
		message: string;
		iconId?: string;
		sourcePath?: string;
		keptSourcePath?: string;
	}[];
};

const fetchSystemIcons = async (systemId: string) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/icons`,
	);
	return readJsonOrThrow<SystemIconsResponse>(response);
};

const fetchSystemIconSvg = async (systemId: string, iconId: string) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/icons/${encodeURIComponent(iconId)}/svg`,
	);

	if (!response.ok) {
		return null;
	}

	return response.text();
};

const syncSystemIcons = async (systemId: string) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/icons/sync`,
		{ method: "POST" },
	);
	return readJsonOrThrow<SystemIconsResponse>(response);
};

export const addSystemIconFolder = async ({
	systemId,
	folderPath,
}: {
	systemId: string;
	folderPath: string;
}) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/icons/folders`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ folderPath }),
		},
	);
	return readJsonOrThrow<SystemIconsResponse>(response);
};

export const replaceSystemIconFolders = async ({
	systemId,
	folderPaths,
}: {
	systemId: string;
	folderPaths: string[];
}) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/icons/folders`,
		{
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ folderPaths }),
		},
	);
	return readJsonOrThrow<SystemIconsResponse>(response);
};

export const removeSystemIconFolder = async ({
	systemId,
	folderPath,
}: {
	systemId: string;
	folderPath: string;
}) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/icons/folders`,
		{
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ folderPath }),
		},
	);
	return readJsonOrThrow<SystemIconsResponse>(response);
};

export const systemIconsQueryKey = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) => withProjectQueryScope(["trickroom-system-icons", systemId], projectScope);

export const systemIconSvgQueriesQueryKey = (systemId: string) => [
	"trickroom-system-icon-svg",
	systemId,
];

export const systemIconSvgQueryKey = (
	systemId: string,
	iconId: string,
	projectScope?: ProjectQueryScope,
) =>
	withProjectQueryScope(
		[...systemIconSvgQueriesQueryKey(systemId), iconId],
		projectScope,
	);

export const systemIconsQueryOptions = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: systemIconsQueryKey(systemId, projectScope),
		queryFn: () => fetchSystemIcons(systemId),
		retry: false,
	});

export const syncSystemIconsMutation = syncSystemIcons;

export const systemIconSvgQueryOptions = (
	systemId: string,
	iconId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: systemIconSvgQueryKey(systemId, iconId, projectScope),
		queryFn: () => fetchSystemIconSvg(systemId, iconId),
		retry: false,
		staleTime: Infinity,
	});
