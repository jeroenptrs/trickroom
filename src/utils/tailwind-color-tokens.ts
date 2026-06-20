import { defaultTailwindColorTokens } from "./default-tailwind-tokens";
import type { TailwindDesignSystem } from "./tailwind-design-system";

export type TailwindColorTokenMap = Record<string, string>;

export type TailwindTokenDomain = "color";

export type TailwindTokenEntry = {
	name: string;
	value: string;
	domain: TailwindTokenDomain;
};

export type TailwindDefaultTokenEntry = {
	name: string;
	defaultValue: string;
	domain: TailwindTokenDomain;
};

export type TailwindOverriddenTokenEntry = TailwindTokenEntry & {
	defaultValue: string;
};

export type TailwindColorTokenBaselineDiff = {
	added: TailwindTokenEntry[];
	overridden: TailwindOverriddenTokenEntry[];
	unchanged: TailwindOverriddenTokenEntry[];
	removed: TailwindDefaultTokenEntry[];
	missingDefaultTokenNames: string[];
};

export type TailwindTokensForPresentation = TailwindTokenEntry[];

const tailwindColorTokenDomain: TailwindTokenDomain = "color";

export function extractTailwindColorTokens(
	designSystem: TailwindDesignSystem,
): TailwindColorTokenMap {
	return createSortedTailwindColorTokenMap(
		designSystem.theme.namespace("--color").entries(),
	);
}

export function diffTailwindColorTokensAgainstDefaults(
	colorTokens: TailwindColorTokenMap,
): TailwindColorTokenBaselineDiff {
	const sortedColorTokens = createSortedTailwindColorTokenMap(
		Object.entries(colorTokens),
	);
	const defaultEntries = Object.entries(defaultTailwindColorTokens).sort(
		([leftName], [rightName]) => leftName.localeCompare(rightName),
	);

	const added: TailwindTokenEntry[] = [];
	const overridden: TailwindOverriddenTokenEntry[] = [];
	const unchanged: TailwindOverriddenTokenEntry[] = [];
	const removed: TailwindDefaultTokenEntry[] = [];

	for (const [name, value] of Object.entries(sortedColorTokens)) {
		const defaultValue = defaultTailwindColorTokens[name];
		if (defaultValue === undefined) {
			added.push({ name, value, domain: tailwindColorTokenDomain });
			continue;
		}

		if (
			normalizeTailwindColorTokenValue(value) ===
			normalizeTailwindColorTokenValue(defaultValue)
		) {
			unchanged.push({
				name,
				value,
				defaultValue,
				domain: tailwindColorTokenDomain,
			});
			continue;
		}

		overridden.push({
			name,
			value,
			defaultValue,
			domain: tailwindColorTokenDomain,
		});
	}

	for (const [name, defaultValue] of defaultEntries) {
		if (name in sortedColorTokens) {
			continue;
		}

		removed.push({
			name,
			defaultValue,
			domain: tailwindColorTokenDomain,
		});
	}

	return {
		added,
		overridden,
		unchanged,
		removed,
		missingDefaultTokenNames: removed.map((token) => token.name),
	};
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
			multiTokenFamilies.get(family)!.add(name);
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

		if (removedFromFamily.length === familyTokens.size && familyTokens.size > 1) {
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

export function extractTailwindColorTokensForPresentation(
	baselineDiff: TailwindColorTokenBaselineDiff,
): TailwindTokensForPresentation {
	return [...baselineDiff.added, ...baselineDiff.overridden];
}

export function normalizeTailwindColorTokenValue(value: string) {
	return value
		.trim()
		.replace(/\s+/g, " ")
		.replace(/^#([0-9a-fA-F]+)$/u, (_, hexDigits: string) =>
			`#${hexDigits.toLowerCase()}`,
		);
}

function createSortedTailwindColorTokenMap(
	entries: Iterable<readonly [string, string]>,
): TailwindColorTokenMap {
	return Object.fromEntries(
		Array.from(entries, ([name, value]) => [name, value] as const).sort(
			([leftName], [rightName]) => leftName.localeCompare(rightName),
		),
	);
}
