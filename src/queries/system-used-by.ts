import { queryOptions } from "@tanstack/react-query";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export type SystemUsedByResponse = {
	systemId: string;
	systemName: string;
	usedByCount: number;
};

const fetchSystemUsedBy = async (systemId: string) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}/used-by`,
	);
	return readJsonOrThrow<SystemUsedByResponse>(response);
};

export const systemUsedByQueryKey = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) =>
	withProjectQueryScope(["trickroom-system-used-by", systemId], projectScope);

export const systemUsedByQueryOptions = (
	systemId: string,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: systemUsedByQueryKey(systemId, projectScope),
		queryFn: () => fetchSystemUsedBy(systemId),
		retry: false,
	});
