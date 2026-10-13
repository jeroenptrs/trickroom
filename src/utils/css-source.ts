import postcss, { type ChildNode, type Root } from "postcss";

/**
 * Reading stylesheet source text. Parsing is postcss's; what is ours is the
 * plain-text normalization the stylesheet fingerprint hashes (comments and
 * whitespace outside strings, so a brace, semicolon or comment marker inside
 * a string never counts) and reading the target out of an `@import`'s
 * params, which postcss leaves as a raw string.
 */

/** Remove `/* … *\/` comments outside strings, leaving a space in their place. */
export function stripCssComments(css: string): string {
	let result = "";
	let index = 0;
	let quote: string | null = null;
	while (index < css.length) {
		const char = css[index] as string;
		if (quote) {
			result += char;
			if (char === "\\" && index + 1 < css.length) {
				result += css[index + 1];
				index += 2;
				continue;
			}
			if (char === quote) quote = null;
			index++;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			result += char;
			index++;
			continue;
		}
		if (char === "/" && css[index + 1] === "*") {
			const end = css.indexOf("*/", index + 2);
			index = end === -1 ? css.length : end + 2;
			result += " ";
			continue;
		}
		result += char;
		index++;
	}
	return result;
}

// Whitespace next to these never changes what CSS means.
const NO_SPACE_BEFORE = new Set(["{", "}", ";", ",", ")"]);
const NO_SPACE_AFTER = new Set(["{", "}", ";", ",", "(", ":"]);

/**
 * Comments and whitespace outside strings normalized away: comments
 * removed, runs of whitespace collapsed to one space, and dropped next to
 * `{ } ; , )` and after `( :`. Nothing else changes, so two sources with the
 * same normalized text are the same CSS. Whitespace before `:` is kept
 * (`a :hover` is not `a:hover`).
 */
export function normalizeCssSource(css: string): string {
	const source = stripCssComments(css);
	let result = "";
	let pendingSpace = false;
	let quote: string | null = null;
	for (let index = 0; index < source.length; index++) {
		const char = source[index] as string;
		if (quote) {
			result += char;
			if (char === "\\" && index + 1 < source.length) {
				result += source[index + 1];
				index++;
				continue;
			}
			if (char === quote) quote = null;
			continue;
		}
		if (/\s/u.test(char)) {
			pendingSpace = true;
			continue;
		}
		if (pendingSpace) {
			const previous = result[result.length - 1];
			if (
				result.length > 0 &&
				!NO_SPACE_AFTER.has(previous as string) &&
				!NO_SPACE_BEFORE.has(char)
			) {
				result += " ";
			}
			pendingSpace = false;
		}
		if (char === '"' || char === "'") {
			quote = char;
		}
		result += char;
	}
	return result;
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
