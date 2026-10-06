import {
	PanelLeftClose,
	PanelLeftOpen,
	PanelRightClose,
	PanelRightOpen,
} from "lucide-react";
import { flushSync } from "react-dom";
import {
	type EditorChromePanel,
	isEditorPanelOpen,
	setEditorPanelOpen,
	toggleEditorPanel,
	useEditorPanelOpen,
} from "../../stores/editor-chrome-store";
import { Button } from "../ui/button";

const panelNames: Record<EditorChromePanel, string> = {
	rail: "sidebar",
	inspector: "inspector",
};

const panelShortcuts: Record<EditorChromePanel, string> = {
	rail: "Alt+[",
	inspector: "Alt+]",
};

export function getSystemPanelToggleLabel(
	panel: EditorChromePanel,
	open: boolean,
) {
	return `${open ? "Collapse" : "Expand"} ${panelNames[panel]}`;
}

export function getSystemPanelToggleTitle(
	panel: EditorChromePanel,
	open: boolean,
) {
	return `${getSystemPanelToggleLabel(panel, open)} (${panelShortcuts[panel]})`;
}

/**
 * Opens a collapsed system editor panel and commits it synchronously, so a
 * caller can focus the panel's region right after. Returns true when the
 * panel had to be opened.
 */
export function revealSystemPanel(
	panel: EditorChromePanel,
	commit: (update: () => void) => void = flushSync,
) {
	if (isEditorPanelOpen("system", panel)) {
		return false;
	}
	commit(() => setEditorPanelOpen("system", panel, true));
	return true;
}

function getToggleIcon(panel: EditorChromePanel, open: boolean) {
	if (panel === "rail") {
		return open ? PanelLeftClose : PanelLeftOpen;
	}
	return open ? PanelRightClose : PanelRightOpen;
}

export function SystemPanelToggle({ panel }: { panel: EditorChromePanel }) {
	const open = useEditorPanelOpen("system", panel);
	const Icon = getToggleIcon(panel, open);
	const label = getSystemPanelToggleLabel(panel, open);

	return (
		<Button
			type="button"
			variant="block"
			className="flex size-7 shrink-0 items-center justify-center p-0"
			onClick={() => toggleEditorPanel("system", panel)}
			aria-label={label}
			aria-expanded={open}
			title={getSystemPanelToggleTitle(panel, open)}
		>
			<Icon className="size-4 text-slate-500" aria-hidden="true" />
		</Button>
	);
}
