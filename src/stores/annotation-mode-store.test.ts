import { afterEach, describe, expect, it, vi } from "vitest";
import {
	annotationModeStore,
	handleAnnotationModeShortcut,
	isAnnotationModeShortcut,
	setAnnotationMode,
} from "./annotation-mode-store";

const key = (overrides: Partial<KeyboardEvent> = {}) => ({
	altKey: true,
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	code: "KeyC",
	preventDefault: vi.fn(),
	...overrides,
});

describe("annotation mode store", () => {
	afterEach(() => setAnnotationMode(false));

	it("starts off", () => {
		expect(annotationModeStore.state).toBe(false);
	});

	it("matches Alt+C by code only", () => {
		expect(isAnnotationModeShortcut(key())).toBe(true);
		expect(isAnnotationModeShortcut(key({ altKey: false }))).toBe(false);
		expect(isAnnotationModeShortcut(key({ shiftKey: true }))).toBe(false);
		expect(isAnnotationModeShortcut(key({ metaKey: true }))).toBe(false);
		expect(isAnnotationModeShortcut(key({ ctrlKey: true }))).toBe(false);
		expect(isAnnotationModeShortcut(key({ code: "KeyV" }))).toBe(false);
	});

	it("toggles on the shortcut and leaves other keys alone", () => {
		const shortcut = key();
		expect(handleAnnotationModeShortcut(shortcut)).toBe(true);
		expect(shortcut.preventDefault).toHaveBeenCalled();
		expect(annotationModeStore.state).toBe(true);
		expect(handleAnnotationModeShortcut(key())).toBe(true);
		expect(annotationModeStore.state).toBe(false);

		const other = key({ code: "KeyF" });
		expect(handleAnnotationModeShortcut(other)).toBe(false);
		expect(other.preventDefault).not.toHaveBeenCalled();
		expect(annotationModeStore.state).toBe(false);
	});
});
