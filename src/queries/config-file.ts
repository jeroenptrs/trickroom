import { queryOptions } from "@tanstack/react-query";
import type { TrickroomConfig } from "../types";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";

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

export const configFileQueryKey = ["trickroom-config"];

export const configFileQueryOptions = () =>
	queryOptions({
		queryKey: configFileQueryKey,
		queryFn: fetchConfigFile,
		retry: false,
	});
