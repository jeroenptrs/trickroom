/**
 * Shared vocabulary + data for property-local override rows (#403).
 *
 * Overrides are grouped as Selector (interaction/state), Breakpoint
 * (responsive), and Mode (dark). We deliberately avoid the word "Variant"
 * in user-facing copy to keep it distinct from component properties.
 */

import { useMemo } from "react";
import { useResolvedBreakpoints } from "../../../hooks/useResolvedBreakpoints";
import { DEFAULT_RESOLVED_BREAKPOINTS } from "../../../utils/resolved-breakpoints";

export type OverrideGroup = "selector" | "breakpoint" | "mode";

/** Interaction / state selectors offered as single-prefix override rows. */
export const SELECTOR_OVERRIDES = [
	"hover",
	"focus",
	"focus-visible",
	"active",
	"disabled",
] as const;

/** Mode prefixes, offered as ordinary scopes/override chains (todo 572). */
export const MODE_OVERRIDES = ["dark"] as const;

/** Tailwind default responsive breakpoint names, used when no synced tokens exist. */
export const DEFAULT_BREAKPOINTS = DEFAULT_RESOLVED_BREAKPOINTS.map(
	({ name }) => name,
);

/**
 * Resolve the breakpoint override names for the active system: the Tailwind
 * defaults unioned with any breakpoint tokens added by the synced theme.
 * The meaningful-token policy means default systems persist no breakpoints,
 * so defaults are always included.
 */
export function useBreakpointNames(
	systemId: string | null | undefined,
): string[] {
	const breakpoints = useResolvedBreakpoints(systemId);

	return useMemo(() => breakpoints.map(({ name }) => name), [breakpoints]);
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
		...SELECTOR_OVERRIDES.map((value) => ({
			value,
			group: "selector" as const,
		})),
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
