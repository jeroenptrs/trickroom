import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProjectScope } from "../components/contexts";
import { storedTailwindTokensQueryOptions } from "../queries/tailwind-sync-tokens";
import {
	DEFAULT_RESOLVED_BREAKPOINTS,
	resolveBreakpoints,
	type ResolvedBreakpoint,
} from "../utils/resolved-breakpoints";

export function useResolvedBreakpoints(
	systemId: string | null | undefined,
): ResolvedBreakpoint[] {
	const trimmed = typeof systemId === "string" ? systemId.trim() : "";
	const enabled = trimmed.length > 0;
	const projectScope = useProjectScope();

	const tokensQuery = useQuery({
		...storedTailwindTokensQueryOptions(trimmed, projectScope),
		enabled,
	});

	return useMemo(() => {
		const storedBreakpoints = tokensQuery.data?.domains.breakpoint?.tokens;
		if (!enabled || !storedBreakpoints) return DEFAULT_RESOLVED_BREAKPOINTS;
		return resolveBreakpoints(storedBreakpoints);
	}, [enabled, tokensQuery.data]);
}
