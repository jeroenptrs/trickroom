import { queryOptions } from "@tanstack/react-query";
import type { TrickroomConfig } from "../types";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

const fetchConfigFile = async () => {
	const response = await fetch("/api/trickroom/config");
	return readJsonOrThrow<TrickroomConfig>(response);
};

export const createConfigFile = async (config: TrickroomConfig) => {
	const response = await fetch("/api/trickroom/config", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(config),
	});

	return readJsonOrThrow<TrickroomConfig>(response);
};

export type ProjectMcpSettings =
	| { enabled: false }
	| { enabled: true; mode: "read-only" | "read-write" };

export const updateProjectMcpSettings = async (
	settings: ProjectMcpSettings,
) => {
	const response = await fetch("/api/trickroom/config/mcp", {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(settings),
	});

	return readJsonOrThrow<TrickroomConfig>(response);
};

export const updateProjectDefaultSystem = async (systemId: string | null) => {
	const response = await fetch("/api/trickroom/config/default-system", {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ systemId }),
	});

	return readJsonOrThrow<TrickroomConfig>(response);
};

export const configFileQueryKey = ["trickroom-config"];

export const configFileProjectQueryKey = (projectScope?: ProjectQueryScope) =>
	withProjectQueryScope(configFileQueryKey, projectScope);

export const configFileQueryOptions = (projectScope?: ProjectQueryScope) =>
	queryOptions({
		queryKey: configFileProjectQueryKey(projectScope),
		queryFn: fetchConfigFile,
		retry: false,
	});
