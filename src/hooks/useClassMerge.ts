import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProjectScope } from "../components/contexts";
import {
	type ClassMergeState,
	NOT_MERGED,
} from "../components/stage/class-merge-context";
import { tailwindClassMergeQueryOptions } from "../queries/tailwind-class-merge";
import { createClassMerge, toComponentClassSource } from "../utils/class-merge";

/**
 * The merge for component classes in a design linked to `systemId`, so the
 * canvas resolves them like the project's code. Without a system nothing is
 * fetched and nothing merges; a failed or timed-out request settles without
 * merging.
 */
export function useClassMerge(
	systemId: string | null | undefined,
): ClassMergeState {
	const trimmed = typeof systemId === "string" ? systemId.trim() : "";
	const enabled = trimmed.length > 0;
	const projectScope = useProjectScope();
	const query = useQuery({
		...tailwindClassMergeQueryOptions(trimmed, projectScope),
		enabled,
	});
	const settled = query.isSuccess || query.isError;

	return useMemo(() => {
		if (!enabled) return NOT_MERGED;
		return {
			merge: createClassMerge(query.data),
			source: toComponentClassSource(query.data),
			ready: settled,
		};
	}, [enabled, query.data, settled]);
}
