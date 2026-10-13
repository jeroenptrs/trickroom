import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { __unstable__loadDesignSystem, type compile } from "tailwindcss";
import { parseStylesheet, readImportTarget } from "./css-source.ts";
import { defaultTailwindTokensByDomain } from "./default-tailwind-tokens.ts";
import {
	createTailwindModuleLoader,
	type LoadedTailwindModule,
	type TailwindModuleLoaderOptions,
} from "./tailwind-module-loader.ts";
import { recordTailwindSourceFiles } from "./tailwind-source-files.ts";

/**
 * Loading a project's Tailwind design system: stylesheet resolution, the
 * compiled-system cache and the file stamps it is checked against. Only
 * Node built-ins, packages (`tailwindcss`, `postcss`) and explicit `.ts`
 * imports, so the canonicalization worker (`tailwind-canonicalize-worker.ts`)
 * can run this module from source under Node's type stripping as well as
 * bundled.
 */

type PackageJson = {
	style?: string;
	exports?: string | Record<string, unknown>;
};

export type TailwindDesignSystem = Awaited<
	ReturnType<typeof __unstable__loadDesignSystem>
>;

export type LoadedTailwindDesignSystem = {
	designSystem: TailwindDesignSystem;
	rootPath: string;
	systemName?: string;
	/**
	 * Concatenated source of every stylesheet the design system loaded — the
	 * entry CSS plus every `@import`-ed file resolved through `loadStylesheet`.
	 * Lets introspection discover `@utility` blocks that live in imported files,
	 * not just the entry CSS. Package stylesheets (e.g. `tailwindcss` itself) are
	 * included; they simply contain no project `@utility` definitions.
	 */
	cssSource: string;
	/**
	 * Every stylesheet the design system loaded, the entry first, in the
	 * order Tailwind inlines them: depth first along each file's `@import`
	 * and `@reference` statements. A file imported twice appears twice.
	 */
	stylesheets: LoadedStylesheet[];
	/**
	 * The `@plugin` and `@config` modules it loaded, by path (Tailwind loads
	 * them in parallel, so load order is no order).
	 */
	modules: LoadedTailwindModule[];
};

export type LoadedStylesheet = { path: string; content: string };

export type LoadTailwindDesignSystemOptions = {
	projectRoot: string;
	cssPath: string;
};
const require = createRequire(import.meta.url);

/** The `loadModule` option Tailwind's `compile` takes. */
export type TailwindLoadModule = NonNullable<
	NonNullable<Parameters<typeof compile>[1]>["loadModule"]
>;

/**
 * `createTailwindModuleLoader`, typed for Tailwind's options. Every file a
 * module reads is recorded for the file watcher before it is read.
 */
export function createTrackedTailwindModuleLoader({
	onFiles,
	projectRoot,
}: TailwindModuleLoaderOptions) {
	const loader = createTailwindModuleLoader({
		projectRoot,
		onFiles: async (files) => {
			recordTailwindSourceFiles(files);
			await onFiles?.(files);
		},
	});
	return {
		loadModule: loader.loadModule as TailwindLoadModule,
		modules: loader.modules,
	};
}

export async function loadTailwindDesignSystem(
	options: LoadTailwindDesignSystemOptions,
): Promise<LoadedTailwindDesignSystem> {
	const { fileStamps: _fileStamps, ...loaded } =
		await loadTrackedTailwindDesignSystem(options);
	return loaded;
}

/** The design system plus a stamp of every file it read, keyed by abs path. */
export async function loadTrackedTailwindDesignSystem({
	projectRoot,
	cssPath,
}: LoadTailwindDesignSystemOptions): Promise<
	LoadedTailwindDesignSystem & { fileStamps: Map<string, string | null> }
