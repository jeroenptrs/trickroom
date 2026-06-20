import { queryOptions } from "@tanstack/react-query";
import type { ProjectRoot } from "../types";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";

const fetchProjectRoot = async () => {
	const response = await fetch("/api/trickroom/project-root");
	return readJsonOrThrow<ProjectRoot>(response);
};

export const projectRootQueryKey = ["trickroom-project-root"];

export const projectRootQueryOptions = () =>
	queryOptions({
		queryKey: projectRootQueryKey,
		queryFn: fetchProjectRoot,
	});
