import { defaultTailwindTokensByDomain } from "./default-tailwind-tokens";
import {
	isTailwindTokenDomainProperty,
	isTokenMatchedByResets,
	normalizeTailwindTokenValue,
	TAILWIND_TOKEN_DOMAINS,
	type TailwindTokenDomain,
} from "./tailwind-token-domains";
import type {
	TailwindAuthoredTokens,
	TailwindConfirmedTokenState,
	TailwindCustomUtilityStorage,
	TailwindProjectTokenDefinition,
} from "./tailwind-token-store";

/**
 * One project token that changed since the last confirmed review. `value` is
 * what the theme resolves the token to now (absent when it is gone),
 * `previousValue` what it resolved to when confirmed (absent when it was not
 * there).
 */
export type TailwindTokenReviewEntry = {
	domain: TailwindTokenDomain;
	name: string;
	value?: string;
	previousValue?: string;
};

export type TailwindCustomPropertyReviewEntry = {
	name: string;
	value?: string;
	previousValue?: string;
};

/** An authored `initial` reset, e.g. `--color-*`, in its domain. */
export type TailwindResetReviewEntry = {
	domain: TailwindTokenDomain;
	pattern: string;
};

/**
 * What changed in the project's own definition since the user last confirmed
 * a token review. Tailwind's reference values are not part of it.
 */
export type TailwindTokenReviewChanges = {
	confirmedAt: string;
	confirmedTailwindBaselineVersion: string;
	tokens: {
		added: TailwindTokenReviewEntry[];
		changed: TailwindTokenReviewEntry[];
		removed: TailwindTokenReviewEntry[];
	};
	/** Resets added (defaults removed) and removed (defaults restored). */
	resets: {
		added: TailwindResetReviewEntry[];
		removed: TailwindResetReviewEntry[];
	};
	customProperties: {
		added: TailwindCustomPropertyReviewEntry[];
		changed: TailwindCustomPropertyReviewEntry[];
		removed: TailwindCustomPropertyReviewEntry[];
	};
	/** `@utility` roots. */
	customUtilities: {
		added: string[];
		changed: string[];
		removed: string[];
	};
};

/**
 * The one set of review counts every surface shows (tokens panel, its
 * banner, the systems list, the system detail pane). With a confirmed
 * review: every change since then, tokens, resets, custom properties and
 * custom utilities together, a reset counting as removed when added and as
 * added when removed. Before the first one: the theme's diff against
 * Tailwind's defaults across all domains.
 */
export type TokenReviewCounts = {
	added: number;
	changed: number;
	removed: number;
	total: number;
	/** Whether the counts are changes since the last confirmed review. */
	sinceLastReview: boolean;
};

type BaselineDiffCounts = Partial<
	Record<
		TailwindTokenDomain,
		{
			added: readonly unknown[];
			overridden: readonly unknown[];
			removed: readonly unknown[];
		}
	>
>;

/** The per-domain baseline diffs of a stored snapshot's domains. */
export function getStoredBaselineDiffs(
	domains:
		| Partial<
				Record<
					TailwindTokenDomain,
					{ baselineDiff: NonNullable<BaselineDiffCounts[TailwindTokenDomain]> }
				>
		  >
		| undefined,
): BaselineDiffCounts | undefined {
	if (!domains) {
		return undefined;
	}
	return Object.fromEntries(
		Object.entries(domains).map(([domain, storage]) => [
			domain,
			storage?.baselineDiff,
		]),
	) as BaselineDiffCounts;
}

export function getTokenReviewCounts({
	reviewChanges,
	baselineDiffs,
}: {
	reviewChanges: TailwindTokenReviewChanges | null | undefined;
	baselineDiffs: BaselineDiffCounts | undefined;
}): TokenReviewCounts {
	if (reviewChanges) {
		const { tokens, resets, customProperties, customUtilities } = reviewChanges;
		const added =
			tokens.added.length +
			resets.removed.length +
			customProperties.added.length +
			customUtilities.added.length;
		const changed =
			tokens.changed.length +
			customProperties.changed.length +
			customUtilities.changed.length;
		const removed =
			tokens.removed.length +
			resets.added.length +
			customProperties.removed.length +
			customUtilities.removed.length;
		return {
			added,
			changed,
			removed,
			total: added + changed + removed,
			sinceLastReview: true,
		};
	}

	let added = 0;
	let changed = 0;
	let removed = 0;
	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		const diff = baselineDiffs?.[domain];
		added += diff?.added.length ?? 0;
		changed += diff?.overridden.length ?? 0;
		removed += diff?.removed.length ?? 0;
	}
	return {
		added,
		changed,
		removed,
		total: added + changed + removed,
		sinceLastReview: false,
	};
}

