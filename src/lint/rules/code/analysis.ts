import type {
	SystemContract,
	SystemContractAxis,
	SystemContractComponent,
} from "../../contract";
import {
	resolveExport,
	type SourceComponentIdentity,
	type SourceIndex,
	type SourceUsage,
} from "../../source/index";
import {
	resolveBinding,
	type SourceCall,
	type SourceCallArgument,
	type SourceCallRef,
	type SourceClassString,
	type SourceJsxElement,
	type SourceLiteralValue,
	type SourceModule,
	type SourcePosition,
	traceCallOrigin,
} from "../../source/parse";
import type { LintLocation, LintRuleContext } from "../types";

/**
 * What the code-side rules share, derived once per run from the source
 * index and the contract (cached on the index): where each component's
 * variants export is in scope in a module, its calls and slot calls, and
 * which export of a wrapper a JSX usage renders. Syntactic, like the
 * source model: a name only counts when it resolves to an import binding
 * at the call, so shadowed names and parameters are skipped.
 */

export type VariantsImport = {
	slug: string;
	/** The local name; for a namespace import, the namespace. */
	local: string;
	/** `import * as ns`: the variants export is `ns.<member>`. */
	namespace: boolean;
	/** The import comes straight from the generated file. */
	direct: boolean;
	position: SourcePosition;
};

export type VariantsCall = {
	slug: string;
	call: SourceCall;
};

export type SlotCall = {
	slug: string;
	slot: string;
	call: SourceCall;
	/** The variants call the slot function comes from. */
	origin: SourceCallRef;
};

export type ModuleVariants = {
	imports: VariantsImport[];
	calls: VariantsCall[];
	slotCalls: SlotCall[];
};

export type CodeAnalysis = {
	components: Map<string, SystemContractComponent>;
	identities: Map<string, SourceComponentIdentity>;
	/** Generated file to the component slug it belongs to. */
	generatedSlug: Map<string, string>;
	/** Variants use per module; generated files are left out. */
	modules: Map<string, ModuleVariants>;
	/**
	 * The index's usages whose element name resolves, at the element, to
	 * the import binding: `<Button>` inside `(Button) => …` is the
	 * parameter, not the component.
	 */
	usages: SourceUsage[];
	/**
	 * Per slug, the modules that implement the component: the index's
	 * wrappers, with a configured barrel replaced by the importers of the
	 * generated file it re-exports (see `implementingModules`).
	 */
	wrappers: Map<string, string[]>;
};

const EMPTY_MODULE_VARIANTS: ModuleVariants = {
	imports: [],
	calls: [],
	slotCalls: [],
};

const cache = new WeakMap<SourceIndex, WeakMap<SystemContract, CodeAnalysis>>();

const comparePositions = (left: SourcePosition, right: SourcePosition) =>
	left.line - right.line || left.column - right.column;

export const codeLocation = (
	file: string,
	position?: SourcePosition,
): LintLocation => ({
	kind: "code",
	file,
	line: position?.line ?? 1,
	column: position?.column ?? 1,
});

/**
 * The defining value behind export `name` of `file`: follows re-exports
 * (`resolveExport`) and then exports of imported bindings
 * (`import { x } from "./a"; export { x }`), so a wrapper that passes its
 * variants export on still leads back to the generated file.
 */
export const resolveValueOrigin = (
	modules: SourceIndex["modules"],
	file: string,
	name: string,
	depth = 8,
): { file: string; name: string } | null => {
	const defining = resolveExport(modules, file, name);
	if (!defining) return null;
	if (depth <= 0 || defining.name === "*") return defining;
	const module = modules[defining.file];
	const local =
		module?.exports.find((entry) => entry.name === defining.name && !entry.type)
			?.local ?? null;
	if (!module || local === null) return defining;
	for (const entry of module.imports) {
		if (entry.resolved === null) continue;
		const imported = entry.names.find(
			(candidate) => candidate.local === local && !candidate.type,
		);
		if (!imported || imported.imported === "*") continue;
		return (
			resolveValueOrigin(
				modules,
				entry.resolved,
				imported.imported,
				depth - 1,
			) ?? defining
		);
	}
	return defining;
};

