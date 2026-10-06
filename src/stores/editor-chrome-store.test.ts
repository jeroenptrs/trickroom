import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "trickroom:editor-chrome";

const storage = new Map<string, string>();
let failStorage = false;

vi.stubGlobal("window", {
	localStorage: {
		getItem: (key: string) => {
			if (failStorage) {
				throw new Error("storage unavailable");
			}
			return storage.get(key) ?? null;
		},
		setItem: (key: string, value: string) => {
			if (failStorage) {
				throw new Error("storage unavailable");
			}
			storage.set(key, value);
		},
	},
});

// The store reads localStorage once on import, so every test loads a fresh
// copy of the module after seeding storage.
async function loadStore(stored?: string) {
	if (stored !== undefined) {
		storage.set(STORAGE_KEY, stored);
	}
	vi.resetModules();
	return import("./editor-chrome-store");
}

function readStored() {
	return JSON.parse(storage.get(STORAGE_KEY) ?? "null");
}

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

const collapsed = {
	design: { rail: false, inspector: false },
	system: { rail: false, inspector: false },
};

describe("editor chrome store", () => {
	beforeEach(() => {
		storage.clear();
		failStorage = false;
	});

	afterEach(() => {
		failStorage = false;
	});

	it("starts with every panel collapsed", async () => {
		const { editorChromeStore } = await loadStore();
		expect(editorChromeStore.state).toEqual(collapsed);
	});

	it("uses the shared storage key", async () => {
		const { EDITOR_CHROME_STORAGE_KEY } = await loadStore();
		expect(EDITOR_CHROME_STORAGE_KEY).toBe(STORAGE_KEY);
	});

	it("persists every change to localStorage", async () => {
		const { toggleEditorPanel } = await loadStore();
		toggleEditorPanel("system", "inspector");
		expect(readStored()).toEqual({
			design: { rail: false, inspector: false },
			system: { rail: false, inspector: true },
		});
		toggleEditorPanel("design", "rail");
		expect(readStored()).toEqual({
			design: { rail: true, inspector: false },
			system: { rail: false, inspector: true },
		});
	});

	it("restores the persisted preference on load", async () => {
		const { editorChromeStore, setEditorPanelOpen } = await loadStore();
		setEditorPanelOpen("design", "rail", true);
		setEditorPanelOpen("system", "inspector", true);

		const reloaded = await loadStore();
		expect(reloaded.editorChromeStore).not.toBe(editorChromeStore);
		expect(reloaded.editorChromeStore.state).toEqual({
			design: { rail: true, inspector: false },
			system: { rail: false, inspector: true },
		});
	});

	it("merges a partial stored value over the defaults", async () => {
		const { editorChromeStore } = await loadStore(
			JSON.stringify({ system: { rail: true } }),
		);
		expect(editorChromeStore.state).toEqual({
			design: { rail: false, inspector: false },
			system: { rail: true, inspector: false },
		});
	});

	it("ignores malformed stored values", async () => {
		for (const stored of [
			"{not json",
			"null",
			"[]",
			'"open"',
			JSON.stringify({ design: "open", system: [true] }),
		]) {
			const { editorChromeStore } = await loadStore(stored);
			expect(editorChromeStore.state).toEqual(collapsed);
		}
	});

	it("keeps valid panels and drops invalid ones from a stored value", async () => {
		const { editorChromeStore } = await loadStore(
			JSON.stringify({
				design: { rail: "yes", inspector: true },
				system: { rail: 1, inspector: null },
				other: { rail: true },
			}),
		);
		expect(editorChromeStore.state).toEqual({
			design: { rail: false, inspector: true },
			system: { rail: false, inspector: false },
		});
	});

	it("swallows storage errors on read and write", async () => {
		failStorage = true;
		const { editorChromeStore, toggleEditorPanel } = await loadStore();
		expect(editorChromeStore.state).toEqual(collapsed);
		expect(() => toggleEditorPanel("design", "rail")).not.toThrow();
		expect(editorChromeStore.state.design.rail).toBe(true);
	});

	it("resets to the defaults after changes", async () => {
		const { editorChromeStore, resetEditorChrome, setEditorPanelOpen } =
			await loadStore();
		setEditorPanelOpen("design", "rail", true);
		setEditorPanelOpen("system", "inspector", true);
		resetEditorChrome();
		expect(editorChromeStore.state).toEqual(collapsed);
		expect(readStored()).toEqual(collapsed);
	});

	it("toggles panels per view without touching the other view", async () => {
		const { isEditorPanelOpen, setEditorPanelOpen, toggleEditorPanel } =
			await loadStore();
		toggleEditorPanel("design", "rail");
		expect(isEditorPanelOpen("design", "rail")).toBe(true);
		expect(isEditorPanelOpen("system", "rail")).toBe(false);
		setEditorPanelOpen("design", "rail", false);
		expect(isEditorPanelOpen("design", "rail")).toBe(false);
	});

	it("keeps the same state object when nothing changes", async () => {
		const { editorChromeStore, setEditorPanelOpen } = await loadStore();
		const before = editorChromeStore.state;
		setEditorPanelOpen("system", "inspector", false);
		expect(editorChromeStore.state).toBe(before);
	});

	it("maps Alt+[ and Alt+] to the rail and inspector", async () => {
		const { handleEditorChromeShortcut, isEditorPanelOpen } = await loadStore();
		const left = keydown({ altKey: true, code: "BracketLeft" });
		expect(handleEditorChromeShortcut(left, "design")).toBe(true);
		expect(left.defaultPrevented).toBe(true);
		expect(isEditorPanelOpen("design", "rail")).toBe(true);

		const right = keydown({ altKey: true, code: "BracketRight" });
		expect(handleEditorChromeShortcut(right, "design")).toBe(true);
		expect(isEditorPanelOpen("design", "inspector")).toBe(true);
	});

	it("ignores other modifier combinations", async () => {
		const { handleEditorChromeShortcut, isEditorPanelOpen } = await loadStore();
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
