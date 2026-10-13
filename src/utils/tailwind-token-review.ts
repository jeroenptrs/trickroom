import { defaultTailwindTokensByDomain } from "./default-tailwind-tokens";
import {
	normalizeTailwindTokenValue,
	TAILWIND_TOKEN_DOMAINS,
	type TailwindTokenDomain,
} from "./tailwind-token-domains";
import type {
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

/** Token, custom property and custom utility changes, all counted. */
export function countTokenReviewChanges(
	changes: TailwindTokenReviewChanges,
): number {
	return [changes.tokens, changes.customProperties, changes.customUtilities]
		.flatMap((group) => [group.added, group.changed, group.removed])
		.reduce((total, entries) => total + entries.length, 0);
}

type ResolvedToken = { kind: "value"; value: string } | { kind: "removed" };

/**
 * The changes between the confirmed project definition and the current one.
 * Per token, the theme either sets a value, removes a Tailwind default, or
 * leaves the name alone (a default, or nothing). Moving between those:
 *
 * - nothing or removed → value: added
 * - value → other value: changed
 * - value → removed, value → nothing (no default), nothing → removed: removed
 * - value → nothing with a default: changed back to the default
 * - removed → nothing with a default: added back as the default
 */
export function computeTokenReviewChanges(
	confirmed: TailwindConfirmedTokenState,
	current: TailwindProjectTokenDefinition,
): TailwindTokenReviewChanges {
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
		const names = [...new Set([...before.keys(), ...after.keys()])].sort(
			(left, right) => left.localeCompare(right),
		);

		for (const name of names) {
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
					tokens.changed.push({
						domain,
						name,
						previousValue: previous.value,
						value: defaultValue,
					});
				} else {
					tokens.removed.push({ domain, name, previousValue: previous.value });
				}
				continue;
			}

			if (next?.kind === "removed" && previous === undefined) {
				tokens.removed.push({ domain, name, previousValue: defaultValue });
				continue;
			}

			if (previous?.kind === "removed" && next === undefined) {
				tokens.added.push({ domain, name, value: defaultValue });
			}
		}
	}

	return {
		confirmedAt: confirmed.confirmedAt,
		confirmedTailwindBaselineVersion: confirmed.tailwindBaselineVersion,
		tokens,
		customProperties: diffCustomProperties(
			confirmed.customProperties,
			current.customProperties,
		),
		customUtilities: diffCustomUtilities(
			confirmed.customUtilities,
			current.customUtilities,
		),
	};
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

function diffCustomProperties(
	before: Record<string, string>,
	after: Record<string, string>,
): TailwindTokenReviewChanges["customProperties"] {
	const changes: TailwindTokenReviewChanges["customProperties"] = {
		added: [],
		changed: [],
		removed: [],
	};
	const names = [
		...new Set([...Object.keys(before), ...Object.keys(after)]),
	].sort((left, right) => left.localeCompare(right));

	for (const name of names) {
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

function diffCustomUtilities(
	before: readonly TailwindCustomUtilityStorage[],
	after: readonly TailwindCustomUtilityStorage[],
): TailwindTokenReviewChanges["customUtilities"] {
	const beforeByRoot = new Map(
		before.map((utility) => [utility.root, JSON.stringify(utility)]),
	);
	const afterByRoot = new Map(
		after.map((utility) => [utility.root, JSON.stringify(utility)]),
	);
	const roots = [
		...new Set([...beforeByRoot.keys(), ...afterByRoot.keys()]),
	].sort((left, right) => left.localeCompare(right));

	return {
		added: roots.filter((root) => !beforeByRoot.has(root)),
		changed: roots.filter(
			(root) =>
				beforeByRoot.has(root) &&
				afterByRoot.has(root) &&
				beforeByRoot.get(root) !== afterByRoot.get(root),
		),
		removed: roots.filter((root) => !afterByRoot.has(root)),
	};
}