const analyse = (
	sources: SourceIndex,
	contract: SystemContract,
): CodeAnalysis => {
	const components = new Map(
		contract.components.map((component) => [component.slug, component]),
	);
	const identities = new Map(
		sources.components.map((identity) => [identity.slug, identity]),
	);
	const generatedSlug = new Map<string, string>();
	for (const identity of sources.components) {
		for (const file of identity.generatedFiles) {
			generatedSlug.set(file, identity.slug);
		}
	}

	/** The slug when `file`'s export `name` is a component's variants export. */
	const variantsSlugOf = (file: string, name: string): string | null => {
		const origin = resolveValueOrigin(sources.modules, file, name);
		if (!origin) return null;
		const slug = generatedSlug.get(origin.file);
		if (slug === undefined) return null;
		return components.get(slug)?.exportName === origin.name ? slug : null;
	};

	const modules = new Map<string, ModuleVariants>();
	for (const file of sources.files) {
		if (sources.generated[file] !== undefined) continue;
		const module = sources.modules[file];
		const imports: VariantsImport[] = [];
		const locals = new Map<string, string>();
		const namespaces = new Map<string, string>();
		for (const entry of module.imports) {
			if (entry.resolved === null) continue;
			const direct = generatedSlug.has(entry.resolved);
			for (const name of entry.names) {
				if (name.type) continue;
				if (name.imported === "*") {
					namespaces.set(name.local, entry.resolved);
					const generated = generatedSlug.get(entry.resolved);
					if (generated !== undefined) {
						imports.push({
							slug: generated,
							local: name.local,
							namespace: true,
							direct,
							position: entry.position,
						});
					}
					continue;
				}
				const slug = variantsSlugOf(entry.resolved, name.imported);
				if (slug === null) continue;
				locals.set(name.local, slug);
				imports.push({
					slug,
					local: name.local,
					namespace: false,
					direct,
					position: entry.position,
				});
			}
		}
		if (imports.length === 0 && namespaces.size === 0) continue;

		/** The slug when `ref` calls a variants export through an import binding. */
		const variantsSlugOfRef = (ref: SourceCallRef): string | null => {
			if (ref.callee.includes("(")) return null;
			const binding = resolveBinding(module, ref.root, ref.position);
			if (binding?.binding.kind !== "import") return null;
			if (ref.members.length === 0) return locals.get(ref.root) ?? null;
			const namespace = namespaces.get(ref.root);
			if (namespace === undefined || ref.members.length !== 1) return null;
			return variantsSlugOf(namespace, ref.members[0]);
		};

		const calls: VariantsCall[] = [];
		const slotCalls: SlotCall[] = [];
		for (const call of module.calls) {
			if (call.receiver === null) {
				const slug = variantsSlugOfRef(call);
				if (slug !== null) {
					calls.push({ slug, call });
					continue;
				}
			}
			const origin = traceCallOrigin(module, call);
			if (!origin || origin.path.length !== 1) continue;
			const slug = variantsSlugOfRef(origin.call);
			if (slug === null) continue;
			const slot = origin.path[0];
			if (!components.get(slug)?.slots.some((entry) => entry.key === slot))
				continue;
			slotCalls.push({ slug, slot, call, origin: origin.call });
		}
		if (imports.length > 0 || calls.length > 0) {
			modules.set(file, { imports, calls, slotCalls });
		}
	}

	const usages = sources.usages.filter(
		(usage) =>
			resolveBinding(
				sources.modules[usage.file],
				usage.element.root,
				usage.element.position,
			)?.binding.kind === "import",
	);

	const wrappers = new Map(
		sources.components.map((identity) => [
			identity.slug,
			implementingModules(sources.modules, identity),
		]),
	);

	return { components, identities, generatedSlug, modules, usages, wrappers };
};

/**
 * The modules that implement a component. Without configuration they are
 * the index's wrappers (the importers of the generated file). A
 * configured module that imports the generated file is itself the
 * implementation; one that does not (a barrel) is followed through its
 * re-exports (`export { x } from`, `export * from`, and exported
 * imports) to the importers of the generated file it reaches. The index
 * binds usages through the configured barrel already (`resolveExport`'s
 * chain); this is the other direction, from the barrel down to the
 * code. A configured module that reaches no importer stays as it is, so
 * the rules still report it.
 */
