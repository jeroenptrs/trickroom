import type { CodegenHeader } from "../../codegen/header";
import type { SystemContract } from "../contract";
import {
	resolveBinding,
	type SourceJsxElement,
	type SourceModule,
	type SourcePosition,
} from "./parse";

/**
 * The project index over parsed modules: resolved relative imports, the
 * generated variants files, each component's identity (which module is its
 * bound wrapper) and every JSX usage of a component. Pure: built from
 * `SourceModule`s and the contract, no filesystem. The rules of WP3 read
 * it; the report's heat map counts come from it.
 *
 * Identity (docs/proposals/design-system-lint.md, "Component identity"):
 * the module that imports a generated variants file is that component's
 * wrapper; its exports are the bound React components. A re-export
 * (`export { x } from "./button.variants"`) borrows the styling and does
 * not bind. `lint.json` `components[slug].module` overrides the wrapper
 * for barrels and renamed wrappers.
 */

export const RESOLVE_EXTENSIONS = [
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
] as const;

const INDEX_FILES = RESOLVE_EXTENSIONS.map((extension) => `index.${extension}`);

const normalizePath = (value: string) => {
	const segments: string[] = [];
	for (const segment of value.split("/")) {
		if (segment === "" || segment === ".") continue;
		if (segment === "..") {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return segments.join("/");
};

const dirname = (file: string) => {
	const index = file.lastIndexOf("/");
	return index === -1 ? "" : file.slice(0, index);
};

/**
 * The scanned module a relative specifier names, trying the bare path, the
 * source extensions, `.js`/`.jsx` rewritten to TypeScript, and an index
 * file. Bare and aliased specifiers (`react`, `@/ui/button`) resolve to
 * null: they need a resolver this syntactic index does not have.
 */
export const resolveModuleSpecifier = (
	fromFile: string,
	specifier: string,
	files: ReadonlySet<string>,
): string | null => {
	if (
		!specifier.startsWith("./") &&
		!specifier.startsWith("../") &&
		specifier !== "." &&
		specifier !== ".."
	) {
		return null;
	}
	const base = normalizePath(`${dirname(fromFile)}/${specifier}`);
	const candidates = [base];
	for (const extension of RESOLVE_EXTENSIONS) {
		candidates.push(`${base}.${extension}`);
	}
	const rewritten = base.replace(/\.(jsx?|mjs|cjs)$/u, "");
	if (rewritten !== base) {
		candidates.push(`${rewritten}.ts`, `${rewritten}.tsx`);
	}
	for (const indexFile of INDEX_FILES) {
		candidates.push(base ? `${base}/${indexFile}` : indexFile);
	}
	return candidates.find((candidate) => files.has(candidate)) ?? null;
};

export type SourceComponentIdentity = {
	slug: string;
	componentId: string;
	/** Where codegen puts the file (outDir + fileName); null without codegen. */
	expectedFile: string | null;
	/** Scanned files carrying this component's codegen header. */
	generatedFiles: string[];
	/**
	 * The bound wrapper module(s): the configured overrides; else the only
	 * importer; else the importer named like the component
	 * (`conventionalWrapper`); else, when that is ambiguous, every importer.
	 */
	wrappers: string[];
	/** Wrappers from `lint.json`, as configured. */
	configuredWrappers: string[];
	/** Configured wrappers that were not scanned (a run diagnostic). */
	missingConfiguredWrappers: string[];
	/** Every module with a value import of a generated file. */
	importers: string[];
	/** Modules re-exporting from a generated file (borrowing the styling). */
	reexporters: string[];
};

export type SourceUsage = {
	file: string;
	slug: string;
	element: SourceJsxElement;
};

export type SourceIndex = {
	/** Every scanned file, sorted. */
	files: string[];
	modules: Record<string, SourceModule>;
	/** Generated variants files of this system, by file. */
	generated: Record<string, CodegenHeader>;
	/** Generated files of this system whose header names no component. */
	unknownGenerated: string[];
	/** One per contract component, sorted by slug. */
	components: SourceComponentIdentity[];
	/**
	 * JSX elements that render a bound component, in file then source order:
	 * the element name resolves through the scope tree to the import, so a
	 * shadowing parameter or local is not a usage. Coverage, the heat map
	 * and the rules all count these.
	 */
	usages: SourceUsage[];
	/** For each module and local name: the component it stands for. */
	bindings: Record<string, Record<string, string>>;
};

export type BuildSourceIndexInput = {
	modules: readonly SourceModule[];
	contract: SystemContract;
	/** `lint.json` component overrides: slug to wrapper modules. */
	componentModules?: Readonly<Record<string, { modules: string[] }>>;
};

const fileStem = (file: string) => {
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
	const names = new Set([slug, ...identity.generatedFiles.map(fileStem)]);
	const matches = identity.importers.filter((file) => {
		const own = fileStem(file);
		if (own === "index") {
			const parts = file.split("/");
			return names.has(parts[parts.length - 2] ?? "");
		}
		return names.has(own);
	});
	return matches.length === 1 ? matches[0] : null;
};

const compareStrings = (left: string, right: string) =>
	left < right ? -1 : left > right ? 1 : 0;

const comparePositions = (left: SourcePosition, right: SourcePosition) =>
	left.line - right.line || left.column - right.column;

export type ResolvedExport = {
	/** The defining module. */
	file: string;
	/** The export's name there. */
	name: string;
	/** Every module visited, from the one asked about to the defining one. */
	chain: string[];
};

/**
 * The module that defines export `name` of `file`, following re-exports
 * through barrels. Returns the defining module, the local export name and
 * the modules visited on the way, or null when the name is not found
 * within `depth` hops.
 */
export const resolveExport = (
	modules: Readonly<Record<string, SourceModule>>,
	file: string,
	name: string,
	depth = 8,
): ResolvedExport | null => {
	const found = resolveExportInner(modules, file, name, depth);
	return found;
};

const resolveExportInner = (
	modules: Readonly<Record<string, SourceModule>>,
	file: string,
	name: string,
	depth: number,
): ResolvedExport | null => {
	const module = modules[file];
	if (!module || depth < 0) return null;
	if (module.exports.some((entry) => entry.name === name && !entry.type)) {
		return { file, name, chain: [file] };
	}
	for (const reexport of module.reexports) {
		if (reexport.resolved === null) continue;
		for (const entry of reexport.names) {
			if (entry.type) continue;
			if (entry.imported === "*" && entry.exported === null) {
				if (name === "default") continue;
				const found = resolveExportInner(
					modules,
					reexport.resolved,
					name,
					depth - 1,
				);
				if (found) return { ...found, chain: [file, ...found.chain] };
			} else if (entry.exported === name) {
				if (entry.imported === "*") {
					// `export * as ns from`: the namespace is the module itself.
					return {
						file: reexport.resolved,
						name: "*",
						chain: [file, reexport.resolved],
					};
				}
				const found = resolveExportInner(
					modules,
					reexport.resolved,
					entry.imported,
					depth - 1,
				);
				return found ? { ...found, chain: [file, ...found.chain] } : null;
			}
		}
	}
	return null;
};

export function buildSourceIndex(input: BuildSourceIndexInput): SourceIndex {
	const files = input.modules.map((module) => module.file).sort(compareStrings);
	const fileSet = new Set(files);
	const modules: Record<string, SourceModule> = {};
	for (const module of input.modules) {
		modules[module.file] = {
			...module,
			imports: module.imports.map((entry) => ({
				...entry,
				resolved: resolveModuleSpecifier(module.file, entry.specifier, fileSet),
			})),
			reexports: module.reexports.map((entry) => ({
				...entry,
				resolved: resolveModuleSpecifier(module.file, entry.specifier, fileSet),
			})),
		};
	}

	const systemId = input.contract.system.id;
	const generated: Record<string, CodegenHeader> = {};
	const generatedByComponent = new Map<string, string[]>();
	const unknownGenerated: string[] = [];
	const knownComponentIds = new Set(
		input.contract.components.map((component) => component.componentId),
	);
	for (const file of files) {
		const header = modules[file].codegenHeader;
		if (!header || header.systemId !== systemId) continue;
		generated[file] = header;
		if (!knownComponentIds.has(header.componentId)) {
			unknownGenerated.push(file);
			continue;
		}
		const list = generatedByComponent.get(header.componentId) ?? [];
		list.push(file);
		generatedByComponent.set(header.componentId, list);
	}

	// Reverse indexes, built once: which modules import or re-export a file.
	const importersByTarget = new Map<string, string[]>();
	const reexportersByTarget = new Map<string, string[]>();
	const link = (index: Map<string, string[]>, target: string, file: string) => {
		const list = index.get(target) ?? [];
		if (list[list.length - 1] !== file) list.push(file);
		index.set(target, list);
	};
	for (const file of files) {
		const module = modules[file];
		for (const entry of module.imports) {
			if (entry.resolved !== null && entry.names.some((name) => !name.type)) {
				link(importersByTarget, entry.resolved, file);
			}
		}
		for (const entry of module.reexports) {
			if (entry.resolved !== null && entry.names.some((name) => !name.type)) {
				link(reexportersByTarget, entry.resolved, file);
			}
		}
	}
	const referrers = (
		index: Map<string, string[]>,
		targets: readonly string[],
	) => {
		const found = new Set<string>();
		for (const target of targets) {
			for (const file of index.get(target) ?? []) {
				if (!targets.includes(file)) found.add(file);
			}
		}
		return [...found].sort(compareStrings);
	};

	const outDir = input.contract.codegen.outDir;
	const wrapperToSlug = new Map<string, string>();
	const components: SourceComponentIdentity[] = input.contract.components.map(
		(component) => {
			const generatedFiles =
				generatedByComponent.get(component.componentId) ?? [];
			const importers = referrers(importersByTarget, generatedFiles);
			const reexporters = referrers(reexportersByTarget, generatedFiles);
			const configuredWrappers = (
				input.componentModules?.[component.slug]?.modules ?? []
			).map(normalizePath);
			// A configured wrapper counts only when it was scanned; a missing
			// one is reported, never silently replaced by the importers.
			const missingConfiguredWrappers = configuredWrappers.filter(
				(file) => !fileSet.has(file),
			);
			// Unconfigured, several importers: the one named like the component
			// is the wrapper and the others borrow its styling (what
			// code.variants-imported-outside-component reports), so a module
			// that also imports another component's variants file is not
			// mistaken for that component.
			const conventional =
				importers.length > 1
					? conventionalWrapper(component.slug, { importers, generatedFiles })
					: null;
			const wrappers =
				configuredWrappers.length > 0
					? configuredWrappers.filter((file) => fileSet.has(file))
					: conventional
						? [conventional]
						: importers;
			for (const wrapper of wrappers) {
				if (!wrapperToSlug.has(wrapper))
					wrapperToSlug.set(wrapper, component.slug);
			}
			return {
				slug: component.slug,
				componentId: component.componentId,
				expectedFile:
					outDir === null
						? null
						: normalizePath(`${outDir}/${component.fileName}`),
				generatedFiles,
				wrappers,
				configuredWrappers,
				missingConfiguredWrappers,
				importers,
				reexporters,
			};
		},
	);

	// Bindings: for each module, which local names stand for a component,
	// following imports through barrels to a wrapper. A configured barrel
	// is itself a wrapper, so every module on the way is checked, nearest
	// to the importer first.
	const bindings: Record<string, Record<string, string>> = {};
	const slugOfExport = (file: string, name: string): string | null => {
		const defining =
			name === "*"
				? { file, name, chain: [file] }
				: resolveExport(modules, file, name);
		if (!defining) return null;
		for (const visited of defining.chain) {
			const slug = wrapperToSlug.get(visited);
			if (slug) return slug;
		}
		return null;
	};
	const usages: SourceUsage[] = [];
	for (const file of files) {
		const module = modules[file];
		const local: Record<string, string> = {};
		// Namespaces map `local` -> module file so member usages resolve lazily.
		const namespaces = new Map<string, string>();
		for (const entry of module.imports) {
			if (entry.resolved === null) continue;
			for (const name of entry.names) {
				if (name.type) continue;
				if (name.imported === "*") {
					namespaces.set(name.local, entry.resolved);
					const slug = wrapperToSlug.get(entry.resolved) ?? null;
					if (slug) local[name.local] = slug;
					continue;
				}
				const slug = slugOfExport(entry.resolved, name.imported);
				if (slug) local[name.local] = slug;
			}
		}
		if (Object.keys(local).length > 0) bindings[file] = local;
		for (const element of module.jsx) {
			let slug: string | null = local[element.root] ?? null;
			if (slug === null && element.members.length > 0) {
				const namespace = namespaces.get(element.root);
				if (namespace) slug = slugOfExport(namespace, element.members[0]);
			}
			if (slug === null) continue;
			// The name has to resolve, at the element, to the import:
			// `<Button>` inside `(Button) => …` is the parameter.
			if (
				resolveBinding(module, element.root, element.position)?.binding.kind !==
				"import"
			)
				continue;
			usages.push({ file, slug, element });
		}
	}
	usages.sort(
		(left, right) =>
			compareStrings(left.file, right.file) ||
			comparePositions(left.element.position, right.element.position),
	);

	return {
		files,
		modules,
		generated,
		unknownGenerated,
		components,
		usages,
		bindings,
	};
}

/** JSX usages per file, for the heat map. */
export const countUsagesByFile = (
	index: SourceIndex,
): Record<string, number> => {
	const counts: Record<string, number> = {};
	for (const usage of index.usages) {
		counts[usage.file] = (counts[usage.file] ?? 0) + 1;
	}
	return counts;
};
