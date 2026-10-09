import { queryOptions } from "@tanstack/react-query";
import type { ClassMergeSettings } from "../utils/class-merge";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export type TailwindClassMergeResponse = ClassMergeSettings & {
	systemId: string | null;
};

/**
 * How the canvas merges the component classes of a design linked to the
 * system. The server derives the config once per compiled design system;
 * file events invalidate this with the other system queries.
 */
export const tailwindClassMergeQueryOptions = (
	systemId: string | null,
	projectScope?: ProjectQueryScope,
) =>
	queryOptions({
		queryKey: withProjectQueryScope(
			["trickroom-tailwind-class-merge", systemId ?? ""],
			projectScope,
		),
		queryFn: async () => {
			const query = systemId ? `?systemId=${encodeURIComponent(systemId)}` : "";
			const response = await fetch(
				`/api/trickroom/tailwind/class-merge${query}`,
			);
			return readJsonOrThrow<TailwindClassMergeResponse>(response);
		},
		staleTime: 5 * 60_000,
	});