> {
	const rootPath = resolveTailwindCssPath(projectRoot, cssPath);
	const fileStamps = new Map<string, string | null>();
	// Stamp before reading, so a write that lands during the compile makes
	// the entry stale rather than cached with the old content.
	fileStamps.set(rootPath, await statStamp(rootPath));
	// Watched before it is read, so a failing load still recovers on an edit.
	recordTailwindSourceFiles([rootPath]);
	const css = await readFile(rootPath, "utf8");

	// Accumulate the content of every stylesheet the DS loads so callers can
	// introspect `@utility` blocks that live in imported files, not only the
	// entry CSS. Seeded with the entry CSS; `loadStylesheet` appends imports.
	const collectedSources: string[] = [css];
	// Which file each `@import` resolved to, by importing directory and id,
	// so the stylesheets can be put in inlining order afterwards.
	const loadedStylesheets = new Map<string, LoadedStylesheet>();
	const collectingLoadStylesheet = async (id: string, base: string) => {
		const result = await loadStylesheet(id, base);
		if (!fileStamps.has(result.path)) {
			fileStamps.set(result.path, await statStamp(result.path));
		}
		collectedSources.push(result.content);
		loadedStylesheets.set(`${base}\0${id}`, {
			path: result.path,
			content: result.content,
		});
		return result;
	};

	const stampFiles = async (files: string[]) => {
		for (const file of files) {
			if (!fileStamps.has(file)) {
				fileStamps.set(file, await statStamp(file));
			}
		}
	};
	// One module loader per attempt, so a retry lists its own modules.
	const load = async (source: string) => {
		const moduleLoader = createTrackedTailwindModuleLoader({
			projectRoot,
			onFiles: stampFiles,
		});
		const designSystem = await __unstable__loadDesignSystem(source, {
			base: path.dirname(rootPath),
			from: rootPath,
			loadStylesheet: collectingLoadStylesheet,
			loadModule: moduleLoader.loadModule,
		});
		return {
			designSystem,
			modules: [...moduleLoader.modules].sort(
				(left, right) =>
					left.path.localeCompare(right.path) ||
					left.directive.localeCompare(right.directive) ||
					left.id.localeCompare(right.id),
			),
		};
	};
	const { designSystem, modules } = await load(css).catch((error: unknown) => {
		if (!isMissingSpacingThemeVariableError(error)) {
			throw error;
		}

		// Drop imports collected by the failed first attempt so the retry's
		// re-resolved imports are not double-counted in `cssSource`.
		collectedSources.length = 1;
		loadedStylesheets.clear();
		return load(
			`${css}\n@theme { --spacing: ${sanitizeSpacingThemeToken(defaultTailwindTokensByDomain.spacing.DEFAULT)}; }\n`,
		);
	});

	return {
		designSystem,
		rootPath,
		cssSource: collectedSources.join("\n"),
		stylesheets: orderLoadedStylesheets(
			{ path: rootPath, content: css },
			loadedStylesheets,
		),
		modules,
		fileStamps,
	};
}

/**
 * The loaded stylesheets in inlining order: depth first from the entry along
 * each file's `@import`/`@reference` statements in source order, nested ones
 * (inside `@layer`, `@media`, …) included. Never the order loads completed
 * in: anything loaded that the walk does not reach is appended sorted by
 * path, so the order depends on the sources alone.
 */
function orderLoadedStylesheets(
	entry: LoadedStylesheet,
	loaded: ReadonlyMap<string, LoadedStylesheet>,
): LoadedStylesheet[] {
	const ordered: LoadedStylesheet[] = [];
	const reached = new Set<string>();
	const visit = (stylesheet: LoadedStylesheet, ancestors: Set<string>) => {
		if (ancestors.has(stylesheet.path)) return;
		ordered.push(stylesheet);
		reached.add(stylesheet.path);
		const nextAncestors = new Set(ancestors).add(stylesheet.path);
		const imports: LoadedStylesheet[] = [];
		parseStylesheet(stylesheet.content)?.walkAtRules((node) => {
			if (node.name !== "import" && node.name !== "reference") {
				return;
			}
			const id = readImportTarget(node.params);
			const imported =
				id === null
					? undefined
					: loaded.get(`${path.dirname(stylesheet.path)}\0${id}`);
			if (imported) imports.push(imported);
		});
		for (const imported of imports) {
			visit(imported, nextAncestors);
		}
	};
	visit(entry, new Set());
	const unreached = [...loaded.values()]
		.filter((stylesheet) => !reached.has(stylesheet.path))
		.sort((left, right) => left.path.localeCompare(right.path));
	for (const stylesheet of unreached) {
		if (!reached.has(stylesheet.path)) {
			ordered.push(stylesheet);
			reached.add(stylesheet.path);
		}
	}
	return ordered;
}

/** `mtimeMs:size`, or null when the file cannot be stat'ed. */
async function statStamp(filePath: string): Promise<string | null> {
	try {
		const stats = await stat(filePath);
		return `${stats.mtimeMs}:${stats.size}`;
	} catch {
		return null;
	}
}

type LoadedDesignSystemCacheEntry = {
	loaded: LoadedTailwindDesignSystem;
	fileStamps: Map<string, string | null>;
};

// Loading a design system parses the whole stylesheet, `tailwindcss` included,
// which is far slower than the checks that use it. Validation runs on every
// agent edit and editor autosave, so keep one per entry file (the absolute
// path, so per project) and reuse it until the entry or any stylesheet it
// imported changes (mtime or size). Failed loads are not kept.
const loadedDesignSystemCache = new Map<
	string,
	Promise<LoadedDesignSystemCacheEntry>
>();

async function loadedDesignSystemIsFresh(
	entry: LoadedDesignSystemCacheEntry,
): Promise<boolean> {
	return fileStampsAreFresh(entry.fileStamps);
}

/** True while every file still has the stamp it had when it was read. */
export async function fileStampsAreFresh(
	fileStamps: ReadonlyMap<string, string | null>,
): Promise<boolean> {
	for (const [filePath, stamp] of fileStamps) {
		if ((await statStamp(filePath)) !== stamp) {
			return false;
		}
	}
	return true;
}

/**
 * `loadTailwindDesignSystem`, cached across calls: the same object comes back
 * while the entry CSS and every file it imports are unchanged. Callers must
 * treat the result as read-only.
 */
