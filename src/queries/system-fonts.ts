import { queryOptions } from "@tanstack/react-query";
import type { FontFace } from "../utils/font-manifest-service";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export type SystemFontSummary = {
	id: string;
	name: string;
	family: string;
	faces: FontFace[];
	createdAt: string;
	updatedAt: string;
};

export type SystemFontsResponse = {
	systemId: string;
	systemName: string;
	updatedAt: string;
	fonts: SystemFontSummary[];
};

export type CreateSystemFontParams = {
	fontId?: string;
	name: string;
	family: string;
	faces: FontFace[];
};

export type UpdateSystemFontParams = {
	name?: string;
	family?: string;
	faces?: FontFace[];
};

export type CreateSystemFontResponse = {
	systemId: string;
	systemName: string;
	font: SystemFontSummary;
};

export type UpdateSystemFontResponse = {
	systemId: string;
	systemName: string;
	font: SystemFontSummary;
};

export type DeleteSystemFontResponse = {
	ok: true;
	systemId: string;
	systemName: string;
	fontId: string;
};

export type ImportManagedFontFileParams = {
	absoluteSourcePath: string;
	targetRelativePath: string;
	format?: string;
};

export type ImportManagedFontFileResponse = {
	systemId: string;
	systemName: string;
	managedPath: string;
	format: string;
};

const fetchSystemFonts = async (systemId: string) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/fonts`,
	);
	return readJsonOrThrow<SystemFontsResponse>(response);
};

export const createSystemFont = async (
	systemId: string,
	params: CreateSystemFontParams,
) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/fonts`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<CreateSystemFontResponse>(response);
};

export const updateSystemFont = async (
	systemId: string,
	fontId: string,
	params: UpdateSystemFontParams,
) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/fonts/${encodeURIComponent(fontId)}`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<UpdateSystemFontResponse>(response);
};

export const deleteSystemFont = async (systemId: string, fontId: string) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/fonts/${encodeURIComponent(fontId)}`,
		{ method: "DELETE" },
	);
	return readJsonOrThrow<DeleteSystemFontResponse>(response);
};

export const importManagedFontFile = async (
	systemId: string,
	params: ImportManagedFontFileParams,
) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/fonts/import`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(params),
		},
	);
	return readJsonOrThrow<ImportManagedFontFileResponse>(response);
};

export const systemFontsQueryKey = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) => withProjectQueryScope(["trickroom-system-fonts", systemId], projectScope);

export const systemFontsQueryOptions = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: systemFontsQueryKey(systemId, projectScope),
		queryFn: () => fetchSystemFonts(systemId),
		retry: false,
	});
