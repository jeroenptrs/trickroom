import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { __unstable__loadDesignSystem, compile } from "tailwindcss";
import type { TrickroomConfig } from "../types";
import { defaultTailwindTokensByDomain } from "./default-tailwind-tokens.ts";
import {
	assertUniqueDesignSystemSafeKeys,
	DesignSystemStorageError,
	listDesignSystems,
} from "./design-system-store.ts";

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

export type ConfiguredTailwindSystem = {
	systemId: string;
	systemName: string;
	cssPath: string;
	normalizedCssPath: string;
};

export type TailwindSystemTarget =
	| { systemId: string }
	| { systemName: string }
	| { cssPath: string };

export class TailwindSystemResolutionError extends Error {
	readonly code:
		| "NO_SYSTEMS_CONFIGURED"
		| "UNKNOWN_SYSTEM"
		| "UNKNOWN_CSS_PATH"
		| "AMBIGUOUS_CSS_PATH"
		| "INVALID_CSS_PATH"
		| "INVALID_SYSTEM_NAME"
		| "DUPLICATE_SYSTEM_KEY";

	constructor(
		code:
			| "NO_SYSTEMS_CONFIGURED"
			| "UNKNOWN_SYSTEM"
			| "UNKNOWN_CSS_PATH"
			| "AMBIGUOUS_CSS_PATH"
			| "INVALID_CSS_PATH"
			| "INVALID_SYSTEM_NAME"
			| "DUPLICATE_SYSTEM_KEY",
		message: string,
	) {
		super(message);
		this.name = "TailwindSystemResolutionError";
		this.code = code;
	}
}

const require = createRequire(import.meta.url);

export async function loadTailwindDesignSystemFromConfig(
	projectRoot: string,
	config: TrickroomConfig,
) {
	const system = (await listConfiguredTailwindSystems(projectRoot, config))[0];
	if (!system) {
		return null;
	}

	const loaded = await loadTailwindDesignSystem({
		projectRoot,
		cssPath: system.cssPath,
	});
	return { ...loaded, systemName: system.systemName };
}

export async function listConfiguredTailwindSystems(
	projectRoot: string,
	config: TrickroomConfig,
): Promise<ConfiguredTailwindSystem[]> {
	const manifestSystems = (await listDesignSystems(projectRoot)).flatMap(
		(record) => {
			const cssPath = record.manifest.cssPath?.trim();
			if (!cssPath) {
				return [];
			}

			return [
				{
					systemId: record.manifest.systemId,
					systemName: record.manifest.systemName,
					cssPath,
				},
			];
		},
	);
	const manifestSystemNames = new Set(
		manifestSystems.map((system) => system.systemName),
	);
	const legacySystems = Object.entries(config.systems ?? {})
		.map(([name, cssPath]) => ({
			systemId: name.trim(),
			systemName: name.trim(),
			cssPath: cssPath.trim(),
		}))
		.filter(
			(system) =>
				system.systemName.length > 0 &&
				system.cssPath.length > 0 &&
				!manifestSystemNames.has(system.systemName),
		);
	const configuredSystems = [...manifestSystems, ...legacySystems];

	assertUniqueDesignSystemSafeKeys(
		configuredSystems.map((system) => system.systemName),
	);

	return configuredSystems.map((system) => ({
		...system,
		normalizedCssPath: normalizeConfiguredCssPath(projectRoot, system.cssPath),
	}));
}

export function resolveConfiguredTailwindSystemTarget(
	projectRoot: string,
	config: TrickroomConfig,
	target: TailwindSystemTarget,
): Promise<ConfiguredTailwindSystem> {
	return resolveConfiguredTailwindSystemTargetInternal(
		projectRoot,
		config,
		target,
	);
}

