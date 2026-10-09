import type { TailwindDesignSystem } from "./tailwind-design-system-loader.ts";

/**
 * Whether a class and the form Tailwind's canonicalization writes it in
 * compile to the same CSS. `canonicalizeCandidates` is a suggestion, not a
 * proof: its forms can change a selector's specificity
 * (`[[data-panel-open]_&]:hidden` to `in-data-panel-open:hidden`, `:where()`)
 * or match other elements (`max-lg:[&_[aria-label=X]]:!hidden` to
 * `max-lg:**:aria-[aria-label=X]:hidden!`, `[aria-aria-label="X"]`). Both
 * classes are compiled on the same design system and the output compared
 * rule by rule after normalising what cannot change behaviour:
 *
 * - **Selectors**: the class's own selector is one placeholder, whitespace and
 *   attribute quoting are normalised, the simple selectors of a compound are
 *   sorted (the type first, a pseudo-element and what follows it in place), a
 *   redundant `*` is dropped, the arguments of `:is()`, `:where()`, `:not()` and
 *   `:has()` are sorted, and a one-argument `:is(X)` is unwrapped where that
 *   keeps matching and specificity: a compound `X` anywhere
 *   (`:has(:is([data-x]))` is `:has([data-x])`), a complex `X` only in the
 *   first compound of a selector that is not relative (`:is(.x > *)` is
 *   `.x > *`). Everything else must match exactly, so a `:where()` the class
 *   did not have is a difference.
 * - **At-rules and declarations**: in order, with `!important`; at-rule
 *   preludes by text. One exception: `@property` registrations of Tailwind's
 *   own `--tw-*` variables that only the canonical form emits are ignored
 *   (`transform-[…]` registers `--tw-rotate-x` and the like, which
 *   `[transform:…]` does not). A registration sets no style, and every
 *   utility that reads such a variable emits it too; one the canonical form
 *   lacks, or registers differently, is a difference.
 * - **Values**: whitespace, hex case and length, number spelling and `calc()`
 *   over plain numbers and one unit (`calc(1 * -1)` is `-1`). Then a theme
 *   variable outside a math function is replaced by its value: the canonical
 *   form names the token (`bg-white` for `bg-[#FFF]`, `rounded-sm` for
 *   `rounded-[0.25rem]`), which is the point of the suggestion. A theme
 *   variable inside `calc()`, `min()`, `max()` or `clamp()` is arithmetic on
 *   the theme (`w-154` is `calc(var(--spacing) * 154)`): equal to
 *   `w-[38.5rem]` only while `--spacing` is `0.25rem`, so the verdict is
 *   `theme-dependent` with the variables it depends on.
 *
 * Whatever the normalisation cannot decide is `different`, never
 * `equivalent`. Only `.ts` imports, so the canonicalization worker can run
 * this from source.
 */

export type CanonicalVerdict =
	| { status: "equivalent" }
	| { status: "theme-dependent"; themeVariables: string[] }
	| { status: "different"; reason: string };

export type CanonicalizedClass = {
	/** The class as Tailwind writes it; the class itself when it already is canonical or unknown. */
	canonical: string;
	/** How `canonical` compiles against the class; absent when they are the same string. */
	verdict?: CanonicalVerdict;
};

/** Theme variable values by name, as `var()` references spell them. */
export type ThemeValues = (name: string) => string | undefined;

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

type Simple =
	| { kind: "self" }
	| { kind: "type"; name: string }
	| { kind: "class" | "id"; name: string }
	| { kind: "attr"; text: string }
	| { kind: "pseudo-class"; name: string; args?: Complex[]; raw?: string }
	| { kind: "pseudo-element"; name: string; raw?: string }
	| { kind: "nesting" };

type Compound = Simple[];

type Complex = {
	/** A relative selector's leading combinator (`:has(> x)`), else null. */
	leading: string | null;
	compounds: Compound[];
	/** `combinators[i]` joins `compounds[i]` and `compounds[i + 1]`. */
	combinators: string[];
};

/** Pseudo-classes whose argument is a selector list. */
const SELECTOR_LIST_PSEUDOS = new Set(["is", "where", "not", "has", "matches"]);

/** Legacy pseudo-elements written with one colon. */
const LEGACY_PSEUDO_ELEMENTS = new Set([
	"before",
	"after",
	"first-line",
	"first-letter",
]);

