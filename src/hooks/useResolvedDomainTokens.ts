/**
 * Reactive accessor for the resolved token set of any synced Tailwind
 * domain: (defaults − removed) + added/overridden. The generic sibling of
 * `useResolvedColorTokens`/`useResolvedBreakpoints` for domains that don't
 * need bespoke post-processing (spacing, container, aspect, …).
 *
 * Pass the active system id (typically from `useDesignSystemId`). When the
 * id is null/empty or the snapshot hasn't loaded, the hook falls back to
 * the bundled Tailwind defaults so dependent controls still work.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProjectScope } from "../components/contexts";
import { storedTailwindTokensQueryOptions } from "../queries/tailwind-sync-tokens";
import {
	computeResolvedDomainTokens,
	type ResolvedDomainTokens,
} from "../utils/resolved-tailwind-domain-tokens";
import type { TailwindTokenDomain } from "../utils/tailwind-token-domains";

export function useResolvedDomainTokens(
	systemId: string | null | undefined,
	domain: TailwindTokenDomain,
): ResolvedDomainTokens {
	const trimmed = typeof systemId === "string" ? systemId.trim() : "";
	const enabled = trimmed.length > 0;
	const projectScope = useProjectScope();

	const tokensQuery = useQuery({
		...storedTailwindTokensQueryOptions(trimmed, projectScope),
		enabled,
	});

	return useMemo(() => {
		const domainStorage = enabled
			? tokensQuery.data?.domains[domain]
			: undefined;
		return computeResolvedDomainTokens({
			domain,
			meaningfulTokens: domainStorage?.tokens,
			removed: domainStorage?.baselineDiff.removed,
		});
	}, [enabled, tokensQuery.data, domain]);
}
