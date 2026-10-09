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
 *   `:has()` are sorted, and a one-argument `:is(X)` without a pseudo-element
 *   is unwrapped where that keeps matching and specificity: a compound `X`
 *   anywhere (`:has(:is([data-x]))` is `:has([data-x])`), a complex `X` only in
 *   the first compound of a selector that is not relative (`:is(.x > *)` is
 *   `.x > *`). Everything else must match exactly, so a `:where()` the class
 *   did not have is a difference.
 * - **At-rules and declarations**: in order, with `!important`; at-rule
 *   preludes by text. An `@property` rule only the canonical form emits is
 *   a difference (it changes how the variable inherits and starts) unless the
 *   stylesheets already register that name identically and unconditionally
 *   (`StylesheetFacts.registrations`).
 * - **Values**: compared as CSS tokens. Whitespace, hex colour case and
 *   length, and number spelling are normalised (numbers exactly, as
 *   fractions, keeping CSS's integer flag and the sign of zero: `order: 1.0`
 *   is invalid where `order: 1` is not); strings and `url()` are kept as
 *   written. A top-level `calc()` over numbers of one unit is replaced by its
 *   result only where the property treats both alike (see `FoldPolicy`):
 *   `z-index: calc(1 * -1)` is `-1`, `z-index: calc(1.5 * -1)` is not
 *   `-1.5`; and only where the browser's arithmetic cannot differ (see
 *   `evaluateCalc`).
 * - **Theme variables**: one outside a math function that the stylesheets
 *   set nowhere but in `@theme` is replaced by its value, since naming the
 *   token is the point of the suggestion (`bg-white` for `bg-[#FFF]`). An
 *   equality that needs any other substitution, of a variable inside
 *   `calc()`, `min()`, `max()` or `clamp()` (`w-154` is
 *   `calc(var(--spacing) * 154)`) or of one the stylesheets also set in a
 *   rule or at-rule (`.dark { --color-white: #000 }`), holds only under the
 *   current theme: `theme-dependent`, with those variables.
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

/**
 * The argument of a single-argument `:is()` that may be unwrapped: not
 * relative, and without a pseudo-element or `&` (`:is(.a::before)` matches
 * nothing, `.a::before` does), else null.
 */
const unwrappableIsArgument = (simple: Simple): Complex | null => {
	if (simple.kind !== "pseudo-class" || simple.name !== "is") return null;
	const [only, ...rest] = simple.args ?? [];
	if (!only || rest.length > 0 || only.leading !== null) return null;
	const plain = only.compounds.every((compound) =>
		compound.every(
			(inner) => inner.kind !== "pseudo-element" && inner.kind !== "nesting",
		),
	);
	return plain ? only : null;
};

