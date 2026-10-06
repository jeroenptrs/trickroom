import { beforeEach, describe, expect, it } from "vitest";
import {
	editorChromeStore,
	handleEditorChromeShortcut,
	isEditorPanelOpen,
	resetEditorChrome,
	setEditorPanelOpen,
	toggleEditorPanel,
} from "./editor-chrome-store";

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

	it("starts with the design rail collapsed and everything else open", () => {
		expect(editorChromeStore.state).toEqual({
			design: { rail: false, inspector: true },
			system: { rail: true, inspector: true },
		});
	});

	it("resets to the defaults after changes", () => {
		setEditorPanelOpen("design", "rail", true);
		setEditorPanelOpen("system", "inspector", false);
		resetEditorChrome();
		expect(editorChromeStore.state).toEqual({
			design: { rail: false, inspector: true },
			system: { rail: true, inspector: true },
		});
	});

	it("toggles panels per view without touching the other view", () => {
		toggleEditorPanel("design", "rail");
		expect(isEditorPanelOpen("design", "rail")).toBe(true);
		expect(isEditorPanelOpen("system", "rail")).toBe(true);
		setEditorPanelOpen("design", "rail", false);
		expect(isEditorPanelOpen("design", "rail")).toBe(false);
	});

	it("keeps the same state object when nothing changes", () => {
		const before = editorChromeStore.state;
		setEditorPanelOpen("system", "inspector", true);
		expect(editorChromeStore.state).toBe(before);
	});

	it("maps Alt+[ and Alt+] to the rail and inspector", () => {
		const left = keydown({ altKey: true, code: "BracketLeft" });
		expect(handleEditorChromeShortcut(left, "design")).toBe(true);
		expect(left.defaultPrevented).toBe(true);
		expect(isEditorPanelOpen("design", "rail")).toBe(true);

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
		expect(isEditorPanelOpen("design", "rail")).toBe(false);
		expect(
			handleEditorChromeShortcut(
				keydown({ altKey: true, code: "KeyA" }),
				"design",
			),
		).toBe(false);
	});
});
