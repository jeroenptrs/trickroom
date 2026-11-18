/**
 * UI copy in JSX, for the text rules (`code.text-pattern`): the text
 * children of an element and the string values of its attributes, read
 * syntactically like the rest of the source model. Pure.
 *
 * - Text children are written as React renders them: lines trimmed, empty
 *   lines dropped, the rest joined with one space, HTML entities decoded
 *   (`&mdash;` is `—`).
 * - A child or attribute expression contributes its string literals and
 *   templates without interpolations, through parentheses, TypeScript
 *   casts, conditionals (`a ? "Yes" : "No"`) and logical expressions
 *   (`busy && "Saving"`). Anything else (identifiers, calls, `t("key")`)
 *   is not read.
 */

import type { SourcePosition } from "./parse";

export type SourceTextOrigin =
	/** A text child, or a literal in a `{…}` child, of `element`. */
	| { kind: "jsx-text"; element: string }
	/** The string value of an attribute of `element` (never `className`). */
	| { kind: "jsx-attribute"; element: string; attribute: string };

export type SourceText = {
	value: string;
	origin: SourceTextOrigin;
	/** The first character of the text, or of the literal. */
	position: SourcePosition;
};

type AstNode = { type: string; start: number; end: number } & Record<
	string,
	unknown
>;

const isNode = (value: unknown): value is AstNode =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { type?: unknown }).type === "string";

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	ndash: "–",
	mdash: "—",
	hellip: "…",
	middot: "·",
	bull: "•",
	rarr: "→",
	larr: "←",
	harr: "↔",
	rArr: "⇒",
	lArr: "⇐",
	lsquo: "‘",
	rsquo: "’",
	ldquo: "“",
	rdquo: "”",
	laquo: "«",
	raquo: "»",
	times: "×",
	copy: "©",
	reg: "®",
	trade: "™",
};

/** HTML entities as JSX decodes them in text and attribute strings. */
export const decodeJsxEntities = (text: string): string =>
	text.replace(
		/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/giu,
		(whole, body: string) => {
			if (body[0] === "#") {
				const code =
					body[1] === "x" || body[1] === "X"
						? Number.parseInt(body.slice(2), 16)
						: Number.parseInt(body.slice(1), 10);
				return Number.isFinite(code) && code <= 0x10ffff
					? String.fromCodePoint(code)
					: whole;
			}
			return NAMED_ENTITIES[body] ?? whole;
		},
	);

/** A JSX text child as React renders it, and the offset of its first character. */
export const normalizeJsxText = (
	raw: string,
): { value: string; offset: number } | null => {
	const lines = raw.split(/\r\n|\n|\r/u);
	const kept: string[] = [];
	for (const [index, line] of lines.entries()) {
		// Whitespace that touches a line break is dropped; within a line it stays.
		let text = line;
		if (index > 0) text = text.replace(/^[ \t]+/u, "");
		if (index < lines.length - 1) text = text.replace(/[ \t]+$/u, "");
		if (text.length > 0) kept.push(text);
	}
	const value = decodeJsxEntities(kept.join(" "));
	if (value.trim().length === 0) return null;
	const offset = raw.search(/\S/u);
	return { value, offset: offset === -1 ? 0 : offset };
};

const UNWRAPPED = new Set([
	"ParenthesizedExpression",
	"TSAsExpression",
	"TSSatisfiesExpression",
	"TSNonNullExpression",
	"TSTypeAssertion",
]);

/** String literals an expression may evaluate to, with their start offsets. */
const literalStrings = (
	node: AstNode,
	out: Array<{ value: string; start: number }>,
) => {
	let current = node;
	while (UNWRAPPED.has(current.type) && isNode(current.expression)) {
		current = current.expression;
	}
	switch (current.type) {
		case "Literal":
			if (typeof current.value === "string") {
				out.push({ value: current.value, start: current.start + 1 });
			}
			return;
		case "TemplateLiteral": {
			const quasis = current.quasis as AstNode[] | undefined;
			const expressions = current.expressions as AstNode[] | undefined;
			if (expressions?.length === 0 && quasis?.length === 1) {
				const cooked = (quasis[0].value as { cooked?: string } | undefined)
					?.cooked;
				if (typeof cooked === "string") {
					out.push({ value: cooked, start: current.start + 1 });
				}
			}
			return;
		}
		case "ConditionalExpression":
			if (isNode(current.consequent)) literalStrings(current.consequent, out);
			if (isNode(current.alternate)) literalStrings(current.alternate, out);
			return;
		case "LogicalExpression":
			// `a && "x"` renders "x" or nothing; `a || "x"` and `a ?? "x"` either side.
			if (current.operator !== "&&" && isNode(current.left)) {
				literalStrings(current.left, out);
			}
			if (isNode(current.right)) literalStrings(current.right, out);
			return;
		case "JSXExpressionContainer":
			if (isNode(current.expression)) literalStrings(current.expression, out);
			return;
		default:
			return;
	}
};

/** Attributes that are never copy. */
const SKIPPED_ATTRIBUTES = new Set(["className", "class", "style", "key"]);

/**
 * The texts of one JSX element or fragment: its attributes' string values
 * (for an element) and its direct children. `element` is the element's name,
 * `<>` for a fragment.
 */
export const collectJsxTexts = (
	node: AstNode,
	element: string,
	position: (offset: number) => SourcePosition,
	attributeName: (attribute: AstNode) => string | null,
): SourceText[] => {
	const texts: SourceText[] = [];
	const opening = isNode(node.openingElement) ? node.openingElement : null;
	for (const attribute of (opening?.attributes as AstNode[] | undefined) ??
		[]) {
		if (attribute.type !== "JSXAttribute" || !isNode(attribute.value)) continue;
		const name = attributeName(attribute);
		if (name === null || SKIPPED_ATTRIBUTES.has(name)) continue;
		const found: Array<{ value: string; start: number }> = [];
		literalStrings(attribute.value, found);
		for (const entry of found) {
			// A quoted attribute value is not unescaped by the parser.
			const value =
				attribute.value.type === "Literal"
					? decodeJsxEntities(entry.value)
					: entry.value;
			if (value.trim().length === 0) continue;
			texts.push({
				value,
				origin: { kind: "jsx-attribute", element, attribute: name },
				position: position(entry.start),
			});
		}
	}
	for (const child of (node.children as AstNode[] | undefined) ?? []) {
		if (child.type === "JSXText" && typeof child.value === "string") {
			const normalized = normalizeJsxText(child.value);
			if (normalized) {
				texts.push({
					value: normalized.value,
					origin: { kind: "jsx-text", element },
					position: position(child.start + normalized.offset),
				});
			}
		} else if (child.type === "JSXExpressionContainer") {
			const found: Array<{ value: string; start: number }> = [];
			literalStrings(child, found);
			for (const entry of found) {
				if (entry.value.trim().length === 0) continue;
				texts.push({
					value: entry.value,
					origin: { kind: "jsx-text", element },
					position: position(entry.start),
				});
			}
		}
	}
	return texts;
};
