import { parseSync } from "oxc-parser";
import { type CodegenHeader, parseCodegenHeader } from "../../codegen/header";
import { createLineIndex } from "./locations";

/**
 * The syntactic model of one TypeScript or JavaScript module, built with
 * `oxc-parser`: imports, exports, JSX elements with their literal
 * attributes, class strings, call sites and the Trickroom codegen header.
 * No type checker and no evaluation: anything that is not a literal is
 * `unknown`. Rules and the project index (`index.ts`) work on this model.
 */

export type SourcePosition = { line: number; column: number };

export type SourceImportName = {
	/** The exported name, `default`, or `*` for a namespace import. */
	imported: string;
	local: string;
	/** `import type` or `import { type X }`: erased, never a value. */
	type: boolean;
};

export type SourceImport = {
	specifier: string;
	/** Filled by the index: the scanned module a relative specifier names. */
	resolved: string | null;
	names: SourceImportName[];
	position: SourcePosition;
};

export type SourceExport = {
	/** The exported name, or `default`. */
	name: string;
	/** The local binding, when the export names one. */
	local: string | null;
	type: boolean;
};

export type SourceReexport = {
	specifier: string;
	resolved: string | null;
	/**
	 * `imported` is `*` for `export * from`; `exported` is null then. `type`
	 * is per name: `export { type Props, Button } from "./button"` keeps
	 * `Button` a value.
	 */
	names: Array<{ imported: string; exported: string | null; type: boolean }>;
	/** Every name is type-only (`export type { … } from`). */
	type: boolean;
	position: SourcePosition;
};

export type SourceLiteralValue =
	| { kind: "string"; value: string }
	| { kind: "literal"; value: number | boolean | null }
	/** Not a literal: an identifier, call, member access or any expression. */
	| { kind: "unknown" };

export type SourceJsxAttribute = {
	name: string;
	/** A bare attribute (`<X disabled>`) is `{ kind: "literal", value: true }`. */
	value: SourceLiteralValue;
	position: SourcePosition;
};

export type SourceJsxElement = {
	/** As written: `Button`, `UI.Button`, `svg:path`. */
	name: string;
	/** The first identifier of the name: `UI` for `UI.Button`. */
	root: string;
	/** Member path after the root: `["Button"]` for `UI.Button`. */
	members: string[];
	attributes: SourceJsxAttribute[];
	/** The element has a `{...spread}` attribute, so attributes are incomplete. */
	spread: boolean;
	/**
	 * Where each `{...spread}` attribute starts, in source order. A literal
	 * attribute before a spread may be overridden by it; one after is not.
	 */
	spreads: SourcePosition[];
	position: SourcePosition;
};

export type SourceClassStringOrigin =
	| { kind: "jsx-attribute"; element: string; attribute: string }
	| { kind: "call"; callee: string };

export type SourceClassBranch = { choice: number; side: number };

export type SourceClassString = {
	value: string;
	origin: SourceClassStringOrigin;
	/** False for a template literal fragment (`q-${n}` yields `q-`). */
	complete: boolean;
	/** The enclosing expression also had parts that are not literals. */
	mixed: boolean;
	/**
	 * The string applies only under a condition: a branch of a conditional,
	 * a side of a logical expression, a clsx-style object key.
	 */
	conditional: boolean;
	/**
	 * The choices the string sits under, outermost first: a conditional or
	 * logical expression (`choice`, numbered per class string, one number
	 * per expression however they nest) evaluates to one operand (`side`),
	 * so two strings on different sides of one choice never apply together.
	 */
	branch: SourceClassBranch[];
	position: SourcePosition;
	/**
	 * Where the `className` attribute or class call it was collected from
	 * starts: the strings that share it are the parts of one class string
	 * (the attribute's position for `jsx-attribute` strings).
	 */
	expression: SourcePosition;
};

export type SourceObjectMember =
	| { kind: "property"; key: string }
	/** `...rest`: may supply or override any key. */
	| { kind: "spread" }
	/** `[expr]: value`: an unknown key. */
	| { kind: "computed" };

export type SourceObjectArgument = {
	kind: "object";
	/** Literal-keyed properties; values are literals or `unknown`. */
	properties: Record<string, SourceLiteralValue>;
	/** Literal keys in source order. */
	keys: string[];
	/** Every member in source order, so a rule can see what a spread may override. */
	members: SourceObjectMember[];
	hasSpread: boolean;
	hasComputed: boolean;
};

export type SourceCallArgument = SourceObjectArgument | SourceLiteralValue;

/** A call named by another record: its callee and where it is. */
export type SourceCallRef = {
	callee: string;
	root: string;
	members: string[];
	position: SourcePosition;
};

/** A value derived from a call: the call and the member path taken from its result. */
export type SourceCallOrigin = {
	call: SourceCallRef;
	path: string[];
};

export type SourceCall = {
	/**
	 * As written: `buttonVariants`, `styles.root`, or `buttonVariants().root`
	 * for a call on another call's result.
	 */
	callee: string;
	/** The first identifier: `styles` for `styles.root()`, `buttonVariants` for `buttonVariants().root()`. */
	root: string;
	/** Member path after the root, or after the receiver call for a call on a call result. */
	members: string[];
	arguments: SourceCallArgument[];
	/**
	 * Set when the receiver is another call's result (`buttonVariants().root()`,
	 * `(await load()).title()`): that call and the member path from it to
	 * this callee. Null when the callee starts with an identifier.
	 */
	receiver: SourceCallOrigin | null;
	position: SourcePosition;
};

