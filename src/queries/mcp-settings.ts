import { queryOptions } from "@tanstack/react-query";
import type { McpToolGroupId } from "../mcp/tool-groups";
import { readJsonOrThrow } from "../utils/readJsonOrThrow";

export type McpToolGroupSetting = {
	id: McpToolGroupId;
	label: string;
	description: string;
	toolCount: number;
	enabled: boolean;
};

export type McpToolGroupSettingsResponse = {
	toolGroups: McpToolGroupSetting[];
};

const fetchMcpToolGroupSettings = async () => {
	const response = await fetch("/api/trickroom/settings/mcp");
	return readJsonOrThrow<McpToolGroupSettingsResponse>(response);
};

export const mcpToolGroupSettingsQueryKey = ["trickroom-mcp-tool-group-settings"];

export const mcpToolGroupSettingsQueryOptions = () =>
	queryOptions({
		queryKey: mcpToolGroupSettingsQueryKey,
		queryFn: fetchMcpToolGroupSettings,
	});

export const updateMcpToolGroupSettings = async (
	toolGroups: Partial<Record<McpToolGroupId, boolean>>,
) => {
	const response = await fetch("/api/trickroom/settings/mcp", {
		method: "PUT",
		headers: {
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ toolGroups }),
	});

	return readJsonOrThrow<McpToolGroupSettingsResponse>(response);
};