/** A single-argument `:is()` whose argument is one compound. */
const unwrapCompoundIs = (simple: Simple): Simple[] | null => {
	const only = unwrappableIsArgument(simple);
	return only?.compounds.length === 1 ? only.compounds[0] : null;
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
	const at = first.findIndex(
		(simple) => unwrappableIsArgument(simple) !== null,
	);
	if (at === -1) return complex;
	const inner = unwrappableIsArgument(first[at]);
	if (!inner) return complex;
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
			const inKeyframes = context.some((outer) =>
				/^@(?:-\w+-)?keyframes\b/iu.test(outer),
			);
			if (prelude.startsWith("@") || inKeyframes) {
				// A keyframe (`0%`, `to`) is compared by its text, not as a selector.
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

/** An exact number: `0.5`, `.50` and `5e-1` are all 1/2, `0.0000001` is not 0. */
type Rational = { n: bigint; d: bigint };

type ValueToken =
	| { type: "space" }
	| { type: "comma" }
	| { type: "delim"; char: string }
	| { type: "ident"; value: string }
	| { type: "hash"; value: string }
	/** Strings and unquoted `url()` contents are kept exactly as written. */
	| { type: "string"; raw: string }
	| { type: "url"; raw: string }
	| {
			type: "number";
			value: Rational;
			unit: string;
			/**
			 * CSS's type flag: `1` is an integer, `1.0` and `1e0` are numbers.
			 * `order: 1.0` is invalid where `order: 1` is not, so they differ.
			 */
			integer: boolean;
			/** `-0`, which differs from `0` as a divisor. */
			negativeZero: boolean;
	  }
	| { type: "function"; name: string; args: ValueToken[] }
	| { type: "block"; args: ValueToken[] };

const abs = (value: bigint) => (value < 0n ? -value : value);

const gcd = (a: bigint, b: bigint): bigint => {
	let x = abs(a);
	let y = abs(b);
	while (y !== 0n) [x, y] = [y, x % y];
	return x;
};

const rational = (n: bigint, d: bigint): Rational => {
	if (d === 0n) throw new Error("Division by zero");
	const sign = d < 0n ? -1n : 1n;
	const divisor = gcd(n, d) || 1n;
	return { n: (sign * n) / divisor, d: (sign * d) / divisor };
};

const NUMBER_PATTERN = /[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/iuy;

const parseRational = (text: string): Rational => {
	const match = /^([+-]?)(\d*)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(text);
	if (!match) throw new Error(`Not a number: "${text}"`);
	const fraction = match[3] ?? "";
	const exponent = Number(match[4] ?? 0);
	if (Math.abs(exponent) > 400)
		throw new Error(`Exponent out of range: "${text}"`);
	let n = BigInt(`${match[2] || "0"}${fraction}`);
	let d = 10n ** BigInt(fraction.length);
	if (match[1] === "-") n = -n;
	if (exponent > 0) n *= 10n ** BigInt(exponent);
	if (exponent < 0) d *= 10n ** BigInt(-exponent);
	return rational(n, d);
};

const isIdentStart = (text: string, index: number) => {
	const char = text[index];
	if (char === undefined) return false;
	if (char === "\\" || /[a-z_\u0080-￿]/iu.test(char)) return true;
	if (char !== "-") return false;
	const next = text[index + 1] ?? "";
	return next === "-" || next === "\\" || /[a-z_\u0080-￿]/iu.test(next);
};

/** A declaration value as CSS tokens, functions and parentheses nested. */
const tokenizeValue = (text: string): ValueToken[] => {
	let index = 0;
	const readList = (closing: boolean): ValueToken[] => {
		const out: ValueToken[] = [];
		while (index < text.length) {
			const char = text[index];
			if (char === ")") {
				if (!closing) throw new Error(`Unbalanced ")" in "${text}"`);
				index += 1;
				return out;
			}
			if (/\s/u.test(char)) {
				while (index < text.length && /\s/u.test(text[index])) index += 1;
				out.push({ type: "space" });
				continue;
			}
			if (char === '"' || char === "'") {
				const end = findStringEnd(text, index);
				out.push({ type: "string", raw: text.slice(index, end + 1) });
				index = end + 1;
				continue;
			}
			if (char === ",") {
				out.push({ type: "comma" });
				index += 1;
				continue;
			}
			if (char === "(") {
				index += 1;
				out.push({ type: "block", args: readList(true) });
				continue;
			}
			NUMBER_PATTERN.lastIndex = index;
			const number = NUMBER_PATTERN.exec(text);
			if (number) {
				index = NUMBER_PATTERN.lastIndex;
				let unit = "";
				if (text[index] === "%") {
					unit = "%";
					index += 1;
				} else if (isIdentStart(text, index)) {
					const [name, next] = readIdent(text, index);
					unit = name.toLowerCase();
					index = next;
				}
				const value = parseRational(number[0]);
				out.push({
					type: "number",
					value,
					unit,
					integer: /^[+-]?\d+$/u.test(number[0]),
					negativeZero: value.n === 0n && number[0].startsWith("-"),
				});
				continue;
			}
			if (char === "#" && isIdentChar(text[index + 1] ?? "")) {
				const [name, next] = readIdent(text, index + 1);
				out.push({ type: "hash", value: normalizeHash(name) });
				index = next;
				continue;
			}
			if (isIdentStart(text, index)) {
				const [name, next] = readIdent(text, index);
				index = next;
				if (text[index] !== "(") {
					out.push({ type: "ident", value: name });
					continue;
				}
				index += 1;
				const lower = name.toLowerCase();
				if (lower === "url") {
					let start = index;
					while (/\s/u.test(text[start] ?? "")) start += 1;
					if (text[start] !== '"' && text[start] !== "'") {
						let end = start;
						while (end < text.length && text[end] !== ")") {
							end += text[end] === "\\" ? 2 : 1;
						}
						if (end >= text.length) {
							throw new Error(`Unterminated url( in "${text}"`);
						}
						out.push({ type: "url", raw: text.slice(start, end).trim() });
						index = end + 1;
						continue;
					}
				}
				out.push({ type: "function", name: lower, args: readList(true) });
				continue;
			}
			out.push({ type: "delim", char });
			index += 1;
		}
		if (closing) throw new Error(`Unbalanced "(" in "${text}"`);
		return out;
	};
	return trimSpaces(readList(false));
};

/** `#FFF` and `#ffffff` are one colour; any other hash is kept as written. */
const normalizeHash = (name: string) => {
	if (!/^[0-9a-f]+$/iu.test(name) || ![3, 4, 6, 8].includes(name.length)) {
		return name;
	}
	const lower = name.toLowerCase();
	return lower.length <= 4
		? [...lower].map((digit) => digit + digit).join("")
		: lower;
};

const trimSpaces = (tokens: ValueToken[]) => {
	let start = 0;
	let end = tokens.length;
	while (start < end && tokens[start].type === "space") start += 1;
	while (end > start && tokens[end - 1].type === "space") end -= 1;
	return tokens.slice(start, end);
};

/** Whitespace next to these separates nothing. */
const isSeparator = (token: ValueToken | undefined) =>
	token === undefined ||
	token.type === "space" ||
	token.type === "comma" ||
	(token.type === "delim" && (token.char === "/" || token.char === "*"));

/** A comparable spelling of a token list; not CSS. */
const serializeTokens = (tokens: ValueToken[]): string => {
	const out: string[] = [];
	tokens.forEach((token, index) => {
		if (token.type === "space") {
			if (!isSeparator(tokens[index - 1]) && !isSeparator(tokens[index + 1])) {
				out.push(" ");
			}
			return;
		}
		out.push(serializeToken(token));
	});
	return out.join("");
};

const serializeToken = (token: ValueToken): string => {
	switch (token.type) {
		case "space":
			return " ";
		case "comma":
			return ",";
		case "delim":
			return token.char;
		case "ident":
			return `i${JSON.stringify(token.value)}`;
		case "hash":
			return `#${JSON.stringify(token.value)}`;
		case "string":
			return `s${token.raw}`;
		case "url":
			return `u${JSON.stringify(token.raw)}`;
		case "number":
			return `${token.integer ? "int" : "num"}${token.negativeZero ? "-" : ""}${token.value.n}/${token.value.d}${JSON.stringify(token.unit)}`;
		case "function":
			return `${token.name}(${serializeTokens(token.args)})`;
		case "block":
			return `(${serializeTokens(token.args)})`;
	}
};

type Quantity = { value: Rational; unit: string };

/**
 * Past these, exact arithmetic and the browser's doubles may disagree
 * (`calc(1e16px + 1px - 1e16px)` is `0px` in Chromium): magnitudes up to a
 * million, and at most six decimals.
 */
const SAFE_MAGNITUDE = 1_000_000n;

const withinSafeBounds = ({ value }: Quantity) =>
	abs(value.n) <= SAFE_MAGNITUDE * value.d && value.d <= SAFE_MAGNITUDE;

/**
 * `calc()` over numbers of one unit, exactly; null for anything else and for
 * anything whose result the browser may compute otherwise: `+` and `-`
 * without whitespace on both sides (`calc(1px+ 1px)` is invalid), division
 * (by `-0` or otherwise), a `-0` operand, and values outside
 * `withinSafeBounds`.
 */
const evaluateCalc = (args: ValueToken[]): Quantity | null => {
	// Non-space tokens, with whether whitespace surrounds each.
	const tokens: Array<{ token: ValueToken; spaced: [boolean, boolean] }> = [];
	args.forEach((token, index) => {
		if (token.type === "space") return;
		tokens.push({
			token,
			spaced: [
				args[index - 1]?.type === "space",
				args[index + 1]?.type === "space",
			],
		});
	});
	let position = 0;
	const operator = (chars: string) => {
		const entry = tokens[position];
		return entry?.token.type === "delim" && chars.includes(entry.token.char)
			? entry
			: null;
	};
	const safe = (quantity: Quantity | null) =>
		quantity && withinSafeBounds(quantity) ? quantity : null;
	const parseSum = (): Quantity | null => {
		let left = parseProduct();
		for (let op = operator("+-"); left && op; op = operator("+-")) {
			if (!op.spaced[0] || !op.spaced[1]) return null;
			position += 1;
			const right = parseProduct();
			if (!right || left.unit !== right.unit) return null;
			const sign =
				op.token.type === "delim" && op.token.char === "+" ? 1n : -1n;
			left = safe({
				value: rational(
					left.value.n * right.value.d + sign * right.value.n * left.value.d,
					left.value.d * right.value.d,
				),
				unit: left.unit,
			});
		}
		return left;
	};
	const parseProduct = (): Quantity | null => {
		let left = parseFactor();
		for (let op = operator("*/"); left && op; op = operator("*/")) {
			if (op.token.type === "delim" && op.token.char === "/") return null;
			position += 1;
			const right = parseFactor();
			if (!right || (left.unit && right.unit)) return null;
			left = safe({
				value: rational(
					left.value.n * right.value.n,
					left.value.d * right.value.d,
				),
				unit: left.unit || right.unit,
			});
		}
		return left;
	};
	const parseFactor = (): Quantity | null => {
		const token = tokens[position]?.token;
		position += 1;
		if (token?.type === "number") {
			if (token.negativeZero) return null;
			return safe({ value: token.value, unit: token.unit });
		}
		if (
			token?.type === "block" ||
			(token?.type === "function" && token.name === "calc")
		) {
			return evaluateCalc(token.args);
		}
		return null;
	};
	const result = parseSum();
	return result && position === tokens.length ? result : null;
};

/**
 * Where a `calc()` may be replaced by its result. Only where the two cannot
 * differ: a literal can be invalid where the `calc()` is clamped or rounded
 * (`z-index: calc(1.5 * -1)` is `-1`, `z-index: -1.5` is invalid, so
 * `auto`; `width: calc(-1px)` is `0`, `width: -1px` invalid). So: integer
 * properties when the result is an integer, lengths that may be negative,
 * lengths that may not when the result is not negative, and nothing else
 * (custom properties included: where they are used is not known here).
 */
type FoldPolicy =
	| { kind: "none" }
	| { kind: "integer" }
	| { kind: "length"; nonNegative: boolean; unitless: boolean };

const INTEGER_PROPERTIES = new Set(["z-index", "order"]);

const SIGNED_LENGTH_PROPERTY =
	/^(?:margin(?:-.+)?|inset(?:-.+)?|top|right|bottom|left|translate|letter-spacing|word-spacing|text-indent|scroll-margin(?:-.+)?|outline-offset|text-underline-offset)$/u;

const NON_NEGATIVE_LENGTH_PROPERTY =
	/^(?:(?:min-|max-)?(?:width|height|inline-size|block-size)|padding(?:-.+)?|gap|row-gap|column-gap|border-radius|border-(?:top|bottom|start|end)-(?:left|right|start|end)-radius|font-size|flex-basis|scroll-padding(?:-.+)?|outline-width|border-width|border-(?:top|right|bottom|left|inline|block|inline-start|inline-end|block-start|block-end)-width|border-spacing)$/u;

const foldPolicy = (property: string): FoldPolicy => {
	if (INTEGER_PROPERTIES.has(property)) return { kind: "integer" };
	if (SIGNED_LENGTH_PROPERTY.test(property)) {
		return { kind: "length", nonNegative: false, unitless: false };
	}
	if (NON_NEGATIVE_LENGTH_PROPERTY.test(property)) {
		return { kind: "length", nonNegative: true, unitless: false };
	}
	if (property === "line-height") {
		return { kind: "length", nonNegative: true, unitless: true };
	}
	return { kind: "none" };
};

const foldAccepts = (policy: FoldPolicy, { value, unit }: Quantity) => {
	switch (policy.kind) {
		case "none":
			return false;
		case "integer":
			return unit === "" && value.d === 1n;
		case "length":
			return (
				(unit !== "" || policy.unitless) &&
				(!policy.nonNegative || value.n >= 0n)
			);
	}
};

/** Replaces each top-level `calc()` by its result where the policy allows. */
const foldCalc = (tokens: ValueToken[], policy: FoldPolicy): ValueToken[] =>
	tokens.map((token) => {
		if (token.type !== "function" || token.name !== "calc") return token;
		const result = evaluateCalc(token.args);
		return result && foldAccepts(policy, result)
			? {
					type: "number",
					value: result.value,
					unit: result.unit,
					// A whole result counts as the integer literal it equals
					// (`z-index: calc(1 * -1)` is `-1`); `1.0` stays a number.
					integer: result.value.d === 1n,
					negativeZero: false,
				}
			: token;
	});

/**
 * How theme variables may be read: their `@theme` values, and which of them
 * the stylesheets also set somewhere else (`.dark { --color-white: … }`).
 */
export type VerificationContext = {
	theme: ThemeValues;
	stylesheet: StylesheetFacts;
};

/**
 * Replaces theme variables by their values. `"stable"` replaces only those
 * whose value cannot vary: outside a math function, and set nowhere but in
 * `@theme`. `"all"` replaces every one and records in `unstable` the names
 * that were not stable.
 */
const substituteTheme = (
	tokens: ValueToken[],
	context: VerificationContext,
	mode: "stable" | "all",
	unstable: Set<string>,
	insideMath = false,
	depth = 0,
): ValueToken[] =>
	tokens.flatMap((token): ValueToken[] => {
		if (token.type === "block") {
			return [
				{
					...token,
					args: substituteTheme(
						token.args,
						context,
						mode,
						unstable,
						insideMath,
						depth,
					),
				},
			];
		}
		if (token.type !== "function") return [token];
		if (token.name === "var") {
			const [first] = trimSpaces(token.args);
			const name = first?.type === "ident" ? first.value : null;
			const value = name === null ? undefined : context.theme(name);
			if (name !== null && value !== undefined) {
				const stable =
					!insideMath && !variesOutsideTheme(context.stylesheet, name);
				if (stable || mode === "all") {
					if (!stable) unstable.add(name);
					if (depth > 8)
						throw new Error(`Theme variables nest too deep at ${name}`);
					return substituteTheme(
						tokenizeValue(value),
						context,
						mode,
						unstable,
						insideMath,
						depth + 1,
					);
				}
			}
		}
		return [
			{
				...token,
				args: substituteTheme(
					token.args,
					context,
					mode,
					unstable,
					insideMath || MATH_FUNCTIONS.has(token.name),
					depth,
				),
			},
		];
	});

type ValueComparison =
	| { status: "equal" }
	| { status: "theme"; variables: string[] }
	| { status: "different" };

/**
 * Equal as written, then with the stable theme variables replaced, then with
 * every theme variable replaced: equal only that way depends on the theme,
 * through the variables that were not stable.
 */
const compareValues = (
	property: string,
	original: string,
	canonical: string,
	context: VerificationContext,
): ValueComparison => {
	const policy = foldPolicy(property);
	const before = tokenizeValue(original);
	const after = tokenizeValue(canonical);
	const render = (
		tokens: ValueToken[],
		mode: "stable" | "all" | null,
		unstable: Set<string>,
	) =>
		serializeTokens(
			foldCalc(
				mode === null
					? tokens
					: substituteTheme(tokens, context, mode, unstable),
				policy,
			),
		);
	const ignored = new Set<string>();
	if (render(before, null, ignored) === render(after, null, ignored)) {
		return { status: "equal" };
	}
	if (render(before, "stable", ignored) === render(after, "stable", ignored)) {
		return { status: "equal" };
	}
	const unstable = new Set<string>();
	if (render(before, "all", unstable) !== render(after, "all", unstable)) {
		return { status: "different" };
	}
	// A registered variable that does not inherit, or starts from another
	// value, is not its `@theme` value where the class applies.
	for (const name of unstable) {
		if (registrationOverridesTheme(context, name)) {
			return { status: "different" };
		}
	}
	return unstable.size === 0
		? { status: "equal" }
		: { status: "theme", variables: [...unstable] };
};

/**
 * Whether an `@property` registration of a theme variable keeps it from
 * its `@theme` value: `inherits: false` (an element does not see `:root`'s
 * value), or an `initial-value` other than the theme value.
 */
const registrationOverridesTheme = (
	context: VerificationContext,
	name: string,
) => {
	const registrations = context.stylesheet.registeredVariables.get(name);
	if (!registrations) return false;
	const themeValue = context.theme(name);
	const spelled = (value: string) => serializeTokens(tokenizeValue(value));
	return registrations.some(
		(descriptors) =>
			descriptors.inherits?.trim().toLowerCase() !== "true" ||
			(descriptors.initialValue !== null &&
				(themeValue === undefined ||
					spelled(descriptors.initialValue) !== spelled(themeValue))),
	);
};

// ---------------------------------------------------------------------------
// Stylesheets the system loaded
// ---------------------------------------------------------------------------

/**
 * What the system's stylesheets say beyond `@theme`, read from their text
 * (every stylesheet the system loaded, imports included).
 */
export type StylesheetFacts = {
	/**
	 * Custom properties set outside `@theme`: in any rule, at-rule or
	 * `@utility` (`.dark { --color-white: #000 }`). A theme variable set
	 * there does not always have its `@theme` value.
	 */
	contextVariables: ReadonlySet<string>;
	/**
	 * Unconditional `@property` registrations by name, their descriptors as
	 * compared: at the top level or inside `@layer` only. Null when a name is
	 * registered twice differently, or also under a condition (`@media`,
	 * `@supports`, a rule). Empty when an `@import` carries anything but
	 * `layer` or `source(…)`: the sheets' text is concatenated, so which
	 * registrations a conditional import brings in cannot be told apart.
	 */
	registrations: ReadonlyMap<string, string | null>;
	/**
	 * Every `@property` registration in the text, conditional or not, by
	 * name: a registered theme variable may not have its `@theme` value
	 * (`inherits: false`, another `initial-value`).
	 */
	registeredVariables: ReadonlyMap<
		string,
		ReadonlyArray<{ inherits: string | null; initialValue: string | null }>
	>;
	/** False when the text could not be read: nothing above can then be relied on. */
	complete: boolean;
};

export const EMPTY_STYLESHEET_FACTS: StylesheetFacts = {
	contextVariables: new Set(),
	registrations: new Map(),
	registeredVariables: new Map(),
	complete: true,
};

const variesOutsideTheme = (stylesheet: StylesheetFacts, name: string) =>
	!stylesheet.complete ||
	stylesheet.contextVariables.has(name) ||
	stylesheet.registeredVariables.has(name);

/** `@property` descriptors in one comparable spelling, in any order. */
const registrationBody = (
	descriptors: ReadonlyArray<{ property: string; value: string }>,
) =>
	descriptors
		.map(
			({ property, value }) =>
				`${property.toLowerCase()}:${serializeTokens(tokenizeValue(value))}`,
		)
		.sort(compareText)
		.join(";");

/** Scans stylesheet text for the facts above. */
export const scanStylesheetFacts = (css: string): StylesheetFacts => {
	const contextVariables = new Set<string>();
	const registrations = new Map<string, string | null>();
	const registeredVariables = new Map<
		string,
		Array<{ inherits: string | null; initialValue: string | null }>
	>();
	type Frame = {
		prelude: string;
		descriptors: Array<{ property: string; value: string }>;
	};
	const stack: Frame[] = [];
	let buffer = "";
	let importsUnconditional = true;
	const insideTheme = () =>
		stack.some((frame) => /^@theme\b/iu.test(frame.prelude));
	const statement = () => {
		const text = buffer.trim();
		buffer = "";
		if (/^@import\b/iu.test(text) && !isUnconditionalImport(text)) {
			importsUnconditional = false;
		}
		if (!text || stack.length === 0 || insideTheme()) return;
		const colon = text.indexOf(":");
		if (colon === -1) return;
		const property = text.slice(0, colon).trim();
		const value = text.slice(colon + 1).trim();
		if (property.startsWith("--")) contextVariables.add(property);
		stack[stack.length - 1].descriptors.push({ property, value });
	};
	try {
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
				if (end === -1) throw new Error("Unterminated comment");
				index = end + 1;
			} else if (char === "(") {
				const end = findClosing(css, index);
				buffer += css.slice(index, end + 1);
				index = end;
			} else if (char === "{") {
				stack.push({ prelude: collapse(buffer), descriptors: [] });
				buffer = "";
			} else if (char === "}") {
				statement();
				const frame = stack.pop();
				if (!frame) throw new Error("Unbalanced }");
				const property = /^@property\s+(--\S+)$/iu.exec(frame.prelude);
				if (property) {
					const descriptor = (key: string) =>
						frame.descriptors.findLast(
							(entry) => entry.property.toLowerCase() === key,
						)?.value ?? null;
					registeredVariables.set(property[1], [
						...(registeredVariables.get(property[1]) ?? []),
						{
							inherits: descriptor("inherits"),
							initialValue: descriptor("initial-value"),
						},
					]);
				}
				if (property && !insideTheme()) {
					const unconditional = stack.every((outer) =>
						/^@layer\b/iu.test(outer.prelude),
					);
					const body = unconditional
						? registrationBody(frame.descriptors)
						: null;
					const known = registrations.get(property[1]);
					registrations.set(
						property[1],
						known === undefined || known === body ? body : null,
					);
				}
			} else if (char === ";") {
				statement();
			} else {
				buffer += char;
			}
		}
		if (stack.length > 0) throw new Error("Unbalanced {");
	} catch {
		return {
			contextVariables,
			registrations,
			registeredVariables,
			complete: false,
		};
	}
	return {
		contextVariables,
		registrations: importsUnconditional ? registrations : new Map(),
		registeredVariables,
		complete: true,
	};
};

/**
 * An `@import` whose content is always included: the URL, then only
 * `layer`, `layer(…)` or `source(…)`. A media query, `supports(…)`, or an
 * option Tailwind reads (`reference`, `theme(…)`, `prefix(…)`) is not.
 */
const isUnconditionalImport = (text: string) => {
	const match =
		/^@import\s+(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\([^)]*\))([\s\S]*)$/iu.exec(
			text,
		);
	if (!match) return false;
	return /^(?:\s+(?:layer(?:\([^)]*\))?|source\([^)]*\)))*\s*$/iu.test(
		match[1],
	);
};

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const formatSpecificity = (specificity: Specificity | null) =>
	specificity ? specificity.join(",") : "none";