/**
 * A member access taken directly off a call result: `buttonVariants().root`
 * (not invoked, `invoked: false`) or `buttonVariants().root()` (invoked;
 * the call itself is also in `calls` with a `receiver`). Only the
 * outermost access of a chain is recorded: `f().a.b` is one use with
 * path `["a", "b"]`.
 */
export type SourceCallResultUse = SourceCallOrigin & {
	invoked: boolean;
	position: SourcePosition;
};

export type SourceBindingKind =
	| "const"
	| "let"
	| "var"
	| "function"
	| "class"
	| "parameter"
	| "catch"
	| "import"
	| "enum"
	| "namespace";

/** A name declared in a scope. */
export type SourceBinding = {
	name: string;
	kind: SourceBindingKind;
	/** Where the name is introduced. */
	position: SourcePosition;
	/**
	 * Set when the binding's value comes from a call: `const s = f()`
	 * (path `[]`), `const r = f().root` and `const { root: r } = f()`
	 * (path `["root"]`), `const [a] = f()` (path `["0"]`), `await f()`.
	 * Null for every other binding, which still shadows outer ones.
	 */
	origin: SourceCallOrigin | null;
};

export type SourceScopeKind =
	| "module"
	| "function"
	| "block"
	| "for"
	| "catch"
	| "class";

/**
 * A lexical scope. The module is scope 0; every function or arrow body,
 * block, `for` head, `catch` clause and class body nests inside its
 * parent. `start`/`end` is the source span the scope covers, so a
 * position finds its innermost scope.
 */
export type SourceScope = {
	id: number;
	parent: number | null;
	kind: SourceScopeKind;
	start: SourcePosition;
	end: SourcePosition;
	/** Bindings declared in this scope, in source order. */
	bindings: SourceBinding[];
};

/**
 * A binding whose value comes from a call: the call-initialised entries
 * of the scope tree, flattened in source order, so a rule can list every
 * `const s = buttonVariants()` without walking scopes.
 */
export type SourceDeclaration = {
	/** The local binding. */
	name: string;
	/** The call the value comes from. */
	call: SourceCallRef;
	/** Property path from the call result to the binding (see `SourceBinding.origin`). */
	path: string[];
	/** The scope (`module.scopes[scope]`) the binding is declared in. */
	scope: number;
	position: SourcePosition;
};

export type SourceModule = {
	/** Relative to the project root, `/` separators. */
	file: string;
	imports: SourceImport[];
	exports: SourceExport[];
	reexports: SourceReexport[];
	jsx: SourceJsxElement[];
	classStrings: SourceClassString[];
	calls: SourceCall[];
	/** Member accesses taken directly off a call result, invoked or not. */
	callResultUses: SourceCallResultUse[];
	/** The lexical scopes, module first; `traceCallOrigin` resolves through them. */
	scopes: SourceScope[];
	/** Bindings initialised from a call, in source order (a view over `scopes`). */
	declarations: SourceDeclaration[];
	/** The Trickroom codegen header when this is a generated variants file. */
	codegenHeader: CodegenHeader | null;
	/** Parser errors; the model holds what could be parsed. */
	errors: string[];
	lineCount: number;
};

export type ParseSourceOptions = {
	/** Call names whose string arguments are class strings (`cn`, `tv`, ...). */
	classCalls: readonly string[];
};

type AstNode = { type: string; start: number; end: number } & Record<
	string,
	unknown
>;

const isNode = (value: unknown): value is AstNode =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { type?: unknown }).type === "string";

const childNodes = (node: AstNode): AstNode[] => {
	const children: AstNode[] = [];
	for (const [key, value] of Object.entries(node)) {
		if (key === "type" || key === "start" || key === "end") continue;
		if (Array.isArray(value)) {
			for (const entry of value) {
				if (isNode(entry)) children.push(entry);
			}
		} else if (isNode(value)) {
			children.push(value);
		}
	}
	return children;
};

const unwrap = (node: AstNode): AstNode => {
	let current = node;
	while (
		(current.type === "ParenthesizedExpression" ||
			current.type === "TSAsExpression" ||
			current.type === "TSSatisfiesExpression" ||
			current.type === "TSNonNullExpression" ||
			current.type === "TSTypeAssertion") &&
		isNode(current.expression)
	) {
		current = current.expression;
	}
	return current;
};

const literalValue = (node: AstNode | null | undefined): SourceLiteralValue => {
	if (!node) return { kind: "unknown" };
	const expression = unwrap(node);
	if (expression.type === "Literal") {
		const value = expression.value;
		if (typeof value === "string") return { kind: "string", value };
		if (
			typeof value === "number" ||
			typeof value === "boolean" ||
			value === null
		) {
			return { kind: "literal", value };
		}
		return { kind: "unknown" };
	}
	if (
		expression.type === "TemplateLiteral" &&
		Array.isArray(expression.expressions) &&
		expression.expressions.length === 0 &&
		Array.isArray(expression.quasis)
	) {
		const quasi = expression.quasis[0] as AstNode | undefined;
		const cooked = (quasi?.value as { cooked?: string } | undefined)?.cooked;
		return typeof cooked === "string"
			? { kind: "string", value: cooked }
			: { kind: "unknown" };
	}
	if (expression.type === "JSXExpressionContainer") {
		return literalValue(expression.expression as AstNode);
	}
	return { kind: "unknown" };
};

