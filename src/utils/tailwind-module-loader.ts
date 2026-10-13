import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * The `loadModule` Tailwind's `compile` and `__unstable__loadDesignSystem`
 * call for `@plugin` and `@config`, loading modules the way
 * `@tailwindcss/node` (Tailwind's CLI and Vite plugin) does: resolved from
 * the folder of the stylesheet that names them with `enhanced-resolve`
 * (import conditions first, then require; `NODE_PATH` included), evaluated
 * with `jiti` (ESM, CommonJS and TypeScript alike), and a local module's
 * relative imports reported as its files (`tailwind-module-runtime.ts` holds
 * the resolver and jiti). `@tailwindcss/node` itself is not imported:
 * importing it loads lightningcss (a native binding), and its native
 * `import()` would run through Vite's module runner in the dev server and
 * the tests.
 *
 * Modules are evaluated without jiti's module cache, so every load reads the
 * files as they are now (an edited local plugin applies on the next load,
 * and nothing piles up in Node's caches). Callers cache the loaded design
 * system against the stamps of the files reported through `onFiles`.
 *
 * A module that cannot be resolved, fails to evaluate, or throws when
 * Tailwind runs it fails the load with a `TailwindModuleError` naming the
 * directive and the module.
 *
 * Only Node built-ins (and the runtime beside it, loaded by path), so the
 * canonicalization worker can run this from source under Node's type
 * stripping.
 */

export type TailwindModuleDirective = "@plugin" | "@config";

export type LoadedTailwindModule = {
	directive: TailwindModuleDirective;
	/** As written in the stylesheet. */
	id: string;
	/** The resolved file. */
	path: string;
	/**
	 * The resolved file and, for a module outside `node_modules`, every file
	 * it imports by relative path, transitively. Absolute paths.
	 */
	files: string[];
};

export type TailwindModuleErrorCode =
	| "TAILWIND_MODULE_NOT_FOUND"
	| "TAILWIND_MODULE_FAILED";

export class TailwindModuleError extends Error {
	readonly code: TailwindModuleErrorCode;
	readonly directive: TailwindModuleDirective;
	/** The module as written in the stylesheet. */
	readonly module: string;

	constructor(
		code: TailwindModuleErrorCode,
		directive: TailwindModuleDirective,
		module: string,
		message: string,
		cause?: unknown,
	) {
		super(message, { cause });
		this.name = "TailwindModuleError";
		this.code = code;
		this.directive = directive;
		this.module = module;
	}
}

/** The first `TailwindModuleError` in an error's cause chain. */
export const findTailwindModuleError = (
	error: unknown,
): TailwindModuleError | null => {
	let current: unknown = error;
	for (let depth = 0; depth < 8 && current; depth += 1) {
		if (current instanceof TailwindModuleError) return current;
		current = current instanceof Error ? current.cause : null;
	}
	return null;
};

type ModuleRuntime = typeof import("./tailwind-module-runtime.ts");

let runtimePromise: Promise<ModuleRuntime> | null = null;

/**
 * The runtime module next to this one: the `.ts` source when this runs from
 * source (the dev server, tests, the worker), the bundle when it runs from
 * `dist/`, where every entry and the runtime bundle sit side by side.
 */
const getRuntime = (): Promise<ModuleRuntime> => {
	if (!runtimePromise) {
		const here = fileURLToPath(import.meta.url);
		const extension = path.extname(here) === ".ts" ? ".ts" : ".js";
		const runtime = pathToFileURL(
			path.join(path.dirname(here), `tailwind-module-runtime${extension}`),
		).href;
		runtimePromise = import(
			/* @vite-ignore */ runtime
		) as Promise<ModuleRuntime>;
		runtimePromise.catch(() => {
			runtimePromise = null;
		});
	}
	return runtimePromise;
};

// `@tailwindcss/node`'s scan for a module's relative imports.
const DEPENDENCY_PATTERNS = [
	/import[\s\S]*?['"](.{3,}?)['"]/gi,
	/import[\s\S]*from[\s\S]*?['"](.{3,}?)['"]/gi,
	/export[\s\S]*from[\s\S]*?['"](.{3,}?)['"]/gi,
	// Not greedy, so two `require()`s on a line are two dependencies.
	/require\(\s*['"`](.+?)['"`]\s*\)/gi,
];
const JS_EXTENSIONS = [".js", ".cjs", ".mjs"];
const JS_RESOLUTION_ORDER = [
	"",
	".js",
	".cjs",
	".mjs",
	".ts",
	".cts",
	".mts",
	".jsx",
	".tsx",
];
const TS_RESOLUTION_ORDER = [
	"",
	".ts",
	".cts",
	".mts",
	".tsx",
	".js",
	".cjs",
	".mjs",
	".jsx",
];

const resolveWithExtensions = async (
	file: string,
	extensions: readonly string[],
): Promise<string | null> => {
	for (const extension of extensions) {
		const candidate = `${file}${extension}`;
		if ((await stat(candidate).catch(() => null))?.isFile()) {
			return candidate;
		}
	}
	for (const extension of extensions) {
		const candidate = `${file}/index${extension}`;
		if ((await stat(candidate).catch(() => null))?.isFile()) {
			return candidate;
		}
	}
	return null;
};

/** The module and every file it imports by relative path, transitively. */
const collectModuleFiles = async (entry: string): Promise<string[]> => {
	const seen = new Set<string>([entry]);
	const visit = async (file: string): Promise<void> => {
		const content = await readFile(file, "utf8").catch(() => null);
		if (content === null) return;
		const order = JS_EXTENSIONS.includes(path.extname(file))
			? JS_RESOLUTION_ORDER
			: TS_RESOLUTION_ORDER;
		const pending: Promise<void>[] = [];
		for (const pattern of DEPENDENCY_PATTERNS) {
			for (const match of content.matchAll(pattern)) {
				const specifier = match[1];
				if (!specifier?.startsWith(".")) continue;
				pending.push(
					resolveWithExtensions(
						path.resolve(path.dirname(file), specifier),
						order,
					).then((resolved) => {
						if (resolved === null || seen.has(resolved)) return;
						seen.add(resolved);
						return visit(resolved);
					}),
				);
			}
		}
		await Promise.all(pending);
	};
	await visit(entry);
	return [...seen];
};

const isUnderNodeModules = (filePath: string) =>
	filePath.split(path.sep).includes("node_modules");

const describeError = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

/** Whether a Proxy over `value` must not change what its properties read. */
const hasLockedProperties = (value: object) =>
	Object.values(Object.getOwnPropertyDescriptors(value)).some(
		(descriptor) =>
			!descriptor.configurable &&
			("get" in descriptor || descriptor.writable === false),
	);

/**
 * Wraps a module's value so an error any of its functions throws when
 * Tailwind runs it names the directive and the module: plugin handlers,
 * `plugin.withOptions` factories, a config's `plugins` and `presets`, theme
 * callbacks (`colors: ({ theme }) => …`), nested plugin configs. Wrapped
 * lazily as Tailwind reads it, the same wrapper for the same value; plain
 * objects, arrays and functions only (a `Map` or `RegExp` passes as is). A
 * frozen object is wrapped through a copy, which a Proxy needs to hand out
 * wrapped properties.
 */
const guardModule = (value: unknown, fail: (error: unknown) => never) => {
	const wrapped = new WeakMap<object, unknown>();
	const guard = (inner: unknown): unknown => {
		if (typeof inner === "function") {
			let proxy = wrapped.get(inner);
			if (!proxy) {
				proxy = new Proxy(inner, {
					apply(target, thisArg, args) {
						let result: unknown;
						try {
							result = Reflect.apply(target, thisArg, args);
						} catch (error) {
							fail(error);
						}
						return guard(result);
					},
				});
				wrapped.set(inner, proxy);
			}
			return proxy;
		}
		if (inner === null || typeof inner !== "object") {
			return inner;
		}
		const isArray = Array.isArray(inner);
		const prototype = Object.getPrototypeOf(inner);
		if (!isArray && prototype !== Object.prototype && prototype !== null) {
			return inner;
		}
		let proxy = wrapped.get(inner);
		if (!proxy) {
			const target = !hasLockedProperties(inner)
				? inner
				: isArray
					? [...(inner as unknown[])]
					: Object.assign(Object.create(prototype), inner);
			proxy = new Proxy(target, {
				get(source, property, receiver) {
					const read = Reflect.get(source, property, receiver);
					return typeof property === "symbol" ? read : guard(read);
				},
			});
			wrapped.set(inner, proxy);
		}
		return proxy;
	};
	return guard(value);
};

export type TailwindModuleLoaderOptions = {
	/**
	 * Called with a module's files before they are read, so they can be
	 * stamped and watched; awaited.
	 */
	onFiles?: (files: string[]) => void | Promise<void>;
	/** Paths in error messages are relative to it. */
	projectRoot?: string;
};

/**
 * A `loadModule` for Tailwind, and the modules it loaded, in no fixed
 * order (Tailwind loads them in parallel).
 */
export const createTailwindModuleLoader = ({
	onFiles,
	projectRoot,
}: TailwindModuleLoaderOptions = {}) => {
	const modules: LoadedTailwindModule[] = [];
	const display = (filePath: string) => {
		if (!projectRoot) return filePath;
		const relative = path.relative(projectRoot, filePath);
		return relative.length === 0
			? "."
			: relative.startsWith("..") || path.isAbsolute(relative)
				? filePath
				: relative.split(path.sep).join("/");
	};

	const loadModule = async (
		id: string,
		base: string,
		resourceHint?: string,
	): Promise<{ path: string; base: string; module: unknown }> => {
		const directive: TailwindModuleDirective =
			resourceHint === "config" ? "@config" : "@plugin";
		const label = `${directive} "${id}"`;
		const isPath = id.startsWith(".") || path.isAbsolute(id);
		let resolved: string;
		try {
			resolved = await (await getRuntime()).resolveModule(id, base);
		} catch (error) {
			// Watched while missing, so creating it lets the load recover.
			if (isPath) await onFiles?.([path.resolve(base, id)]);
			throw new TailwindModuleError(
				"TAILWIND_MODULE_NOT_FOUND",
				directive,
				id,
				isPath
					? `${label}: no module at ${display(path.resolve(base, id))}`
					: `${label}: cannot find module "${id}" from ${display(base)}; is it installed in the project?`,
				error,
			);
		}

		const files = isUnderNodeModules(resolved)
			? [resolved]
			: await collectModuleFiles(resolved);
		await onFiles?.(files);
		modules.push({ directive, id, path: resolved, files });

		let loaded: unknown;
		try {
			loaded = (await getRuntime()).importModule(resolved, files);
		} catch (error) {
			throw new TailwindModuleError(
				"TAILWIND_MODULE_FAILED",
				directive,
				id,
				`${label} (${display(resolved)}) failed to load: ${describeError(error)}`,
				error,
			);
		}
		const value =
			loaded !== null &&
			typeof loaded === "object" &&
			"default" in loaded &&
			loaded.default !== undefined
				? loaded.default
				: loaded;
		const fail = (error: unknown): never => {
			if (error instanceof TailwindModuleError) throw error;
			throw new TailwindModuleError(
				"TAILWIND_MODULE_FAILED",
				directive,
				id,
				`${label} (${display(resolved)}) threw: ${describeError(error)}`,
				error,
			);
		};
		return {
			path: resolved,
			base: path.dirname(resolved),
			module: guardModule(value, fail),
		};
	};

	return { loadModule, modules };
};
