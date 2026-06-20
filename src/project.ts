import path from "node:path";
import { asErrnoException, isTrickroomConfig, readJsonFile } from "./server-utils";
import type { TrickroomConfig } from "./types";

export type TrickroomProjectPaths = {
	projectRoot: string;
	configPath: string;
};

export type TrickroomProjectConfigErrorCode =
	| "CONFIG_NOT_FOUND"
	| "INVALID_CONFIG"
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
): TrickroomProjectPaths => ({
	projectRoot,
	configPath: path.join(projectRoot, "trickroom.config.json"),
});

export const isMcpEnabled = (config: TrickroomConfig) =>
	config.mcp?.enabled === true;

export const normalizeTrickroomConfig = (
	config: TrickroomConfig,
): TrickroomConfig => ({
	name: config.name.trim(),
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
	...(config.mcp ? { mcp: { enabled: config.mcp.enabled } } : {}),
});

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

export const readMcpEnabledProjectContext = async (
	projectRoot = resolveProjectRoot(),
): Promise<TrickroomProjectContext> => {
	const paths = getTrickroomProjectPaths(projectRoot);
	const config = await readRequiredTrickroomConfig(paths.configPath);

	if (!isMcpEnabled(config)) {
		throw new TrickroomProjectConfigError(
			"MCP_DISABLED",
			`MCP is disabled for project ${config.name}. Set "mcp.enabled" to true in ${paths.configPath}.`,
		);
	}

	return {
		...paths,
		config,
	};
};
