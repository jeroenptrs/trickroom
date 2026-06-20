/**
 * Panel-level style scope (right-rail P3): one scope selector for the whole
 * Style tab. The scope is a variant chain key (`""` = Base, `"hover"`,
 * `"md"`, `"dark"`, `"md:hover"`, …); while a non-base scope is active every
 * override-aware row reads and writes that chain's slot — the same chains the
 * per-property override peek writes — so the scope bar is presentation over
 * the existing override engine, not a new data path.
 *
 * Mode prefixes (`dark`) are folded into the variant chains by
 * `buildPropertyModel` (todo 572), so `dark` is an ordinary scope here.
 */

import { createContext, useContext } from "react";
import { parseClassName } from "../../../utils/tailwind-classname";
import { MODE_OVERRIDES, SELECTOR_OVERRIDES } from "./styleOverrides";

export const BASE_SCOPE = "";

export type StyleScope = {
	/** Active variant chain key (`""` = Base). */
	scope: string;
	/** Chain split for slot mutations (`[]` = base). */
	variants: string[];
	setScope: (scope: string) => void;
};

const BASE_STYLE_SCOPE: StyleScope = {
	scope: BASE_SCOPE,
	variants: [],
	setScope: () => {},
};

export const StyleScopeContext = createContext<StyleScope>(BASE_STYLE_SCOPE);

/** Active panel scope; the base scope outside a provider (or with the bar disabled). */
export function useStyleScope(): StyleScope {
	return useContext(StyleScopeContext);
}

/** Split a scope key into the variant chain for slot mutations. */
export function scopeVariants(scope: string): string[] {
	return scope.length > 0 ? scope.split(":") : [];
}

/**
 * Distinct variant chains present anywhere in the className, ordered
 * canonically: selectors first, then breakpoints, then modes (`dark`), then
 * anything else (compound chains, aria-*, …) in first-appearance order. The
 * syntactic parse means chains on unknown/custom utilities count too —
 * selecting such a scope is harmless, rows simply write proper classes into
 * it. Modes are folded (`modes: []`) to match `buildPropertyModel`.
 */
export function collectScopeChains(
	className: string,
	breakpoints: readonly string[],
): string[] {
	const seen = new Set<string>();
	const chains: string[] = [];
	for (const parsed of parseClassName(className, { modes: [] })) {
		if (parsed.variants.length === 0) continue;
		const key = parsed.variants.join(":");
		if (seen.has(key)) continue;
		seen.add(key);
		chains.push(key);
	}

	const selectors: readonly string[] = SELECTOR_OVERRIDES;
	const modes: readonly string[] = MODE_OVERRIDES;
	const rank = (chain: string): number => {
		const selectorIndex = selectors.indexOf(chain);
		if (selectorIndex !== -1) return selectorIndex;
		const breakpointIndex = breakpoints.indexOf(chain);
		if (breakpointIndex !== -1) return selectors.length + breakpointIndex;
		const modeIndex = modes.indexOf(chain);
		if (modeIndex !== -1)
			return selectors.length + breakpoints.length + modeIndex;
		return selectors.length + breakpoints.length + modes.length;
	};

	return chains
		.map((chain, index) => ({ chain, index }))
		.sort((a, b) => rank(a.chain) - rank(b.chain) || a.index - b.index)
		.map(({ chain }) => chain);
}

const SCOPE_BAR_FLAG_KEY = "trickroom:style-scope-bar";

/** Kill switch while the scope bar settles: set localStorage to "off" to disable. */
export function isScopeBarEnabled(): boolean {
	if (typeof window === "undefined") return false;
	return window.localStorage.getItem(SCOPE_BAR_FLAG_KEY) !== "off";
}
