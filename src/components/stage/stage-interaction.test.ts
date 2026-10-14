// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAGE_BOARD_PORTAL_ATTRIBUTE } from "../../libraries/stage-portal";
import {
	attachStageInteraction,
	createStageNodeLookup,
	forwardStageKeyEvent,
	getStageDrillTarget,
	getStageLayerAncestry,
	hasOpenBoardOverlay,
	resolveStageHoverId,
	resolveStagePointerTarget,
	type StageLayerTree,
	type StageSelectionSource,
	shouldForwardStageKey,
	shouldSuppressStageHover,
} from "./stage-interaction";

type TestNode = { parentId: string | null; childIds: string[]; name: string };

function createTree(nodes: Record<string, TestNode>): StageLayerTree {
	return {
		has: (id) => nodes[id] !== undefined,
		getParentId: (id) => nodes[id]?.parentId ?? null,
		getChildIds: (id) => nodes[id]?.childIds ?? [],
		getName: (id) => nodes[id]?.name ?? "Layer",
	};
}

const nodes: Record<string, TestNode> = {
	board: { parentId: null, childIds: ["card", "dialog"], name: "Board" },
	card: { parentId: "board", childIds: ["title", "cta"], name: "Card" },
	title: { parentId: "card", childIds: [], name: "Title" },
	cta: { parentId: "card", childIds: [], name: "CTA" },
	dialog: { parentId: "board", childIds: ["popup"], name: "Dialog" },
	popup: { parentId: "dialog", childIds: [], name: "Popup" },
	missing: { parentId: "board", childIds: [], name: "Missing" },
	other: { parentId: null, childIds: [], name: "Other board" },
};
const tree = createTree(nodes);