const describeEntry = (entry: Entry) =>
	`${entry.property}: ${entry.value}${entry.important ? " !important" : ""}`;

/** The name an `@property` entry registers, if it is one. */
const registeredName = (entry: Entry) => {
	if (entry.context.length !== 1) return null;
	return /^@property\s+(--\S+)$/iu.exec(entry.context[0])?.[1] ?? null;
};

/**
 * Drops the canonical side's `@property` rules the class does not emit when
 * the stylesheets already register the same name identically: then adding
 * it changes nothing. Any other added registration changes how the variable
 * inherits or starts, so it is a difference (the reason), as is one the
 * class has and the form lacks (left for the comparison to find).
 */
const withoutRegisteredExtras = (
	after: Entry[],
	before: Entry[],
	stylesheet: StylesheetFacts,
): Entry[] | string => {
	const emitted = new Set(before.map(registeredName));
	const extras = new Map<string, Entry[]>();
	for (const entry of after) {
		const name = registeredName(entry);
		if (name === null || emitted.has(name)) continue;
		extras.set(name, [...(extras.get(name) ?? []), entry]);
	}
	for (const [name, entries] of extras) {
		const registered = stylesheet.complete
			? stylesheet.registrations.get(name)
			: undefined;
		if (registered == null || registered !== registrationBody(entries)) {
			return `registers ${name} (@property), which the class does not and the stylesheets do not already`;
		}
	}
	return after.filter((entry) => {
		const name = registeredName(entry);
		return name === null || !extras.has(name);
	});
};

