/**
 * Pure logic behind the inspector's free-text class field: tokenizing the
 * class string, finding the token at the caret, completing it from the
 * project's Tailwind class catalog, and deciding what a commit writes.
 */

export type ClassToken = {
	value: string;
	start: number;
	end: number;
};

export type ClassCatalog = {
	classes: readonly string[];
	variants: readonly string[];
};

export type ClassCatalogIndex = ClassCatalog & {
	classSet: ReadonlySet<string>;
	variantSet: ReadonlySet<string>;
};

export type ClassCompletion = {
	/** Full replacement for the token at the caret, variant prefix included. */
	value: string;
	/** What the list shows: the utility or `variant:` being completed. */
	label: string;
	kind: "utility" | "variant";
};

export function createClassCatalogIndex(
	catalog: ClassCatalog,
): ClassCatalogIndex {
	return {
		...catalog,
		classSet: new Set(catalog.classes),
		variantSet: new Set(catalog.variants),
	};
}

export function tokenizeClassName(value: string): ClassToken[] {
	const tokens: ClassToken[] = [];
	for (const match of value.matchAll(/\S+/g)) {
		const start = match.index ?? 0;
		tokens.push({ value: match[0], start, end: start + match[0].length });
	}
	return tokens;
}

/**
 * The token the caret touches, or an empty token at the caret when it sits in
 * whitespace (so a completion inserts rather than replaces).
 */
export function getTokenAtCursor(value: string, cursor: number): ClassToken {
	for (const token of tokenizeClassName(value)) {
		if (cursor >= token.start && cursor <= token.end) {
			return token;
		}
	}
	return { value: "", start: cursor, end: cursor };
}

/**
 * Split `md:hover:!bg-red-500` at its last top-level `:` into the variant
 * prefix (`md:hover:!`, important marker included) and the utility being
 * typed. Colons inside `[…]`/`(…)` belong to arbitrary values.
 */
export function splitVariantPrefix(token: string): {
	prefix: string;
	variants: string[];
	utility: string;
} {
	let depth = 0;
	let segmentStart = 0;
	const variants: string[] = [];
	for (let index = 0; index < token.length; index++) {
		const char = token[index];
		if (char === "[" || char === "(") depth++;
		else if (char === "]" || char === ")") depth = Math.max(0, depth - 1);
		else if (char === ":" && depth === 0) {
			variants.push(token.slice(segmentStart, index));
			segmentStart = index + 1;
		}
	}
	let prefix = token.slice(0, segmentStart);
	let utility = token.slice(segmentStart);
	if (utility.startsWith("!")) {
		prefix += "!";
		utility = utility.slice(1);
	}
	return { prefix, variants, utility };
}

const DEFAULT_COMPLETION_LIMIT = 50;

/**
 * Rank catalog entries for the token at the caret: an exact match, then prefix
 * matches (shorter first, Tailwind's own order within a length), then matches
 * on a later `-segment` (`red` finds `bg-red-500`). Variants complete as
 * `name:` alongside utilities. Negative utilities only show once `-` is typed.
 */
export function getClassCompletions(
	index: ClassCatalogIndex,
	token: string,
	limit = DEFAULT_COMPLETION_LIMIT,
): ClassCompletion[] {
	const { prefix, utility } = splitVariantPrefix(token);
	const needle = utility.toLowerCase();
	if (needle.length === 0 || needle.includes("[")) {
		return [];
	}

	const scored: Array<ClassCompletion & { score: number; order: number }> = [];
	const segmentNeedle = `-${needle}`;
	const allowNegative = needle.startsWith("-");
	let order = 0;
	for (const name of index.classes) {
		order++;
		if (!allowNegative && name.startsWith("-")) continue;
		let score: number;
		if (name === needle) score = 0;
		else if (name.startsWith(needle)) score = 1 + name.length / 1000;
		else if (needle.length >= 2 && name.includes(segmentNeedle))
			score = 2 + name.length / 1000;
		else continue;
		scored.push({
			value: `${prefix}${name}`,
			label: name,
			kind: "utility",
			score,
			order,
		});
	}
	// `!` can't precede a variant, so only offer variants after a clean prefix.
	if (!prefix.endsWith("!")) {
		for (const name of index.variants) {
			order++;
			if (!name.startsWith(needle)) continue;
			scored.push({
				value: `${prefix}${name}:`,
				label: `${name}:`,
				kind: "variant",
				score: 1 + name.length / 1000,
				order,
			});
		}
	}

	return scored
		.sort((left, right) => left.score - right.score || left.order - right.order)
		.slice(0, limit)
		.map(({ value, label, kind }) => ({ value, label, kind }));
}

/** Replace the token at the caret with a completion; returns the new caret. */
export function applyClassCompletion(
	value: string,
	token: ClassToken,
	completion: string,
): { value: string; cursor: number } {
	return {
		value: `${value.slice(0, token.start)}${completion}${value.slice(token.end)}`,
		cursor: token.start + completion.length,
	};
}

export function normalizeClassName(value: string): string {
	return tokenizeClassName(value)
		.map((token) => token.value)
		.join(" ");
}

/**
 * What a commit writes: the normalized draft, or null when it matches the
 * stored className up to whitespace (nothing to write).
 */
export function getClassFieldCommit(
	draft: string,
	committed: string,
): string | null {
	const next = normalizeClassName(draft);
	return next === normalizeClassName(committed) ? null : next;
}

/**
 * Plain `variant:…:utility` tokens resolvable from the catalog alone. Anything
 * else (arbitrary values, opacity modifiers, typos) needs the server's
 * Tailwind design system to decide.
 */
export function isCatalogClass(index: ClassCatalogIndex, token: string) {
	const { variants, utility } = splitVariantPrefix(token);
	const bare = utility.endsWith("!") ? utility.slice(0, -1) : utility;
	return (
		index.classSet.has(bare) &&
		variants.every((variant) => index.variantSet.has(variant))
	);
}

/** Distinct tokens the catalog can't vouch for, sorted for a stable query key. */
export function getUninspectedClasses(
	index: ClassCatalogIndex | null,
	value: string,
): string[] {
	const tokens = new Set<string>();
	for (const { value: token } of tokenizeClassName(value)) {
		if (!index || !isCatalogClass(index, token)) {
			tokens.add(token);
		}
	}
	return [...tokens].sort();
}

/** Replace every occurrence of a whole class token. */
export function replaceClassToken(
	value: string,
	token: string,
	replacement: string,
): string {
	return tokenizeClassName(value)
		.map((entry) => (entry.value === token ? replacement : entry.value))
		.filter(Boolean)
		.join(" ");
}