export async function loadCachedTailwindDesignSystem(
	options: LoadTailwindDesignSystemOptions,
): Promise<LoadedTailwindDesignSystem> {
	const key = resolveTailwindCssPath(options.projectRoot, options.cssPath);
	const cached = loadedDesignSystemCache.get(key);
	if (cached) {
		const entry = await cached.catch(() => null);
		if (entry && (await loadedDesignSystemIsFresh(entry))) {
			return entry.loaded;
		}
	}

	const pending = loadTrackedTailwindDesignSystem(options).then(
		({ fileStamps, ...loaded }) => ({ loaded, fileStamps }),
	);
	loadedDesignSystemCache.set(key, pending);
	pending.catch(() => {
		if (loadedDesignSystemCache.get(key) === pending) {
			loadedDesignSystemCache.delete(key);
		}
	});
	return (await pending).loaded;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this rejects
const unsafeCssThemeValuePattern = /[\x00-\x1f\x7f{};\r\n]/u;
const SAFE_SPACING_THEME_FALLBACK = "0.25rem";

export function sanitizeSpacingThemeToken(token: string): string {
	const trimmed = token.trim();
	if (trimmed.length === 0 || unsafeCssThemeValuePattern.test(trimmed)) {
		return SAFE_SPACING_THEME_FALLBACK;
	}

	return trimmed;
}

export function isMissingSpacingThemeVariableError(error: unknown) {
	if (!(error instanceof Error)) {
		return false;
	}

	const code = (error as { code?: unknown }).code;
	if (typeof code === "string" && /spacing/i.test(code)) {
		return true;
	}

	if (/spacing/i.test(error.name) && /theme|variable/i.test(error.name)) {
		return true;
	}

	// Tailwind does not expose a stable structured error here, so keep this
	// fallback intentionally broad and tied to the missing `--spacing` token.
	return /`--spacing`|--spacing/u.test(error.message);
}

export function resolveTailwindCssPath(projectRoot: string, cssPath: string) {
	const resolvedProjectRoot = path.resolve(projectRoot);
	const resolvedCssPath = path.resolve(resolvedProjectRoot, cssPath);

	if (
		resolvedCssPath !== resolvedProjectRoot &&
		!resolvedCssPath.startsWith(`${resolvedProjectRoot}${path.sep}`)
	) {
		throw new Error("Tailwind CSS path must be inside the project root");
	}

	return resolvedCssPath;
}

export async function loadStylesheet(id: string, base: string) {
	const stylesheetPath = await resolveStylesheet(id, base);
	// Recorded before the read: an import of a missing file is watched, so
	// creating it lets a failed load recover.
	recordTailwindSourceFiles([stylesheetPath]);

	return {
		path: stylesheetPath,
		base: path.dirname(stylesheetPath),
		content: await readFile(stylesheetPath, "utf8"),
	};
}

async function resolveStylesheet(id: string, base: string) {
	if (isFileImport(id)) {
		return path.resolve(base, id);
	}

	const { subpath } = parsePackageId(id);
	const packageStyleEntry = await resolvePackageStyleEntry(id, base);
	if (packageStyleEntry) {
		return packageStyleEntry;
	}

	const resolvedPackagePath = require.resolve(id, { paths: [base] });
	if (!subpath && path.extname(resolvedPackagePath) !== ".css") {
		throw new Error(`Package "${id}" does not expose a stylesheet entrypoint`);
	}

	return resolvedPackagePath;
}

async function resolvePackageStyleEntry(id: string, base: string) {
	const { name, subpath } = parsePackageId(id);

	if (subpath) {
		return null;
	}

	let packageJsonPath: string;
	try {
		packageJsonPath = require.resolve(`${name}/package.json`, {
			paths: [base],
		});
	} catch {
		return null;
	}

	const packageJson = JSON.parse(
		await readFile(packageJsonPath, "utf8"),
	) as PackageJson;
	const styleEntry = getPackageStyleEntry(packageJson);

	if (!styleEntry) {
		return null;
	}

	return path.resolve(path.dirname(packageJsonPath), styleEntry);
}

function getPackageStyleEntry(packageJson: PackageJson) {
	if (packageJson.style) {
		return packageJson.style;
	}

	if (
		packageJson.exports &&
		typeof packageJson.exports === "object" &&
		"." in packageJson.exports
	) {
		const rootExport = packageJson.exports["."];

		if (
			rootExport &&
			typeof rootExport === "object" &&
			"style" in rootExport &&
			typeof rootExport.style === "string"
		) {
			return rootExport.style;
		}
	}

	return null;
}

function isFileImport(id: string) {
	return id.startsWith(".") || id.startsWith("/");
}

function parsePackageId(id: string) {
	const parts = id.split("/");
	const scopeLength = id.startsWith("@") ? 2 : 1;
	const name = parts.slice(0, scopeLength).join("/");
	const subpath = parts.slice(scopeLength).join("/");

	return { name, subpath };
}