const memberPath = (
	node: AstNode,
): { root: string; members: string[] } | null => {
	const expression = unwrap(node);
	if (expression.type === "Identifier" || expression.type === "JSXIdentifier") {
		return { root: String(expression.name), members: [] };
	}
	if (expression.type === "ThisExpression") {
		return { root: "this", members: [] };
	}
	if (
		(expression.type === "MemberExpression" ||
			expression.type === "JSXMemberExpression") &&
		isNode(expression.object) &&
		isNode(expression.property) &&
		expression.computed !== true
	) {
		const object = memberPath(expression.object);
		const property = expression.property;
		if (
			!object ||
			(property.type !== "Identifier" &&
				property.type !== "JSXIdentifier" &&
				property.type !== "PrivateIdentifier")
		) {
			return null;
		}
		return {
			root: object.root,
			members: [...object.members, String(property.name)],
		};
	}
	if (
		expression.type === "JSXNamespacedName" &&
		isNode(expression.namespace) &&
		isNode(expression.name)
	) {
		return {
			root: `${String(expression.namespace.name)}:${String(expression.name.name)}`,
			members: [],
		};
	}
	return null;
};

const formatName = (path: { root: string; members: string[] }) =>
	[path.root, ...path.members].join(".");

type Collected = {
	value: string;
	complete: boolean;
	conditional: boolean;
	branch: SourceClassBranch[];
	position: SourcePosition;
};

/** Calls whose first argument is a tailwind-variants or cva config object. */
export const TV_CONFIG_CALLS: readonly string[] = ["tv", "cva"];

const TV_CLASS_KEYS = new Set(["class", "className"]);

/** The keys of a tv()/cva() config; an object with none of them is not one. */
const TV_CONFIG_KEYS = new Set([
	"base",
	"slots",
	"variants",
	"compoundVariants",
	"compoundSlots",
	"defaultVariants",
	"extend",
]);

type Collector = {
	out: Collected[];
	classCalls: ReadonlySet<string>;
	position: (offset: number) => SourcePosition;
	handledCalls: Set<AstNode>;
	/** Inside a branch, a logical operand or an object key: depth > 0. */
	conditional: number;
	/** The choices being visited, outermost first. */
	branch: SourceClassBranch[];
	/**
	 * The next choice number. A node's offset is no id: `a && b || c`
	 * starts both expressions at `a`.
	 */
	choices: number;
};

/** Visits `node` as an expression that applies only under a condition. */
const visitConditionally = (
	collector: Collector,
	node: AstNode,
	objectMode: "keys" | "values",
	choice: SourceClassBranch,
): boolean => {
	collector.conditional += 1;
	collector.branch.push(choice);
	try {
		return visitClassExpression(collector, node, objectMode);
	} finally {
		collector.conditional -= 1;
		collector.branch.pop();
	}
};

const propertyName = (property: AstNode): string | null => {
	if (property.type !== "Property" || !isNode(property.key)) return null;
	const key = property.key;
	if (property.computed === true) {
		return key.type === "Literal" && typeof key.value === "string"
			? key.value
			: null;
	}
	if (key.type === "Identifier") return String(key.name);
	if (key.type === "Literal" && typeof key.value === "string") return key.value;
	return null;
};

/**
 * Every string literal a class expression can evaluate to, as separate
 * entries: literals, template quasis, both branches of conditionals and
 * logical expressions, array items, nested class calls, and object keys
 * (`clsx({ "p-2": active })`) or object values (`objectMode: "values"`, the
 * slot objects of a tv config). Returns false when a non-literal part was
 * skipped.
 */
