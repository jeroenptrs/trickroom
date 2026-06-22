import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
	createDefaultMcpToolGroupSettings,
	isMcpToolGroupId,
	type McpToolGroupId,
	type McpToolGroupSettings,
	normalizeMcpToolGroupSettings,
} from "../mcp/tool-groups";
import { readJsonFile, writeJsonFileAtomically } from "../server-file-utils";
import { asErrnoException, isRecord } from "../server-utils";
import { resolveTrickroomHome } from "./home";

export type TrickroomSettings = {
	version: 1;
	mcp: {
		toolGroups: McpToolGroupSettings;
	};
};

export class TrickroomSettingsError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TrickroomSettingsError";
	}
}

export const getTrickroomSettingsPath = (
	trickroomHome = resolveTrickroomHome(),
) => path.join(trickroomHome, "settings.json");

export const createDefaultTrickroomSettings = (): TrickroomSettings => ({
	version: 1,
	mcp: {
		toolGroups: createDefaultMcpToolGroupSettings(),
	},
});

const isMcpToolGroupSettings = (value: unknown): value is McpToolGroupSettings =>
	isRecord(value) &&
	Object.entries(value).every(
		([key, enabled]) => isMcpToolGroupId(key) && typeof enabled === "boolean",
	);

export const isTrickroomSettings = (value: unknown): value is TrickroomSettings =>
	isRecord(value) &&
	value.version === 1 &&
	isRecord(value.mcp) &&
	isMcpToolGroupSettings(value.mcp.toolGroups);

export const readTrickroomSettings = async (
	trickroomHome = resolveTrickroomHome(),
): Promise<TrickroomSettings> => {
	const settingsPath = getTrickroomSettingsPath(trickroomHome);

	try {
		const settings = await readJsonFile<unknown>(settingsPath);
		if (!isTrickroomSettings(settings)) {
			throw new TrickroomSettingsError(
				`Trickroom settings at ${settingsPath} are invalid.`,
			);
		}

		return {
			version: 1,
			mcp: {
				toolGroups: normalizeMcpToolGroupSettings(settings.mcp.toolGroups),
			},
		};
	} catch (error) {
		const fsError = asErrnoException(error);
		if (fsError.code === "ENOENT") {
			return createDefaultTrickroomSettings();
		}

		if (error instanceof TrickroomSettingsError) {
			throw error;
		}

		throw new TrickroomSettingsError(
			`Failed to read Trickroom settings at ${settingsPath}.`,
		);
	}
};

export const writeTrickroomSettings = async (
	settings: TrickroomSettings,
	trickroomHome = resolveTrickroomHome(),
): Promise<TrickroomSettings> => {
	const normalized: TrickroomSettings = {
		version: 1,
		mcp: {
			toolGroups: normalizeMcpToolGroupSettings(settings.mcp.toolGroups),
		},
	};

	await mkdir(trickroomHome, { recursive: true });
	await writeJsonFileAtomically(
		getTrickroomSettingsPath(trickroomHome),
		normalized,
	);

	return normalized;
};

export const updateMcpToolGroupSettings = async (
	patch: Partial<Record<McpToolGroupId, boolean>>,
	trickroomHome = resolveTrickroomHome(),
): Promise<TrickroomSettings> => {
	const current = await readTrickroomSettings(trickroomHome);
	const nextGroups = normalizeMcpToolGroupSettings({
		...current.mcp.toolGroups,
		...patch,
	});

	return writeTrickroomSettings(
		{
			version: 1,
			mcp: {
				toolGroups: nextGroups,
			},
		},
		trickroomHome,
	);
};

export const parseMcpToolGroupSettingsPatch = (
	value: unknown,
): Partial<Record<McpToolGroupId, boolean>> | null => {
	if (!isRecord(value)) {
		return null;
	}

	const patch: Partial<Record<McpToolGroupId, boolean>> = {};
	for (const [key, enabled] of Object.entries(value)) {
		if (!isMcpToolGroupId(key) || typeof enabled !== "boolean") {
			return null;
		}
		patch[key] = enabled;
	}

	return patch;
};
