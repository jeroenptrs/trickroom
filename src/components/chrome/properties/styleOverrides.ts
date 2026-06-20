/**
 * Shared vocabulary + data for property-local override rows (#403).
 *
 * Overrides are grouped as Selector (interaction/state), Breakpoint
 * (responsive), and Mode (dark). We deliberately avoid the word "Variant"
 * in user-facing copy to keep it distinct from component properties.
 */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useProjectScope } from "../../contexts";
import { storedTailwindTokensQueryOptions } from "../../../queries/tailwind-sync-tokens";

export type OverrideGroup = "selector" | "breakpoint" | "mode";

/** Interaction / state selectors offered as single-prefix override rows. */
export const SELECTOR_OVERRIDES = [
	"hover",
	"focus",
	"focus-visible",
	"active",
	"disabled",
] as const;

/** Mode buckets (kept separate so existing `dark:` classes are not dropped). */
export const MODE_OVERRIDES = ["dark"] as const;

/** Tailwind default responsive breakpoints, used when no synced tokens exist. */
export const DEFAULT_BREAKPOINTS = ["sm", "md", "lg", "xl", "2xl"] as const;

/**
 * Resolve the breakpoint override names for the active system: the Tailwind
 * defaults unioned with any breakpoint tokens added by the synced theme.
 * The meaningful-token policy means default systems persist no breakpoints,
 * so defaults are always included.
 */
export function useBreakpointNames(
	systemId: string | null | undefined,
): string[] {
	const trimmed = typeof systemId === "string" ? systemId.trim() : "";
	const enabled = trimmed.length > 0;
	const projectScope = useProjectScope();

	const tokensQuery = useQuery({
		...storedTailwindTokensQueryOptions(trimmed, projectScope),
		enabled,
	});

	return useMemo(() => {
		const names = new Set<string>(DEFAULT_BREAKPOINTS);
		const stored = tokensQuery.data;
		const tokens = stored?.domains.breakpoint?.tokens;
		if (tokens) {
			for (const name of Object.keys(tokens)) {
				names.add(name);
			}
		}
		return Array.from(names);
	}, [tokensQuery.data]);
}

export type OverrideOption = {
	value: string;
	group: OverrideGroup;
};

/**
 * Build the ordered, de-duplicated list of override options for the add menu,
 * excluding variant keys already present on the property.
 */
export function buildOverrideOptions(
	breakpoints: readonly string[],
	usedVariantKeys: ReadonlySet<string>,
): OverrideOption[] {
	const options: OverrideOption[] = [
		...SELECTOR_OVERRIDES.map((value) => ({ value, group: "selector" as const })),
		...breakpoints.map((value) => ({ value, group: "breakpoint" as const })),
		...MODE_OVERRIDES.map((value) => ({ value, group: "mode" as const })),
	];
	return options.filter((option) => !usedVariantKeys.has(option.value));
}

export const OVERRIDE_GROUP_LABELS: Record<OverrideGroup, string> = {
	selector: "Selector",
	breakpoint: "Breakpoint",
	mode: "Mode",
};
