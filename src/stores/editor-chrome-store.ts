import { createStore, useSelector } from "@tanstack/react-store";

// Visibility of the side panels around an editor workspace. Shared by the
// design editor and the system editor so both answer to the same toggles,
// shortcuts and persisted preference. It is UI state, not design data: it
// lives in the browser's localStorage, never in the project's `.trickroom`
// folder.

export type EditorChromeView = "design" | "system";
export type EditorChromePanel = "rail" | "inspector";

export type EditorChromePanels = Record<EditorChromePanel, boolean>;
export type EditorChromeState = Record<EditorChromeView, EditorChromePanels>;

export const EDITOR_CHROME_STORAGE_KEY = "trickroom:editor-chrome";

const views: EditorChromeView[] = ["design", "system"];
const panels: EditorChromePanel[] = ["rail", "inspector"];

// Both panels start collapsed in both editors so the workspace gets the room.
function createDefaultState(): EditorChromeState {
	return {
		design: { rail: false, inspector: false },
		system: { rail: false, inspector: false },
	};
}

// Merges whatever valid booleans the stored value holds over the defaults,
// so a partial or partly malformed value keeps what it can.
function readPersistedState(): EditorChromeState {
	const state = createDefaultState();
	if (typeof window === "undefined") {
		return state;
	}
	try {
		const raw = window.localStorage.getItem(EDITOR_CHROME_STORAGE_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		if (!isRecord(parsed)) {
			return state;
		}
		for (const view of views) {
			const stored = parsed[view];
			if (!isRecord(stored)) {
				continue;
			}
			for (const panel of panels) {
				const open = stored[panel];
				if (typeof open === "boolean") {
					state[view][panel] = open;
				}
			}
		}
	} catch {
		// Unreadable storage or JSON falls back to the defaults.
	}
	return state;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

editorChromeStore.subscribe((state) => persistState(state));

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

/** Test and reset helper: back to the defaults, persisted as such. */
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
