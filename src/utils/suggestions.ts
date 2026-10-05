/**
 * Nearest-match helpers for actionable "unknown X" errors. Kept dependency-free
 * so services, MCP tools, and diagnostics can share one ranking.
 */

/**
 * Optimal string alignment distance (Levenshtein plus adjacent
 * transpositions). Returns `limit + 1` early once every alignment exceeds
 * `limit`, so callers can scan large candidate lists cheaply.
 */
export const editDistance = (
	a: string,
	b: string,
	limit = Number.POSITIVE_INFINITY,
): number => {
	if (a === b) return 0;
	if (Math.abs(a.length - b.length) > limit) return limit + 1;
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	let previousPrevious: number[] = [];
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		let rowMin = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let value = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + cost,
			);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
				value = Math.min(value, previousPrevious[j - 2] + 1);
			}
			current[j] = value;
			rowMin = Math.min(rowMin, value);
		}
		if (rowMin > limit) return limit + 1;
		previousPrevious = previous;
		previous = current;
	}

	return previous[b.length];
};

export type SuggestClosestOptions = {
	/** Maximum suggestions to return. Defaults to 3. */
	limit?: number;
	/**
	 * Maximum edit distance. Defaults to roughly a third of the input length,
	 * with a floor of 2.
	 */
	maxDistance?: number;
	/**
	 * Treat prefix/containment as a match (useful for names and ids). Disable
	 * for short structured strings like class names, where "p" is a prefix of
	 * everything. Defaults to true.
	 */
	prefixMatches?: boolean;
};

/**
 * Rank `candidates` by closeness to `input`: case-insensitive exact matches,
 * then prefix/containment matches, then small edit distances. Returns at most
 * `limit` distinct candidates; empty when nothing is plausibly close.
 */
export const suggestClosest = (
	input: string,
	candidates: Iterable<string>,
	options: SuggestClosestOptions = {},
): string[] => {
	const limit = options.limit ?? 3;
	const prefixMatches = options.prefixMatches ?? true;
	const needle = input.trim().toLowerCase();
	if (needle.length === 0) return [];
	const maxDistance =
		options.maxDistance ?? Math.max(2, Math.floor(needle.length / 3));

	const scored: Array<{ candidate: string; score: number }> = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		if (seen.has(candidate)) continue;
		seen.add(candidate);
		const haystack = candidate.toLowerCase();
		if (haystack === needle) {
			scored.push({ candidate, score: 0 });
			continue;
		}
		if (
			prefixMatches &&
			needle.length >= 3 &&
			(haystack.startsWith(needle) || needle.startsWith(haystack))
		) {
			scored.push({
				candidate,
				score: 0.5 + Math.abs(haystack.length - needle.length) / 100,
			});
			continue;
		}
		const distance = editDistance(needle, haystack, maxDistance);
		if (distance <= maxDistance) {
			scored.push({ candidate, score: distance });
			continue;
		}
		if (prefixMatches && needle.length >= 4 && haystack.includes(needle)) {
			scored.push({ candidate, score: maxDistance + 0.5 });
		}
	}

	return scored
		.sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
		.slice(0, limit)
		.map((entry) => entry.candidate);
};

/**
 * Format a "did you mean" suffix for an error message, or an empty string when
 * there are no suggestions.
 */
export const formatDidYouMean = (suggestions: readonly string[]) =>
	suggestions.length === 0
		? ""
		: ` Did you mean ${suggestions.map((value) => `"${value}"`).join(", ")}?`;
