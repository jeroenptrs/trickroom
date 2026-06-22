import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { resolveTrickroomHome } from "./app-state/home";
import { upsertProjectLocation } from "./app-state/project-registry";
import {
	asErrnoException,
	isTrickroomConfig,
} from "./server-utils";
import { readJsonFile, writeJsonFileAtomically } from "./server-file-utils";
import type { TrickroomConfig } from "./types";
import { migrateConfiguredSystemsToManifests } from "./utils/design-system-store";
import {
	resolveDefaultSystemIdFromName,
	setConfigDefaultSystemId,
} from "./utils/project-default-system";

export type TrickroomProjectPaths = {
	projectRoot: string;
	trickroomDir: string;
	configPath: string;
	legacyConfigPath: string;
	designsDir: string;
};

export type TrickroomProjectConfigErrorCode =
	| "CONFIG_NOT_FOUND"
	| "INVALID_CONFIG"
	| "INVALID_PROJECT_ROOT"
	| "MCP_DISABLED";

export class TrickroomProjectConfigError extends Error {
	readonly code: TrickroomProjectConfigErrorCode;

	constructor(code: TrickroomProjectConfigErrorCode, message: string) {
		super(message);
		this.name = "TrickroomProjectConfigError";
		this.code = code;
	}
}

export const resolveProjectRoot = () => {
	const projectDirOverride = process.env.TRICKROOM_PROJECT_DIR;
	if (!projectDirOverride) {
		return process.cwd();
	}

	return path.resolve(process.cwd(), projectDirOverride);
};

export const getTrickroomProjectPaths = (
	projectRoot = resolveProjectRoot(),
): TrickroomProjectPaths => {
	const resolvedProjectRoot = path.resolve(projectRoot);
	const trickroomDir = path.join(resolvedProjectRoot, ".trickroom");
	return {
		projectRoot: resolvedProjectRoot,
		trickroomDir,
		configPath: path.join(trickroomDir, "config.json"),
		legacyConfigPath: path.join(resolvedProjectRoot, "trickroom.config.json"),
		designsDir: path.join(trickroomDir, "designs"),
	};
};

export const isMcpEnabled = (config: TrickroomConfig) =>
	config.mcp?.enabled === true;

export const normalizeTrickroomConfig = (
	config: TrickroomConfig,
): TrickroomConfig => ({
	schemaVersion: 1,
	...(config.projectId ? { projectId: config.projectId.trim() } : {}),
	name: config.name.trim(),
	...(config.defaultSystemId
		? { defaultSystemId: config.defaultSystemId.trim() }
		: {}),
	...(config.defaultSystemName
		? { defaultSystemName: config.defaultSystemName.trim() }
		: {}),
	...(config.systems
		? {
				systems: Object.fromEntries(
					Object.entries(config.systems).map(([name, cssPath]) => [
						name.trim(),
						cssPath.trim(),
					]),
				),
			}
		: {}),
	...(config.mcp
		? {
				mcp: {
					enabled: config.mcp.enabled,
					...(config.mcp.mode ? { mode: config.mcp.mode } : {}),
					...(config.mcp.allowedDesignFileIds
						? {
								allowedDesignFileIds: config.mcp.allowedDesignFileIds.map(
									(id) => id.trim(),
								),
							}
						: {}),
					...(config.mcp.allowedComponents
						? {
								allowedComponents: config.mcp.allowedComponents.map((ref) =>
									ref.trim(),
								),
							}
						: {}),
					...(config.mcp.auditLog !== undefined
						? { auditLog: config.mcp.auditLog }
						: {}),
				},
			}
		: {}),
});

const omitTransientConfigFields = (config: TrickroomConfig): TrickroomConfig => {
	const {
		systems: _systems,
		defaultSystemName: _defaultSystemName,
		...withoutTransientFields
	} = config;
	void _systems;
	void _defaultSystemName;
	return withoutTransientFields;
};

export const readTrickroomConfig = async (configPath: string) =>
	readJsonFile<unknown>(configPath);

export type TrickroomProjectContext = TrickroomProjectPaths & {
	config: TrickroomConfig;
};

export const readRequiredTrickroomConfig = async (
	configPath: string,
): Promise<TrickroomConfig> => {
	let config: unknown;

	try {
		config = await readTrickroomConfig(configPath);
	} catch (error) {
		const fsError = asErrnoException(error);
		if (fsError.code === "ENOENT") {
			throw new TrickroomProjectConfigError(
				"CONFIG_NOT_FOUND",
				`Trickroom config file not found at ${configPath}.`,
			);
		}

		throw error;
	}

	if (!isTrickroomConfig(config)) {
		throw new TrickroomProjectConfigError(
			"INVALID_CONFIG",
			`Trickroom config file at ${configPath} is invalid.`,
		);
	}

	return normalizeTrickroomConfig(config);
};

export const generateProjectId = () => `proj_${randomUUID()}`;

export const ensureProjectConfigIdentity = (
	config: TrickroomConfig,
): TrickroomConfig => ({
	...normalizeTrickroomConfig(config),
	projectId: config.projectId?.trim() || generateProjectId(),
});

