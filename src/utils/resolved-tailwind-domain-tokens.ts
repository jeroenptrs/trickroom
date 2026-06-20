/**
 * Resolves the active set of Tailwind tokens for any synced domain.
 *
 * Resolution mirrors color/font helpers (scratchpad Q2):
 *   resolved = (defaults − removed) + added/overridden
 */

import {
	type DefaultTailwindTokenDomain,
	defaultTailwindTokensByDomain,
} from "./default-tailwind-tokens";
import {
	TAILWIND_TOKEN_DOMAINS,
	type TailwindTokenDomain,
} from "./tailwind-token-domains";
import type { TailwindTokenStorage } from "./tailwind-token-store";

export type ResolvedDomainTokens = {
	/** Token name → CSS value. */
	values: ReadonlyMap<string, string>;
	/** Token names available for membership checks. */
	names: ReadonlySet<string>;
};

export type RemovedTokenInput = string | { name: string };

export type ResolvedDomainTokensInput = {
	domain: TailwindTokenDomain;
	meaningfulTokens?: Readonly<Record<string, string>>;
	removed?: readonly RemovedTokenInput[];
};

export type ResolvedTokenContext = Readonly<
	Record<TailwindTokenDomain, ReadonlySet<string>>
>;

export function computeResolvedDomainTokens(
	input: ResolvedDomainTokensInput,
): ResolvedDomainTokens {
	const defaults =
		defaultTailwindTokensByDomain[input.domain as DefaultTailwindTokenDomain] ??
		{};
	const values = new Map<string, string>(Object.entries(defaults));

	for (const removed of input.removed ?? []) {
		const name = typeof removed === "string" ? removed : removed.name;
		values.delete(name);
	}

	for (const [name, value] of Object.entries(input.meaningfulTokens ?? {})) {
		values.set(name, value);
	}

	return { values, names: new Set(values.keys()) };
}

export function buildResolvedTokenContext(
	storedTokens: TailwindTokenStorage,
): ResolvedTokenContext {
	const context = {} as Record<TailwindTokenDomain, ReadonlySet<string>>;

	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		const domainStorage = storedTokens.domains[domain];
		context[domain] = computeResolvedDomainTokens({
			domain,
			meaningfulTokens: domainStorage?.tokens,
			removed: domainStorage?.baselineDiff.removed,
		}).names;
	}

	return context;
}
