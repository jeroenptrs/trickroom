import { queryOptions } from "@tanstack/react-query";
import type { TrickroomDesign, TrickroomDesignSummary } from "../types";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";

export const getDesignFileForUuid = (uuid: string) => `${uuid}.json`;

export const designSummariesQueryKey = ["trickroom-designs"];

const fetchDesignFile = async (file: string) => {
	const query = new URLSearchParams({ file });
	const response = await fetch(`/api/trickroom/design?${query.toString()}`);
	return readJsonOrThrow<TrickroomDesign>(response);
};

const fetchDesignSummaries = async () => {
	const response = await fetch("/api/trickroom/designs");
	return readJsonOrThrow<TrickroomDesignSummary[]>(response);
};

export const saveDesignFile = async (
	file: string,
	design: TrickroomDesign,
) => {
	const query = new URLSearchParams({ file });
	const response = await fetch(`/api/trickroom/design?${query.toString()}`, {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify(design),
	});

	return readJsonOrThrow<TrickroomDesign>(response);
};

export const designFileQueryOptions = (file: string) =>
	queryOptions({
		queryKey: ["trickroom-design", file],
		queryFn: () => fetchDesignFile(file),
	});

export const designSummariesQueryOptions = () =>
	queryOptions({
		queryKey: designSummariesQueryKey,
		queryFn: fetchDesignSummaries,
	});
