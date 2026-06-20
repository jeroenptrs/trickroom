import {
	type CustomUtilityDomain,
	inferCustomUtilityDomains,
} from "./tailwind-css-property-domains.ts";
import type { TailwindDesignSystem } from "./tailwind-design-system";
import type {
	CustomFunctionalUtility,
	TailwindIntrospection,
} from "./tailwind-introspection";

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

export type TailwindTokenResetOverrides = Record<TailwindTokenDomain, string[]>;

export function emptyTailwindTokenDomains(): TailwindTokenDomains {
	return Object.fromEntries(
		TAILWIND_TOKEN_DOMAINS.map((domain) => [domain, {}]),
	) as TailwindTokenDomains;
}

export function extractTailwindTokens(
	designSystem: TailwindDesignSystem,
): TailwindTokenDomains {
	const domains = emptyTailwindTokenDomains();

	for (const [propertyName, token] of designSystem.theme.entries()) {
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
	resetOverridesByDomain: Partial<TailwindTokenResetOverrides> = {},
): TailwindTokenDomainDiffs {
	const diffs = {} as TailwindTokenDomainDiffs;
	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		diffs[domain] = diffTailwindDomainTokensAgainstDefaults(
			domain,
			tokensByDomain[domain] ?? {},
			defaultsByDomain[domain] ?? {},
			resetOverridesByDomain[domain] ?? [],
		);
	}
	return diffs;
}

export function diffTailwindDomainTokensAgainstDefaults(
	domain: TailwindTokenDomain,
	tokens: TailwindTokenMap,
	defaults: TailwindTokenMap,
	resetOverrides: readonly string[] = [],
): TailwindTokenBaselineDiff {
	const sortedTokens = createSortedTailwindTokenMap(Object.entries(tokens));
	const defaultEntries = Object.entries(defaults).sort(([left], [right]) =>
		left.localeCompare(right),
	);

	const added: TailwindTokenEntry[] = [];
	const overridden: TailwindOverriddenTokenEntry[] = [];
	const unchanged: TailwindOverriddenTokenEntry[] = [];
	const removed: TailwindDefaultTokenEntry[] = [];
	const resetOverrideSet = new Set(resetOverrides);

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
		if (resetOverridesMatchToken(resetOverrideSet, domain, name)) {
			removed.push({ name, defaultValue, domain });
		}
	}

	return {
		added,
		overridden,
		unchanged,
		removed,
		missingDefaultTokenNames: removed.map((token) => token.name),
	};
}

function resetOverridesMatchToken(
	resetOverrideSet: ReadonlySet<string>,
	domain: TailwindTokenDomain,
	name: string,
) {
	const propertyName = tokenDomainToCssPropertyName(domain, name);
	if (resetOverrideSet.has(propertyName)) {
		return true;
	}

	for (const resetOverride of resetOverrideSet) {
		if (!resetOverride.endsWith("-*")) {
			continue;
		}
		const prefix = resetOverride.slice(0, -1);
		if (propertyName.startsWith(prefix)) {
			return true;
		}
	}

	return false;
}

export function extractTailwindTokenResetOverrides(
	designSystem: TailwindDesignSystem,
): TailwindTokenResetOverrides {
	const overrides = Object.fromEntries(
		TAILWIND_TOKEN_DOMAINS.map((domain) => [domain, new Set<string>()]),
	) as Record<TailwindTokenDomain, Set<string>>;
	const seenSources = new Set<string>();

	for (const [, token] of designSystem.theme.entries()) {
		const source = token.src?.[0];
		if (!source || typeof source.code !== "string") {
			continue;
		}
		const sourceKey = `${source.file ?? ""}\0${source.code}`;
		if (seenSources.has(sourceKey)) {
			continue;
		}
		seenSources.add(sourceKey);

		for (const resetProperty of extractInitialThemeProperties(source.code)) {
			const match = resolveTailwindTokenDomainProperty(resetProperty);
			if (!match) {
				continue;
			}
			overrides[match.domain].add(resetProperty);
		}
	}

	return Object.fromEntries(
		TAILWIND_TOKEN_DOMAINS.map((domain) => [
			domain,
			[...overrides[domain]].sort((left, right) => left.localeCompare(right)),
		]),
	) as TailwindTokenResetOverrides;
}