/**
 * Whether two project definitions are the same, so whether a review is
 * needed between them. The theme compares as authored (values as written,
 * reset patterns) when both sides record it, otherwise as resolved against
 * the defaults of the time. Custom utilities compare by their authored
 * definition when both sides record it. Custom properties of the token
 * domains are left to the theme comparison. Values compare normalized
 * (whitespace, hex case).
 */
export function areProjectTokenDefinitionsEquivalent(
	left: TailwindProjectTokenDefinition,
	right: TailwindProjectTokenDefinition,
): boolean {
	const theme =
		left.authored && right.authored
			? JSON.stringify(comparableAuthored(left.authored)) ===
				JSON.stringify(comparableAuthored(right.authored))
			: JSON.stringify(comparableResolved(left)) ===
				JSON.stringify(comparableResolved(right));
	if (!theme) {
		return false;
	}

	if (
		JSON.stringify(comparableCustomProperties(left.customProperties)) !==
		JSON.stringify(comparableCustomProperties(right.customProperties))
	) {
		return false;
	}

	const diff = diffCustomUtilities(left.customUtilities, right.customUtilities);
	return (
		diff.added.length === 0 &&
		diff.changed.length === 0 &&
		diff.removed.length === 0
	);
}

/**
 * A confirmed state recorded before the authored theme or the utility
 * definitions were, completed from an equivalent current definition, so
 * later reviews compare what the CSS authors. Unchanged when there is
 * nothing to complete or the definitions differ.
 */
export function backfillConfirmedTokenState(
	confirmed: TailwindConfirmedTokenState,
	current: TailwindProjectTokenDefinition,
): TailwindConfirmedTokenState {
	const lacksDefinitions =
		!confirmed.authored ||
		confirmed.customUtilities.some(
			(utility) => utility.definition === undefined,
		);
	if (
		!lacksDefinitions ||
		!current.authored ||
		!areProjectTokenDefinitionsEquivalent(confirmed, current)
	) {
		return confirmed;
	}

	return {
		...confirmed,
		authored: current.authored,
		customUtilities: current.customUtilities,
	};
}

type ResolvedToken = { kind: "value"; value: string } | { kind: "removed" };

/**
 * The changes between the confirmed project definition and the current one.
 *
 * With the authored theme on both sides, per domain: tokens the CSS now
 * authors (added), authors with another value (changed) or no longer
 * authors (changed back to the default, or removed when there is none or a
 * reset covers it), and resets added or removed.
 *
 * Otherwise, per token resolved against the defaults: the theme either sets
 * a value, removes a Tailwind default, or leaves the name alone. Moving
 * between those:
 *
 * - nothing or removed → value: added
 * - value → other value: changed
 * - value → removed, value → nothing (no default), nothing → removed: removed
 * - value → nothing with a default: changed back to the default (left out
 *   when the value equals it: the default caught up with the theme)
 * - removed → nothing with a default: added back as the default
 */
export function computeTokenReviewChanges(
	confirmed: TailwindConfirmedTokenState,
	current: TailwindProjectTokenDefinition,
): TailwindTokenReviewChanges {
	const authored =
		confirmed.authored && current.authored
			? diffAuthoredTokens(confirmed.authored, current.authored)
			: null;

	return {
		confirmedAt: confirmed.confirmedAt,
		confirmedTailwindBaselineVersion: confirmed.tailwindBaselineVersion,
		tokens: authored?.tokens ?? diffResolvedTokens(confirmed, current),
		resets: authored?.resets ?? { added: [], removed: [] },
		customProperties: diffCustomProperties(
			comparableCustomProperties(confirmed.customProperties),
			comparableCustomProperties(current.customProperties),
		),
		customUtilities: diffCustomUtilities(
			confirmed.customUtilities,
			current.customUtilities,
		),
	};
}

