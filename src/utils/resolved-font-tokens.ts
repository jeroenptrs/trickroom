/**
 * Resolves the active set of Tailwind font-family tokens for a design system.
 *
 * Resolution mirrors color tokens (scratchpad Q2):
 *   resolved = (defaults − removed) + added/overridden
 */

import { defaultTailwindFontTokens } from "./default-tailwind-tokens";

export type ResolvedFontTokens = {
	/** Token name → CSS font-family stack value. */
	values: ReadonlyMap<string, string>;
	/** Token names available for `font-*` utilities. */
	names: ReadonlySet<string>;
};

export type RemovedTokenInput = string | { name: string };

export type ResolvedFontTokensInput = {
	meaningfulTokens?: Readonly<Record<string, string>>;
	removed?: readonly RemovedTokenInput[];
};

export function computeResolvedFontTokens(
	input: ResolvedFontTokensInput = {},
): ResolvedFontTokens {
	const values = new Map<string, string>(
		Object.entries(defaultTailwindFontTokens),
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

export const EMPTY_RESOLVED_FONT_TOKENS: ResolvedFontTokens =
	computeResolvedFontTokens();
