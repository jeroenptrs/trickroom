import { afterEach, describe, expect, it, vi } from "vitest";
import {
	isEditorPanelOpen,
	resetEditorChrome,
	setEditorPanelOpen,
} from "../../stores/editor-chrome-store";
import {
	getSystemPanelToggleLabel,
	getSystemPanelToggleTitle,
	revealSystemPanel,
} from "./SystemPanelToggle";

describe("system panel toggle", () => {
	afterEach(() => {
		resetEditorChrome();
	});

	it("labels the toggle by panel and state", () => {
		expect(getSystemPanelToggleLabel("rail", true)).toBe("Collapse sidebar");
		expect(getSystemPanelToggleLabel("rail", false)).toBe("Expand sidebar");
		expect(getSystemPanelToggleLabel("inspector", true)).toBe(
			"Collapse inspector",
		);
		expect(getSystemPanelToggleLabel("inspector", false)).toBe(
			"Expand inspector",
		);
	});

	it("mentions the panel shortcut in the title", () => {
		expect(getSystemPanelToggleTitle("rail", true)).toBe(
			"Collapse sidebar (Alt+[)",
		);
		expect(getSystemPanelToggleTitle("inspector", false)).toBe(
			"Expand inspector (Alt+])",
		);
	});

	it("opens a collapsed panel inside the commit callback", () => {
		setEditorPanelOpen("system", "rail", false);
		setEditorPanelOpen("design", "rail", false);
		const commit = vi.fn((update: () => void) => update());

		expect(revealSystemPanel("rail", commit)).toBe(true);
		expect(commit).toHaveBeenCalledTimes(1);
		expect(isEditorPanelOpen("system", "rail")).toBe(true);
		expect(isEditorPanelOpen("design", "rail")).toBe(false);
	});

	it("leaves an open panel alone", () => {
		const commit = vi.fn((update: () => void) => update());

		expect(revealSystemPanel("inspector", commit)).toBe(false);
		expect(commit).not.toHaveBeenCalled();
		expect(isEditorPanelOpen("system", "inspector")).toBe(true);
	});
});
