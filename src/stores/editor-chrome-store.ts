import { createStore, useSelector } from "@tanstack/react-store";

// Visibility of the side panels around an editor workspace. Shared by the
// design editor and the system editor so both answer to the same toggles and
// shortcuts. It is session UI state, held in memory only: switching designs
// keeps the choice, a fresh page load starts from the defaults again.

export type EditorChromeView = "design" | "system";
export type EditorChromePanel = "rail" | "inspector";

export type EditorChromePanels = Record<EditorChromePanel, boolean>;
export type EditorChromeState = Record<EditorChromeView, EditorChromePanels>;

// The left rail starts collapsed so the stage gets the room; the inspector
// starts open.
const defaultPanels: EditorChromePanels = { rail: false, inspector: true };

function createDefaultState(): EditorChromeState {
	return {
		design: { ...defaultPanels },
		system: { ...defaultPanels },
	};
}

export const editorChromeStore = createStore<EditorChromeState>(
	createDefaultState(),
);

export function setEditorPanelOpen(
	view: EditorChromeView,
	panel: EditorChromePanel,
	open: boolean,
) {
	editorChromeStore.setState((state) =>
		state[view][panel] === open
			? state
			: { ...state, [view]: { ...state[view], [panel]: open } },
	);
}

export function toggleEditorPanel(
	view: EditorChromeView,
	panel: EditorChromePanel,
) {
	setEditorPanelOpen(view, panel, !editorChromeStore.state[view][panel]);
}

export function isEditorPanelOpen(
	view: EditorChromeView,
	panel: EditorChromePanel,
) {
	return editorChromeStore.state[view][panel];
}

export function useEditorPanelOpen(
	view: EditorChromeView,
	panel: EditorChromePanel,
) {
	return useSelector(editorChromeStore, (state) => state[view][panel]);
}

/** Test and reset helper: back to the defaults of a fresh page load. */
export function resetEditorChrome() {
	editorChromeStore.setState(() => createDefaultState());
}

/**
 * Keyboard shortcuts for the panels, shared by both editors. `Alt+[` toggles
 * the left rail, `Alt+]` the right inspector. Returns true when handled.
 */
export type EditorChromeShortcutEvent = Pick<
	KeyboardEvent,
	"altKey" | "metaKey" | "ctrlKey" | "shiftKey" | "code" | "preventDefault"
>;

export function handleEditorChromeShortcut(
	event: EditorChromeShortcutEvent,
	view: EditorChromeView,
) {
	if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) {
		return false;
	}
	// `event.code` is used because Alt changes `event.key` on macOS layouts.
	if (event.code === "BracketLeft") {
		toggleEditorPanel(view, "rail");
	} else if (event.code === "BracketRight") {
		toggleEditorPanel(view, "inspector");
	} else {
		return false;
	}
	event.preventDefault();
	return true;
}