/**
 * Compares the compiled CSS of a class and of its canonical form (Tailwind's
 * `candidatesToCss` output for each, null when it compiles to nothing).
 */
export const compareCompiledClasses = (
	original: { candidate: string; css: string | null },
	canonical: { candidate: string; css: string | null },
	context: VerificationContext,
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
	try {
		return compareEntries(
			flatten(parseCss(original.css), original.candidate),
			flatten(parseCss(canonical.css), canonical.candidate),
			context,
		);
	} catch (error) {
		return {
			status: "different",
			reason: `its CSS could not be compared (${error instanceof Error ? error.message : String(error)})`,
		};
	}
};

const compareEntries = (
	before: Entry[],
	compiled: Entry[],
	context: VerificationContext,
): CanonicalVerdict => {
	const after = withoutRegisteredExtras(compiled, before, context.stylesheet);
	if (typeof after === "string") return { status: "different", reason: after };
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
		const values =
			was.property === is.property && was.important === is.important
				? compareValues(was.property, was.value, is.value, context)
				: ({ status: "different" } as const);
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
 * compile to the same CSS on this system. `stylesheet` is
 * `scanStylesheetFacts` over every stylesheet the system loaded.
 */
export const canonicalizeAndVerifyTailwindCandidate = (
	system: { designSystem: TailwindDesignSystem; stylesheet: StylesheetFacts },
	candidate: string,
	canonicalize: (
		designSystem: TailwindDesignSystem,
		candidate: string,
	) => string,
): CanonicalizedClass => {
	const { designSystem } = system;
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
			{ theme: themeValuesOf(designSystem), stylesheet: system.stylesheet },
		),
	};
};