const visitClassExpression = (
	collector: Collector,
	node: AstNode,
	objectMode: "keys" | "values",
): boolean => {
	const { out, position } = collector;
	const expression = unwrap(node);
	switch (expression.type) {
		case "Literal": {
			if (typeof expression.value === "string") {
				out.push({
					value: expression.value,
					complete: true,
					conditional: collector.conditional > 0,
					branch: [...collector.branch],
					position: position(expression.start),
				});
				return true;
			}
			return false;
		}
		case "TemplateLiteral": {
			const quasis = (expression.quasis as AstNode[]) ?? [];
			const expressions = (expression.expressions as AstNode[]) ?? [];
			let complete = true;
			const cooked = (index: number) =>
				(quasis[index]?.value as { cooked?: string } | undefined)?.cooked ?? "";
			for (const [index, inner] of expressions.entries()) {
				const first = out.length;
				if (!visitClassExpression(collector, inner, objectMode))
					complete = false;
				// The strings an interpolation yields are whole classes only when
				// whitespace, or the template's start or end, sits on both sides:
				// `[&_.${"x"}]:p-2` makes "x" part of a selector, not a class.
				const before = cooked(index);
				const after = cooked(index + 1);
				const bounded =
					(before === "" ? index === 0 : /\s$/u.test(before)) &&
					(after === ""
						? index === expressions.length - 1
						: /^\s/u.test(after));
				if (!bounded) {
					for (const entry of out.slice(first)) entry.complete = false;
				}
			}
			for (const quasi of quasis) {
				const text = (quasi.value as { cooked?: string }).cooked ?? "";
				if (text.trim().length > 0) {
					out.push({
						value: text,
						complete: expressions.length === 0,
						conditional: collector.conditional > 0,
						branch: [...collector.branch],
						position: position(quasi.start),
					});
				}
			}
			return complete;
		}
		case "JSXExpressionContainer":
			return (
				isNode(expression.expression) &&
				visitClassExpression(collector, expression.expression, objectMode)
			);
		case "ConditionalExpression": {
			const choice = collector.choices++;
			const left =
				isNode(expression.consequent) &&
				visitConditionally(collector, expression.consequent, objectMode, {
					choice,
					side: 0,
				});
			const right =
				isNode(expression.alternate) &&
				visitConditionally(collector, expression.alternate, objectMode, {
					choice,
					side: 1,
				});
			return left && right;
		}
		case "LogicalExpression": {
			// `a || b`, `a && b`, `a ?? b`: the value is one of the operands.
			const choice = collector.choices++;
			const left =
				isNode(expression.left) &&
				visitConditionally(collector, expression.left, objectMode, {
					choice,
					side: 0,
				});
			const right =
				isNode(expression.right) &&
				visitConditionally(collector, expression.right, objectMode, {
					choice,
					side: 1,
				});
			return expression.operator === "&&" ? right : left && right;
		}
		case "ArrayExpression": {
			let complete = true;
			for (const element of (expression.elements as Array<AstNode | null>) ??
				[]) {
				if (element && !visitClassExpression(collector, element, objectMode))
					complete = false;
			}
			return complete;
		}
		case "ObjectExpression": {
			let complete = true;
			for (const property of (expression.properties as AstNode[]) ?? []) {
				if (objectMode === "keys") {
					const name = propertyName(property);
					if (name === null) {
						complete = false;
						continue;
					}
					// `clsx({ "p-2": active })`: the key applies when its value is truthy.
					out.push({
						value: name,
						complete: true,
						conditional: true,
						branch: [...collector.branch],
						position: position(property.start),
					});
					continue;
				}
				if (property.type !== "Property" || !isNode(property.value)) {
					complete = false;
					continue;
				}
				if (!visitClassExpression(collector, property.value, objectMode))
					complete = false;
			}
			return complete;
		}
		case "CallExpression":
			return visitClassCall(collector, expression) ?? false;
		default:
			return false;
	}
};

/**
 * A call to a class call: `tv`/`cva` configs are walked by their known
 * keys (base, slots, variants, compoundVariants, compoundSlots; conditions
 * and defaults are not classes), other class calls by their arguments.
 * `cva(base, options)` takes its base classes from the first argument;
 * a lone cva argument is the config only when it has config keys.
 * Null when the callee is not a class call.
 */
const visitClassCall = (
	collector: Collector,
	call: AstNode,
): boolean | null => {
	const callee = isNode(call.callee) ? memberPath(call.callee) : null;
	if (
		!callee ||
		callee.members.length > 0 ||
		!collector.classCalls.has(callee.root)
	) {
		return null;
	}
	collector.handledCalls.add(call);
	const args = (call.arguments as AstNode[]) ?? [];
	if (!TV_CONFIG_CALLS.includes(callee.root)) {
		let complete = true;
		for (const argument of args) {
			if (!visitClassExpression(collector, argument, "keys")) complete = false;
		}
		return complete;
	}
	let complete = true;
	let configArgument: AstNode | undefined = args[0];
	// `cva(base, options)`: with two arguments the first is always the base,
	// a class value (strings, nested arrays, clsx-style objects), and the
	// second a config like tv's. One argument is the config (cva 1.x, tv),
	// unless it is not an object with config keys: then it is the base.
	if (callee.root === "cva" && args[0]) {
		const first = unwrap(args[0]);
		const isBase =
			args.length > 1 ||
			first.type !== "ObjectExpression" ||
			!((first.properties as AstNode[]) ?? []).some((property) => {
				const name = propertyName(property);
				return name !== null && TV_CONFIG_KEYS.has(name);
			});
		if (isBase) {
			if (!visitClassExpression(collector, args[0], "keys")) complete = false;
			configArgument = args[1];
			if (!configArgument) return complete;
		}
	}
	const config = configArgument ? unwrap(configArgument) : null;
	if (!config || config.type !== "ObjectExpression") {
		return false;
	}
	const leaf = (node: AstNode) => {
		if (!visitClassExpression(collector, node, "values")) complete = false;
	};
	const compoundList = (node: AstNode) => {
		const list = unwrap(node);
		if (list.type !== "ArrayExpression") {
			complete = false;
			return;
		}
		for (const element of (list.elements as Array<AstNode | null>) ?? []) {
			const entry = element ? unwrap(element) : null;
			if (!entry || entry.type !== "ObjectExpression") {
				complete = false;
				continue;
			}
			for (const property of (entry.properties as AstNode[]) ?? []) {
				const name = propertyName(property);
				if (name !== null && TV_CLASS_KEYS.has(name) && isNode(property.value))
					leaf(property.value);
			}
		}
	};
	for (const property of (config.properties as AstNode[]) ?? []) {
		const name = propertyName(property);
		if (name === null || !isNode(property.value)) continue;
		if (name === "base" || name === "slots") {
			leaf(property.value);
		} else if (name === "variants") {
			const axes = unwrap(property.value);
			if (axes.type !== "ObjectExpression") {
				complete = false;
				continue;
			}
			for (const axis of (axes.properties as AstNode[]) ?? []) {
				if (!isNode(axis.value)) continue;
				const values = unwrap(axis.value);
				if (values.type !== "ObjectExpression") {
					complete = false;
					continue;
				}
				for (const value of (values.properties as AstNode[]) ?? []) {
					if (isNode(value.value)) leaf(value.value);
				}
			}
		} else if (name === "compoundVariants" || name === "compoundSlots") {
			compoundList(property.value);
		}
	}
	return complete;
};