const writeProjectConfigAndSystemManifests = async (
	paths: TrickroomProjectPaths,
	config: TrickroomConfig,
): Promise<TrickroomConfig> => {
	await mkdir(paths.trickroomDir, { recursive: true });
	const configWithIdentity = ensureProjectConfigIdentity(config);
	await migrateConfiguredSystemsToManifests(
		paths.projectRoot,
		configWithIdentity.systems,
	);
	let storedConfig = omitTransientConfigFields(configWithIdentity);
	if (configWithIdentity.defaultSystemName?.trim()) {
		const defaultSystemId = await resolveDefaultSystemIdFromName(
			paths.projectRoot,
			configWithIdentity.defaultSystemName,
		);
		if (defaultSystemId) {
			storedConfig = setConfigDefaultSystemId(storedConfig, defaultSystemId);
		}
	}
	await writeJsonFileAtomically(paths.configPath, storedConfig);
	return storedConfig;
};

export const readProjectConfig = async (
	projectRoot = resolveProjectRoot(),
): Promise<TrickroomConfig> => {
	return (await readOrMigrateProjectConfig(projectRoot)).config;
};

export const readOrMigrateProjectConfig = async (
	projectRoot = resolveProjectRoot(),
) => {
	const paths = getTrickroomProjectPaths(projectRoot);
	let config: TrickroomConfig;
	let source: "current" | "legacy" = "current";

	try {
		config = await readRequiredTrickroomConfig(paths.configPath);
	} catch (error) {
		if (
			!(
				error instanceof TrickroomProjectConfigError &&
				error.code === "CONFIG_NOT_FOUND"
			)
		) {
			throw error;
		}

		config = await readRequiredTrickroomConfig(paths.legacyConfigPath);
		source = "legacy";
	}

	const nextConfig =
		source !== "current" || !config.projectId || config.systems
			? await writeProjectConfigAndSystemManifests(paths, config)
			: ensureProjectConfigIdentity(config);

	return {
		...paths,
		config: nextConfig,
		source,
	};
};

export const writeProjectConfig = async (
	projectRoot: string,
	config: TrickroomConfig,
) => {
	const paths = getTrickroomProjectPaths(projectRoot);
	return writeProjectConfigAndSystemManifests(paths, config);
};

export const readOrCreateProjectConfig = async (
	projectRoot = resolveProjectRoot(),
	options: { defaultName?: string; config?: TrickroomConfig } = {},
) => {
	const paths = getTrickroomProjectPaths(projectRoot);
	let config: TrickroomConfig;
	let source: "new" | "current" | "legacy" = "current";

	try {
		config = await readRequiredTrickroomConfig(paths.configPath);
	} catch (error) {
		if (
			!(
				error instanceof TrickroomProjectConfigError &&
				error.code === "CONFIG_NOT_FOUND"
			)
		) {
			throw error;
		}

		try {
			config = await readRequiredTrickroomConfig(paths.legacyConfigPath);
			source = "legacy";
		} catch (legacyError) {
			if (
				!(
					legacyError instanceof TrickroomProjectConfigError &&
					legacyError.code === "CONFIG_NOT_FOUND"
				)
			) {
				throw legacyError;
			}

			config = options.config ?? {
				name: options.defaultName ?? path.basename(paths.projectRoot),
			};
			source = "new";
		}
	}

	const nextConfig =
		source !== "current" || !config.projectId || config.systems
			? await writeProjectConfigAndSystemManifests(paths, config)
			: ensureProjectConfigIdentity(config);

	return {
		...paths,
		config: nextConfig,
		source,
	};
};

export type OpenProjectResult = TrickroomProjectContext & {
	locationId: string;
	trickroomHome: string;
	source: "new" | "current" | "legacy";
};

export const openProject = async ({
	projectRoot,
	trickroomHome = resolveTrickroomHome(),
	config,
}: {
	projectRoot: string;
	trickroomHome?: string;
	config?: TrickroomConfig;
}): Promise<OpenProjectResult> => {
	const resolvedProjectRoot = path.resolve(projectRoot);
	let projectStat: Awaited<ReturnType<typeof stat>>;
	try {
		projectStat = await stat(resolvedProjectRoot);
	} catch {
		throw new TrickroomProjectConfigError(
			"INVALID_PROJECT_ROOT",
			`Project directory "${resolvedProjectRoot}" does not exist or is not accessible.`,
		);
	}

	if (!projectStat.isDirectory()) {
		throw new TrickroomProjectConfigError(
			"INVALID_PROJECT_ROOT",
			`Project directory "${resolvedProjectRoot}" is not a directory.`,
		);
	}

	const project = await readOrCreateProjectConfig(resolvedProjectRoot, {
		config,
		defaultName: path.basename(resolvedProjectRoot),
	});
	const projectId = project.config.projectId;
	if (!projectId) {
		throw new TrickroomProjectConfigError(
			"INVALID_CONFIG",
			`Trickroom config at ${project.configPath} is missing a projectId after migration.`,
		);
	}

	const { location } = await upsertProjectLocation({
		trickroomHome,
		projectId,
		root: resolvedProjectRoot,
		name: project.config.name,
	});

	return {
		...project,
		locationId: location.locationId,
		trickroomHome,
	};
};

export const readMcpEnabledProjectContext = async (
	projectRoot = resolveProjectRoot(),
): Promise<TrickroomProjectContext> => {
	const project = await readOrMigrateProjectConfig(projectRoot);
	const config = project.config;

	if (!isMcpEnabled(config)) {
		throw new TrickroomProjectConfigError(
			"MCP_DISABLED",
			`MCP is disabled for project ${config.name}. Set "mcp.enabled" to true in ${project.configPath}.`,
		);
	}

	return {
		projectRoot: project.projectRoot,
		trickroomDir: project.trickroomDir,
		configPath: project.configPath,
		legacyConfigPath: project.legacyConfigPath,
		designsDir: project.designsDir,
		config,
	};
};
