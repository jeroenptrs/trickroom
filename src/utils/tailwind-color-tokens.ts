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