// ---------------------------------------------------------------------------
// In context: the classes next to it
// ---------------------------------------------------------------------------

/**
 * A class and its canonical form among the other classes that may render on
 * the same element. Standalone equivalence does not cover the cascade:
 * Tailwind emits `bg-white` after `bg-red-500` but `bg-[#FFF]` before it, so
 * `bg-[#FFF] bg-red-500` is red and `bg-white bg-red-500` white.
 */
export type ContextCheck = {
	/** The classes that may render on the element, the class included. */
	classes: readonly string[];
	candidate: string;
	canonical: string;
};

export type ContextVerdict =
	| { status: "unchanged"; competitors: number }
	| { status: "changed"; reason: string };

/**
 * Properties that can override one another, by family: a shorthand and its
 * longhands, logical and physical sides. Deliberately wide (`margin-top`
 * and `margin-bottom` are one family): a family only selects which classes
 * are compared, and comparing more classes never claims more.
 */
const PROPERTY_FAMILIES: ReadonlyArray<[RegExp, string]> = [
	[/^(?:top|right|bottom|left|inset(?:-.+)?)$/u, "inset"],
	[/^(?:min-|max-)?(?:width|height|inline-size|block-size)$/u, "size"],
	[/^(?:grid-)?(?:gap|row-gap|column-gap)$/u, "gap"],
	[/^(?:place|align|justify)-/u, "align"],
	[/^(?:font|line-height)(?:-|$)/u, "font"],
	[/^(?:white-space|text-wrap)(?:-|$)/u, "text"],
	[/^columns?(?:-|$)/u, "column"],
	[/^(?:transform|translate|rotate|scale)(?:-|$)/u, "transform"],
];

