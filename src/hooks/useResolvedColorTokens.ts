/**
 * Reactive accessor for the resolved color token set of a design
 * system. Combines the bundled Tailwind defaults with the synced
 * snapshot's added/overridden/removed entries.
 *
 * Pass the active system id (typically from `useDesignSystemId`).
 * When the id is null/empty, the hook falls back to the bundled
 * Tailwind defaults so the picker still works without a linked system.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProjectScope } from "../components/contexts";
import { storedTailwindTokensQueryOptions } from "../queries/tailwind-sync-tokens";
import {
	computeResolvedColorTokens,
	EMPTY_RESOLVED_COLOR_TOKENS,
	type ResolvedColorTokens,
} from "../utils/resolved-color-tokens";

export function useResolvedColorTokens(
	systemId: string | null | undefined,
): ResolvedColorTokens {
	const trimmed = typeof systemId === "string" ? systemId.trim() : "";
	const enabled = trimmed.length > 0;
	const projectScope = useProjectScope();

	const tokensQuery = useQuery({
		...storedTailwindTokensQueryOptions(trimmed, projectScope),
		enabled,
	});

	return useMemo(() => {
		if (!enabled) return EMPTY_RESOLVED_COLOR_TOKENS;
		const stored = tokensQuery.data;
		if (!stored) return EMPTY_RESOLVED_COLOR_TOKENS;
		const color = stored.domains.color;
		return computeResolvedColorTokens({
			meaningfulTokens: color.tokens,
			removed: color.baselineDiff.removed,
		});
	}, [enabled, tokensQuery.data]);
}
