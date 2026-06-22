import { existsSync, readFileSync, watch } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	createDefaultTrickroomSettings,
	getTrickroomSettingsPath,
	isTrickroomSettings,
	readTrickroomSettings,
} from "../app-state/settings";
import { normalizeMcpToolGroupSettings } from "./tool-groups";
import type { McpToolGroupSettings } from "./tool-groups";
import { MCP_TOOL_GROUPS } from "./tool-groups";

export type McpToolControl = {
	enable: () => void;
	disable: () => void;
};

export type Stop = () => void;

const readTrickroomSettingsForStartup = (
	trickroomHome: string,
): McpToolGroupSettings => {
	const settingsPath = getTrickroomSettingsPath(trickroomHome);
	if (!existsSync(settingsPath)) {
		return createDefaultTrickroomSettings().mcp.toolGroups;
	}

	try {
		const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
		if (!isTrickroomSettings(parsed)) {
			return createDefaultTrickroomSettings().mcp.toolGroups;
		}

		return normalizeMcpToolGroupSettings(parsed.mcp.toolGroups);
	} catch {
		return createDefaultTrickroomSettings().mcp.toolGroups;
	}
};

export const applyMcpToolGroupSettings = (
	toolControls: ReadonlyMap<string, McpToolControl>,
	settings: McpToolGroupSettings,
	server?: Pick<McpServer, "isConnected" | "sendToolListChanged">,
) => {
	const disabledGroups = new Set(
		Object.entries(settings)
			.filter(([, enabled]) => !enabled)
			.map(([groupId]) => groupId),
	);

	for (const group of MCP_TOOL_GROUPS) {
		const enabled = !disabledGroups.has(group.id);
		for (const toolName of group.tools) {
			const control = toolControls.get(toolName);
			if (!control) {
				continue;
			}

			if (enabled) {
				control.enable();
			} else {
				control.disable();
			}
		}
	}

	if (server?.isConnected()) {
		server.sendToolListChanged();
	}
};

export const installMcpToolGroupControls = ({
	trickroomHome,
	toolControls,
	server,
}: {
	trickroomHome: string;
	toolControls: ReadonlyMap<string, McpToolControl>;
	server: Pick<McpServer, "isConnected" | "sendToolListChanged">;
}): Stop => {
	let active = true;
	let applying = false;

	applyMcpToolGroupSettings(
		toolControls,
		readTrickroomSettingsForStartup(trickroomHome),
		server,
	);

	const refresh = async () => {
		if (!active || applying) {
			return;
		}

		applying = true;
		try {
			const settings = await readTrickroomSettings(trickroomHome);
			applyMcpToolGroupSettings(toolControls, settings.mcp.toolGroups, server);
		} catch {
			// Keep the previous tool visibility if settings cannot be read.
		} finally {
			applying = false;
		}
	};

	const settingsPath = getTrickroomSettingsPath(trickroomHome);
	const settingsDirectory = path.dirname(settingsPath);
	const watcher = watch(
		settingsDirectory,
		{ persistent: false },
		(_eventType, filename) => {
			if (!active) {
				return;
			}

			if (filename !== path.basename(settingsPath)) {
				return;
			}

			void refresh();
		},
	);

	return () => {
		active = false;
		watcher.close();
	};
};