const propertyFamily = (property: string) => {
	if (property.startsWith("--")) return property;
	const name = property.toLowerCase().replace(/^-(?:webkit|moz|ms|o)-/u, "");
	for (const [pattern, family] of PROPERTY_FAMILIES) {
		if (pattern.test(name)) return family;
	}
	return name.split("-")[0];
};

/** One class's compiled declarations in style rules; null when it compiles to nothing. */
type CompiledClass = Entry[] | null;

const compiledClasses = new WeakMap<
	TailwindDesignSystem,
	Map<string, CompiledClass>
>();

/** Compiled once per system and class; throws when the CSS cannot be read. */
const compileClass = (
	designSystem: TailwindDesignSystem,
	candidate: string,
): CompiledClass => {
	let cache = compiledClasses.get(designSystem);
	if (!cache) {
		cache = new Map();
		compiledClasses.set(designSystem, cache);
	}
	if (cache.has(candidate)) return cache.get(candidate) ?? null;
	let css: string | null = null;
	try {
		css = designSystem.candidatesToCss([candidate])[0] ?? null;
	} catch {
		css = null;
	}
	const entries =
		css === null || !css.trim()
			? null
			: flatten(parseCss(css), candidate).filter(
					(entry) => entry.selector !== null,
				);
	if (cache.size >= 20_000) cache.clear();
	cache.set(candidate, entries);
	return entries;
};

