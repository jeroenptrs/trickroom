import type { TailwindDesignSystem } from "./tailwind-design-system";

export type SuggestionGroup = {
	supportsNegative?: boolean;
	values: (string | null)[];
	modifiers: string[];
};

export type ThemeEntry = {
	value: string;
	src?: unknown;
};

export type CustomFunctionalUtility = {
	/** The @utility root (e.g. "text-interaction" from "@utility text-interaction-*"). */
	root: string;
	/** CSS variable namespaces consumed by --value(--ns-*) / --modifier(--ns-*) in this utility. */
	consumedNamespaces: string[];
};

/**
 * Stable adapter over Tailwind's __unstable__ design-system APIs.
 *
 * All unstable API surface lives here so the rest of the codebase can treat
 * it as a stable contract. Enrichment is always layered over the lossless
 * ParsedClass.raw tokenizer — never a replacement for it.
 */
export type TailwindIntrospection = {
	/** True iff Tailwind's DS recognizes the candidate (parseCandidate returns non-empty). */
	isKnownCandidate(candidate: string): boolean;
	/** All functional utility roots, including custom @utility definitions. */
	getFunctionalUtilityRoots(): string[];
	/** All static utility roots. */
	getStaticUtilityRoots(): string[];
	/** Completion groups for a utility root from the DS. */
	getCompletions(root: string): SuggestionGroup[];
	/**
	 * Compiled CSS for a single candidate (the utility's own declarations only —
	 * no preflight/theme), or null if the DS does not resolve it. Used to infer
	 * which UI domain(s) a custom utility folds into from the properties it sets.
	 */
	getCandidateCss(candidate: string): string | null;
	/**
	 * Theme entries via the public theme.entries() API.
	 * Use this instead of the private theme.values map.
	 */
	getThemeEntries(): Iterable<[string, ThemeEntry]>;
	/** Map of sub-key → value for a CSS variable namespace prefix (e.g. "--color"). */
	resolveNamespace(namespace: string): Map<string | null, string>;
	/**
	 * Custom @utility roots discovered by parsing the CSS source, together with
	 * the CSS variable namespaces they consume via --value/--modifier.
	 */
	getCustomFunctionalUtilities(): readonly CustomFunctionalUtility[];
};

export function createTailwindIntrospection(
	designSystem: TailwindDesignSystem,
	cssSource: string,
): TailwindIntrospection {
	let cachedCustomUtilities: CustomFunctionalUtility[] | null = null;

	return {
		isKnownCandidate(candidate) {
			return Array.from(designSystem.parseCandidate(candidate)).length > 0;
		},
		getFunctionalUtilityRoots() {
			return designSystem.utilities.keys("functional");
		},
		getStaticUtilityRoots() {
			return designSystem.utilities.keys("static");
		},
		getCompletions(root) {
			return designSystem.utilities.getCompletions(root) as SuggestionGroup[];
		},
		getCandidateCss(candidate) {
			return designSystem.candidatesToCss([candidate])[0] ?? null;
		},
		getThemeEntries() {
			return designSystem.theme.entries() as Iterable<[string, ThemeEntry]>;
		},
		resolveNamespace(namespace) {
			return designSystem.theme.namespace(namespace);
		},
		getCustomFunctionalUtilities() {
			cachedCustomUtilities ??= extractCustomFunctionalUtilities(cssSource);
			return cachedCustomUtilities;
		},
	};
}

/**
 * Parse @utility blocks in CSS source to discover custom functional utility
 * roots and the CSS variable namespaces they consume.
 *
 * Handles patterns like:
 *   @utility text-interaction-* { font-size: --value(--db-interaction-*); }
 */
export function extractCustomFunctionalUtilities(
	cssSource: string,
): CustomFunctionalUtility[] {
	const utilities: CustomFunctionalUtility[] = [];
	for (const { root, body } of parseAtUtilityBlocks(cssSource)) {
		const consumedNamespaces = extractConsumedNamespaces(body);
		utilities.push({ root, consumedNamespaces });
	}
	return utilities;
}

type UtilityBlock = { root: string; body: string };

function parseAtUtilityBlocks(rawCss: string): UtilityBlock[] {
	// Strip `/* … */` comments first so a commented-out `@utility` draft is not
	// registered as a real utility (and so braces inside comments don't throw off
	// the balanced-block scan below).
	const css = stripCssBlockComments(rawCss);
	const blocks: UtilityBlock[] = [];
	const pattern = /@utility\s+([\w-]+(?:-\*)?)\s*\{/g;

	for (const match of css.matchAll(pattern)) {
		const nameWithWildcard = match[1];
		if (!nameWithWildcard) continue;

		const root = nameWithWildcard.endsWith("-*")
			? nameWithWildcard.slice(0, -2)
			: nameWithWildcard;
		const bodyStart = match.index + match[0].length;
		const body = extractBalancedBlock(css, bodyStart);
		if (body !== null) {
			blocks.push({ root, body });
		}
	}

	return blocks;
}

/**
 * Remove CSS block comments, leaving a single space in their place so adjacent
 * tokens don't glue together. String literals are respected so a `/*` inside a
 * `content: "…"` value is not treated as a comment opener.
 */
function stripCssBlockComments(css: string): string {
	let result = "";
	let i = 0;
	let inString: '"' | "'" | null = null;
	while (i < css.length) {
		const ch = css[i];
		if (inString) {
			result += ch;
			if (ch === "\\" && i + 1 < css.length) {
				result += css[i + 1];
				i += 2;
				continue;
			}
			if (ch === inString) inString = null;
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") {
			inString = ch;
			result += ch;
			i++;
			continue;
		}
		if (ch === "/" && css[i + 1] === "*") {
			i += 2;
			while (i < css.length && !(css[i] === "*" && css[i + 1] === "/")) i++;
			i += 2; // skip the closing `*/`
			result += " ";
			continue;
		}
		result += ch;
		i++;
	}
	return result;
}

/**
 * Walk from `offset` (just past an opening `{`) to its matching `}`, returning
 * the block body. String literals are skipped so a brace inside `content: "{"`
 * doesn't throw off the depth counter. Assumes comments are already stripped.
 */
function extractBalancedBlock(css: string, offset: number): string | null {
	let depth = 1;
	let i = offset;
	let inString: '"' | "'" | null = null;
	while (i < css.length && depth > 0) {
		const ch = css[i];
		if (inString) {
			if (ch === "\\") {
				i += 2;
				continue;
			}
			if (ch === inString) inString = null;
			i++;
			continue;
		}
		if (ch === '"' || ch === "'") {
			inString = ch;
		} else if (ch === "{") {
			depth++;
		} else if (ch === "}") {
			depth--;
		}
		i++;
	}
	return depth === 0 ? css.slice(offset, i - 1) : null;
}

function extractConsumedNamespaces(body: string): string[] {
	const namespaces = new Set<string>();
	const pattern = /--(?:value|modifier)\(\s*(--[a-z0-9-]+(?:-\*)?)\s*\)/gi;
	for (const match of body.matchAll(pattern)) {
		const raw = match[1];
		if (!raw) continue;
		const ns = raw.endsWith("-*") ? raw.slice(0, -2) : raw;
		namespaces.add(ns);
	}
	return [...namespaces].sort();
}
