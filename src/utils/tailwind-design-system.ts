import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { __unstable__loadDesignSystem, compile } from "tailwindcss";
import type { TrickroomConfig } from "../types";
import { defaultTailwindTokensByDomain } from "./default-tailwind-tokens.ts";
import {
	assertUniqueDesignSystemSafeKeys,
	DesignSystemStorageError,
	listDesignSystems,
} from "./design-system-store.ts";
import {
	isMissingSpacingThemeVariableError,
	loadStylesheet,
	loadTailwindDesignSystem,
	resolveTailwindCssPath,
	sanitizeSpacingThemeToken,
	type TailwindDesignSystem,
} from "./tailwind-design-system-loader.ts";
import { recordTailwindSourceFiles } from "./tailwind-source-files.ts";

export {
	type LoadedTailwindDesignSystem,
	type LoadTailwindDesignSystemOptions,
	loadCachedTailwindDesignSystem,
	loadTailwindDesignSystem,
	resolveTailwindCssPath,
	sanitizeSpacingThemeToken,
	type TailwindDesignSystem,
} from "./tailwind-design-system-loader.ts";

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

	recordTailwindSourceFiles([rootPath]);
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
	const compiled = await compile(source, loadOptions).catch(
		(error: unknown) => {
			if (!isMissingSpacingThemeVariableError(error)) {
				throw error;
			}
			return compile(
				`${source}\n@theme { --spacing: ${sanitizeSpacingThemeToken(defaultTailwindTokensByDomain.spacing.DEFAULT)}; }\n`,
				loadOptions,
			);
		},
	);

	compiledStylesheetCache.set(rootPath, {
		themeOverrides,
		fileMtimes,
		compiled,
	});
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

export type CanvasTailwindDesignSystem = {
	designSystem: TailwindDesignSystem;
	/** mtimeMs of the entry CSS plus every `@import`-ed file, keyed by abs path. */
	fileMtimes: Map<string, number>;
};

/**
 * Load the design system the canvas compiles with: the system's entry CSS
 * (with `@import "tailwindcss"` ensured, as `compileTailwindCss` does) plus the
 * appended live theme, or baseline Tailwind when `cssPath` is null. Reports
 * every file it read so callers can cache against their mtimes.
 */
export async function loadCanvasTailwindDesignSystem({
	projectRoot,
	cssPath,
	themeOverrides = "",
}: {
	projectRoot: string;
	cssPath: string | null;
	themeOverrides?: string;
}): Promise<CanvasTailwindDesignSystem> {
	const fileMtimes = new Map<string, number>();
	let source = '@import "tailwindcss";\n';
	let loadOptions = {
		base: projectRoot,
		from: path.join(projectRoot, "__trickroom_baseline__.css"),
		loadStylesheet: async (id: string, base: string) => {
			const result = await loadStylesheet(id, base);
			const mtime = await statMtimeMs(result.path);
			if (mtime !== null) {
				fileMtimes.set(result.path, mtime);
			}
			return result;
		},
	};

	if (cssPath !== null) {
		const rootPath = resolveTailwindCssPath(projectRoot, cssPath);
		recordTailwindSourceFiles([rootPath]);
		const rawCss = await readFile(rootPath, "utf8");
		const entryMtime = await statMtimeMs(rootPath);
		if (entryMtime !== null) {
			fileMtimes.set(rootPath, entryMtime);
		}
		source = TAILWIND_IMPORT_PATTERN.test(rawCss)
			? rawCss
			: `@import "tailwindcss";\n${rawCss}`;
		if (themeOverrides.trim().length > 0) {
			source += `\n${themeOverrides}\n`;
		}
		loadOptions = {
			...loadOptions,
			base: path.dirname(rootPath),
			from: rootPath,
		};
	}

	const designSystem = await __unstable__loadDesignSystem(
		source,
		loadOptions,
	).catch((error: unknown) => {
		if (!isMissingSpacingThemeVariableError(error)) {
			throw error;
		}
		return __unstable__loadDesignSystem(
			`${source}\n@theme { --spacing: ${sanitizeSpacingThemeToken(defaultTailwindTokensByDomain.spacing.DEFAULT)}; }\n`,
			loadOptions,
		);
	});

	return { designSystem, fileMtimes };
}

function normalizeConfiguredCssPath(projectRoot: string, cssPath: string) {
	return resolveTailwindCssPath(projectRoot, cssPath.trim());
}