/**
 * Whether two declarations set the same property to the same value, with
 * the same `!important`: whichever wins, the result is the same, so their
 * order does not matter (`data-[starting-style]:opacity-0` next to
 * `data-[ending-style]:opacity-0`).
 */
const declaresTheSame = (a: Entry, b: Entry) => {
	if (a.property !== b.property || a.important !== b.important) return false;
	try {
		return (
			serializeTokens(tokenizeValue(a.value)) ===
			serializeTokens(tokenizeValue(b.value))
		);
	} catch {
		return false;
	}
};

/** `a` before `b` in the cascade (`b` wins where both apply): -1, else 1. */
const cascadeOrder = (
	a: { entry: Entry; position: number },
	b: { entry: Entry; position: number },
) => {
	const keyOf = ({ entry, position }: { entry: Entry; position: number }) => [
		entry.important ? 1 : 0,
		...(entry.specificity ?? [0, 0, 0]),
		position,
	];
	const left = keyOf(a);
	const right = keyOf(b);
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index])
			return left[index] < right[index] ? -1 : 1;
	}
	return 0;
};

/**
 * Who wins between the class (`self`) and each competitor declaration that
 * may override it or be overridden by it, keyed by both declarations, with
 * Tailwind's emitted order (`getClassOrder`) as the last tie-breaker.
 */
