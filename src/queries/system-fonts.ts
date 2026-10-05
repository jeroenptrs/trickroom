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

const fetchSystemFonts = async (systemId: string) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/fonts`,
	);
	return readJsonOrThrow<SystemFontsResponse>(response);
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
