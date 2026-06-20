import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProjectScope } from "../components/contexts";
import { storedTailwindTokensQueryOptions } from "../queries/tailwind-sync-tokens";
import {
	computeResolvedFontTokens,
	EMPTY_RESOLVED_FONT_TOKENS,
	type ResolvedFontTokens,
} from "../utils/resolved-font-tokens";

export function useResolvedFontTokens(
	systemId: string | null | undefined,
): ResolvedFontTokens {
	const trimmed = typeof systemId === "string" ? systemId.trim() : "";
	const enabled = trimmed.length > 0;
	const projectScope = useProjectScope();

	const tokensQuery = useQuery({
		...storedTailwindTokensQueryOptions(trimmed, projectScope),
		enabled,
	});

	return useMemo(() => {
		if (!enabled) return EMPTY_RESOLVED_FONT_TOKENS;
		const stored = tokensQuery.data;
		if (!stored) return EMPTY_RESOLVED_FONT_TOKENS;
		const font = stored.domains.font;
		return computeResolvedFontTokens({
			meaningfulTokens: font.tokens,
			removed: font.baselineDiff.removed,
		});
	}, [enabled, tokensQuery.data]);
}