const collectClassStrings = (
	node: AstNode,
	classCalls: ReadonlySet<string>,
	position: (offset: number) => SourcePosition,
	handledCalls: Set<AstNode>,
	expression: SourcePosition,
): Array<Collected & { mixed: boolean; expression: SourcePosition }> => {
	const collector: Collector = {
		out: [],
		classCalls,
		position,
		handledCalls,
		conditional: 0,
		branch: [],
		choices: 0,
	};
	const unwrapped = unwrap(node);
	const complete =
		unwrapped.type === "CallExpression"
			? (visitClassCall(collector, unwrapped) ??
				visitClassExpression(collector, unwrapped, "keys"))
			: visitClassExpression(collector, unwrapped, "keys");
	return collector.out.map((entry) => ({
		...entry,
		mixed: !complete,
		expression,
	}));
};

const callArgument = (node: AstNode): SourceCallArgument => {
	const expression = unwrap(node);
	if (expression.type === "ObjectExpression") {
		const argument: SourceObjectArgument = {
			kind: "object",
			properties: {},
			keys: [],
			members: [],
			hasSpread: false,
			hasComputed: false,
		};
		for (const property of (expression.properties as AstNode[]) ?? []) {
			if (property.type === "SpreadElement") {
				argument.hasSpread = true;
				argument.members.push({ kind: "spread" });
				continue;
			}
			const name = property.type === "Property" ? propertyName(property) : null;
			if (name === null) {
				argument.hasComputed = true;
				argument.members.push({ kind: "computed" });
				continue;
			}
			argument.properties[name] =
				property.shorthand === true
					? { kind: "unknown" }
					: literalValue(property.value as AstNode);
			argument.keys.push(name);
			argument.members.push({ kind: "property", key: name });
		}
		return argument;
	}
	return literalValue(expression);
};

const callRef = (
	call: AstNode,
	position: (offset: number) => SourcePosition,
): SourceCallRef | null => {
	if (!isNode(call.callee)) return null;
	const callee = memberPath(call.callee);
	if (callee) {
		return {
			callee: formatName(callee),
			root: callee.root,
			members: callee.members,
			position: position(call.start),
		};
	}
	const receiver = callOrigin(call.callee, position);
	return receiver
		? {
				callee: formatReceiverCallee(receiver),
				root: receiver.call.root,
				members: receiver.path,
				position: position(call.start),
			}
		: null;
};

const formatReceiverCallee = (receiver: SourceCallOrigin) =>
	[`${receiver.call.callee}()`, ...receiver.path].join(".");

/**
 * The call an expression's value comes from and the member path taken
 * from its result: `f()` -> `[]`, `f().root` -> `["root"]`,
 * `(await f()).root` -> `["root"]`, `f().a().b` -> the `f().a()` call and
 * `["b"]`. Null when the expression does not start with a call.
 */
const callOrigin = (
	node: AstNode,
	position: (offset: number) => SourcePosition,
): SourceCallOrigin | null => {
	const expression = unwrap(node);
	if (expression.type === "AwaitExpression" && isNode(expression.argument)) {
		return callOrigin(expression.argument, position);
	}
	if (expression.type === "CallExpression") {
		const call = callRef(expression, position);
		return call ? { call, path: [] } : null;
	}
	if (
		expression.type === "MemberExpression" &&
		isNode(expression.object) &&
		isNode(expression.property) &&
		expression.computed !== true &&
		expression.property.type === "Identifier"
	) {
		const origin = callOrigin(expression.object, position);
		return origin
			? { ...origin, path: [...origin.path, String(expression.property.name)] }
			: null;
	}
	return null;
};

/** The bindings a pattern introduces, with their property paths. */
const collectBindings = (
	id: AstNode,
	path: string[],
	out: Array<{ name: string; path: string[] | null; position: number }>,
) => {
	const target = unwrap(id);
	if (target.type === "Identifier") {
		out.push({ name: String(target.name), path, position: target.start });
		return;
	}
	if (target.type === "AssignmentPattern" && isNode(target.left)) {
		collectBindings(target.left, path, out);
		return;
	}
	if (target.type === "RestElement" && isNode(target.argument)) {
		// `...rest` holds what is left, not one property: no path.
		collectBindings(target.argument, [], out);
		const last = out[out.length - 1];
		if (last) last.path = null;
		return;
	}
	if (target.type === "ObjectPattern") {
		for (const property of (target.properties as AstNode[]) ?? []) {
			if (property.type === "RestElement") {
				collectBindings(property, path, out);
				continue;
			}
			if (property.type !== "Property" || !isNode(property.value)) continue;
			const key = propertyName(property);
			if (key === null) continue;
			collectBindings(property.value, [...path, key], out);
		}
		return;
	}
	if (target.type === "ArrayPattern") {
		((target.elements as Array<AstNode | null>) ?? []).forEach(
			(element, index) => {
				if (element) collectBindings(element, [...path, String(index)], out);
			},
		);
	}
};

