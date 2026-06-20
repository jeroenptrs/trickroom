import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { __unstable__loadDesignSystem } from "tailwindcss";
import type { TrickroomConfig } from "../types";

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
	systemName: string;
	cssPath: string;
	normalizedCssPath: string;
};

export type TailwindSystemTarget =
	| { systemName: string }
	| { cssPath: string };

export class TailwindSystemResolutionError extends Error {
	readonly code:
		| "NO_SYSTEMS_CONFIGURED"
		| "UNKNOWN_SYSTEM"
		| "UNKNOWN_CSS_PATH"
		| "AMBIGUOUS_CSS_PATH"
		| "INVALID_CSS_PATH";

	constructor(
		code:
			| "NO_SYSTEMS_CONFIGURED"
			| "UNKNOWN_SYSTEM"
			| "UNKNOWN_CSS_PATH"
			| "AMBIGUOUS_CSS_PATH"
			| "INVALID_CSS_PATH",
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
	const system = listConfiguredTailwindSystems(projectRoot, config)[0];
	if (!system) {
		return null;
	}

	const loaded = await loadTailwindDesignSystem({
		projectRoot,
		cssPath: system.cssPath,
	});
	return { ...loaded, systemName: system.name };
}

export function listConfiguredTailwindSystems(
	projectRoot: string,
	config: TrickroomConfig,
): Array<{ name: string; cssPath: string; normalizedCssPath: string }> {
	return Object.entries(config.systems ?? {})
		.map(([name, cssPath]) => ({
			name: name.trim(),
			cssPath: cssPath.trim(),
		}))
		.filter((system) => system.name.length > 0 && system.cssPath.length > 0)
		.map((system) => ({
			...system,
			normalizedCssPath: normalizeConfiguredCssPath(
				projectRoot,
				system.cssPath,
			),
		}));
}

export function resolveConfiguredTailwindSystemTarget(
	projectRoot: string,
	config: TrickroomConfig,
	target: TailwindSystemTarget,
): ConfiguredTailwindSystem {
	let configuredSystems: ReturnType<typeof listConfiguredTailwindSystems>;
	try {
		configuredSystems = listConfiguredTailwindSystems(projectRoot, config);
	} catch (error) {
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

	if ("systemName" in target) {
		const requestedSystemName = target.systemName.trim();
		const matchedSystem = configuredSystems.find(
			(system) => system.name === requestedSystemName,
		);
		if (!matchedSystem) {
			throw new TailwindSystemResolutionError(
				"UNKNOWN_SYSTEM",
				`Unknown Tailwind system: ${requestedSystemName}`,
			);
		}

		return {
			systemName: matchedSystem.name,
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
		systemName: matchedSystem.name,
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

	const designSystem = await __unstable__loadDesignSystem(css, {
		base: path.dirname(rootPath),
		from: rootPath,
		loadStylesheet,
	});

	return { designSystem, rootPath };
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
