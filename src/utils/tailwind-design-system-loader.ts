import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { __unstable__loadDesignSystem } from "tailwindcss";
import { defaultTailwindTokensByDomain } from "./default-tailwind-tokens.ts";
import { recordTailwindSourceFiles } from "./tailwind-source-files.ts";

/**
 * Loading a project's Tailwind design system: stylesheet resolution, the
 * compiled-system cache and the file stamps it is checked against. Only
 * Node built-ins, `tailwindcss` and explicit `.ts` imports, so the
 * canonicalization worker (`tailwind-canonicalize-worker.ts`) can run this
 * module from source under Node's type stripping as well as bundled.
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
};

export type LoadTailwindDesignSystemOptions = {
	projectRoot: string;
	cssPath: string;
};
const require = createRequire(import.meta.url);

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
	const collectingLoadStylesheet = async (id: string, base: string) => {
		const result = await loadStylesheet(id, base);
		if (!fileStamps.has(result.path)) {
			fileStamps.set(result.path, await statStamp(result.path));
		}
		collectedSources.push(result.content);
		return result;
	};

	const loadOptions = {
		base: path.dirname(rootPath),
		from: rootPath,
		loadStylesheet: collectingLoadStylesheet,
	};
	const designSystem = await __unstable__loadDesignSystem(
		css,
		loadOptions,
	).catch((error: unknown) => {
		if (!isMissingSpacingThemeVariableError(error)) {
			throw error;
		}

		// Drop imports collected by the failed first attempt so the retry's
		// re-resolved imports are not double-counted in `cssSource`.
		collectedSources.length = 1;
		return __unstable__loadDesignSystem(
			`${css}\n@theme { --spacing: ${sanitizeSpacingThemeToken(defaultTailwindTokensByDomain.spacing.DEFAULT)}; }\n`,
			loadOptions,
		);
	});

	return {
		designSystem,
		rootPath,
		cssSource: collectedSources.join("\n"),
		fileStamps,
	};
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
