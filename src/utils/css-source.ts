import postcss, { type ChildNode, Input, type Root } from "postcss";
import tokenizer, { type Token } from "postcss/lib/tokenize";

/**
 * Reading stylesheet source text: postcss parses it, and its tokenizer
 * drives the normalization below. What is ours is which tokens that
 * normalization drops, and reading the target out of an `@import`'s
 * params, which postcss leaves as a raw string.
 */

// Whitespace next to these never changes what CSS means.
const STRUCTURAL_TOKENS = new Set(["{", "}", ";"]);
// Tokens that would read as one if nothing separated them.
const JOINABLE_TOKENS = new Set(["word", "at-word", "string", "brackets"]);

/**
 * The stylesheet text with only what cannot change its meaning removed,
 * token by token (postcss's tokenizer, so strings, `url(…)` and comments
 * are recognized as CSS does):
 *
 * - comments are dropped without leaving anything in their place: in CSS a
 *   comment is not whitespace (`&/**\/:hover` is `&:hover`, not
 *   `& :hover`). Only where dropping it would join two words into one is a
 *   bare `/**\/` kept in its place.
 * - runs of whitespace become one space, and whitespace next to `{`, `}`
 *   or `;` is dropped. Whitespace inside brackets without strings or
 *   comments is collapsed the same way, except in an unquoted `url(…)` and
 *   after a backslash escape, which stay as written.
 * - strings, and everything else, stay as written.
 *
 * Text postcss cannot tokenize stays as it is.
 */
export function normalizeCssSource(css: string): string {
	let tokens: Token[];
	try {
		const stream = tokenizer(new Input(css));
		tokens = [];
		while (!stream.endOfFile()) {
			tokens.push(stream.nextToken());
		}
	} catch {
		return css;
	}

	const output: Token[] = [];
	let pendingSpace = false;
	let droppedComment = false;
	for (const token of tokens) {
		const [type, content] = token;
		if (type === "comment") {
			droppedComment = true;
			continue;
		}
		if (type === "space") {
			pendingSpace = true;
			continue;
		}
		const previous = output[output.length - 1];
		if (previous) {
			if (
				pendingSpace &&
				!STRUCTURAL_TOKENS.has(previous[0]) &&
				!STRUCTURAL_TOKENS.has(type)
			) {
				output.push(["space", " "]);
			} else if (
				!pendingSpace &&
				droppedComment &&
				JOINABLE_TOKENS.has(previous[0]) &&
				JOINABLE_TOKENS.has(type)
			) {
				output.push(["comment", "/**/"]);
			}
		}
		pendingSpace = false;
		droppedComment = false;
		output.push(
			type === "brackets" && !keepsBracketsVerbatim(previous, content)
				? [type, content.replace(/\s+/gu, " ")]
				: [type, content],
		);
	}
	return output.map(([, content]) => content).join("");
}

/**
 * Brackets whose whitespace means something: an unquoted `url(…)`, whose
 * content is the address as written, and any with a backslash escape (an
 * escaped tab is not an escaped space).
 */
function keepsBracketsVerbatim(
	previous: Token | undefined,
	content: string,
): boolean {
	return (
		content.includes("\\") ||
		(previous?.[0] === "word" && /url$/iu.test(previous[1]))
	);
}

/**
 * Parse stylesheet source with postcss, or null when postcss rejects it
 * (the fingerprint still covers the file; only the explanation skips it).
 */
export function parseStylesheet(css: string): Root | null {
	try {
		return postcss.parse(css);
	} catch {
		return null;
	}
}

/**
 * A node back as CSS text with comments left out and whitespace outside
 * strings normalized (`normalizeCssSource` of each selector, at-rule
 * params and declaration value): what it means, not how it is laid out.
 */
export function serializeNormalized(node: ChildNode | Root): string {
	if (node.type === "comment") {
		return "";
	}
	if (node.type === "decl") {
		return `${node.prop}:${normalizeCssSource(node.value)}${node.important ? "!important" : ""};`;
	}
	const children =
		"nodes" in node && node.nodes
			? node.nodes.map((child) => serializeNormalized(child)).join("")
			: null;
	if (node.type === "root") {
		return children ?? "";
	}
	if (node.type === "rule") {
		return `${normalizeCssSource(node.selector)}{${children ?? ""}}`;
	}
	const head = `@${node.name}${node.params ? ` ${normalizeCssSource(node.params)}` : ""}`;
	return children === null ? `${head};` : `${head}{${children}}`;
}

/** The stylesheet an `@import`/`@reference` names: `"x"`, `'x'` or `url(x)`. */
export function readImportTarget(params: string): string | null {
	const match =
		/^(?:"([^"]*)"|'([^']*)'|url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\))/u.exec(
			params.trim(),
		);
	if (!match) return null;
	return match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? null;
}
