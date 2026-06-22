import type { TrickroomConfig } from "../types";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export type SystemSummary = {
	systemId: string;
	systemName: string;
	isDefault?: boolean;
	cssPath?: string;
	iconFolderPaths?: string[];
};

export type ListSystemsResponse = {
	systems: SystemSummary[];
};

export type UpdateSystemResponse = {
	systemId: string;
	systemName: string;
	cssPath?: string;
	config: TrickroomConfig;
};

export type CreateSystemResponse = UpdateSystemResponse;

export type DeleteSystemResponse = {
	ok: true;
	systemId: string;
	systemName: string;
	config: TrickroomConfig;
};

const fetchSystems = async () => {
	const response = await fetch("/api/trickroom/systems");
	return readJsonOrThrow<ListSystemsResponse>(response);
};

export const systemsQueryKey = ["trickroom-systems"];

export const systemsProjectQueryKey = (projectScope?: ProjectQueryScope) =>
	withProjectQueryScope(systemsQueryKey, projectScope);

export const systemsQueryOptions = (projectScope?: ProjectQueryScope) => ({
	queryKey: systemsProjectQueryKey(projectScope),
	queryFn: fetchSystems,
	retry: false,
});

export const updateSystem = async ({
	systemId,
	nextSystemName,
	cssPath,
}: {
	systemId: string;
	nextSystemName?: string;
	cssPath?: string;
}) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}`,
		{
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				...(nextSystemName ? { systemName: nextSystemName } : {}),
				...(cssPath ? { cssPath } : {}),
			}),
		},
	);

	return readJsonOrThrow<UpdateSystemResponse>(response);
};

export const createSystem = async ({
	systemName,
	cssPath,
	setAsDefault,
}: {
	systemName: string;
	cssPath: string;
	setAsDefault?: boolean;
}) => {
	const response = await fetch("/api/trickroom/systems", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			systemName,
			cssPath,
			...(setAsDefault ? { setAsDefault: true } : {}),
		}),
	});

	return readJsonOrThrow<CreateSystemResponse>(response);
};

export const deleteSystem = async (systemId: string) => {
	const response = await fetch(
		`/api/trickroom/systems/${encodeURIComponent(systemId)}`,
		{ method: "DELETE" },
	);

	return readJsonOrThrow<DeleteSystemResponse>(response);
};
