import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
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
	const componentsError = query.data?.componentsError;
	useEffect(() => {
		// Classes merge, but instances cannot be resolved: they render their
		// stored className. (`mode: "none"` is intentional and not reported.)
		if (componentsError) {
			console.warn(
				`[Trickroom] Component instances render their stored classes: the component manifest could not be read: ${componentsError}`,
			);
		}
	}, [componentsError]);

	return useMemo(() => {
		if (!enabled) return NOT_MERGED;
		return {
			merge: createClassMerge(query.data),
			source: toComponentClassSource(query.data),
			ready: settled,
		};
	}, [enabled, query.data, settled]);
}