function extractInitialThemeProperties(css: string): string[] {
	const resetProperties: string[] = [];
	const declarationPattern =
		/(^|[;{\s])(--[a-z0-9\-*]+)\s*:\s*initial\s*(?:!important\s*)?[;}]/gi;

	for (const match of css.matchAll(declarationPattern)) {
		const property = match[2];
		if (property) {
			resetProperties.push(property);
		}
	}

	return resetProperties;
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

// ---------------------------------------------------------------------------
// Custom namespace and functional utility extraction (Step 2 wedge)
// ---------------------------------------------------------------------------

export type CustomTailwindNamespace = {
	/** CSS variable namespace prefix (e.g. "--db-interaction"). */
	namespace: string;
	tokens: TailwindTokenMap;
};

/**
 * Discover token maps for all CSS variable namespaces consumed by custom
 * @utility definitions. Returns only namespaces that have at least one token.
 *
 * This resolves the --db-interaction-* / text-interaction-* case that
 * TAILWIND_TOKEN_DOMAIN_NAMESPACES (the fixed whitelist) does not cover.
 */
export function extractCustomTailwindNamespaces(
	introspection: TailwindIntrospection,
): CustomTailwindNamespace[] {
	const seen = new Set<string>();
	const result: CustomTailwindNamespace[] = [];

	for (const utility of introspection.getCustomFunctionalUtilities()) {
		for (const ns of utility.consumedNamespaces) {
			if (seen.has(ns)) continue;
			seen.add(ns);

			const nsMap = introspection.resolveNamespace(ns);
			if (nsMap.size === 0) continue;

			const tokens: TailwindTokenMap = {};
			for (const [key, value] of nsMap) {
				tokens[key ?? TAILWIND_DEFAULT_TOKEN_NAME] = value;
			}

			result.push({
				namespace: ns,
				tokens: createSortedTailwindTokenMap(Object.entries(tokens)),
			});
		}
	}

	return result.sort((a, b) => a.namespace.localeCompare(b.namespace));
}

/**
 * Flatten all custom namespace tokens into a single map keyed by full CSS
 * custom-property name (e.g. `--db-interaction-sm`). This is the persisted
 * `customProperties` shape — these are just CSS variables, stored verbatim.
 */
export function extractCustomTailwindProperties(
	introspection: TailwindIntrospection,
): Record<string, string> {
	const properties: Record<string, string> = {};
	for (const { namespace, tokens } of extractCustomTailwindNamespaces(
		introspection,
	)) {
		for (const [name, value] of Object.entries(tokens)) {
			const fullName =
				name === TAILWIND_DEFAULT_TOKEN_NAME
					? namespace
					: `${namespace}-${name}`;
			properties[fullName] = value;
		}
	}
	return properties;
}

export type CustomTailwindUtilityKind = "functional" | "static";

export type CustomTailwindUtility = CustomFunctionalUtility & {
	/**
	 * `functional` = wildcard `@utility foo-*` consuming a namespace and taking a
	 * value suffix (e.g. `text-interaction-sm`). `static` = value-less `@utility`
	 * matched exactly (e.g. `core-interaction-primary`, `bg-penn-app`).
	 */
	kind: CustomTailwindUtilityKind;
	/** Completion values from the DS (e.g. ["sm", "lg"]); empty for static utilities. */
	completionValues: string[];
	/**
	 * UI domain(s) this utility folds into, inferred from the CSS properties it
	 * emits (e.g. `text-interaction-*` → ["typography"], `bg-penn-app` →
	 * ["color"]). Multi-property semantic utilities tag every domain they touch.
	 */
	domains: CustomUtilityDomain[];
};

/**
 * Build a candidate string the DS can actually compile so we can read the
 * utility's CSS: functional roots need a value suffix (use a real completion),
 * static roots are compiled by their exact name.
 */
function probeCandidateForUtility(utility: {
	root: string;
	kind: CustomTailwindUtilityKind;
	completionValues: string[];
}): string {
	if (utility.kind === "functional" && utility.completionValues.length > 0) {
		return `${utility.root}-${utility.completionValues[0]}`;
	}
	return utility.root;
}

/**
 * Enumerate custom @utility definitions that the loaded DS recognises — both
 * functional (wildcard, value-taking) and static (value-less) — together with
 * their kind, completion values, and consumed namespaces.
 *
 * Real design systems are mostly *static* custom utilities (e.g. an entire
 * colour system of `bg-penn-app`/`text-sun-dim`), so both kinds must be
 * surfaced or those classes register as "unknown" in the inspector.
 *
 * Callers sort roots by length descending and pass them to
 * ClassifyContext.customFunctionalUtilityRoots for classification.
 */
export function extractTailwindCustomUtilities(
	introspection: TailwindIntrospection,
): CustomTailwindUtility[] {
	const functionalRoots = new Set(introspection.getFunctionalUtilityRoots());
	const staticRoots = new Set(introspection.getStaticUtilityRoots());
	const result: CustomTailwindUtility[] = [];

	for (const utility of introspection.getCustomFunctionalUtilities()) {
		let entry: Omit<CustomTailwindUtility, "domains"> | null = null;
		if (functionalRoots.has(utility.root)) {
			const completionValues = introspection
				.getCompletions(utility.root)
				.flatMap((group) =>
					group.values.filter((value): value is string => value !== null),
				);
			entry = { ...utility, kind: "functional", completionValues };
		} else if (staticRoots.has(utility.root)) {
			entry = { ...utility, kind: "static", completionValues: [] };
		}
		// Roots the DS does not recognise at all (e.g. malformed @utility) are
		// intentionally dropped — we only persist utilities the engine resolves.
		if (!entry) continue;

		const domains = inferCustomUtilityDomains(
			introspection.getCandidateCss(probeCandidateForUtility(entry)),
		);
		result.push({ ...entry, domains });
	}

	return result;
}