function createSource(): StageSelectionSource & {
	selected: () => string | null;
} {
	let selectedId: string | null = null;
	const listeners = new Set<() => void>();
	return {
		...tree,
		selected: () => selectedId,
		getSelectedId: () => selectedId,
		select: (id) => {
			selectedId = id && tree.has(id) ? id : null;
			for (const listener of listeners) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

// A board as the stage renders it: the portal host is the board's first
// child, overlays render into it with their own node ids, and a library
// component may render inner markup without one.
function renderStage() {
	document.body.innerHTML = `
		<div id="trickroom-viewport" tabindex="0">
			<div class="frame-content">
				<main id="canvas">
					<section data-trickroom-node-id="board" data-trickroom-root-id="board" id="board">
						<div data-trickroom-board-portal="">
							<div data-trickroom-node-id="popup"><span id="popup-text">Hello</span></div>
						</div>
						<div data-trickroom-node-id="card">
							<h2 data-trickroom-node-id="title"><em id="title-inner">Title</em></h2>
							<a data-trickroom-node-id="cta" href="https://example.com" id="cta">Go</a>
							<div id="no-id"><span id="no-id-inner">plain</span></div>
							<button type="submit" id="unknown" data-trickroom-node-id="stale">x</button>
						</div>
						<div data-trickroom-node-id="missing" data-trickroom-missing-renderer="lib/thing" role="note">
							<div id="missing-label">No renderer for lib/thing</div>
						</div>
					</section>
					<section data-trickroom-node-id="other" data-trickroom-root-id="other">
						<span id="other-inner">other</span>
					</section>
				</main>
				<div data-trickroom-stage-chrome="" id="chrome"><button id="pin">pin</button></div>
			</div>
		</div>`;
}

function pathOf(id: string) {
	const path: EventTarget[] = [];
	let node: Node | null = document.getElementById(id);
	while (node) {
		path.push(node);
		node = node.parentNode;
	}
	path.push(window);
	return path;
}

describe("resolveStagePointerTarget", () => {
	beforeEach(renderStage);

	it("resolves the nearest ancestor that carries a node id", () => {
		expect(
			resolveStagePointerTarget(pathOf("title-inner"), tree),
		).toMatchObject({ kind: "layer", id: "title" });
		expect(
			resolveStagePointerTarget(pathOf("no-id-inner"), tree),
		).toMatchObject({ kind: "layer", id: "card" });
	});

	it("skips node ids the tree does not hold", () => {
		expect(resolveStagePointerTarget(pathOf("unknown"), tree)).toMatchObject({
			kind: "layer",
			id: "card",
		});
	});

	it("resolves overlays in a portal host to their own layer, past the host", () => {
		expect(resolveStagePointerTarget(pathOf("popup-text"), tree)).toMatchObject(
			{ kind: "layer", id: "popup" },
		);
		const host = document.querySelector(`[${STAGE_BOARD_PORTAL_ATTRIBUTE}]`);
		const hostPath: EventTarget[] = [];
		for (let node: Node | null = host; node; node = node.parentNode) {
			hostPath.push(node);
		}
		expect(resolveStagePointerTarget(hostPath, tree)).toMatchObject({
			kind: "layer",
			id: "board",
		});
	});

	it("resolves inside a missing renderer to its layer", () => {
		expect(
			resolveStagePointerTarget(pathOf("missing-label"), tree),
		).toMatchObject({ kind: "layer", id: "missing" });
	});

	it("reports stage chrome and empty space", () => {
		expect(resolveStagePointerTarget(pathOf("pin"), tree)).toEqual({
			kind: "chrome",
		});
		expect(
			resolveStagePointerTarget(pathOf("trickroom-viewport"), tree),
		).toEqual({ kind: "empty" });
	});
});

describe("hover suppression", () => {
	beforeEach(renderStage);

	it("suppresses hover while a button is held or Space is down", () => {
		expect(
			shouldSuppressStageHover({
				buttons: 1,
				spacePressed: false,
				overlayOpen: false,
			}),
		).toBe(true);
		expect(
			shouldSuppressStageHover({
				buttons: 0,
				spacePressed: true,
				overlayOpen: false,
			}),
		).toBe(true);
		expect(
			shouldSuppressStageHover({
				buttons: 0,
				spacePressed: false,
				overlayOpen: true,
			}),
		).toBe(true);
		expect(
			resolveStageHoverId(pathOf("other-inner"), tree, {
				buttons: 1,
				spacePressed: false,
			}),
		).toBeNull();
	});

	it("suppresses hover in a board with an open overlay, not in other boards", () => {
		const board = document.querySelector("[data-trickroom-root-id=board]");
		expect(board && hasOpenBoardOverlay(board)).toBe(true);
		const idle = { buttons: 0, spacePressed: false };
		expect(resolveStageHoverId(pathOf("title-inner"), tree, idle)).toBeNull();
		expect(resolveStageHoverId(pathOf("popup-text"), tree, idle)).toBeNull();
		expect(resolveStageHoverId(pathOf("other-inner"), tree, idle)).toBe(
			"other",
		);

		document
			.querySelector(`[${STAGE_BOARD_PORTAL_ATTRIBUTE}]`)
			?.replaceChildren();
		expect(board && hasOpenBoardOverlay(board)).toBe(false);
		expect(resolveStageHoverId(pathOf("title-inner"), tree, idle)).toBe(
			"title",
		);
	});
});

describe("tree helpers", () => {
	it("drills into the first child", () => {
		expect(getStageDrillTarget(tree, "card")).toBe("title");
		expect(getStageDrillTarget(tree, "title")).toBeNull();
		expect(getStageDrillTarget(tree, null)).toBeNull();
	});

	it("lists the breadcrumb root first", () => {
		expect(getStageLayerAncestry(tree, "cta")).toEqual([
			{ id: "board", name: "Board" },
			{ id: "card", name: "Card" },
			{ id: "cta", name: "CTA" },
		]);
		expect(getStageLayerAncestry(tree, "board")).toEqual([
			{ id: "board", name: "Board" },
		]);
		expect(getStageLayerAncestry(tree, null)).toEqual([]);
		expect(getStageLayerAncestry(tree, "nope")).toEqual([]);
	});

	it("stops on a parent cycle", () => {
		const cyclic = createTree({
			a: { parentId: "b", childIds: [], name: "A" },
			b: { parentId: "a", childIds: [], name: "B" },
		});
		expect(getStageLayerAncestry(cyclic, "a").map((c) => c.id)).toEqual([
			"b",
			"a",
		]);
	});
});

describe("key forwarding", () => {
	it("keeps Space, Tab and typing in board inputs in the stage", () => {
		const input = document.createElement("input");
		expect(shouldForwardStageKey({ key: " ", target: document.body })).toBe(
			false,
		);
		expect(shouldForwardStageKey({ key: "Tab", target: document.body })).toBe(
			false,
		);
		expect(shouldForwardStageKey({ key: "Enter", target: input })).toBe(false);
		expect(
			shouldForwardStageKey({ key: "Escape", target: document.body }),
		).toBe(true);
	});

	it("re-dispatches on the host and mirrors preventDefault", () => {
		// The editor document; the stage's own is the iframe's in the app.
		const host = document;
		const seen: KeyboardEvent[] = [];
		const onHostKeyDown = (event: KeyboardEvent) => {
			seen.push(event);
			if (event.key === "Enter") event.preventDefault();
		};
		host.addEventListener("keydown", onHostKeyDown);

		const enter = new KeyboardEvent("keydown", {
			key: "Enter",
			shiftKey: true,
			cancelable: true,
		});
		Object.defineProperty(enter, "target", { value: document.body });
		forwardStageKeyEvent(enter, host);
		expect(seen[0]).toMatchObject({ key: "Enter", shiftKey: true });
		expect(enter.defaultPrevented).toBe(true);

		const escapeKey = new KeyboardEvent("keydown", {
			key: "Escape",
			cancelable: true,
		});
		Object.defineProperty(escapeKey, "target", { value: document.body });
		forwardStageKeyEvent(escapeKey, host);
		expect(seen).toHaveLength(2);
		expect(escapeKey.defaultPrevented).toBe(false);
		host.removeEventListener("keydown", onHostKeyDown);

		// Releases follow presses, so held-key state on the host clears.
		const released: string[] = [];
		const onHostKeyUp = (event: KeyboardEvent) => released.push(event.key);
		host.addEventListener("keyup", onHostKeyUp);
		const shiftUp = new KeyboardEvent("keyup", { key: "Shift" });
		Object.defineProperty(shiftUp, "target", { value: document.body });
		forwardStageKeyEvent(shiftUp, host);
		expect(released).toEqual(["Shift"]);
		host.removeEventListener("keyup", onHostKeyUp);
	});
});

describe("attachStageInteraction", () => {
	let detach: (() => void) | undefined;
	const hovers: Array<string | null> = [];
	let source: ReturnType<typeof createSource>;

	beforeEach(() => {
		renderStage();
		hovers.length = 0;
		source = createSource();
		detach = attachStageInteraction({
			document,
			window,
			source,
			onHoverChange: (id) => hovers.push(id),
		});
	});

	afterEach(() => {
		detach?.();
		detach = undefined;
	});

	const press = (id: string, init: PointerEventInit = {}) => {
		const target = document.getElementById(id) as HTMLElement;
		const down = new PointerEvent("pointerdown", {
			bubbles: true,
			cancelable: true,
			button: 0,
			...init,
		});
		target.dispatchEvent(down);
		const click = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
			button: init.button ?? 0,
		});
		target.dispatchEvent(click);
		return { down, click };
	};

	it("selects the layer under the pointer and keeps the press from the board", () => {
		const boardClick = vi.fn();
		const link = document.getElementById("cta") as HTMLAnchorElement;
		link.addEventListener("click", boardClick);
		link.addEventListener("pointerdown", boardClick);

		const { down, click } = press("cta");
		expect(source.selected()).toBe("cta");
		expect(boardClick).not.toHaveBeenCalled();
		expect(down.defaultPrevented).toBe(true);
		expect(click.defaultPrevented).toBe(true);
	});

	it("selects a board on its own background and clears on canvas space outside every board", () => {
		source.select("card");
		press("board");
		expect(source.selected()).toBe("board");
		press("canvas");
		expect(source.selected()).toBeNull();
		source.select("card");
		press("trickroom-viewport");
		expect(source.selected()).toBeNull();
	});

	it("moves focus to the stage, blurring the editor control first", () => {
		detach?.();
		detach = attachStageInteraction({
			document,
			window,
			source,
			host: document,
			onHoverChange: () => {},
		});
		source.select("cta");
		const field = document.createElement("input");
		document.body.append(field);
		field.focus();
		const selectedAtBlur: Array<string | null> = [];
		field.addEventListener("blur", () =>
			selectedAtBlur.push(source.selected()),
		);

		press("title-inner");
		// The pending edit commits against the layer it was made on.
		expect(selectedAtBlur).toEqual(["cta"]);
		expect(source.selected()).toBe("title");
		expect(document.activeElement?.id).toBe("trickroom-viewport");
		field.remove();
	});

	it("selects on right-click and keeps the context menu from the board", () => {
		const boardMenu = vi.fn();
		document.getElementById("cta")?.addEventListener("contextmenu", boardMenu);
		const menu = new MouseEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			button: 2,
		});
		document.getElementById("cta")?.dispatchEvent(menu);
		expect(source.selected()).toBe("cta");
		expect(menu.defaultPrevented).toBe(true);
		expect(boardMenu).not.toHaveBeenCalled();

		const pinMenu = vi.fn();
		document.getElementById("pin")?.addEventListener("contextmenu", pinMenu);
		document
			.getElementById("pin")
			?.dispatchEvent(
				new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
			);
		expect(pinMenu).toHaveBeenCalledTimes(1);
		expect(source.selected()).toBe("cta");
	});

	it("does not drill on a double-click made while Space is held", () => {
		source.select("board");
		window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
		press("no-id-inner");
		press("no-id-inner");
		document
			.getElementById("no-id-inner")
			?.dispatchEvent(
				new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
			);
		expect(source.selected()).toBe("board");
		window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));

		// A middle-button double press does not drill either.
		press("no-id-inner", { button: 1 });
		document
			.getElementById("no-id-inner")
			?.dispatchEvent(
				new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
			);
		expect(source.selected()).toBe("board");
	});

	it("drills into the first child on double-click", () => {
		press("no-id-inner");
		expect(source.selected()).toBe("card");
		document
			.getElementById("no-id-inner")
			?.dispatchEvent(
				new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
			);
		expect(source.selected()).toBe("title");
	});

	it("lets pan presses and stage chrome through", () => {
		const viewportDown = vi.fn();
		const viewport = document.getElementById("trickroom-viewport");
		viewport?.addEventListener("pointerdown", viewportDown);

		press("title-inner", { button: 1 });
		expect(source.selected()).toBeNull();
		expect(viewportDown).toHaveBeenCalledTimes(1);

		window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
		press("title-inner");
		expect(source.selected()).toBeNull();
		expect(viewportDown).toHaveBeenCalledTimes(2);
		window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));

		const pinClick = vi.fn();
		document.getElementById("pin")?.addEventListener("click", pinClick);
		press("pin");
		expect(pinClick).toHaveBeenCalledTimes(1);
		expect(source.selected()).toBeNull();
	});

	it("does not forward keys into its own document", () => {
		detach?.();
		const seen = vi.fn();
		document.addEventListener("keydown", seen);
		detach = attachStageInteraction({
			document,
			window,
			source,
			host: document,
			onHoverChange: () => {},
		});
		document.body.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(seen).toHaveBeenCalledTimes(1);
		document.removeEventListener("keydown", seen);
	});

	it("reports hover, and none while a button is held", () => {
		document
			.querySelector(`[${STAGE_BOARD_PORTAL_ATTRIBUTE}]`)
			?.replaceChildren();
		const move = (id: string, buttons = 0) =>
			document
				.getElementById(id)
				?.dispatchEvent(
					new PointerEvent("pointermove", { bubbles: true, buttons }),
				);
		move("title-inner");
		move("title-inner");
		move("other-inner", 1);
		move("other-inner");
		expect(hovers).toEqual(["title", null, "other"]);
		// Any press ends the hover, a middle-button pan included.
		press("other-inner", { button: 1 });
		expect(hovers).toEqual(["title", null, "other", null]);
	});
});

describe("createStageNodeLookup", () => {
	beforeEach(renderStage);

	it("caches elements and looks them up again once they leave the document", () => {
		let time = 0;
		const lookup = createStageNodeLookup(document, () => time);
		const title = lookup("title");
		expect(title?.id).toBe("");
		expect(title?.getAttribute("data-trickroom-node-id")).toBe("title");
		const spy = vi.spyOn(document, "querySelector");
		expect(lookup("title")).toBe(title);
		expect(spy).not.toHaveBeenCalled();

		const replacement = document.createElement("h2");
		replacement.setAttribute("data-trickroom-node-id", "title");
		title?.replaceWith(replacement);
		expect(lookup("title")).toBe(replacement);
		expect(spy).toHaveBeenCalledTimes(1);

		expect(lookup("ghost")).toBeNull();
		expect(lookup("ghost")).toBeNull();
		expect(spy).toHaveBeenCalledTimes(2);
		time = 1_000;
		expect(lookup("ghost")).toBeNull();
		expect(spy).toHaveBeenCalledTimes(3);
		spy.mockRestore();
	});
});
