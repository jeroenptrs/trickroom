import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import EnhancedResolve from "enhanced-resolve";
// `jiti/static` bundles its Babel transform with it, so the bundle does not
// look for it next to itself.
import { createJiti } from "jiti/static";

/**
 * What `tailwind-module-loader.ts` resolves and evaluates `@plugin` and
 * `@config` modules with, the way `@tailwindcss/node` does. Its own bundle
 * (`dist/tailwind-module-runtime.js`), loaded on the first module, so the
 * server, MCP, lint, codegen and worker bundles share one copy of jiti
 * (Babel included) and enhanced-resolve. Only packages, so it runs from
 * source under Node's type stripping too.
 */

const modules = [
	"node_modules",
	...(process.env.NODE_PATH ? process.env.NODE_PATH.split(path.delimiter) : []),
];
const fileSystem = new EnhancedResolve.CachedInputFileSystem(fs, 4000);
const createResolver = (conditionNames: string[]) =>
	EnhancedResolve.ResolverFactory.createResolver({
		fileSystem,
		useSyncFileSystemCalls: true,
		extensions: [".js", ".json", ".node", ".ts"],
		conditionNames,
		modules,
	});
const esmResolver = createResolver(["node", "import"]);
const cjsResolver = createResolver(["node", "require"]);

const run = (
	resolver: ReturnType<typeof createResolver>,
	id: string,
	base: string,
) =>
	new Promise<string>((resolve, reject) => {
		resolver.resolve({}, base, id, {}, (error, result) => {
			if (error) reject(error);
			else if (typeof result === "string") resolve(result);
			else reject(new Error(`Cannot resolve "${id}"`));
		});
	});

/**
 * The file `id` resolves to from `base`: import conditions first, then
 * require (`@tailwindcss/node`'s `resolveJsId`).
 */
export const resolveModule = (id: string, base: string): Promise<string> => {
	// The resolver caches the file system for a few seconds; a module
	// created since the last load must resolve.
	fileSystem.purge();
	return run(esmResolver, id, base).catch(() => run(cjsResolver, id, base));
};

// Without jiti's module cache, so jiti evaluates what it transpiles (ESM,
// TypeScript) afresh on every load. Its `require` form, not `import`: the
// latter hands ESM and `.cjs` files to Node's own `import()`, whose cache
// keeps the files a module imports.
const jiti = createJiti(import.meta.url, {
	moduleCache: false,
	fsCache: false,
});

// Node's require cache, the one CommonJS modules are kept in.
const requireCache = createRequire(import.meta.url).cache;

/**
 * Evaluates a module file (ESM, CommonJS or TypeScript) as it is now:
 * `files` (the module and the files it imports) are dropped from Node's
 * require cache first, which CommonJS files load through
 * (`@tailwindcss/node`'s `clearRequireCache`). Top-level `await` is not
 * supported.
 */
export const importModule = (
	file: string,
	files: readonly string[],
): unknown => {
	for (const cached of files) {
		delete requireCache[cached];
	}
	return jiti(file);
};