const precedence = (
	designSystem: TailwindDesignSystem,
	self: string,
	competitors: readonly string[],
): Map<string, number> => {
	const ordered = designSystem
		.getClassOrder([self, ...competitors])
		.filter((entry): entry is [string, bigint] => entry[1] !== null)
		.sort(([, left], [, right]) => (left < right ? -1 : left > right ? 1 : 0))
		.map(([className]) => className);
	const rank = new Map(ordered.map((className, index) => [className, index]));
	const positioned = (className: string) =>
		(compileClass(designSystem, className) ?? []).map((entry, index) => ({
			entry,
			position: (rank.get(className) ?? -1) * 100_000 + index,
			index,
		}));
	const mine = positioned(self);
	const relations = new Map<string, number>();
	for (const competitor of competitors) {
		for (const theirs of positioned(competitor)) {
			for (const ours of mine) {
				if (
					propertyFamily(ours.entry.property) !==
						propertyFamily(theirs.entry.property) ||
					declaresTheSame(ours.entry, theirs.entry)
				) {
					continue;
				}
				relations.set(
					`${ours.index}\u0000${competitor}\u0000${theirs.index}`,
					cascadeOrder(ours, theirs),
				);
			}
		}
	}
	return relations;
};

/**
 * Whether replacing `candidate` by `canonical` among `classes` changes which
 * declaration wins anywhere the class competes. Competitors are the other
 * classes with a declaration in a family the class declares; none, and the
 * standalone verdict stands. Otherwise every pair of competing declarations
 * must keep its order (`!important`, then specificity, then emitted
 * order), whatever the conditions they apply under: ordering conditions
 * that never overlap is not worth the risk of missing one that does.
 */
export const verifyCanonicalInContext = (
	designSystem: TailwindDesignSystem,
	{ classes, candidate, canonical }: ContextCheck,
): ContextVerdict => {
	try {
		const own = compileClass(designSystem, candidate);
		const replacement = compileClass(designSystem, canonical);
		if (!own || !replacement || own.length !== replacement.length) {
			return {
				status: "changed",
				reason: "its declarations could not be matched with the replacement's",
			};
		}
		const families = new Set(
			own.map((entry) => propertyFamily(entry.property)),
		);
		const competitors = [...new Set(classes)].filter((className) => {
			if (className === candidate || className === canonical) return false;
			const compiled = compileClass(designSystem, className);
			return compiled?.some((entry) =>
				families.has(propertyFamily(entry.property)),
			);
		});
		if (competitors.length === 0) {
			return { status: "unchanged", competitors: 0 };
		}
		const before = precedence(designSystem, candidate, competitors);
		const after = precedence(designSystem, canonical, competitors);
		// With the canonical form already there, replacing the class removes
		// it: that changes something only where the class beat a competitor
		// the canonical form loses to (both declare the same values).
		const alreadyThere = classes.includes(canonical);
		for (const [key, order] of before) {
			const changed = alreadyThere
				? order > 0 && (after.get(key) ?? -1) < 0
				: after.get(key) !== order;
			if (changed) {
				const competitor = key.split("\u0000")[1];
				return {
					status: "changed",
					reason: `next to "${competitor}", ${order < 0 ? `"${competitor}" wins over the class but not over "${canonical}"` : `the class wins over "${competitor}" but "${canonical}" does not`}`,
				};
			}
		}
		if (after.size !== before.size && !alreadyThere) {
			return {
				status: "changed",
				reason: "the replacement competes with other declarations",
			};
		}
		return { status: "unchanged", competitors: competitors.length };
	} catch (error) {
		return {
			status: "changed",
			reason: `the classes could not be compared (${error instanceof Error ? error.message : String(error)})`,
		};
	}
};