const comparePositions = (left: SourcePosition, right: SourcePosition) =>
	left.line - right.line || left.column - right.column;

/** The innermost scope whose span contains `position`. */
const scopeAt = (
	module: Pick<SourceModule, "scopes">,
	position: SourcePosition,
): SourceScope | null => {
	let found: SourceScope | null = null;
	let depth = -1;
	for (const scope of module.scopes) {
		if (
			comparePositions(scope.start, position) > 0 ||
			comparePositions(position, scope.end) > 0
		) {
			continue;
		}
		let scopeDepth = 0;
		for (let parent = scope.parent; parent !== null; ) {
			scopeDepth += 1;
			parent = module.scopes[parent]?.parent ?? null;
		}
		if (scopeDepth > depth) {
			found = scope;
			depth = scopeDepth;
		}
	}
	return found;
};

/**
 * The binding `name` refers to at `position`: the innermost enclosing
 * scope that declares it wins, as in the language. Within one scope the
 * last declaration before the use is taken (`var` redeclarations), else
 * the first (hoisted functions). Null for an undeclared name.
 */
export const resolveBinding = (
	module: Pick<SourceModule, "scopes">,
	name: string,
	position: SourcePosition,
): { binding: SourceBinding; scope: SourceScope } | null => {
	for (
		let scope = scopeAt(module, position);
		scope;
		scope = scope.parent === null ? null : (module.scopes[scope.parent] ?? null)
	) {
		const candidates = scope.bindings.filter((entry) => entry.name === name);
		if (candidates.length === 0) continue;
		const before = candidates.filter(
			(entry) => comparePositions(entry.position, position) <= 0,
		);
		return { binding: before[before.length - 1] ?? candidates[0], scope };
	}
	return null;
};

/**
 * The call a call site's receiver comes from, with the full member path
 * from that call's result to the callee:
 *
 * - `s.title()` after `const s = buttonVariants()`: the `buttonVariants()`
 *   call and `["title"]`, resolved through the scope tree, so a shadowing
 *   `const s`, parameter or destructured name in an inner scope wins.
 * - `buttonVariants().root()`: the `buttonVariants()` call and `["root"]`.
 * - `s.root().x()` or `f().a().b()`: followed recursively.
 *
 * Null when the receiver is not a call result: an undeclared name, a
 * binding not initialised from a call, a parameter. Assignments after
 * declaration are not followed.
 */
export const traceCallOrigin = (
	module: Pick<SourceModule, "scopes" | "calls">,
	call: SourceCall,
	depth = 16,
): SourceCallOrigin | null => {
	if (depth < 0) return null;
	if (call.receiver) {
		const inner = module.calls.find(
			(entry) =>
				comparePositions(
					entry.position,
					call.receiver?.call.position ?? entry.position,
				) === 0 && entry.callee === call.receiver?.call.callee,
		);
		const base = inner
			? (traceCallOrigin(module, inner, depth - 1) ?? {
					call: call.receiver.call,
					path: [],
				})
			: { call: call.receiver.call, path: [] };
		return { call: base.call, path: [...base.path, ...call.receiver.path] };
	}
	const resolved = resolveBinding(module, call.root, call.position);
	if (!resolved?.binding.origin) return null;
	return {
		call: resolved.binding.origin.call,
		path: [...resolved.binding.origin.path, ...call.members],
	};
};

const describeError = (
	error: { message: string; labels?: Array<{ start: number }> },
	position: (offset: number) => SourcePosition,
) => {
	const label = error.labels?.[0];
	if (!label) return error.message;
	const { line, column } = position(label.start);
	return `${line}:${column} ${error.message}`;
};

const langFor = (file: string): "ts" | "tsx" | "js" | "jsx" => {
	if (file.endsWith(".tsx")) return "tsx";
	if (file.endsWith(".ts") || file.endsWith(".mts") || file.endsWith(".cts"))
		return "ts";
	if (file.endsWith(".jsx")) return "jsx";
	return "js";
};