export const implementingModules = (
	modules: SourceIndex["modules"],
	identity: Pick<
		SourceComponentIdentity,
		"wrappers" | "configuredWrappers" | "importers"
	>,
): string[] => {
	if (identity.configuredWrappers.length === 0) return identity.wrappers;
	const importers = new Set(identity.importers);
	const found = new Set<string>();
	for (const wrapper of identity.wrappers) {
		if (importers.has(wrapper)) {
			found.add(wrapper);
			continue;
		}
		const reached = new Set<string>();
		const visit = (file: string, depth: number) => {
			const module = modules[file];
			if (!module || depth < 0) return;
			const next: string[] = [];
			for (const entry of module.reexports) {
				if (entry.resolved && entry.names.some((name) => !name.type))
					next.push(entry.resolved);
			}
			const exported = new Set(
				module.exports.flatMap((entry) =>
					!entry.type && entry.local !== null ? [entry.local] : [],
				),
			);
			for (const entry of module.imports) {
				if (
					entry.resolved &&
					entry.names.some((name) => !name.type && exported.has(name.local))
				)
					next.push(entry.resolved);
			}
			for (const target of next) {
				if (reached.has(target) || target === wrapper) continue;
				reached.add(target);
				visit(target, depth - 1);
			}
		};
		visit(wrapper, 8);
		const implementations = [...reached].filter((file) => importers.has(file));
		if (implementations.length === 0) found.add(wrapper);
		for (const file of implementations) found.add(file);
	}
	return [...found].sort();
};

/** The shared analysis of a run, computed once per source index and contract. */
export const getCodeAnalysis = (
	context: Pick<LintRuleContext, "sources" | "contract">,
): CodeAnalysis => {
	let byContract = cache.get(context.sources);
	if (!byContract) {
		byContract = new WeakMap();
		cache.set(context.sources, byContract);
	}
	let analysis = byContract.get(context.contract);
	if (!analysis) {
		analysis = analyse(context.sources, context.contract);
		byContract.set(context.contract, analysis);
	}
	return analysis;
};

export const moduleVariants = (
	analysis: CodeAnalysis,
	file: string,
): ModuleVariants => analysis.modules.get(file) ?? EMPTY_MODULE_VARIANTS;

const stem = (file: string) => {
	const name = file.slice(file.lastIndexOf("/") + 1);
	const dot = name.indexOf(".");
	return dot === -1 ? name : name.slice(0, dot);
};

/**
 * The importer named like the component when no wrapper is configured:
 * `button.tsx` or `button/index.tsx` for slug `button` (or for the
 * generated file's stem). Null when none or several match.
 */
export const conventionalWrapper = (
	slug: string,
	identity: Pick<SourceComponentIdentity, "importers" | "generatedFiles">,
): string | null => {
	const names = new Set([slug, ...identity.generatedFiles.map(stem)]);
	const matches = identity.importers.filter((file) => {
		const own = stem(file);
		if (own === "index") {
			const parts = file.split("/");
			return names.has(parts[parts.length - 2] ?? "");
		}
		return names.has(own);
	});
	return matches.length === 1 ? matches[0] : null;
};

/**
 * The component's own wrapper(s), for rules that exempt it: the
 * configured modules (a barrel resolved to its implementations); else the only importer; else the importer named
 * like the component; else, when that is ambiguous, every importer.
 */
export const componentWrappers = (
	analysis: CodeAnalysis,
	identity: SourceComponentIdentity,
): string[] => {
	if (identity.configuredWrappers.length > 0 || identity.wrappers.length < 2)
		return analysis.wrappers.get(identity.slug) ?? identity.wrappers;
	const conventional = conventionalWrapper(identity.slug, identity);
	return conventional ? [conventional] : identity.wrappers;
};

/** `otp-field` -> `OtpField`, `OTP field` -> `OTPField`. */
export const pascalCase = (value: string): string =>
	value
		.split(/[^A-Za-z0-9]+/u)
		.filter((part) => part.length > 0)
		.map((part) => part[0].toUpperCase() + part.slice(1))
		.join("");

/**
 * What a JSX usage renders: the export name in its defining module, and
 * whether the element names a member of it (`<Card.Title>`), which is a
 * part, not the component.
 */
const usageExport = (
	sources: SourceIndex,
	usage: SourceUsage,
): { file: string; name: string; member: boolean } | null => {
	const module = sources.modules[usage.file];
	const element = usage.element;
	for (const entry of module?.imports ?? []) {
		if (entry.resolved === null) continue;
		const imported = entry.names.find(
			(name) => name.local === element.root && !name.type,
		);
		if (!imported) continue;
		const namespace = imported.imported === "*";
		if (namespace && element.members.length === 0) return null;
		const name = namespace ? element.members[0] : imported.imported;
		const defining = resolveExport(sources.modules, entry.resolved, name);
		return {
			file: defining?.file ?? entry.resolved,
			name: defining?.name ?? name,
			member: element.members.length > (namespace ? 1 : 0),
		};
	}
	return null;
};

/**
 * Whether a usage renders the component itself rather than one of the
 * other exports of its wrapper (`CardTitle` next to `Card`). The component
 * is the default export or the export named after the slug or the name
 * (`Button`, `OtpField`); a wrapper that exports none of those has no
 * recognisable main export, so every export counts. Members
 * (`<Card.Title>`) never count.
 */