async function resolveConfiguredTailwindSystemTargetInternal(
	projectRoot: string,
	config: TrickroomConfig,
	target: TailwindSystemTarget,
): Promise<ConfiguredTailwindSystem> {
	let configuredSystems: Awaited<
		ReturnType<typeof listConfiguredTailwindSystems>
	>;
	try {
		configuredSystems = await listConfiguredTailwindSystems(
			projectRoot,
			config,
		);
	} catch (error) {
		if (error instanceof DesignSystemStorageError) {
			throw new TailwindSystemResolutionError(
				error.code === "DUPLICATE_SYSTEM_KEY"
					? "DUPLICATE_SYSTEM_KEY"
					: "INVALID_SYSTEM_NAME",
				error.message,
			);
		}

		throw new TailwindSystemResolutionError(
			"INVALID_CSS_PATH",
			error instanceof Error ? error.message : "Invalid Tailwind CSS path",
		);
	}

	if (configuredSystems.length === 0) {
		throw new TailwindSystemResolutionError(
			"NO_SYSTEMS_CONFIGURED",
			"No design system is configured",
		);
	}

	if ("systemId" in target) {
		const requestedSystemId = target.systemId.trim();
		const matchedSystem = configuredSystems.find(
			(system) => system.systemId === requestedSystemId,
		);
		if (!matchedSystem) {
			throw new TailwindSystemResolutionError(
				"UNKNOWN_SYSTEM",
				`Unknown Tailwind system: ${requestedSystemId}`,
			);
		}

		return matchedSystem;
	}

	if ("systemName" in target) {
		const requestedSystemName = target.systemName.trim();
		const matchedSystem = configuredSystems.find(
			(system) => system.systemName === requestedSystemName,
		);
		if (!matchedSystem) {
			throw new TailwindSystemResolutionError(
				"UNKNOWN_SYSTEM",
				`Unknown Tailwind system: ${requestedSystemName}`,
			);
		}

		return {
			systemId: matchedSystem.systemId,
			systemName: matchedSystem.systemName,
			cssPath: matchedSystem.cssPath,
			normalizedCssPath: matchedSystem.normalizedCssPath,
		};
	}

	let requestedNormalizedCssPath: string;
	try {
		requestedNormalizedCssPath = normalizeConfiguredCssPath(
			projectRoot,
			target.cssPath,
		);
	} catch (error) {
		throw new TailwindSystemResolutionError(
			"INVALID_CSS_PATH",
			error instanceof Error ? error.message : "Invalid Tailwind CSS path",
		);
	}

	const matchedSystems = configuredSystems.filter(
		(system) => system.normalizedCssPath === requestedNormalizedCssPath,
	);

	if (matchedSystems.length === 0) {
		throw new TailwindSystemResolutionError(
			"UNKNOWN_CSS_PATH",
			`Unknown Tailwind cssPath: ${target.cssPath.trim()}`,
		);
	}

	if (matchedSystems.length > 1) {
		throw new TailwindSystemResolutionError(
			"AMBIGUOUS_CSS_PATH",
			`Multiple systems share the same normalized cssPath: ${target.cssPath.trim()}`,
		);
	}

	const [matchedSystem] = matchedSystems;
	return {
		systemId: matchedSystem.systemId,
		systemName: matchedSystem.systemName,
		cssPath: matchedSystem.cssPath,
		normalizedCssPath: matchedSystem.normalizedCssPath,
	};
}