/** Parse one module. `file` is the project-relative path, used for locations. */
export function parseSourceModule(
	file: string,
	text: string,
	options: ParseSourceOptions,
): SourceModule {
	const lines = createLineIndex(text);
	const position = lines.position;
	const classCalls = new Set(options.classCalls);
	const result = parseSync(file, text, {
		lang: langFor(file),
		sourceType: "module",
	});
	const module: SourceModule = {
		file,
		imports: [],
		exports: [],
		reexports: [],
		jsx: [],
		classStrings: [],
		calls: [],
		callResultUses: [],
		scopes: [],
		declarations: [],
		codegenHeader: parseCodegenHeader(text),
		errors: result.errors
			.filter((error) => error.severity === "Error")
			.map((error) => describeError(error, position)),
		lineCount: lines.lineCount,
	};

	for (const entry of result.module.staticImports) {
		module.imports.push({
			specifier: entry.moduleRequest.value,
			resolved: null,
			names: entry.entries.map((name) => ({
				imported:
					name.importName.kind === "Default"
						? "default"
						: name.importName.kind === "NamespaceObject"
							? "*"
							: (name.importName.name ?? name.localName.value),
				local: name.localName.value,
				type: name.isType,
			})),
			position: position(entry.start),
		});
	}
	for (const statement of result.module.staticExports) {
		const reexports = new Map<string, SourceReexport>();
		for (const entry of statement.entries) {
			if (entry.moduleRequest) {
				const specifier = entry.moduleRequest.value;
				const existing = reexports.get(specifier) ?? {
					specifier,
					resolved: null,
					names: [],
					type: true,
					position: position(statement.start),
				};
				existing.names.push(
					entry.importName.kind === "AllButDefault"
						? { imported: "*", exported: null, type: entry.isType }
						: entry.importName.kind === "All"
							? {
									imported: "*",
									exported: entry.exportName.name,
									type: entry.isType,
								}
							: {
									imported: entry.importName.name ?? "default",
									exported:
										entry.exportName.kind === "Default"
											? "default"
											: entry.exportName.name,
									type: entry.isType,
								},
				);
				existing.type = existing.names.every((name) => name.type);
				reexports.set(specifier, existing);
				continue;
			}
			module.exports.push({
				name:
					entry.exportName.kind === "Default"
						? "default"
						: (entry.exportName.name ?? "default"),
				local: entry.localName.name,
				type: entry.isType,
			});
		}
		module.reexports.push(...reexports.values());
	}

	const handledCalls = new Set<AstNode>();
	// Member accesses off a call result that are a call's callee, and inner
	// accesses of a chain already recorded by the outermost one.
	const invokedAccesses = new Set<AstNode>();
	const recordedAccesses = new Set<AstNode>();

	const openScope = (
		kind: SourceScopeKind,
		node: AstNode,
		parent: number | null,
	): number => {
		const id = module.scopes.length;
		module.scopes.push({
			id,
			parent,
			kind,
			start: position(node.start),
			end: position(node.end),
			bindings: [],
		});
		return id;
	};
	const bind = (
		scope: number,
		name: string,
		kind: SourceBindingKind,
		offset: number,
		origin: SourceCallOrigin | null,
	) => {
		const bindingPosition = position(offset);
		module.scopes[scope].bindings.push({
			name,
			kind,
			position: bindingPosition,
			origin,
		});
		if (origin) {
			module.declarations.push({
				name,
				call: origin.call,
				path: origin.path,
				scope,
				position: bindingPosition,
			});
		}
	};
	const bindPattern = (
		scope: number,
		pattern: AstNode,
		kind: SourceBindingKind,
		origin: SourceCallOrigin | null,
	) => {
		const bindings: Array<{
			name: string;
			path: string[] | null;
			position: number;
		}> = [];
		collectBindings(pattern, [], bindings);
		for (const binding of bindings) {
			bind(
				scope,
				binding.name,
				kind,
				binding.position,
				origin && binding.path !== null
					? { call: origin.call, path: [...origin.path, ...binding.path] }
					: null,
			);
		}
	};
	/** The nearest function or module scope, where `var` lands. */
	const functionScope = (scope: number) => {
		let current = scope;
		while (
			module.scopes[current].kind !== "function" &&
			module.scopes[current].kind !== "module"
		) {
			current = module.scopes[current].parent ?? 0;
		}
		return current;
	};
	const bindParameters = (scope: number, params: AstNode[]) => {
		for (const param of params) {
			// TS parameter properties (`constructor(private x)`) wrap the pattern.
			const pattern =
				param.type === "TSParameterProperty" && isNode(param.parameter)
					? param.parameter
					: param;
			bindPattern(scope, pattern, "parameter", null);
		}
	};

	const visit = (node: AstNode, scope: number) => {
		if (node.type === "JSXElement" && isNode(node.openingElement)) {
			const opening = node.openingElement;
			const name = isNode(opening.name) ? memberPath(opening.name) : null;
			if (name) {
				const attributes: SourceJsxAttribute[] = [];
				const spreads: SourcePosition[] = [];
				for (const attribute of (opening.attributes as AstNode[]) ?? []) {
					if (attribute.type === "JSXSpreadAttribute") {
						spreads.push(position(attribute.start));
						continue;
					}
					if (attribute.type !== "JSXAttribute" || !isNode(attribute.name))
						continue;
					const attributeName = memberPath(attribute.name);
					if (!attributeName) continue;
					const value = isNode(attribute.value)
						? literalValue(attribute.value)
						: ({ kind: "literal", value: true } as const);
					attributes.push({
						name: attributeName.root,
						value,
						position: position(attribute.start),
					});
					if (attributeName.root === "className" && isNode(attribute.value)) {
						for (const collected of collectClassStrings(
							attribute.value,
							classCalls,
							position,
							handledCalls,
							position(attribute.start),
						)) {
							module.classStrings.push({
								...collected,
								origin: {
									kind: "jsx-attribute",
									element: formatName(name),
									attribute: "className",
								},
							});
						}
					}
				}
				module.jsx.push({
					name: formatName(name),
					root: name.root,
					members: name.members,
					attributes,
					spread: spreads.length > 0,
					spreads,
					position: position(opening.start),
				});
			}
		}

		// Scopes and bindings.
		switch (node.type) {
			case "VariableDeclaration": {
				const kind =
					node.kind === "var" ? "var" : node.kind === "let" ? "let" : "const";
				const target = kind === "var" ? functionScope(scope) : scope;
				for (const declarator of (node.declarations as AstNode[]) ?? []) {
					if (!isNode(declarator.id)) continue;
					const origin = isNode(declarator.init)
						? callOrigin(declarator.init, position)
						: null;
					bindPattern(target, declarator.id, kind, origin);
				}
				break;
			}
			case "FunctionDeclaration":
			case "FunctionExpression":
			case "ArrowFunctionExpression": {
				const id =
					isNode(node.id) && node.id.type === "Identifier" ? node.id : null;
				if (id && node.type === "FunctionDeclaration") {
					bind(scope, String(id.name), "function", id.start, null);
				}
				const inner = openScope("function", node, scope);
				if (id && node.type === "FunctionExpression") {
					bind(inner, String(id.name), "function", id.start, null);
				}
				bindParameters(inner, (node.params as AstNode[]) ?? []);
				for (const child of childNodes(node)) {
					if (child === node.id) continue;
					visit(child, inner);
				}
				return;
			}
			case "ClassDeclaration":
			case "ClassExpression": {
				const id =
					isNode(node.id) && node.id.type === "Identifier" ? node.id : null;
				if (id && node.type === "ClassDeclaration") {
					bind(scope, String(id.name), "class", id.start, null);
				}
				const inner = openScope("class", node, scope);
				if (id && node.type === "ClassExpression") {
					bind(inner, String(id.name), "class", id.start, null);
				}
				for (const child of childNodes(node)) {
					if (child === node.id) continue;
					visit(child, inner);
				}
				return;
			}
			case "BlockStatement":
			case "StaticBlock": {
				const inner = openScope("block", node, scope);
				for (const child of childNodes(node)) visit(child, inner);
				return;
			}
			case "ForStatement":
			case "ForInStatement":
			case "ForOfStatement": {
				const inner = openScope("for", node, scope);
				for (const child of childNodes(node)) visit(child, inner);
				return;
			}
			case "CatchClause": {
				const inner = openScope("catch", node, scope);
				if (isNode(node.param)) bindPattern(inner, node.param, "catch", null);
				for (const child of childNodes(node)) {
					if (child === node.param) continue;
					visit(child, inner);
				}
				return;
			}
			case "ImportDeclaration": {
				for (const specifier of (node.specifiers as AstNode[]) ?? []) {
					if (
						isNode(specifier.local) &&
						specifier.local.type === "Identifier"
					) {
						bind(
							scope,
							String(specifier.local.name),
							"import",
							specifier.local.start,
							null,
						);
					}
				}
				break;
			}
			case "TSEnumDeclaration":
			case "TSModuleDeclaration": {
				if (isNode(node.id) && node.id.type === "Identifier") {
					bind(
						scope,
						String(node.id.name),
						node.type === "TSEnumDeclaration" ? "enum" : "namespace",
						node.id.start,
						null,
					);
				}
				break;
			}
			default:
				break;
		}

		if (node.type === "CallExpression" && isNode(node.callee)) {
			const callee = memberPath(node.callee);
			const receiver = callee ? null : callOrigin(node.callee, position);
			if (callee || receiver) {
				const args = (node.arguments as AstNode[]) ?? [];
				const ref = callRef(node, position);
				if (ref) {
					module.calls.push({
						callee: ref.callee,
						root: ref.root,
						members: ref.members,
						arguments: args.map(callArgument),
						receiver,
						position: ref.position,
					});
				}
				if (receiver) {
					invokedAccesses.add(unwrap(node.callee));
				}
				if (
					callee &&
					callee.members.length === 0 &&
					classCalls.has(callee.root) &&
					!handledCalls.has(node)
				) {
					for (const collected of collectClassStrings(
						node,
						classCalls,
						position,
						handledCalls,
						position(node.start),
					)) {
						module.classStrings.push({
							...collected,
							origin: { kind: "call", callee: callee.root },
						});
					}
				}
			}
		}
		if (node.type === "MemberExpression" && !recordedAccesses.has(node)) {
			const origin = callOrigin(node, position);
			if (origin && origin.path.length > 0) {
				module.callResultUses.push({
					...origin,
					invoked: invokedAccesses.has(node),
					position: position(node.start),
				});
				// Inner accesses of this chain belong to this record.
				let inner: AstNode = node;
				while (
					inner.type === "MemberExpression" &&
					isNode(inner.object) &&
					unwrap(inner.object).type === "MemberExpression"
				) {
					inner = unwrap(inner.object);
					recordedAccesses.add(inner);
				}
			}
		}
		for (const child of childNodes(node)) {
			visit(child, scope);
		}
	};
	const program = result.program as unknown as AstNode;
	visit(program, openScope("module", program, null));
	const byOffset = (
		left: { position: SourcePosition },
		right: { position: SourcePosition },
	) =>
		left.position.line - right.position.line ||
		left.position.column - right.position.column;
	module.classStrings.sort(byOffset);
	return module;
}
