/**
 * Reactive accessor for a design system's custom `@utility` roots — the
 * `text-interaction-*`-style functional utilities backed by custom CSS variable
 * namespaces, and the value-less static utilities (`core-interaction-primary`,
 * `bg-penn-app`, …) that real systems define in bulk.
 *
 * Returns the custom-utility slice of `ModelOptions`, split by kind:
 * - `customFunctionalUtilityRoots`: matched by exact name OR `root-` prefix.
 * - `customStaticUtilityRoots`: matched by EXACT name only.
 * Both are sorted by length descending so the classifier prefers the longest
 * match. Spread the result into a property model's options:
 *
 *   const customUtilityRoots = useResolvedCustomUtilities(systemId);
 *   const options = useMemo(
 *     () => ({ colorTokens, ...customUtilityRoots }),
 *     [colorTokens, customUtilityRoots],
 *   );
 *
 * When the id is null/empty or the system has no stored custom utilities, the
 * hook returns a stable empty slice.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProjectScope } from "../components/contexts";
import { storedTailwindTokensQueryOptions } from "../queries/tailwind-sync-tokens";

export type ResolvedCustomUtilities = {
	customFunctionalUtilityRoots: readonly string[];
	customStaticUtilityRoots: readonly string[];
};

const EMPTY: ResolvedCustomUtilities = Object.freeze({
	customFunctionalUtilityRoots: Object.freeze([]),
	customStaticUtilityRoots: Object.freeze([]),
});

function byLengthDescending(roots: string[]): string[] {
	return roots.sort((a, b) => b.length - a.length || a.localeCompare(b));
}

export function useResolvedCustomUtilities(
	systemId: string | null | undefined,
): ResolvedCustomUtilities {
	const trimmed = typeof systemId === "string" ? systemId.trim() : "";
	const enabled = trimmed.length > 0;
	const projectScope = useProjectScope();

	const tokensQuery = useQuery({
		...storedTailwindTokensQueryOptions(trimmed, projectScope),
		enabled,
	});

	return useMemo(() => {
		if (!enabled) return EMPTY;
		const utilities = tokensQuery.data?.customUtilities;
		if (!utilities || utilities.length === 0) return EMPTY;

		const functional: string[] = [];
		const staticRoots: string[] = [];
		for (const utility of utilities) {
			// Legacy snapshots without `kind` are treated as functional.
			(utility.kind === "static" ? staticRoots : functional).push(utility.root);
		}

		return {
			customFunctionalUtilityRoots: byLengthDescending(functional),
			customStaticUtilityRoots: byLengthDescending(staticRoots),
		};
	}, [enabled, tokensQuery.data]);
}

const EMPTY_DOMAIN_INDEX: ReadonlyMap<string, readonly string[]> = new Map();

/**
 * Maps each custom `@utility` root to the UI domain(s) it folds into, derived
 * from the synced snapshot. Used to surface a layer's custom utilities inside
 * the relevant property panel (e.g. `bg-penn-app` → background).
 */
export function useCustomUtilityDomains(
	systemId: string | null | undefined,
): ReadonlyMap<string, readonly string[]> {
	const trimmed = typeof systemId === "string" ? systemId.trim() : "";
	const enabled = trimmed.length > 0;
	const projectScope = useProjectScope();

	const tokensQuery = useQuery({
		...storedTailwindTokensQueryOptions(trimmed, projectScope),
		enabled,
	});

	return useMemo(() => {
		if (!enabled) return EMPTY_DOMAIN_INDEX;
		const utilities = tokensQuery.data?.customUtilities;
		if (!utilities || utilities.length === 0) return EMPTY_DOMAIN_INDEX;

		const index = new Map<string, readonly string[]>();
		for (const utility of utilities) {
			index.set(utility.root, utility.domains ?? []);
		}
		return index;
	}, [enabled, tokensQuery.data]);
}
