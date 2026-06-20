/**
 * Pure logic for the token-first value field (right-rail P2): filtering the
 * token scale, arrow-stepping between numeric tokens, and deriving the
 * explicit out-of-system arbitrary candidate. Kept apart from `TokenField`
 * per the controller pattern so the behavior is unit-testable.
 */

export type TokenFieldOption = {
	/** Utility value suffix as it appears in the class (e.g. "2", "full", "[10px]"). */
	value: string;
	/** Resolved display value for the right column (e.g. "8px", "100%"). */
	resolved?: string;
	/** Marks the out-of-system arbitrary candidate row. */
	arbitrary?: boolean;
};

/**
 * Curated numeric spacing steps offered in the dropdown. Tailwind v4 derives
 * spacing utilities from the `--spacing` multiplier, so any number is valid —
 * this is the designer-facing scale, not an exhaustive list; off-scale
 * numbers remain reachable by typing.
 */
export const SPACING_SCALE_STEPS = [
	"0",
	"0.5",
	"1",
	"1.5",
	"2",
	"2.5",
	"3",
	"3.5",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"10",
	"11",
	"12",
	"14",
	"16",
	"20",
	"24",
	"28",
	"32",
	"36",
	"40",
	"44",
	"48",
	"52",
	"56",
	"60",
	"64",
	"72",
	"80",
	"96",
] as const;

export function formatPx(px: number): string {
	return `${Number(px.toFixed(2))}px`;
}

/** Numeric scale options with px resolved through the spacing multiplier. */
export function spacingScaleOptions(basePx: number | null): TokenFieldOption[] {
	return SPACING_SCALE_STEPS.map((step) => ({
		value: step,
		resolved: basePx === null ? undefined : formatPx(Number(step) * basePx),
	}));
}

export function findTokenOption(
	options: readonly TokenFieldOption[],
	value: string,
): TokenFieldOption | undefined {
	const trimmed = value.trim();
	return options.find((option) => option.value === trimmed);
}

/** Arbitrary `[…]` values and custom-property `(--…)` references. */
export function isArbitraryTokenValue(value: string): boolean {
	const trimmed = value.trim();
	return trimmed.startsWith("[") || trimmed.startsWith("(");
}

/**
 * Filter the scale by a query, in-system matches first: value prefix
 * matches, then value substring matches, then resolved-column matches
 * (so "8px" finds spacing "2"). An empty query returns the whole scale.
 */
export function filterTokenOptions(
	options: readonly TokenFieldOption[],
	query: string,
): TokenFieldOption[] {
	const q = query.trim().toLowerCase();
	if (!q) return [...options];

	const ranked: [number, TokenFieldOption][] = [];
	for (const option of options) {
		const value = option.value.toLowerCase();
		const resolved = option.resolved?.toLowerCase() ?? "";
		const rank = value.startsWith(q)
			? 0
			: value.includes(q)
				? 1
				: resolved.includes(q)
					? 2
					: -1;
		if (rank >= 0) ranked.push([rank, option]);
	}
	return ranked.sort((a, b) => a[0] - b[0]).map(([, option]) => option);
}

/**
 * The explicit out-of-system candidate for a query: bare numbers become
 * `[<n>px]` (so the in-system token always outranks it), bracketed/paren
 * input is completed as typed, and anything else is wrapped as an arbitrary
 * value with spaces underscored per Tailwind syntax.
 */
export function arbitraryTokenCandidate(
	query: string,
): TokenFieldOption | null {
	const trimmed = query.trim();
	if (!trimmed) return null;

	if (trimmed.startsWith("[")) {
		const body = trimmed.replace(/^\[/, "").replace(/\]$/, "");
		if (!body) return null;
		return { value: `[${body}]`, arbitrary: true };
	}
	if (trimmed.startsWith("(")) {
		const body = trimmed.replace(/^\(/, "").replace(/\)$/, "");
		if (!body) return null;
		return { value: `(${body})`, arbitrary: true };
	}
	// Negative numbers included: margins step below zero, and `m-[-8px]` is
	// the honest out-of-system spelling for them.
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
		return { value: `[${trimmed}px]`, arbitrary: true };
	}
	return { value: `[${trimmed.replace(/\s+/g, "_")}]`, arbitrary: true };
}

function parseTokenNumber(value: string): number | null {
	if (!/^\d+(\.\d+)?$/.test(value)) return null;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Arrow-step along the numeric tokens of the scale, like dragging in Figma
 * except it can only land on tokens. Off-scale numeric input lands on the
 * nearest token in the step direction; keywords and arbitrary values do not
 * step (returns null, caller no-ops). Stepping past either end is a no-op.
 */
export function stepToken(
	options: readonly TokenFieldOption[],
	current: string,
	delta: 1 | -1,
): string | null {
	const numeric = options
		.filter((option) => !option.arbitrary)
		.map((option) => ({ option, number: parseTokenNumber(option.value) }))
		.filter(
			(entry): entry is { option: TokenFieldOption; number: number } =>
				entry.number !== null,
		)
		.sort((a, b) => a.number - b.number);
	if (numeric.length === 0) return null;

	const trimmed = current.trim();
	if (!trimmed) {
		return delta > 0 ? numeric[0].option.value : null;
	}

	const currentNumber = parseTokenNumber(trimmed);
	if (currentNumber === null) return null;

	if (delta > 0) {
		const next = numeric.find((entry) => entry.number > currentNumber);
		return next ? next.option.value : null;
	}
	const previous = [...numeric]
		.reverse()
		.find((entry) => entry.number < currentNumber);
	return previous ? previous.option.value : null;
}
