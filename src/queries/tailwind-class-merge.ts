import { queryOptions } from "@tanstack/react-query";
import type { ComponentClassMerge } from "../utils/class-merge";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";
import { type ProjectQueryScope, withProjectQueryScope } from "./project-scope";

export type TailwindClassMergeResponse = ComponentClassMerge & {
	systemId: string | null;
};

/**
 * Boards wait for the merge settings; a request that hangs longer than this
 * fails, and the boards render unmerged instead.
 */
export const CLASS_MERGE_FETCH_TIMEOUT_MS = 8_000;

/**
 * How the canvas merges the component classes of a design linked to the
 * system, with the class data of its component versions. The server derives
 * the config once per compiled design system; file events (system files,
 * `.trickroom/config.json`, the system's CSS) invalidate this.
 */
export const tailwindClassMergeQueryOptions = (
	systemId: string | null,
	projectScope?: ProjectQueryScope,
	timeoutMs = CLASS_MERGE_FETCH_TIMEOUT_MS,
) =>
	queryOptions({
		queryKey: withProjectQueryScope(
			["trickroom-tailwind-class-merge", systemId ?? ""],
			projectScope,
		),
		queryFn: async ({ signal }) => {
			const query = systemId ? `?systemId=${encodeURIComponent(systemId)}` : "";
			const response = await fetch(
				`/api/trickroom/tailwind/class-merge${query}`,
				{
					signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
				},
			);
			return readJsonOrThrow<TailwindClassMergeResponse>(response);
		},
		// A failure renders unmerged right away; file events refetch it.
		retry: false,
		staleTime: 5 * 60_000,
	});
