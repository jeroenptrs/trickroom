/**
 * Parses a Tailwind className string into structured tokens that preserve
 * every byte needed to round-trip back to the original string.
 *
 * The parser is intentionally syntactic only: it does not know which
 * utilities are "real" Tailwind utilities. Classification (e.g. is
 * `text-sm` a font-size or a text-color?) is the classifier's job.
 */

export type ParsedClass = {
	/** The original token, byte-for-byte. */
	raw: string;
	/**
	 * All modifier prefixes before the utility body in original order.
	 * This is the exact Tailwind modifier chain used for conflict identity.
	 */
	modifiers: string[];
	/**
	 * Mode prefixes found in the variant chain (e.g. `dark`).
	 * Modes are parsed and preserved so the round-trip is lossless,
	 * but they are surfaced separately so the friendly UI can park
	 * them behind a future "modes" toggle.
	 */
	modes: string[];
	/**
	 * All non-mode variant prefixes in original order (e.g.
	 * `["md", "hover"]` for `md:hover:bg-blue-500`).
	 */
	variants: string[];
	/** True for Tailwind's important marker (`bg-red!`). */
	important: boolean;
	/** True for utilities prefixed with `-` (e.g. `-mt-4`). */
	negative: boolean;
	/** The utility body without variants, modes, `!` or leading `-`. */
	utility: string;
	/**
	 * Best-guess utility prefix, naively the segment before the first
	 * unbracketed `-`. Multi-segment prefixes such as `border-t-blue-500`
	 * are left for the classifier to disambiguate.
	 */
	prefix: string;
	/** The value portion after the prefix, or null for prefix-only utilities. */
	value: string | null;
	/** True when the value (or whole utility) is an `[...]` arbitrary value. */
	arbitrary: boolean;
	/** Opacity modifier from `/<value>`, or null when absent. */
	opacity: string | null;
};

export type ParseClassNameOptions = {
	/**
	 * Variant tokens that should be treated as modes (split off into
	 * `modes` instead of `variants`). Defaults to `["dark"]`.
	 */
	modes?: Iterable<string>;
};

const DEFAULT_MODES: ReadonlySet<string> = new Set(["dark"]);

export function parseClassName(
	className: string,
	options: ParseClassNameOptions = {},
): ParsedClass[] {
	const modeSet = options.modes ? new Set(options.modes) : DEFAULT_MODES;
	return tokenizeClassString(className).map((raw) =>
		parseSingleClass(raw, modeSet),
	);
}

function tokenizeClassString(className: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let depth = 0;
	for (const ch of className) {
		if (ch === "[" || ch === "(") {
			depth++;
		} else if (ch === "]" || ch === ")") {
			depth = Math.max(0, depth - 1);
		}
		if (depth === 0 && /\s/.test(ch)) {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (current.length > 0) tokens.push(current);
	return tokens;
}

function parseSingleClass(
	raw: string,
	modeSet: ReadonlySet<string>,
): ParsedClass {
	const segments = splitOnUnbracketed(raw, ":");
	const body = segments.pop() ?? "";

	const modes: string[] = [];
	const variants: string[] = [];
	for (const segment of segments) {
		if (modeSet.has(segment)) modes.push(segment);
		else variants.push(segment);
	}

	let working = body;
	let important = false;
	let negative = false;

	// Tailwind v4 important suffix.
	if (working.endsWith("!")) {
		important = true;
		working = working.slice(0, -1);
	}
	// Negative utilities (`-mt-4`).
	if (working.startsWith("-")) {
		negative = true;
		working = working.slice(1);
	}

	// Opacity modifier: the last `/` outside any brackets/parens.
	let opacity: string | null = null;
	const opacityIdx = findLastUnbracketed(working, "/");
	if (opacityIdx !== -1) {
		opacity = working.slice(opacityIdx + 1);
		working = working.slice(0, opacityIdx);
	}

	const utility = working;

	let arbitrary = false;
	let prefix = utility;
	let value: string | null = null;

	if (
		utility.length > 0 &&
		utility.startsWith("[") &&
		utility.endsWith("]")
	) {
		// Fully arbitrary utility, e.g. `[mask:linear-gradient(...)]`.
		arbitrary = true;
		prefix = "";
		value = utility;
	} else {
		const hyphenIdx = findFirstUnbracketed(utility, "-");
		if (hyphenIdx !== -1) {
			prefix = utility.slice(0, hyphenIdx);
			value = utility.slice(hyphenIdx + 1);
			if (value.startsWith("[") && value.endsWith("]")) {
				arbitrary = true;
			}
		}
	}

	return {
		raw,
		modifiers: segments,
		modes,
		variants,
		important,
		negative,
		utility,
		prefix,
		value,
		arbitrary,
		opacity,
	};
}

function splitOnUnbracketed(input: string, separator: string): string[] {
	const parts: string[] = [];
	let current = "";
	let depth = 0;
	for (const ch of input) {
		if (ch === "[" || ch === "(") {
			depth++;
		} else if (ch === "]" || ch === ")") {
			depth = Math.max(0, depth - 1);
		} else if (depth === 0 && ch === separator) {
			parts.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	parts.push(current);
	return parts;
}

function findFirstUnbracketed(input: string, target: string): number {
	let depth = 0;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (ch === "[" || ch === "(") depth++;
		else if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
		else if (depth === 0 && ch === target) return i;
	}
	return -1;
}

function findLastUnbracketed(input: string, target: string): number {
	let depth = 0;
	let last = -1;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (ch === "[" || ch === "(") depth++;
		else if (ch === "]" || ch === ")") depth = Math.max(0, depth - 1);
		else if (depth === 0 && ch === target) last = i;
	}
	return last;
}
