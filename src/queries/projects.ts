import { queryOptions } from "@tanstack/react-query";
import type { TrickroomConfig } from "../types";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";

export type TrickroomProjectSummary = {
	projectId: string;
	locationId: string;
	projectRoot: string;
	name: string;
};

export type TrickroomSessionResponse = {
	activeProject: TrickroomProjectSummary | null;
	recentProjects: TrickroomProjectSummary[];
};

export type RenameProjectLocationResponse = TrickroomSessionResponse & {
	project: TrickroomProjectSummary;
	config: TrickroomConfig;
};

export const sessionQueryKey = ["trickroom-session"];

const fetchSession = async (): Promise<TrickroomSessionResponse> => {
	const response = await fetch("/api/trickroom/session");
	return readJsonOrThrow<TrickroomSessionResponse>(response);
};

export const sessionQueryOptions = () =>
	queryOptions({
		queryKey: sessionQueryKey,
		queryFn: fetchSession,
		retry: false,
	});

type OpenProjectPayload = {
	path: string;
	config?: TrickroomConfig;
};

export const openProject = async (payload: OpenProjectPayload) => {
	const response = await fetch("/api/trickroom/projects/open", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(payload),
	});

	return readJsonOrThrow<unknown>(response);
};

export const closeProject = async () => {
	const response = await fetch("/api/trickroom/projects/close", {
		method: "POST",
	});

	return readJsonOrThrow<unknown>(response);
};

export const deleteProjectLocation = async (locationId: string) => {
	const response = await fetch(
		`/api/trickroom/projects/${encodeURIComponent(locationId)}/delete`,
		{
			method: "POST",
		},
	);

	return readJsonOrThrow<unknown>(response);
};

export const renameProjectLocation = async ({
	locationId,
	name,
}: {
	locationId: string;
	name: string;
}) => {
	const response = await fetch(
		`/api/trickroom/projects/${encodeURIComponent(locationId)}/rename`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ name }),
		},
	);

	return readJsonOrThrow<RenameProjectLocationResponse>(response);
};
