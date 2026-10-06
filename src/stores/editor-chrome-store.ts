import { createStore, useSelector } from "@tanstack/react-store";

// Visibility of the side panels around an editor workspace. Shared by the
// design editor and the system editor so both answer to the same toggles,
// shortcuts and persisted preference. It is UI state, not design data: it
// lives in localStorage, never in the project's `.trickroom` folder.

export type EditorChromeView = "design" | "system";
export type EditorChromePanel = "rail" | "inspector";

export type EditorChromePanels = Record<EditorChromePanel, boolean>;
export type EditorChromeState = Record<EditorChromeView, EditorChromePanels>;

export const EDITOR_CHROME_STORAGE_KEY = "trickroom:editor-chrome";

const defaultPanels: EditorChromePanels = { rail: true, inspector: true };

const defaultState: EditorChromeState = {
	design: { ...defaultPanels },
	system: { ...defaultPanels },
};

function readPersistedState(): EditorChromeState {
	if (typeof window === "undefined") {
		return defaultState;
	}
	try {
		const raw = window.localStorage.getItem(EDITOR_CHROME_STORAGE_KEY);
		if (!raw) {
			return defaultState;
		}
		const parsed = JSON.parse(raw) as Partial<
			Record<EditorChromeView, Partial<EditorChromePanels>>
		>;
		return {
			design: { ...defaultPanels, ...parsed.design },
			system: { ...defaultPanels, ...parsed.system },
		};
	} catch {
		return defaultState;
	}
}

function persistState(state: EditorChromeState) {
	if (typeof window === "undefined") {
		return;
	}
	try {
		window.localStorage.setItem(
			EDITOR_CHROME_STORAGE_KEY,
			JSON.stringify(state),
		);
	} catch {
		// Storage failures (private mode, quota) only lose the preference.
	}
}

export const editorChromeStore = createStore<EditorChromeState>(
	readPersistedState(),
);

editorChromeStore.subscribe(() => persistState(editorChromeStore.state));

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

/** Test and reset helper; also drops the persisted preference. */
export function resetEditorChrome() {
	editorChromeStore.setState(() => ({
		design: { ...defaultPanels },
		system: { ...defaultPanels },
	}));
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