function diffAuthoredTokens(
	before: TailwindAuthoredTokens,
	after: TailwindAuthoredTokens,
): Pick<TailwindTokenReviewChanges, "tokens" | "resets"> {
	const tokens: TailwindTokenReviewChanges["tokens"] = {
		added: [],
		changed: [],
		removed: [],
	};
	const resets: TailwindTokenReviewChanges["resets"] = {
		added: [],
		removed: [],
	};

	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		const previousTokens = before.domains[domain]?.tokens ?? {};
		const nextTokens = after.domains[domain]?.tokens ?? {};
		const previousResets = before.domains[domain]?.resets ?? [];
		const nextResets = after.domains[domain]?.resets ?? [];
		const defaults: Record<string, string> =
			defaultTailwindTokensByDomain[domain] ?? {};

		for (const name of sortedUnion(
			Object.keys(previousTokens),
			Object.keys(nextTokens),
		)) {
			const previousValue = previousTokens[name];
			const value = nextTokens[name];
			if (previousValue !== undefined && value !== undefined) {
				if (
					normalizeTailwindTokenValue(previousValue) !==
					normalizeTailwindTokenValue(value)
				) {
					tokens.changed.push({ domain, name, previousValue, value });
				}
			} else if (value !== undefined) {
				tokens.added.push({ domain, name, value });
			} else if (previousValue !== undefined) {
				const defaultValue = defaults[name];
				if (
					defaultValue !== undefined &&
					!isTokenMatchedByResets(nextResets, domain, name)
				) {
					tokens.changed.push({
						domain,
						name,
						previousValue,
						value: defaultValue,
					});
				} else {
					tokens.removed.push({ domain, name, previousValue });
				}
			}
		}

		for (const pattern of sortedUnion(previousResets, nextResets)) {
			if (!previousResets.includes(pattern)) {
				resets.added.push({ domain, pattern });
			} else if (!nextResets.includes(pattern)) {
				resets.removed.push({ domain, pattern });
			}
		}
	}

	return { tokens, resets };
}

function diffResolvedTokens(
	confirmed: TailwindProjectTokenDefinition,
	current: TailwindProjectTokenDefinition,
): TailwindTokenReviewChanges["tokens"] {
	const tokens: TailwindTokenReviewChanges["tokens"] = {
		added: [],
		changed: [],
		removed: [],
	};

	for (const domain of TAILWIND_TOKEN_DOMAINS) {
		const before = resolveDomainTokens(confirmed, domain);
		const after = resolveDomainTokens(current, domain);
		const defaults: Record<string, string> =
			defaultTailwindTokensByDomain[domain] ?? {};

		for (const name of sortedUnion([...before.keys()], [...after.keys()])) {
			const previous = before.get(name);
			const next = after.get(name);
			const defaultValue = defaults[name];

			if (previous?.kind === "value" && next?.kind === "value") {
				if (
					normalizeTailwindTokenValue(previous.value) !==
					normalizeTailwindTokenValue(next.value)
				) {
					tokens.changed.push({
						domain,
						name,
						previousValue: previous.value,
						value: next.value,
					});
				}
				continue;
			}

			if (next?.kind === "value") {
				tokens.added.push({ domain, name, value: next.value });
				continue;
			}

			if (previous?.kind === "value") {
				if (next === undefined && defaultValue !== undefined) {
					if (
						normalizeTailwindTokenValue(previous.value) !==
						normalizeTailwindTokenValue(defaultValue)
					) {
						tokens.changed.push({
							domain,
							name,
							previousValue: previous.value,
							value: defaultValue,
						});
					}
				} else {
					tokens.removed.push({ domain, name, previousValue: previous.value });
				}
				continue;
			}

			if (next?.kind === "removed" && previous === undefined) {
				tokens.removed.push({ domain, name, previousValue: defaultValue });
				continue;
			}

			if (
				previous?.kind === "removed" &&
				next === undefined &&
				defaultValue !== undefined
			) {
				tokens.added.push({ domain, name, value: defaultValue });
			}
		}
	}

	return tokens;
}

function resolveDomainTokens(
	definition: TailwindProjectTokenDefinition,
	domain: TailwindTokenDomain,
): Map<string, ResolvedToken> {
	const storage = definition.domains[domain];
	const resolved = new Map<string, ResolvedToken>();
	for (const name of storage?.removed ?? []) {
		resolved.set(name, { kind: "removed" });
	}
	for (const [name, value] of Object.entries(storage?.tokens ?? {})) {
		resolved.set(name, { kind: "value", value });
	}
	return resolved;
}

