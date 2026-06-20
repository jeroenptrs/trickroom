import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { __unstable__loadDesignSystem } from "tailwindcss";
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

	const loadOptions = {
		base: path.dirname(rootPath),
		from: rootPath,
		loadStylesheet,
	};
	const designSystem = await __unstable__loadDesignSystem(
		css,
		loadOptions,
	).catch((error: unknown) => {
		if (!isMissingSpacingThemeVariableError(error)) {
			throw error;
		}

		return __unstable__loadDesignSystem(
			`${css}\n@theme { --spacing: ${sanitizeSpacingThemeToken(defaultTailwindTokensByDomain.spacing.DEFAULT)}; }\n`,
			loadOptions,
		);
	});

	return { designSystem, rootPath };
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
