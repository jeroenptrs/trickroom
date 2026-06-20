import type { TailwindDesignSystem } from "./tailwind-design-system";

export const TAILWIND_DEFAULT_TOKEN_NAME = "DEFAULT";

export const TAILWIND_TOKEN_DOMAIN_NAMESPACES = {
	color: "--color",
	spacing: "--spacing",
	breakpoint: "--breakpoint",
	container: "--container",
	radius: "--radius",
	font: "--font",
	text: "--text",
	"font-weight": "--font-weight",
	"text-shadow": "--text-shadow",
	leading: "--leading",
	tracking: "--tracking",
	shadow: "--shadow",
	"inset-shadow": "--inset-shadow",
	"drop-shadow": "--drop-shadow",
	blur: "--blur",
	aspect: "--aspect",
	ease: "--ease",
	animate: "--animate",
	perspective: "--perspective",
} as const;

export type TailwindTokenDomain = keyof typeof TAILWIND_TOKEN_DOMAIN_NAMESPACES;

export const TAILWIND_TOKEN_DOMAINS = Object.keys(
	TAILWIND_TOKEN_DOMAIN_NAMESPACES,
) as TailwindTokenDomain[];

export type TailwindTokenMap = Record<string, string>;

export type TailwindTokenDomains = Record<
	TailwindTokenDomain,
	TailwindTokenMap
>;

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

export type TailwindTokenBaselineDiff = {
	added: TailwindTokenEntry[];
	overridden: TailwindOverriddenTokenEntry[];
	unchanged: TailwindOverriddenTokenEntry[];
	removed: TailwindDefaultTokenEntry[];
	missingDefaultTokenNames: string[];
};

export type TailwindMeaningfulTokenBaselineDiff = {
	added: TailwindTokenEntry[];
	overridden: TailwindOverriddenTokenEntry[];
	removed: TailwindDefaultTokenEntry[];
};

export type TailwindTokenDomainDiffs = Record<
	TailwindTokenDomain,
	TailwindTokenBaselineDiff
>;

export type TailwindMeaningfulTokenDomainDiffs = Record<
	TailwindTokenDomain,
	TailwindMeaningfulTokenBaselineDiff
>;

export function emptyTailwindTokenDomains(): TailwindTokenDomains {
	return Object.fromEntries(
		TAILWIND_TOKEN_DOMAINS.map((domain) => [domain, {}]),
	) as TailwindTokenDomains;
}

export function extractTailwindTokens(
	designSystem: TailwindDesignSystem,
): TailwindTokenDomains {
	const domains = emptyTailwindTokenDomains();

	for (const [propertyName, token] of designSystem.theme.values) {
		const match = resolveTailwindTokenDomainProperty(propertyName);
		if (!match) {
			continue;
		}

		const tokenName =
			propertyName === match.namespace
				? TAILWIND_DEFAULT_TOKEN_NAME
				: propertyName.slice(match.namespace.length + 1);
		domains[match.domain][tokenName] = token.value;
	}

	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		domains[domain] = createSortedTailwindTokenMap(
			Object.entries(domains[domain]),
		);
	}

	return domains;
}

function resolveTailwindTokenDomainProperty(propertyName: string): {
	domain: TailwindTokenDomain;
	namespace: string;
} | null {
	let bestMatch: {
		domain: TailwindTokenDomain;
		namespace: string;
	} | null = null;

	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		const namespace = TAILWIND_TOKEN_DOMAIN_NAMESPACES[domain];
		if (
			propertyName !== namespace &&
			!propertyName.startsWith(`${namespace}-`)
		) {
			continue;
		}

		if (!bestMatch || namespace.length > bestMatch.namespace.length) {
			bestMatch = { domain, namespace };
		}
	}

	return bestMatch;
}

export function diffTailwindTokensAgainstDefaults(
	tokensByDomain: TailwindTokenDomains,
	defaultsByDomain: TailwindTokenDomains,
): TailwindTokenDomainDiffs {
	const diffs = {} as TailwindTokenDomainDiffs;
	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		diffs[domain] = diffTailwindDomainTokensAgainstDefaults(
			domain,
			tokensByDomain[domain] ?? {},
			defaultsByDomain[domain] ?? {},
		);
	}
	return diffs;
}

export function diffTailwindDomainTokensAgainstDefaults(
	domain: TailwindTokenDomain,
	tokens: TailwindTokenMap,
	defaults: TailwindTokenMap,
): TailwindTokenBaselineDiff {
	const sortedTokens = createSortedTailwindTokenMap(Object.entries(tokens));
	const defaultEntries = Object.entries(defaults).sort(([left], [right]) =>
		left.localeCompare(right),
	);

	const added: TailwindTokenEntry[] = [];
	const overridden: TailwindOverriddenTokenEntry[] = [];
	const unchanged: TailwindOverriddenTokenEntry[] = [];
	const removed: TailwindDefaultTokenEntry[] = [];

	for (const [name, value] of Object.entries(sortedTokens)) {
		const defaultValue = defaults[name];
		if (defaultValue === undefined) {
			added.push({ name, value, domain });
			continue;
		}
		if (
			normalizeTailwindTokenValue(value) ===
			normalizeTailwindTokenValue(defaultValue)
		) {
			unchanged.push({ name, value, defaultValue, domain });
			continue;
		}
		overridden.push({ name, value, defaultValue, domain });
	}

	for (const [name, defaultValue] of defaultEntries) {
		if (name in sortedTokens) {
			continue;
		}
		removed.push({ name, defaultValue, domain });
	}

	return {
		added,
		overridden,
		unchanged,
		removed,
		missingDefaultTokenNames: removed.map((token) => token.name),
	};
}

export function extractTailwindTokensForPresentation(
	baselineDiffs: TailwindTokenDomainDiffs,
): TailwindTokenEntry[] {
	return TAILWIND_TOKEN_DOMAINS.flatMap((domain) => [
		...baselineDiffs[domain].added,
		...baselineDiffs[domain].overridden,
	]);
}

export function computeTokenDomainOverrides(
	removed: readonly TailwindDefaultTokenEntry[],
): string[] {
	return Array.from(
		new Set(
			removed.map((token) =>
				tokenDomainToCssPropertyName(token.domain, token.name),
			),
		),
	).sort((left, right) => left.localeCompare(right));
}

export function normalizeTailwindTokenValue(value: string) {
	return value
		.trim()
		.replace(/\s+/g, " ")
		.replace(
			/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/u,
			(_, hexDigits: string) => `#${hexDigits.toLowerCase()}`,
		);
}

export function tokenDomainToCssPropertyName(
	domain: TailwindTokenDomain,
	name: string,
): string {
	const namespace = TAILWIND_TOKEN_DOMAIN_NAMESPACES[domain];
	return name === TAILWIND_DEFAULT_TOKEN_NAME
		? namespace
		: `${namespace}-${name}`;
}

export function isValidTokenDomain(
	value: string,
): value is TailwindTokenDomain {
	return (TAILWIND_TOKEN_DOMAINS as string[]).includes(value);
}

export function createSortedTailwindTokenMap(
	entries: Iterable<readonly [string | null, string]>,
): TailwindTokenMap {
	return Object.fromEntries(
		Array.from(
			entries,
			([name, value]) => [name ?? TAILWIND_DEFAULT_TOKEN_NAME, value] as const,
		).sort(([leftName], [rightName]) => leftName.localeCompare(rightName)),
	);
}