function comparableAuthored(authored: TailwindAuthoredTokens) {
	return TAILWIND_TOKEN_DOMAINS.flatMap((domain) => {
		const storage = authored.domains[domain];
		const tokens = normalizedValues(storage?.tokens ?? {});
		const resets = [...new Set(storage?.resets ?? [])].sort();
		return Object.keys(tokens).length > 0 || resets.length > 0
			? [[domain, tokens, resets]]
			: [];
	});
}

/**
 * Removed names compare only while they are Tailwind defaults: a default
 * Tailwind dropped is no longer removed by anything.
 */
function comparableResolved(definition: TailwindProjectTokenDefinition) {
	return TAILWIND_TOKEN_DOMAINS.flatMap((domain) => {
		const storage = definition.domains[domain];
		const defaults: Record<string, string> =
			defaultTailwindTokensByDomain[domain] ?? {};
		const tokens = normalizedValues(storage?.tokens ?? {});
		const removed = [...new Set(storage?.removed ?? [])]
			.filter((name) => defaults[name] !== undefined)
			.sort();
		return Object.keys(tokens).length > 0 || removed.length > 0
			? [[domain, tokens, removed]]
			: [];
	});
}

/**
 * Custom properties outside the token domains (the theme comparison covers
 * those, and they include Tailwind's defaults when a utility consumes a
 * default namespace).
 */
function comparableCustomProperties(
	properties: Record<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(properties).filter(
			([name]) => !isTailwindTokenDomainProperty(name),
		),
	);
}

function normalizedValues(values: Record<string, string>) {
	return Object.fromEntries(
		Object.entries(values)
			.map(([name, value]) => [name, normalizeTailwindTokenValue(value)])
			.sort(([left], [right]) => left.localeCompare(right)),
	);
}

function sortedUnion(left: Iterable<string>, right: Iterable<string>) {
	return [...new Set([...left, ...right])].sort((a, b) => a.localeCompare(b));
}

function diffCustomProperties(
	before: Record<string, string>,
	after: Record<string, string>,
): TailwindTokenReviewChanges["customProperties"] {
	const changes: TailwindTokenReviewChanges["customProperties"] = {
		added: [],
		changed: [],
		removed: [],
	};

	for (const name of sortedUnion(Object.keys(before), Object.keys(after))) {
		const previousValue = before[name];
		const value = after[name];
		if (previousValue === undefined && value !== undefined) {
			changes.added.push({ name, value });
		} else if (value === undefined && previousValue !== undefined) {
			changes.removed.push({ name, previousValue });
		} else if (
			value !== undefined &&
			previousValue !== undefined &&
			normalizeTailwindTokenValue(value) !==
				normalizeTailwindTokenValue(previousValue)
		) {
			changes.changed.push({ name, previousValue, value });
		}
	}

	return changes;
}

/**
 * A utility changed when its authored definition did, when both sides
 * record one. Otherwise (a snapshot synced before definitions were recorded)
 * by what was recorded: kind, consumed namespaces, completion values and
 * domains.
 */
function diffCustomUtilities(
	before: readonly TailwindCustomUtilityStorage[],
	after: readonly TailwindCustomUtilityStorage[],
): TailwindTokenReviewChanges["customUtilities"] {
	const beforeByRoot = new Map(
		before.map((utility) => [utility.root, utility]),
	);
	const afterByRoot = new Map(after.map((utility) => [utility.root, utility]));
	const roots = sortedUnion(beforeByRoot.keys(), afterByRoot.keys());

	return {
		added: roots.filter((root) => !beforeByRoot.has(root)),
		changed: roots.filter((root) => {
			const previous = beforeByRoot.get(root);
			const next = afterByRoot.get(root);
			return previous && next && !areCustomUtilitiesEquivalent(previous, next);
		}),
		removed: roots.filter((root) => !afterByRoot.has(root)),
	};
}

function areCustomUtilitiesEquivalent(
	left: TailwindCustomUtilityStorage,
	right: TailwindCustomUtilityStorage,
): boolean {
	if (left.kind !== right.kind) {
		return false;
	}
	if (left.definition !== undefined && right.definition !== undefined) {
		return left.definition === right.definition;
	}
	const recorded = (utility: TailwindCustomUtilityStorage) =>
		JSON.stringify([
			[...utility.consumedNamespaces].sort(),
			[...utility.completionValues].sort(),
			[...(utility.domains ?? [])].sort(),
		]);
	return recorded(left) === recorded(right);
}
