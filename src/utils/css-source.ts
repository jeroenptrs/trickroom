/**
 * Reading stylesheet source text: comments, whitespace and a minimal parse
 * into at-rules, rules and declarations. String literals (and `url(…)`) are
 * respected throughout, so a brace, semicolon or comment marker inside a
 * string never counts. No imports, so the Tailwind loader (which the
 * canonicalization worker runs from source) can use it.
 */

export type CssNode =
	| { type: "at-rule"; name: string; params: string; nodes?: CssNode[] }
	| { type: "rule"; selector: string; nodes: CssNode[] }
	| { type: "decl"; prop: string; value: string };

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
 * Parse stylesheet source into a tree of at-rules (`@theme inline { … }`,
 * `@import "x" layer(base);`), rules and declarations, comments removed.
 * Lenient: unbalanced input closes what is open at the end.
 */
export function parseCss(css: string): CssNode[] {
	const source = stripCssComments(css);
	const root: CssNode[] = [];
	const stack: CssNode[][] = [root];
	let buffer = "";
	let quote: string | null = null;
	let parens = 0;

	const current = () => stack[stack.length - 1] as CssNode[];
	const flushStatement = () => {
		const text = buffer.trim();
		buffer = "";
		if (!text) return;
		if (text.startsWith("@")) {
			const { name, params } = splitAtRule(text);
			current().push({ type: "at-rule", name, params });
			return;
		}
		const colon = text.indexOf(":");
		if (colon > 0) {
			current().push({
				type: "decl",
				prop: text.slice(0, colon).trim(),
				value: text.slice(colon + 1).trim(),
			});
		}
	};

	for (let index = 0; index < source.length; index++) {
		const char = source[index] as string;
		if (quote) {
			buffer += char;
			if (char === "\\" && index + 1 < source.length) {
				buffer += source[index + 1];
				index++;
				continue;
			}
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			buffer += char;
			continue;
		}
		if (char === "(") parens++;
		if (char === ")") parens = Math.max(0, parens - 1);
		if (parens > 0) {
			buffer += char;
			continue;
		}
		if (char === ";") {
			flushStatement();
			continue;
		}
		if (char === "{") {
			const text = buffer.trim();
			buffer = "";
			const nodes: CssNode[] = [];
			if (text.startsWith("@")) {
				const { name, params } = splitAtRule(text);
				current().push({ type: "at-rule", name, params, nodes });
			} else {
				current().push({ type: "rule", selector: text, nodes });
			}
			stack.push(nodes);
			continue;
		}
		if (char === "}") {
			flushStatement();
			if (stack.length > 1) stack.pop();
			continue;
		}
		buffer += char;
	}
	flushStatement();
	return root;
}

function splitAtRule(text: string): { name: string; params: string } {
	const match = /^@([\w-]+)\s*([\s\S]*)$/u.exec(text);
	return {
		name: (match?.[1] ?? "").toLowerCase(),
		params: (match?.[2] ?? "").trim(),
	};
}

/** The nodes back as normalized CSS text (`normalizeCssSource` of each part). */
export function serializeCssNodes(nodes: readonly CssNode[]): string {
	return nodes
		.map((node) => {
			if (node.type === "decl") {
				return `${normalizeCssSource(node.prop)}:${normalizeCssSource(node.value)};`;
			}
			if (node.type === "rule") {
				return `${normalizeCssSource(node.selector)}{${serializeCssNodes(node.nodes)}}`;
			}
			const head = `@${node.name}${node.params ? ` ${normalizeCssSource(node.params)}` : ""}`;
			return node.nodes
				? `${head}{${serializeCssNodes(node.nodes)}}`
				: `${head};`;
		})
		.join("");
}

/** Every at-rule named `name`, at any depth, in source order. */
export function findAtRules(
	nodes: readonly CssNode[],
	name: string,
): Extract<CssNode, { type: "at-rule" }>[] {
	const found: Extract<CssNode, { type: "at-rule" }>[] = [];
	for (const node of nodes) {
		if (node.type === "at-rule" && node.name === name) {
			found.push(node);
		}
		if (node.type !== "decl" && node.nodes) {
			found.push(...findAtRules(node.nodes, name));
		}
	}
	return found;
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
