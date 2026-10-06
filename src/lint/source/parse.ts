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
	/** `imported` is `*` for `export * from`; `exported` is null then. */
	names: Array<{ imported: string; exported: string | null }>;
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
	position: SourcePosition;
};

export type SourceClassStringOrigin =
	| { kind: "jsx-attribute"; element: string; attribute: string }
	| { kind: "call"; callee: string };

export type SourceClassString = {
	value: string;
	origin: SourceClassStringOrigin;
	/** False for a template literal fragment (`q-${n}` yields `q-`). */
	complete: boolean;
	/** The enclosing expression also had parts that are not literals. */
	mixed: boolean;
	position: SourcePosition;
};

export type SourceCallArgument =
	| { kind: "object"; properties: Record<string, SourceLiteralValue> }
	| SourceLiteralValue;

export type SourceCall = {
	/** As written: `buttonVariants` or `styles.root`. */
	callee: string;
	/** The first identifier: `styles` for `styles.root()`. */
	root: string;
	/** Member path after the root. */
	members: string[];
	arguments: SourceCallArgument[];
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

type Collected = { value: string; complete: boolean; position: SourcePosition };

/** Calls whose first argument is a tailwind-variants or cva config object. */
export const TV_CONFIG_CALLS: readonly string[] = ["tv", "cva"];

const TV_CLASS_KEYS = new Set(["class", "className"]);

type Collector = {
	out: Collected[];
	classCalls: ReadonlySet<string>;
	position: (offset: number) => SourcePosition;
	handledCalls: Set<AstNode>;
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
			for (const inner of expressions) {
				if (!visitClassExpression(collector, inner, objectMode))
					complete = false;
			}
			for (const quasi of quasis) {
				const cooked = (quasi.value as { cooked?: string }).cooked ?? "";
				if (cooked.trim().length > 0) {
					out.push({
						value: cooked,
						complete: expressions.length === 0,
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
			const left =
				isNode(expression.consequent) &&
				visitClassExpression(collector, expression.consequent, objectMode);
			const right =
				isNode(expression.alternate) &&
				visitClassExpression(collector, expression.alternate, objectMode);
			return left && right;
		}
		case "LogicalExpression": {
			const left =
				isNode(expression.left) &&
				visitClassExpression(collector, expression.left, objectMode);
			const right =
				isNode(expression.right) &&
				visitClassExpression(collector, expression.right, objectMode);
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
					out.push({
						value: name,
						complete: true,
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
	const config = args[0] ? unwrap(args[0]) : null;
	if (!config || config.type !== "ObjectExpression") {
		return false;
	}
	let complete = true;
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
): Array<Collected & { mixed: boolean }> => {
	const collector: Collector = { out: [], classCalls, position, handledCalls };
	const unwrapped = unwrap(node);
	const complete =
		unwrapped.type === "CallExpression"
			? (visitClassCall(collector, unwrapped) ??
				visitClassExpression(collector, unwrapped, "keys"))
			: visitClassExpression(collector, unwrapped, "keys");
	return collector.out.map((entry) => ({ ...entry, mixed: !complete }));
};

const callArgument = (node: AstNode): SourceCallArgument => {
	const expression = unwrap(node);
	if (expression.type === "ObjectExpression") {
		const properties: Record<string, SourceLiteralValue> = {};
		for (const property of (expression.properties as AstNode[]) ?? []) {
			if (
				property.type !== "Property" ||
				property.computed === true ||
				!isNode(property.key)
			) {
				continue;
			}
			const key = property.key;
			const name =
				key.type === "Identifier"
					? String(key.name)
					: key.type === "Literal" && typeof key.value === "string"
						? key.value
						: null;
			if (name === null) continue;
			properties[name] =
				property.shorthand === true
					? { kind: "unknown" }
					: literalValue(property.value as AstNode);
		}
		return { kind: "object", properties };
	}
	return literalValue(expression);
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
					type: entry.isType,
					position: position(statement.start),
				};
				existing.names.push(
					entry.importName.kind === "AllButDefault"
						? { imported: "*", exported: null }
						: entry.importName.kind === "All"
							? { imported: "*", exported: entry.exportName.name }
							: {
									imported: entry.importName.name ?? "default",
									exported:
										entry.exportName.kind === "Default"
											? "default"
											: entry.exportName.name,
								},
				);
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
	const visit = (node: AstNode) => {
		if (node.type === "JSXElement" && isNode(node.openingElement)) {
			const opening = node.openingElement;
			const name = isNode(opening.name) ? memberPath(opening.name) : null;
			if (name) {
				const attributes: SourceJsxAttribute[] = [];
				let spread = false;
				for (const attribute of (opening.attributes as AstNode[]) ?? []) {
					if (attribute.type === "JSXSpreadAttribute") {
						spread = true;
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
					spread,
					position: position(opening.start),
				});
			}
		}
		if (node.type === "CallExpression" && isNode(node.callee)) {
			const callee = memberPath(node.callee);
			if (callee) {
				const args = (node.arguments as AstNode[]) ?? [];
				module.calls.push({
					callee: formatName(callee),
					root: callee.root,
					members: callee.members,
					arguments: args.map(callArgument),
					position: position(node.start),
				});
				if (
					callee.members.length === 0 &&
					classCalls.has(callee.root) &&
					!handledCalls.has(node)
				) {
					for (const collected of collectClassStrings(
						node,
						classCalls,
						position,
						handledCalls,
					)) {
						module.classStrings.push({
							...collected,
							origin: { kind: "call", callee: callee.root },
						});
					}
				}
			}
		}
		for (const child of childNodes(node)) {
			visit(child);
		}
	};
	visit(result.program as unknown as AstNode);
	const byOffset = (
		left: { position: SourcePosition },
		right: { position: SourcePosition },
	) =>
		left.position.line - right.position.line ||
		left.position.column - right.position.column;
	module.classStrings.sort(byOffset);
	return module;
}