export async function loadTailwindDesignSystem({
	projectRoot,
	cssPath,
}: LoadTailwindDesignSystemOptions): Promise<LoadedTailwindDesignSystem> {
	const rootPath = resolveTailwindCssPath(projectRoot, cssPath);
	const css = await readFile(rootPath, "utf8");

	// Accumulate the content of every stylesheet the DS loads so callers can
	// introspect `@utility` blocks that live in imported files, not only the
	// entry CSS. Seeded with the entry CSS; `loadStylesheet` appends imports.
	const collectedSources: string[] = [css];
	const collectingLoadStylesheet = async (id: string, base: string) => {
		const result = await loadStylesheet(id, base);
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

	return { designSystem, rootPath, cssSource: collectedSources.join("\n") };
}

type CompiledStylesheet = Awaited<ReturnType<typeof compile>>;

// Compiling parses the whole stylesheet (incl. `@import "tailwindcss"`), so we
// cache the compiled instance per entry file and only re-run the cheap
// `build(candidates)` per request. The cache entry tracks the appended theme
// overrides plus the mtime of *every* file the compile resolved — the entry CSS
// and every `@import`-ed fragment — so editing an imported `@theme`/`@utility`
// file invalidates it, while candidate-only changes (the common case) reuse it.
// One entry per file.
type CompiledCacheEntry = {
	themeOverrides: string;
	/** mtimeMs of the entry CSS plus every `@import`-ed file, keyed by abs path. */
	fileMtimes: Map<string, number>;
	compiled: CompiledStylesheet;
};

const compiledStylesheetCache = new Map<string, CompiledCacheEntry>();

async function statMtimeMs(filePath: string): Promise<number | null> {
	try {
		return (await stat(filePath)).mtimeMs;
	} catch {
		// Deleted/unreadable since the last compile — treat as changed so the
		// caller recompiles (and surfaces any real resolution error then).
		return null;
	}
}

async function compiledCacheEntryIsFresh(
	entry: CompiledCacheEntry,
	themeOverrides: string,
): Promise<boolean> {
	if (entry.themeOverrides !== themeOverrides) {
		return false;
	}
	for (const [filePath, mtimeMs] of entry.fileMtimes) {
		if ((await statMtimeMs(filePath)) !== mtimeMs) {
			return false;
		}
	}
	return true;
}

async function getCompiledStylesheet(
	rootPath: string,
	themeOverrides: string,
): Promise<CompiledStylesheet> {
	const cached = compiledStylesheetCache.get(rootPath);
	if (cached && (await compiledCacheEntryIsFresh(cached, themeOverrides))) {
		return cached.compiled;
	}

	const rawCss = await readFile(rootPath, "utf8");
	// A system's configured cssPath may be a *theme fragment* that is meant to be
	// imported AFTER `@import "tailwindcss"` (e.g. a `themes/*.css` consumed by an
	// `app.css`). Compiled standalone, it would emit no preflight/base utilities.
	// The browser runtime never hit this because it *is* Tailwind. So ensure the
	// import is present, but don't duplicate it when the entry already has it.
	let source = TAILWIND_IMPORT_PATTERN.test(rawCss)
		? rawCss
		: `@import "tailwindcss";\n${rawCss}`;
	// Append the editor's live `@theme` (synced tokens + overrides) so token
	// edits preview without a sync; later `@theme` wins, matching browser mode.
	if (themeOverrides.trim().length > 0) {
		source += `\n${themeOverrides}\n`;
	}
	// Record the mtime of every file the compile resolves (entry + imports) so a
	// later edit to any imported `@theme`/`@utility` fragment invalidates the
	// cache, not just a change to the entry file.
	const fileMtimes = new Map<string, number>();
	const entryMtime = await statMtimeMs(rootPath);
	if (entryMtime !== null) {
		fileMtimes.set(rootPath, entryMtime);
	}
	const trackingLoadStylesheet = async (id: string, base: string) => {
		const result = await loadStylesheet(id, base);
		const mtime = await statMtimeMs(result.path);
		if (mtime !== null) {
			fileMtimes.set(result.path, mtime);
		}
		return result;
	};
	const loadOptions = {
		base: path.dirname(rootPath),
		from: rootPath,
		loadStylesheet: trackingLoadStylesheet,
	};
	const compiled = await compile(source, loadOptions).catch((error: unknown) => {
		if (!isMissingSpacingThemeVariableError(error)) {
			throw error;
		}
		return compile(
			`${source}\n@theme { --spacing: ${sanitizeSpacingThemeToken(defaultTailwindTokensByDomain.spacing.DEFAULT)}; }\n`,
			loadOptions,
		);
	});

	compiledStylesheetCache.set(rootPath, { themeOverrides, fileMtimes, compiled });
	return compiled;
}

const TAILWIND_IMPORT_PATTERN = /@import\s+["']tailwindcss(?:["']|\/)/;

/**
 * Compile the full stylesheet (preflight + theme `:root` vars + the used
 * utilities) for a set of candidate class names, using the keeper engine
 * instead of `@tailwindcss/browser`. Output is a complete `<style>` body.
 */
export async function compileTailwindCss({
	projectRoot,
	cssPath,
	candidates,
	themeOverrides = "",
}: {
	projectRoot: string;
	cssPath: string;
	candidates: readonly string[];
	/** Serialized `@theme { … }` appended to the entry to reflect live token edits. */
	themeOverrides?: string;
}): Promise<string> {
	const rootPath = resolveTailwindCssPath(projectRoot, cssPath);
	const compiled = await getCompiledStylesheet(rootPath, themeOverrides);
	return compiled.build([...candidates]);
}

// Baseline (`@import "tailwindcss"`, no custom theme) compiled per project, so
// designs with no linked/synced system still render with Tailwind defaults
// instead of a blank, unstyled canvas. Resolves `tailwindcss` from the project.
const baselineCompiledCache = new Map<string, CompiledStylesheet>();

async function getBaselineCompiledStylesheet(
	projectRoot: string,
): Promise<CompiledStylesheet> {
	const cached = baselineCompiledCache.get(projectRoot);
	if (cached) {
		return cached;
	}
	const loadOptions = {
		base: projectRoot,
		from: path.join(projectRoot, "__trickroom_baseline__.css"),
		loadStylesheet,
	};
	const compiled = await compile('@import "tailwindcss";\n', loadOptions).catch(
		(error: unknown) => {
			if (!isMissingSpacingThemeVariableError(error)) {
				throw error;
			}
			return compile(
				`@import "tailwindcss";\n@theme { --spacing: ${sanitizeSpacingThemeToken(defaultTailwindTokensByDomain.spacing.DEFAULT)}; }\n`,
				loadOptions,
			);
		},
	);
	baselineCompiledCache.set(projectRoot, compiled);
	return compiled;
}

/**
 * Compile baseline Tailwind (defaults only, no custom theme) for the given
 * candidates — used when a design has no resolvable system.
 */
export async function compileBaselineTailwindCss({
	projectRoot,
	candidates,
}: {
	projectRoot: string;
	candidates: readonly string[];
}): Promise<string> {
	const compiled = await getBaselineCompiledStylesheet(projectRoot);
	return compiled.build([...candidates]);
}

const unsafeCssThemeValuePattern = /[\x00-\x1f\x7f{};\r\n]/u;
const SAFE_SPACING_THEME_FALLBACK = "0.25rem";

export function sanitizeSpacingThemeToken(token: string): string {
	const trimmed = token.trim();
	if (trimmed.length === 0 || unsafeCssThemeValuePattern.test(trimmed)) {
		return SAFE_SPACING_THEME_FALLBACK;
	}

	return trimmed;
}

function isMissingSpacingThemeVariableError(error: unknown) {
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

function normalizeConfiguredCssPath(projectRoot: string, cssPath: string) {
	return resolveTailwindCssPath(projectRoot, cssPath.trim());
}

async function loadStylesheet(id: string, base: string) {
	const stylesheetPath = await resolveStylesheet(id, base);

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