const isHex = (char: string) => /[0-9a-f]/iu.test(char);

/** Reads an escape at `start` (the backslash); returns the character and the index after it. */
const readEscape = (text: string, start: number): [string, number] => {
	let index = start + 1;
	let hex = "";
	while (index < text.length && hex.length < 6 && isHex(text[index])) {
		hex += text[index];
		index += 1;
	}
	if (hex) {
		if (/\s/u.test(text[index] ?? "")) index += 1;
		return [String.fromCodePoint(Number.parseInt(hex, 16) || 0xfffd), index];
	}
	return [text[index] ?? "", index + 1];
};

const isIdentChar = (char: string) => /[\w\u00a0-\uffff-]/u.test(char);

/** An identifier at `start`, unescaped; returns it and the index after it. */
const readIdent = (text: string, start: number): [string, number] => {
	let index = start;
	let name = "";
	while (index < text.length) {
		const char = text[index];
		if (char === "\\") {
			const [escaped, next] = readEscape(text, index);
			name += escaped;
			index = next;
		} else if (isIdentChar(char)) {
			name += char;
			index += 1;
		} else {
			break;
		}
	}
	return [name, index];
};

/** The index of the bracket closing the one at `start`, skipping strings and escapes. */
const findClosing = (text: string, start: number): number => {
	const open = text[start];
	const close = open === "(" ? ")" : "]";
	let depth = 0;
	for (let index = start; index < text.length; index += 1) {
		const char = text[index];
		if (char === "\\") {
			index += 1;
		} else if (char === '"' || char === "'") {
			index = findStringEnd(text, index);
		} else if (char === open) {
			depth += 1;
		} else if (char === close) {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	throw new Error(`Unbalanced "${open}" in "${text}"`);
};

const findStringEnd = (text: string, start: number): number => {
	const quote = text[start];
	for (let index = start + 1; index < text.length; index += 1) {
		if (text[index] === "\\") index += 1;
		else if (text[index] === quote) return index;
	}
	throw new Error(`Unterminated string in "${text}"`);
};

const unquote = (value: string) => {
	const trimmed = value.trim();
	if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
		let out = "";
		for (let index = 1; index < trimmed.length - 1; index += 1) {
			if (trimmed[index] === "\\") {
				const [escaped, next] = readEscape(trimmed, index);
				out += escaped;
				index = next - 1;
			} else {
				out += trimmed[index];
			}
		}
		return out;
	}
	return readIdent(trimmed, 0)[0];
};

/** `[name op value flag]` with the value quoted the same way every time. */
const normalizeAttribute = (inner: string): string => {
	const match =
		/^\s*((?:\\.|[^~|^$*=\s])+)\s*(?:([~|^$*]?=)\s*(.*?))?\s*$/su.exec(inner);
	if (!match) return `[${inner.trim()}]`;
	const name = readIdent(match[1], 0)[0] || match[1];
	if (!match[2]) return `[${name}]`;
	let rest = match[3];
	let flag = "";
	const flagMatch = /\s+([is])$/iu.exec(rest);
	if (flagMatch && !/^["']/u.test(rest.slice(flagMatch.index).trim())) {
		flag = ` ${flagMatch[1].toLowerCase()}`;
		rest = rest.slice(0, flagMatch.index);
	}
	return `[${name}${match[2]}${JSON.stringify(unquote(rest))}${flag}]`;
};

const parseSelectorList = (
	text: string,
	self: string,
	relative = false,
): Complex[] => {
	const list: Complex[] = [];
	let complex: Complex = { leading: null, compounds: [], combinators: [] };
	let compound: Compound = [];
	let pendingCombinator: string | null = null;

	const closeCompound = () => {
		if (compound.length === 0) return;
		if (complex.compounds.length === 0) {
			if (pendingCombinator && pendingCombinator !== " ") {
				complex.leading = pendingCombinator;
			}
		} else {
			complex.combinators.push(pendingCombinator ?? " ");
		}
		complex.compounds.push(compound);
		compound = [];
		pendingCombinator = null;
	};
	const closeComplex = () => {
		closeCompound();
		if (complex.compounds.length === 0) {
			throw new Error(`Empty selector in "${text}"`);
		}
		if (relative && complex.leading === null) complex.leading = " ";
		list.push(complex);
		complex = { leading: null, compounds: [], combinators: [] };
		pendingCombinator = null;
	};

	let index = 0;
	while (index < text.length) {
		const char = text[index];
		if (/\s/u.test(char)) {
			if (compound.length > 0) closeCompound();
			if (complex.compounds.length > 0 || relative) {
				pendingCombinator ??= " ";
			}
			index += 1;
		} else if (char === ">" || char === "+" || char === "~") {
			if (compound.length > 0) closeCompound();
			pendingCombinator = char;
			index += 1;
		} else if (char === ",") {
			closeComplex();
			index += 1;
		} else if (char === ".") {
			const [name, next] = readIdent(text, index + 1);
			compound.push(name === self ? { kind: "self" } : { kind: "class", name });
			index = next;
		} else if (char === "#") {
			const [name, next] = readIdent(text, index + 1);
			compound.push({ kind: "id", name });
			index = next;
		} else if (char === "[") {
			const end = findClosing(text, index);
			compound.push({
				kind: "attr",
				text: normalizeAttribute(text.slice(index + 1, end)),
			});
			index = end + 1;
		} else if (char === "*") {
			compound.push({ kind: "type", name: "*" });
			index += 1;
		} else if (char === "&") {
			compound.push({ kind: "nesting" });
			index += 1;
		} else if (char === ":") {
			const element = text[index + 1] === ":";
			const [rawName, next] = readIdent(text, index + (element ? 2 : 1));
			const name = rawName.toLowerCase();
			index = next;
			let argText: string | undefined;
			if (text[index] === "(") {
				const end = findClosing(text, index);
				argText = text.slice(index + 1, end);
				index = end + 1;
			}
			if (element || LEGACY_PSEUDO_ELEMENTS.has(name)) {
				compound.push({
					kind: "pseudo-element",
					name,
					...(argText === undefined ? {} : { raw: collapse(argText) }),
				});
			} else if (argText !== undefined && SELECTOR_LIST_PSEUDOS.has(name)) {
				compound.push({
					kind: "pseudo-class",
					name,
					args: parseSelectorList(argText, self, name === "has"),
				});
			} else {
				compound.push({
					kind: "pseudo-class",
					name,
					...(argText === undefined ? {} : { raw: collapse(argText) }),
				});
			}
		} else if (isIdentChar(char) || char === "\\") {
			const [name, next] = readIdent(text, index);
			compound.push({ kind: "type", name: name.toLowerCase() });
			index = next;
		} else {
			throw new Error(`Unexpected "${char}" in selector "${text}"`);
		}
	}
	closeComplex();
	return list;
};

const collapse = (text: string) => text.trim().replace(/\s+/gu, " ");

const serializeSimple = (simple: Simple): string => {
	switch (simple.kind) {
		case "self":
			return "&";
		case "nesting":
			return "&&";
		case "type":
			return simple.name;
		case "class":
			return `.${JSON.stringify(simple.name)}`;
		case "id":
			return `#${JSON.stringify(simple.name)}`;
		case "attr":
			return simple.text;
		case "pseudo-element":
			return `::${simple.name}${simple.raw === undefined ? "" : `(${simple.raw})`}`;
		case "pseudo-class":
			if (simple.args) {
				return `:${simple.name}(${simple.args.map(serializeComplex).join(", ")})`;
			}
			return `:${simple.name}${simple.raw === undefined ? "" : `(${simple.raw})`}`;
	}
};

const serializeCompound = (compound: Compound) =>
	compound.map(serializeSimple).join("");

const serializeComplex = (complex: Complex): string => {
	let out = complex.leading ? `${complex.leading.trim()} `.trimStart() : "";
	complex.compounds.forEach((compound, index) => {
		if (index > 0) {
			const combinator = complex.combinators[index - 1];
			out += combinator === " " ? " " : ` ${combinator} `;
		}
		out += serializeCompound(compound);
	});
	return out;
};

/** A single-argument `:is()` whose argument is one compound. */
const unwrapCompoundIs = (simple: Simple): Simple[] | null => {
	if (simple.kind !== "pseudo-class" || simple.name !== "is") return null;
	const [only, ...rest] = simple.args ?? [];
	if (!only || rest.length > 0 || only.leading) return null;
	return only.compounds.length === 1 ? only.compounds[0] : null;
};

/** The type first, then the other simple selectors sorted, then a pseudo-element and what follows it as written. */
const normalizeCompound = (compound: Compound): Compound => {
	const flat: Simple[] = [];
	for (const simple of compound) {
		const inner = unwrapCompoundIs(simple);
		if (inner) flat.push(...inner);
		else flat.push(simple);
	}
	const tailStart = flat.findIndex(
		(simple) => simple.kind === "pseudo-element",
	);
	const head = tailStart === -1 ? flat : flat.slice(0, tailStart);
	const tail = tailStart === -1 ? [] : flat.slice(tailStart);
	const types = head.filter((simple) => simple.kind === "type");
	const others = head
		.filter((simple) => simple.kind !== "type")
		.sort((a, b) => compareText(serializeSimple(a), serializeSimple(b)));
	// `*` adds nothing next to another simple selector.
	const kept =
		types.length > 0 && types.length + others.length + tail.length > 1
			? types.filter((simple) => simple.kind === "type" && simple.name !== "*")
			: types;
	const result = [...kept, ...others, ...tail];
	return result.length > 0 ? result : [{ kind: "type", name: "*" }];
};

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const normalizeSimpleArgs = (simple: Simple): Simple => {
	if (simple.kind !== "pseudo-class" || !simple.args) return simple;
	const args = simple.args.map(normalizeComplex);
	const byText = new Map(args.map((arg) => [serializeComplex(arg), arg]));
	return {
		...simple,
		args: [...byText.keys()].sort(compareText).map((key) => {
			const arg = byText.get(key);
			if (!arg) throw new Error("unreachable");
			return arg;
		}),
	};
};

/**
 * `:is(A > B)C D` matches what `A > BC D` matches, with the same specificity,
 * when the `:is()` sits in the first compound of a selector that is not
 * relative; expanded one at a time until none is left.
 */
const expandLeadingIs = (complex: Complex): Complex => {
	if (complex.leading !== null) return complex;
	const [first, ...restCompounds] = complex.compounds;
	const at = first.findIndex((simple) => {
		if (simple.kind !== "pseudo-class" || simple.name !== "is") return false;
		const args = simple.args ?? [];
		return args.length === 1 && args[0].leading === null;
	});
	if (at === -1) return complex;
	const target = first[at];
	if (target.kind !== "pseudo-class" || !target.args) return complex;
	const inner = target.args[0];
	const others = first.filter((_, index) => index !== at);
	const innerLast = inner.compounds[inner.compounds.length - 1];
	return expandLeadingIs({
		leading: null,
		compounds: [
			...inner.compounds.slice(0, -1),
			[...innerLast, ...others],
			...restCompounds,
		],
		combinators: [...inner.combinators, ...complex.combinators],
	});
};

const normalizeComplex = (complex: Complex): Complex => {
	const withArgs: Complex = {
		...complex,
		compounds: complex.compounds.map((compound) =>
			compound.map(normalizeSimpleArgs),
		),
	};
	const expanded = expandLeadingIs(withArgs);
	return {
		...expanded,
		compounds: expanded.compounds.map(normalizeCompound),
	};
};

/** Specificity as [ids, classes, types]: `:where()` counts nothing, `:is()`, `:not()` and `:has()` their most specific argument. */
export const selectorSpecificity = (
	selector: string,
	self = "",
): [number, number, number] =>
	maxSpecificity(parseSelectorList(selector, self));

type Specificity = [number, number, number];

const maxSpecificity = (list: Complex[]): Specificity =>
	list
		.map(complexSpecificity)
		.reduce<Specificity>(
			(best, next) => (compareSpecificity(next, best) > 0 ? next : best),
			[0, 0, 0],
		);

const compareSpecificity = (a: Specificity, b: Specificity) =>
	a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const complexSpecificity = (complex: Complex): Specificity => {
	const total: Specificity = [0, 0, 0];
	for (const compound of complex.compounds) {
		for (const simple of compound) {
			const add = simpleSpecificity(simple);
			total[0] += add[0];
			total[1] += add[1];
			total[2] += add[2];
		}
	}
	return total;
};

const simpleSpecificity = (simple: Simple): Specificity => {
	switch (simple.kind) {
		case "id":
			return [1, 0, 0];
		case "self":
		case "class":
		case "attr":
			return [0, 1, 0];
		case "type":
			return simple.name === "*" ? [0, 0, 0] : [0, 0, 1];
		case "pseudo-element":
			return [0, 0, 1];
		case "nesting":
			return [0, 0, 0];
		case "pseudo-class":
			if (simple.name === "where") return [0, 0, 0];
			if (simple.args) return maxSpecificity(simple.args);
			return [0, 1, 0];
	}
};

/** The selector with the class as `&`, normalised, and its specificity. */
const normalizeSelector = (selector: string, self: string) => {
	const list = parseSelectorList(selector, self).map(normalizeComplex);
	const texts = [...new Set(list.map(serializeComplex))].sort(compareText);
	return {
		text: texts.join(", "),
		specificity: maxSpecificity(list),
	};
};

// ---------------------------------------------------------------------------
// Stylesheets
// ---------------------------------------------------------------------------

type CssBlock = { prelude: string; children: CssNode[] };
type CssNode =
	| { type: "block"; block: CssBlock }
	| {
			type: "declaration";
			property: string;
			value: string;
			important: boolean;
	  };

/** Tailwind's `candidatesToCss` output as a tree of blocks and declarations. */
const parseCss = (css: string): CssNode[] => {
	const root: CssBlock = { prelude: "", children: [] };
	const stack: CssBlock[] = [root];
	let buffer = "";
	const flushDeclaration = () => {
		const text = buffer.trim();
		buffer = "";
		if (!text) return;
		const colon = text.indexOf(":");
		if (colon === -1) {
			throw new Error(`Unexpected "${text}" in compiled CSS`);
		}
		let value = text.slice(colon + 1).trim();
		const important = /!\s*important$/iu.test(value);
		if (important) value = value.replace(/!\s*important$/iu, "").trim();
		stack[stack.length - 1].children.push({
			type: "declaration",
			property: text.slice(0, colon).trim(),
			value,
			important,
		});
	};
	for (let index = 0; index < css.length; index += 1) {
		const char = css[index];
		if (char === "\\") {
			buffer += css.slice(index, index + 2);
			index += 1;
		} else if (char === '"' || char === "'") {
			const end = findStringEnd(css, index);
			buffer += css.slice(index, end + 1);
			index = end;
		} else if (char === "/" && css[index + 1] === "*") {
			const end = css.indexOf("*/", index + 2);
			index = end === -1 ? css.length : end + 1;
		} else if (char === "(") {
			const end = findClosing(css, index);
			buffer += css.slice(index, end + 1);
			index = end;
		} else if (char === "{") {
			const block: CssBlock = { prelude: buffer.trim(), children: [] };
			buffer = "";
			stack[stack.length - 1].children.push({ type: "block", block });
			stack.push(block);
		} else if (char === "}") {
			flushDeclaration();
			if (stack.length === 1) throw new Error("Unbalanced } in compiled CSS");
			stack.pop();
		} else if (char === ";") {
			flushDeclaration();
		} else {
			buffer += char;
		}
	}
	if (stack.length !== 1 || buffer.trim()) {
		throw new Error("Unbalanced compiled CSS");
	}
	return root.children;
};

type Entry = {
	/** At-rule preludes and normalised selectors, outermost first. */
	context: string[];
	specificity: Specificity | null;
	/** The selector of the innermost style rule as compiled, for messages. */
	selector: string | null;
	property: string;
	important: boolean;
	value: string;
};

const flatten = (nodes: CssNode[], self: string): Entry[] => {
	const entries: Entry[] = [];
	const walk = (
		list: CssNode[],
		context: string[],
		specificity: Specificity | null,
		selector: string | null,
	) => {
		for (const node of list) {
			if (node.type === "declaration") {
				entries.push({
					context,
					specificity,
					selector,
					property: node.property.startsWith("--")
						? node.property
						: node.property.toLowerCase(),
					important: node.important,
					value: node.value,
				});
				continue;
			}
			const { prelude, children } = node.block;
			if (prelude.startsWith("@")) {
				walk(children, [...context, collapse(prelude)], specificity, selector);
			} else {
				const normalized = normalizeSelector(prelude, self);
				walk(
					children,
					[...context, normalized.text],
					normalized.specificity,
					collapse(prelude),
				);
			}
		}
	};
	walk(nodes, [], null, null);
	return entries;
};

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const MATH_FUNCTIONS = new Set(["calc", "min", "max", "clamp"]);

/** Whitespace, hex colours and number spelling, outside strings. */
const normalizeValueText = (value: string): string =>
	value
		.split(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/u)
		.map((part, index) => {
			if (index % 2 === 1) return part;
			return collapse(part)
				.replace(/\(\s+/gu, "(")
				.replace(/\s+\)/gu, ")")
				.replace(/\s*,\s*/gu, ", ")
				.replace(/#([0-9a-f]{3,8})\b/giu, (_, hex: string) => {
					const lower = hex.toLowerCase();
					return `#${
						lower.length === 3 || lower.length === 4
							? [...lower].map((digit) => digit + digit).join("")
							: lower
					}`;
				})
				.replace(
					/(?<![\w#.-])(-?)(\d*\.?\d+)(?![\d.])/gu,
					(_, sign: string, number: string) =>
						formatNumber(Number(`${sign}${number}`)),
				);
		})
		.join("");

const formatNumber = (value: number) => {
	const rounded = Number(value.toFixed(6));
	return Object.is(rounded, -0) ? "0" : String(rounded);
};

type Quantity = { value: number; unit: string };

/** Evaluates `calc()` over numbers and one unit; anything else is left as written. */
const evaluateCalc = (value: string): string => {
	let out = "";
	let index = 0;
	while (index < value.length) {
		const match = /\bcalc\(/iu.exec(value.slice(index));
		if (!match) {
			out += value.slice(index);
			break;
		}
		const start = index + match.index;
		const open = start + match[0].length - 1;
		const close = findClosing(value, open);
		const inner = evaluateCalc(value.slice(open + 1, close));
		const result = evaluateExpression(inner);
		out += value.slice(index, start);
		out += result
			? `${formatNumber(result.value)}${result.unit}`
			: `calc(${inner})`;
		index = close + 1;
	}
	return out;
};

const evaluateExpression = (text: string): Quantity | null => {
	const tokens: Array<Quantity | string> = [];
	const pattern =
		/\s*(?:([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)|([-+*/()]))/iuy;
	let index = 0;
	while (index < text.length) {
		pattern.lastIndex = index;
		const match = pattern.exec(text);
		if (!match) {
			if (/^\s*$/u.test(text.slice(index))) break;
			return null;
		}
		index = pattern.lastIndex;
		if (match[3]) tokens.push(match[3]);
		else {
			// `a -1` is an operand after an operand: a sign glued to a number
			// following another operand is an operator.
			const previous = tokens[tokens.length - 1];
			if (
				previous !== undefined &&
				(typeof previous !== "string" || previous === ")") &&
				/^[+-]/u.test(match[1])
			) {
				tokens.push(match[1][0]);
				tokens.push({
					value: Number(match[1].slice(1)),
					unit: match[2].toLowerCase(),
				});
			} else {
				tokens.push({ value: Number(match[1]), unit: match[2].toLowerCase() });
			}
		}
	}
	let position = 0;
	const peek = () => tokens[position];
	const parseSum = (): Quantity | null => {
		let left = parseProduct();
		while (left && (peek() === "+" || peek() === "-")) {
			const op = tokens[position++];
			const right = parseProduct();
			if (!right) return null;
			if (left.unit !== right.unit) return null;
			left = {
				value: op === "+" ? left.value + right.value : left.value - right.value,
				unit: left.unit,
			};
		}
		return left;
	};
	const parseProduct = (): Quantity | null => {
		let left = parseFactor();
		while (left && (peek() === "*" || peek() === "/")) {
			const op = tokens[position++];
			const right = parseFactor();
			if (!right) return null;
			if (op === "*") {
				if (left.unit && right.unit) return null;
				left = {
					value: left.value * right.value,
					unit: left.unit || right.unit,
				};
			} else {
				if (right.unit || right.value === 0) return null;
				left = { value: left.value / right.value, unit: left.unit };
			}
		}
		return left;
	};
	const parseFactor = (): Quantity | null => {
		const token = tokens[position++];
		if (token === "(") {
			const inner = parseSum();
			if (tokens[position++] !== ")") return null;
			return inner;
		}
		if (token === "-") {
			const inner = parseFactor();
			return inner ? { value: -inner.value, unit: inner.unit } : null;
		}
		if (token === undefined || typeof token === "string") return null;
		return token;
	};
	const result = parseSum();
	return result && position === tokens.length ? result : null;
};

/**
 * Replaces theme variables with their values: outside math functions only
 * (`"tokens"`), or everywhere (`"all"`). Records the names replaced.
 */
const substituteTheme = (
	value: string,
	theme: ThemeValues,
	mode: "tokens" | "all",
	used: Set<string>,
): string => {
	let current = value;
	for (let round = 0; round < 8; round += 1) {
		const next = substituteOnce(current, theme, mode, used);
		if (next === current) return current;
		current = next;
	}
	return current;
};

const substituteOnce = (
	value: string,
	theme: ThemeValues,
	mode: "tokens" | "all",
	used: Set<string>,
): string => {
	let out = "";
	// Function names of the open parentheses, innermost last.
	const functions: string[] = [];
	let index = 0;
	while (index < value.length) {
		const char = value[index];
		if (char === '"' || char === "'") {
			const end = findStringEnd(value, index);
			out += value.slice(index, end + 1);
			index = end + 1;
			continue;
		}
		const call = /^([\w-]+)\(/u.exec(value.slice(index));
		if (call && (index === 0 || !/[\w-]/u.test(value[index - 1]))) {
			const name = call[1].toLowerCase();
			if (name === "var") {
				const close = findClosing(value, index + call[0].length - 1);
				const inner = value.slice(index + call[0].length, close);
				const comma = inner.indexOf(",");
				const variable = (comma === -1 ? inner : inner.slice(0, comma)).trim();
				const replacement = theme(variable);
				const insideMath = functions.some((fn) => MATH_FUNCTIONS.has(fn));
				if (replacement !== undefined && (mode === "all" || !insideMath)) {
					used.add(variable);
					out += replacement;
					index = close + 1;
					continue;
				}
			}
			functions.push(name);
			out += call[0];
			index += call[0].length;
			continue;
		}
		if (char === "(") functions.push("");
		if (char === ")") functions.pop();
		out += char;
		index += 1;
	}
	return out;
};

const normalizeValue = (value: string) =>
	normalizeValueText(evaluateCalc(normalizeValueText(value)));

type ValueComparison =
	| { status: "equal" }
	| { status: "theme"; variables: string[] }
	| { status: "different" };

const compareValues = (
	original: string,
	canonical: string,
	theme: ThemeValues,
): ValueComparison => {
	if (normalizeValue(original) === normalizeValue(canonical)) {
		return { status: "equal" };
	}
	const resolve = (value: string, mode: "tokens" | "all", used: Set<string>) =>
		normalizeValue(
			substituteTheme(normalizeValueText(value), theme, mode, used),
		);
	if (
		resolve(original, "tokens", new Set()) ===
		resolve(canonical, "tokens", new Set())
	) {
		return { status: "equal" };
	}
	const usedByOriginal = new Set<string>();
	const usedByCanonical = new Set<string>();
	if (
		resolve(original, "all", usedByOriginal) ===
		resolve(canonical, "all", usedByCanonical)
	) {
		const variables = [
			...[...usedByCanonical].filter((name) => !usedByOriginal.has(name)),
			...[...usedByOriginal].filter((name) => !usedByCanonical.has(name)),
		];
		return { status: "theme", variables };
	}
	return { status: "different" };
};

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const formatSpecificity = (specificity: Specificity | null) =>
	specificity ? specificity.join(",") : "none";

const describeEntry = (entry: Entry) =>
	`${entry.property}: ${entry.value}${entry.important ? " !important" : ""}`;

/**
 * Compares the compiled CSS of a class and of its canonical form (Tailwind's
 * `candidatesToCss` output for each, null when it compiles to nothing).
 */
export const compareCompiledClasses = (
	original: { candidate: string; css: string | null },
	canonical: { candidate: string; css: string | null },
	theme: ThemeValues,
): CanonicalVerdict => {
	if (canonical.css === null || !canonical.css.trim()) {
		return { status: "different", reason: "compiles to no CSS" };
	}
	if (original.css === null || !original.css.trim()) {
		return {
			status: "different",
			reason: "the class it replaces compiles to no CSS",
		};
	}
	let before: Entry[];
	let after: Entry[];
	try {
		before = flatten(parseCss(original.css), original.candidate);
		after = withoutExtraRegistrations(
			flatten(parseCss(canonical.css), canonical.candidate),
			before,
		);
	} catch (error) {
		return {
			status: "different",
			reason: `its CSS could not be compared (${error instanceof Error ? error.message : String(error)})`,
		};
	}
	if (before.length !== after.length) {
		return {
			status: "different",
			reason: `emits ${after.length} declarations where the class emits ${before.length}`,
		};
	}
	const themeVariables = new Set<string>();
	for (let index = 0; index < before.length; index += 1) {
		const was = before[index];
		const is = after[index];
		if (was.context.join("\u0000") !== is.context.join("\u0000")) {
			const selectorChanged =
				was.context.length === is.context.length &&
				was.selector !== null &&
				is.selector !== null;
			if (selectorChanged) {
				const specificityNote =
					compareSpecificity(
						was.specificity ?? [0, 0, 0],
						is.specificity ?? [0, 0, 0],
					) === 0
						? ""
						: ` (specificity ${formatSpecificity(was.specificity)} becomes ${formatSpecificity(is.specificity)})`;
				return {
					status: "different",
					reason: `applies under "${is.context.at(-1)}" where the class applies under "${was.context.at(-1)}"${specificityNote}`,
				};
			}
			return {
				status: "different",
				reason: `applies under "${is.context.join(" ")}" where the class applies under "${was.context.join(" ")}"`,
			};
		}
		if (was.property !== is.property || was.important !== is.important) {
			return {
				status: "different",
				reason: `declares "${describeEntry(is)}" where the class declares "${describeEntry(was)}"`,
			};
		}
		const values = compareValues(was.value, is.value, theme);
		if (values.status === "different") {
			return {
				status: "different",
				reason: `declares "${describeEntry(is)}" where the class declares "${describeEntry(was)}"`,
			};
		}
		if (values.status === "theme") {
			for (const name of values.variables) themeVariables.add(name);
		}
	}
	if (themeVariables.size > 0) {
		return {
			status: "theme-dependent",
			themeVariables: [...themeVariables].sort(compareText),
		};
	}
	return { status: "equivalent" };
};

/** The `@property --tw-*` rule an entry belongs to, if any. */
const tailwindRegistration = (entry: Entry) => {
	const at = entry.context[0];
	return entry.context.length === 1 && /^@property --tw-/u.test(at) ? at : null;
};

/** Drops the canonical side's `@property --tw-*` rules the class does not emit. */
const withoutExtraRegistrations = (after: Entry[], before: Entry[]) => {
	const registered = new Set(before.map(tailwindRegistration));
	return after.filter((entry) => {
		const registration = tailwindRegistration(entry);
		return registration === null || registered.has(registration);
	});
};

const themeLookups = new WeakMap<TailwindDesignSystem, ThemeValues>();

/** The theme variables of a compiled system, by the name `var()` uses. */
export const themeValuesOf = (
	designSystem: TailwindDesignSystem,
): ThemeValues => {
	let lookup = themeLookups.get(designSystem);
	if (!lookup) {
		const values = new Map<string, string>();
		for (const [key, entry] of designSystem.theme.entries()) {
			values.set(
				designSystem.theme.prefixKey(key as `--${string}`),
				entry.value,
			);
			values.set(key, entry.value);
		}
		lookup = (name) => values.get(name);
		themeLookups.set(designSystem, lookup);
	}
	return lookup;
};

/**
 * The class as Tailwind writes it (`canonicalizeCandidates`, see
 * `canonicalizeTailwindCandidate`) and, when that differs, whether both
 * compile to the same CSS on this system.
 */
export const canonicalizeAndVerifyTailwindCandidate = (
	designSystem: TailwindDesignSystem,
	candidate: string,
	canonicalize: (
		designSystem: TailwindDesignSystem,
		candidate: string,
	) => string,
): CanonicalizedClass => {
	const canonical = canonicalize(designSystem, candidate);
	if (canonical === candidate) return { canonical };
	const compile = (value: string) => {
		try {
			return designSystem.candidatesToCss([value])[0] ?? null;
		} catch {
			return null;
		}
	};
	return {
		canonical,
		verdict: compareCompiledClasses(
			{ candidate, css: compile(candidate) },
			{ candidate: canonical, css: compile(canonical) },
			themeValuesOf(designSystem),
		),
	};
};
