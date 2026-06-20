/**
 * Resolves the active set of Tailwind color tokens for a design system.
 *
 * The resolution rule comes from the scratchpad (Q2):
 *   resolved = (defaults − removed) + added/overridden
 *
 * The stored token snapshot only persists "meaningful" tokens — added
 * and overridden entries — so we layer those on top of the bundled
 * defaults and subtract anything explicitly removed via
 * `@theme { --color-…: initial }`.
 */

import { defaultTailwindColorTokens } from "./default-tailwind-tokens";

export type ResolvedColorTokens = {
	/** Token name → CSS value (e.g. `"red-500" → "oklch(...)"` or `#fff`). */
	values: ReadonlyMap<string, string>;
	/** Just the token names. Convenient for membership checks. */
	names: ReadonlySet<string>;
};

export type RemovedTokenInput = string | { name: string };

export type ResolvedColorTokensInput = {
	/**
	 * Tokens that differ from the Tailwind defaults — both `added`
	 * (new names) and `overridden` (defaults with a different value).
	 * The stored snapshot already carries this shape via
	 * `domains.color.tokens`.
	 */
	meaningfulTokens?: Readonly<Record<string, string>>;
	/**
	 * Tokens removed via `@theme { --color-…: initial }`. Accepts the
	 * raw entries from `baselineDiff.removed` (objects with a `name`)
	 * or plain strings.
	 */
	removed?: readonly RemovedTokenInput[];
};

export function computeResolvedColorTokens(
	input: ResolvedColorTokensInput = {},
): ResolvedColorTokens {
	const values = new Map<string, string>(
		Object.entries(defaultTailwindColorTokens),
	);

	for (const removed of input.removed ?? []) {
		const name = typeof removed === "string" ? removed : removed.name;
		values.delete(name);
	}

	for (const [name, value] of Object.entries(input.meaningfulTokens ?? {})) {
		values.set(name, value);
	}

	return { values, names: new Set(values.keys()) };
}

/**
 * Identity reference for "no system selected / nothing synced". Stable
 * across renders so consumers can rely on referential equality when
 * memoizing.
 */
export const EMPTY_RESOLVED_COLOR_TOKENS: ResolvedColorTokens =
	computeResolvedColorTokens();
