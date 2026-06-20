import { defaultTailwindColorTokens } from "./default-tailwind-tokens";
import type { TailwindDesignSystem } from "./tailwind-design-system";
import {
	diffTailwindDomainTokensAgainstDefaults,
	extractTailwindTokens,
	type TailwindDefaultTokenEntry,
	type TailwindOverriddenTokenEntry,
	type TailwindTokenBaselineDiff,
	type TailwindTokenDomain,
	type TailwindTokenEntry,
	type TailwindTokenMap,
} from "./tailwind-token-domains";

export type TailwindColorTokenMap = TailwindTokenMap;
export type {
	TailwindDefaultTokenEntry,
	TailwindOverriddenTokenEntry,
	TailwindTokenDomain,
	TailwindTokenEntry,
};
export type TailwindColorTokenBaselineDiff = TailwindTokenBaselineDiff;
export type TailwindTokensForPresentation = TailwindTokenEntry[];

const tailwindColorTokenDomain: TailwindTokenDomain = "color";

export function extractTailwindColorTokens(
	designSystem: TailwindDesignSystem,
): TailwindColorTokenMap {
	return extractTailwindTokens(designSystem).color;
}

export function diffTailwindColorTokensAgainstDefaults(
	colorTokens: TailwindColorTokenMap,
): TailwindColorTokenBaselineDiff {
	return diffTailwindDomainTokensAgainstDefaults(
		tailwindColorTokenDomain,
		colorTokens,
		defaultTailwindColorTokens,
	);
}

const numericShadePattern = /^(.+)-(\d+)$/;

export function computeColorOverrides(
	removed: TailwindDefaultTokenEntry[],
	defaults: Record<string, string> = defaultTailwindColorTokens,
): string[] {
	if (removed.length === 0) return [];

	// Derive family groups from the passed defaults map, not hard-coded.
	const multiTokenFamilies = new Map<string, Set<string>>();
	const singleTokenFamilies = new Set<string>();

	for (const name of Object.keys(defaults)) {
		const match = numericShadePattern.exec(name);
		if (match) {
			const family = match[1];
			if (!multiTokenFamilies.has(family)) {
				multiTokenFamilies.set(family, new Set());
			}
			multiTokenFamilies.get(family)?.add(name);
		} else {
			singleTokenFamilies.add(name);
		}
	}

	// Only count removed entries that are present in the defaults baseline.
	const removedInDefaults = new Set(
		removed.filter((e) => e.name in defaults).map((e) => e.name),
	);

	// If every default token is removed, collapse to a single wildcard.
	const totalDefaults = Object.keys(defaults).length;
	if (totalDefaults > 0 && removedInDefaults.size === totalDefaults) {
		return ["--color-*"];
	}

	const overrides: string[] = [];

	for (const name of singleTokenFamilies) {
		if (removedInDefaults.has(name)) {
			overrides.push(`--color-${name}`);
		}
	}

	for (const [family, familyTokens] of multiTokenFamilies) {
		const removedFromFamily = [...familyTokens].filter((t) =>
			removedInDefaults.has(t),
		);
		if (removedFromFamily.length === 0) continue;

		if (
			removedFromFamily.length === familyTokens.size &&
			familyTokens.size > 1
		) {
			overrides.push(`--color-${family}-*`);
		} else {
			for (const t of removedFromFamily) {
				overrides.push(`--color-${t}`);
			}
		}
	}

	// Conservatively emit exact overrides for removed tokens absent from defaults.
	for (const entry of removed) {
		if (!(entry.name in defaults)) {
			overrides.push(`--color-${entry.name}`);
		}
	}

	return overrides.sort();
}

export function canUseGlobalColorReset(
	removed: TailwindDefaultTokenEntry[],
	defaults: Record<string, string> = defaultTailwindColorTokens,
): boolean {
	const defaultTokenNames = Object.keys(defaults);
	if (defaultTokenNames.length === 0) {
		return false;
	}

	const removedNames = new Set(removed.map((entry) => entry.name));
	return (
		removedNames.size === defaultTokenNames.length &&
		defaultTokenNames.every((name) => removedNames.has(name)) &&
		removed.every((entry) => entry.name in defaults)
	);
}

export function extractTailwindColorTokensForPresentation(
	baselineDiff: TailwindColorTokenBaselineDiff,
): TailwindTokensForPresentation {
	return [...baselineDiff.added, ...baselineDiff.overridden];
}
