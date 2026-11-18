import { useHotkey } from "@tanstack/react-hotkeys";
import { useEffect, useState } from "react";
import { McpToolSettingsDialog } from "./McpToolSettingsDialog";

const OPEN_MCP_TOOL_SETTINGS_EVENT = "trickroom:open-mcp-tool-settings";

/** Opens the MCP tools dialog from anywhere, the same as Mod+,. */
export const openMcpToolSettings = () => {
	window.dispatchEvent(new Event(OPEN_MCP_TOOL_SETTINGS_EVENT));
};

export function AppDialogHost() {
	const [mcpSettingsOpen, setMcpSettingsOpen] = useState(false);

	useHotkey(
		"Mod+,",
		() => {
			setMcpSettingsOpen((open) => !open);
		},
		{ preventDefault: true },
	);

	useEffect(() => {
		const open = () => setMcpSettingsOpen(true);
		window.addEventListener(OPEN_MCP_TOOL_SETTINGS_EVENT, open);
		return () => window.removeEventListener(OPEN_MCP_TOOL_SETTINGS_EVENT, open);
	}, []);

	return (
		<McpToolSettingsDialog
			open={mcpSettingsOpen}
			onOpenChange={setMcpSettingsOpen}
		/>
	);
}
