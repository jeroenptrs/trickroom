import { createStore, useSelector } from "@tanstack/react-store";

// Whether the design stage takes the pointer for layer selection and shows
// its selection, hover and annotation pin overlays. Off, the boards are live:
// clicks, keys and focus reach the design so its interactivity can be tried.
// UI state for the session only: every page load starts with it off.

export const annotationModeStore = createStore(false);

export function setAnnotationMode(enabled: boolean) {
	annotationModeStore.setState(() => enabled);
}

export function toggleAnnotationMode() {
	setAnnotationMode(!annotationModeStore.state);
}

export function useAnnotationMode() {
	return useSelector(annotationModeStore, (enabled) => enabled);
}

/** The label the switch and the shortcut list show for the shortcut. */
export const ANNOTATION_MODE_SHORTCUT_LABEL = "⌥ C";

export type AnnotationModeShortcutEvent = Pick<
	KeyboardEvent,
	"altKey" | "metaKey" | "ctrlKey" | "shiftKey" | "code"
>;

/**
 * `Alt+C` toggles annotation mode. `event.code` is used because Alt changes
 * `event.key` on macOS layouts.
 */
export function isAnnotationModeShortcut(event: AnnotationModeShortcutEvent) {
	return (
		event.altKey &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		event.code === "KeyC"
	);
}

/** Toggles annotation mode on its shortcut. Returns true when handled. */
export function handleAnnotationModeShortcut(
	event: AnnotationModeShortcutEvent & Pick<KeyboardEvent, "preventDefault">,
) {
	if (!isAnnotationModeShortcut(event)) {
		return false;
	}
	toggleAnnotationMode();
	event.preventDefault();
	return true;
}