export const isComponentUsage = (
	sources: SourceIndex,
	component: SystemContractComponent,
	usage: SourceUsage,
): boolean => {
	const target = usageExport(sources, usage);
	if (!target || target.member) return false;
	const names = new Set(
		[pascalCase(component.slug), pascalCase(component.name), "default"].filter(
			(name) => name.length > 0,
		),
	);
	if (names.has(target.name)) return true;
	const defining = sources.modules[target.file];
	return !defining?.exports.some(
		(entry) => !entry.type && names.has(entry.name),
	);
};

/**
 * The attribute `name` of a JSX element as far as it is known: absent,
 * or its value. A literal followed by a `{...spread}` (in source order)
 * may be overridden at runtime, so its value is `unknown`; a spread
 * before it does not matter.
 */
export const jsxAttributeValue = (
	element: SourceJsxElement,
	name: string,
): SourceLiteralValue | null => {
	const attribute = element.attributes.findLast((entry) => entry.name === name);
	if (!attribute) return null;
	return spreadFollows(element, attribute.position)
		? { kind: "unknown" }
		: attribute.value;
};

/** A `{...spread}` comes after `position` on the element, so it may override what is there. */
export const spreadFollows = (
	element: SourceJsxElement,
	position: SourcePosition,
): boolean =>
	element.spreads.some((spread) => comparePositions(spread, position) > 0);

/** A literal as the variant key tailwind-variants would look up; null when unset or dynamic. */
export const literalVariantKey = (value: SourceLiteralValue): string | null => {
	if (value.kind === "string") return value.value;
	if (value.kind === "literal" && value.value !== null)
		return String(value.value);
	return null;
};

export const axisAccepts = (axis: SystemContractAxis, key: string): boolean =>
	axis.boolean
		? key === "true" || key === "false"
		: axis.values.some((value) => value.key === key);

export const describeAxisValues = (axis: SystemContractAxis): string =>
	axis.boolean
		? "true or false"
		: axis.values.length === 0
			? "no values"
			: axis.values.map((value) => `"${value.key}"`).join(", ");

export const objectArgument = (
	argument: SourceCallArgument | undefined,
): Extract<SourceCallArgument, { kind: "object" }> | null =>
	argument?.kind === "object" ? argument : null;

/**
 * The class strings of a usage's `className` attribute. Class strings carry
 * the element name, not the element, so the attribute's span is bounded by
 * the next attribute of the element and the next JSX element of the module
 * (elements are recorded in pre-order, so that is a child or a sibling).
 */
export const usageClassStrings = (
	module: SourceModule,
	usage: SourceUsage,
): SourceClassString[] => {
	const element = usage.element;
	const index = element.attributes.findIndex(
		(attribute) => attribute.name === "className",
	);
	if (index === -1) return [];
	const start = element.attributes[index].position;
	const bounds: SourcePosition[] = [];
	const nextAttribute = element.attributes[index + 1];
	if (nextAttribute) bounds.push(nextAttribute.position);
	const nextElement = module.jsx.find(
		(candidate) => comparePositions(candidate.position, element.position) > 0,
	);
	if (nextElement) bounds.push(nextElement.position);
	return module.classStrings.filter(
		(entry) =>
			entry.origin.kind === "jsx-attribute" &&
			entry.origin.element === element.name &&
			comparePositions(entry.position, start) >= 0 &&
			bounds.every((bound) => comparePositions(entry.position, bound) < 0),
	);
};

/**
 * Where `classToken` sits inside a class string, for a finding location:
 * the literal's position moved past its opening quote and to the class.
 * Falls back to the literal's position when the class is not found.
 */
export const classTokenPosition = (
	entry: SourceClassString,
	classToken: string,
): SourcePosition => {
	const pattern = new RegExp(
		`(^|\\s)${classToken.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=\\s|$)`,
		"u",
	);
	const match = pattern.exec(entry.value);
	if (!match) return entry.position;
	const index = match.index + match[1].length;
	const before = entry.value.slice(0, index);
	const lastBreak = before.lastIndexOf("\n");
	if (lastBreak === -1) {
		return {
			line: entry.position.line,
			column: entry.position.column + 1 + index,
		};
	}
	return {
		line: entry.position.line + (before.match(/\n/gu)?.length ?? 0),
		column: index - lastBreak,
	};
};

/** Message for options a rule ignored, as an `info` finding. */
export const optionsNote = (ruleId: string, problems: string[]) => ({
	severity: "info" as const,
	message: `lint.json rules["${ruleId}"].options: ${problems.join(" ")}`,
	location: null,
});
