import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, string>();
vi.stubGlobal("window", {
	localStorage: {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
	},
});

const {
	EDITOR_CHROME_STORAGE_KEY,
	editorChromeStore,
	handleEditorChromeShortcut,
	isEditorPanelOpen,
	resetEditorChrome,
	setEditorPanelOpen,
	toggleEditorPanel,
} = await import("./editor-chrome-store");

function keydown(init: {
	altKey?: boolean;
	metaKey?: boolean;
	ctrlKey?: boolean;
	shiftKey?: boolean;
	code: string;
}) {
	const event = {
		altKey: false,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		defaultPrevented: false,
		preventDefault() {
			event.defaultPrevented = true;
		},
		...init,
	};
	return event;
}

describe("editor chrome store", () => {
	beforeEach(() => {
		resetEditorChrome();
	});

	it("opens every panel by default", () => {
		expect(editorChromeStore.state).toEqual({
			design: { rail: true, inspector: true },
			system: { rail: true, inspector: true },
		});
	});

	it("toggles panels per view without touching the other view", () => {
		toggleEditorPanel("design", "rail");
		expect(isEditorPanelOpen("design", "rail")).toBe(false);
		expect(isEditorPanelOpen("system", "rail")).toBe(true);
		setEditorPanelOpen("design", "rail", true);
		expect(isEditorPanelOpen("design", "rail")).toBe(true);
	});

	it("keeps the same state object when nothing changes", () => {
		const before = editorChromeStore.state;
		setEditorPanelOpen("system", "inspector", true);
		expect(editorChromeStore.state).toBe(before);
	});

	it("persists to localStorage", () => {
		toggleEditorPanel("system", "inspector");
		expect(JSON.parse(storage.get(EDITOR_CHROME_STORAGE_KEY) ?? "")).toEqual({
			design: { rail: true, inspector: true },
			system: { rail: true, inspector: false },
		});
	});

	it("maps Alt+[ and Alt+] to the rail and inspector", () => {
		const left = keydown({ altKey: true, code: "BracketLeft" });
		expect(handleEditorChromeShortcut(left, "design")).toBe(true);
		expect(left.defaultPrevented).toBe(true);
		expect(isEditorPanelOpen("design", "rail")).toBe(false);

		const right = keydown({ altKey: true, code: "BracketRight" });
		expect(handleEditorChromeShortcut(right, "design")).toBe(true);
		expect(isEditorPanelOpen("design", "inspector")).toBe(false);
	});

	it("ignores other modifier combinations", () => {
		const event = keydown({
			altKey: true,
			shiftKey: true,
			code: "BracketLeft",
		});
		expect(handleEditorChromeShortcut(event, "design")).toBe(false);
		expect(isEditorPanelOpen("design", "rail")).toBe(true);
		expect(
			handleEditorChromeShortcut(
				keydown({ altKey: true, code: "KeyA" }),
				"design",
			),
		).toBe(false);
	});
});
