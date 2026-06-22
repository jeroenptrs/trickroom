import { useHotkey } from "@tanstack/react-hotkeys";
import { useState } from "react";
import { McpToolSettingsDialog } from "./McpToolSettingsDialog";

export function AppDialogHost() {
	const [mcpSettingsOpen, setMcpSettingsOpen] = useState(false);

	useHotkey(
		"Mod+,",
		() => {
			setMcpSettingsOpen((open) => !open);
		},
		{ preventDefault: true },
	);

	return (
		<McpToolSettingsDialog
			open={mcpSettingsOpen}
			onOpenChange={setMcpSettingsOpen}
		/>
	);
}
