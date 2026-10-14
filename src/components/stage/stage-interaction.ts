import { STAGE_BOARD_PORTAL_ATTRIBUTE } from "../../libraries/stage-portal";
import { isEditableShortcutTarget } from "../../utils/editor-shortcuts";
import { STAGE_CHROME_ATTRIBUTE } from "./stage-overlay";

/**
 * Stage interaction shared by the design editor and the component editor:
 * pointer resolution, hover suppression and keyboard forwarding for the
 * stage document (the iframe). Selection itself stays in the editor's store;
 * the stage reports what was clicked and the store decides.
 */

/** Every rendered layer carries its id (a draft node: its path) in this. */
export const STAGE_NODE_ID_ATTRIBUTE = "data-trickroom-node-id";

const STAGE_BOARD_SELECTOR =
	"[data-trickroom-root-id], [data-trickroom-draft-board]";

/** Read access to the layer tree a stage renders. */
export type StageLayerTree = {
	has: (id: string) => boolean;
	getParentId: (id: string) => string | null;
	getChildIds: (id: string) => readonly string[];
	getName: (id: string) => string;
};

/** A layer tree plus the store that owns its single selection. */
export type StageSelectionSource = StageLayerTree & {
	getSelectedId: () => string | null;
	select: (id: string | null) => void;
	/** Calls `listener` after any change to the tree or the selection. */
	subscribe: (listener: () => void) => () => void;
};

export type StagePointerTarget =
	| { kind: "layer"; id: string; element: HTMLElement }
	/** Editor chrome in the stage document (pins, highlights). */
	| { kind: "chrome" }
	/** Canvas or board space that is no layer of the tree. */
	| { kind: "empty" };

function isElementNode(target: EventTarget | null | undefined) {
	return (
		typeof target === "object" &&
		target !== null &&
		(target as Partial<Node>).nodeType === 1
	);
}

/**
 * Resolves an event path (`event.composedPath()`, innermost first) to the
 * nearest layer of the tree. Library components do not always forward the
 * node id to the DOM, so the nearest ancestor that carries one wins.
 * Overlays portalled into a board's portal host keep their own node ids and
 * resolve to their own layer; a portal host itself is skipped like any
 * element without an id. Ids the tree does not hold are skipped too.
 */
export function resolveStagePointerTarget(
	path: readonly EventTarget[],
	tree: Pick<StageLayerTree, "has">,
): StagePointerTarget {
	for (const target of path) {
		if (!isElementNode(target)) {
			continue;
		}
		const element = target as HTMLElement;
		if (element.hasAttribute(STAGE_CHROME_ATTRIBUTE)) {
			return { kind: "chrome" };
		}
		const id = element.getAttribute(STAGE_NODE_ID_ATTRIBUTE);
		if (id && tree.has(id)) {
			return { kind: "layer", id, element };
		}
	}
	return { kind: "empty" };
}

/** The board (design board root or component draft board) of an element. */
export function findStageBoardElement(element: Element) {
	return element.closest(STAGE_BOARD_SELECTOR);
}

/**
 * Whether an overlay (dialog, popover, menu) is open in `board`. Boards
 * portal their overlays into a host that is a direct child of the board and
 * only holds children while something is open.
 */
export function hasOpenBoardOverlay(board: Element) {
	for (const child of Array.from(board.children)) {
		if (
			child.hasAttribute(STAGE_BOARD_PORTAL_ATTRIBUTE) &&
			child.childElementCount > 0
		) {
			return true;
		}
	}
	return false;
}

/** Whether hover outlines are off over `element`: its board shows an overlay. */
export function isStageHoverBlockedAt(element: Element) {
	const board = findStageBoardElement(element);
	return board !== null && hasOpenBoardOverlay(board);
}

/**
 * Hover outlines stay off while a button is held (a pan, or a press that
 * will select), while Space is held for panning, and while an overlay is
 * open in the hovered board, where the outline would cover the overlay.
 */
export function shouldSuppressStageHover({
	buttons,
	spacePressed,
	overlayOpen,
}: {
	buttons: number;
	spacePressed: boolean;
	overlayOpen: boolean;
}) {
	return buttons !== 0 || spacePressed || overlayOpen;
}

/** The layer a hover at `path` outlines, or null. */
export function resolveStageHoverId(
	path: readonly EventTarget[],
	tree: Pick<StageLayerTree, "has">,
	state: { buttons: number; spacePressed: boolean },
) {
	if (shouldSuppressStageHover({ ...state, overlayOpen: false })) {
		return null;
	}
	const target = resolveStagePointerTarget(path, tree);
	if (target.kind !== "layer" || isStageHoverBlockedAt(target.element)) {
		return null;
	}
	return target.id;
}

/** Double-click and Enter drill into the first child. */
export function getStageDrillTarget(tree: StageLayerTree, id: string | null) {
	return id ? (tree.getChildIds(id)[0] ?? null) : null;
}

export type StageLayerCrumb = { id: string; name: string };

/** The layer and its ancestors, root first: the inspector breadcrumb. */
export function getStageLayerAncestry(
	tree: StageLayerTree,
	id: string | null,
): StageLayerCrumb[] {
	const crumbs: StageLayerCrumb[] = [];
	const seen = new Set<string>();
	let current = id;
	while (current && tree.has(current) && !seen.has(current)) {
		seen.add(current);
		crumbs.unshift({ id: current, name: tree.getName(current) });
		current = tree.getParentId(current);
	}
	return crumbs;
}

export function isSameStageLayerAncestry(
	a: readonly StageLayerCrumb[],
	b: readonly StageLayerCrumb[],
) {
	return (
		a.length === b.length &&
		a.every(
			(crumb, index) =>
				crumb.id === b[index]?.id && crumb.name === b[index]?.name,
		)
	);
}

/**
 * Keys pressed while the stage document has focus are re-dispatched on the
 * editor document, so the editor's shortcuts (Escape, Enter, arrows, Delete,
 * panel and save shortcuts) work after a click on the canvas. Space stays in
 * the stage for panning, Tab for focus order, and keys typed into an
 * editable element in a board stay there. Key releases are forwarded with
 * the same filter, so the editor's held-key state (Alt and Shift pick where
 * a new layer goes) never sees a press without its release.
 */
export function shouldForwardStageKey(
	event: Pick<KeyboardEvent, "key" | "target">,
) {
	if (event.key === " " || event.key === "Tab") {
		return false;
	}
	return !isEditableShortcutTarget(event.target);
}

export function forwardStageKeyEvent(event: KeyboardEvent, host: Document) {
	const HostKeyboardEvent = host.defaultView?.KeyboardEvent;
	if (!HostKeyboardEvent || !shouldForwardStageKey(event)) {
		return;
	}
	const forwarded = new HostKeyboardEvent(event.type, {
		key: event.key,
		code: event.code,
		location: event.location,
		repeat: event.repeat,
		altKey: event.altKey,
		ctrlKey: event.ctrlKey,
		metaKey: event.metaKey,
		shiftKey: event.shiftKey,
		bubbles: true,
		cancelable: true,
	});
	if (!host.dispatchEvent(forwarded)) {
		event.preventDefault();
	}
}

/**
 * Whether a press lands on a scrollbar of the element it targets (the
 * responsive viewport scrolls natively): not a click on content.
 */
function isScrollbarPress(event: MouseEvent) {
	const target = event.target;
	if (!isElementNode(target)) {
		return false;
	}
	const element = target as HTMLElement;
	return (
		(element.clientWidth > 0 && event.offsetX > element.clientWidth) ||
		(element.clientHeight > 0 && event.offsetY > element.clientHeight)
	);
}

export type StageInteractionOptions = {
	/** The stage document and its window (the iframe's). */
	document: Document;
	window: Window;
	source: StageSelectionSource;
	/** Called with the hovered layer, or null, whenever it changes. */
	onHoverChange: (id: string | null) => void;
	/**
	 * The editor document: stage key presses are forwarded to it, and a
	 * selection press blurs whatever had focus in it.
	 */
	host?: Document | null;
};

/** The focusable stage element of the iframe shell. */
const STAGE_VIEWPORT_ID = "trickroom-viewport";

/**
 * Wires the stage document: hover, click to select, double-click to drill,
 * and key forwarding. A press on a board's own background selects the board
 * (a board is a layer); a press on canvas space outside every board, or on
 * a draft board's empty area, clears the selection. One set of delegated
 * listeners on the stage window, none per layer.
 *
 * Board content is inert to the pointer: a press on a layer selects it and
 * nothing else, so links do not navigate, buttons do not submit, inputs do
 * not take focus and Base UI triggers do not open. The stage swallows the
 * primary press (pointer and mouse down and up) and every click, auxclick
 * and double-click in the capture phase on the window, before React (which
 * listens on the stage's mount node) or Base UI (document listeners) see
 * them. Middle-button and Space presses go through untouched so the canvas
 * can pan. A right-click selects like a press and opens no context menu.
 * Overlays open through their recipe controls, not by clicking.
 *
 * A selection press moves keyboard focus to the stage, first blurring the
 * editor control that had it, so a pending edit there commits to the layer
 * it belongs to before the selection changes, and Delete, Enter and Space
 * then act on the stage.
 *
 * Returns the cleanup.
 */
export function attachStageInteraction({
	document,
	window,
	source,
	onHoverChange,
	host,
}: StageInteractionOptions) {
	// Forwarding into the stage's own document would come straight back here.
	const forwardTo = host && host !== document ? host : null;
	let spacePressed = false;
	let hoverId: string | null = null;
	// The press in progress is a selection press, so its up events and the
	// click it produces are the stage's, not the board's.
	let selecting = false;
	// The last press selected (rather than panned), so a double-click that
	// ends it may drill. Unlike `selecting`, the click does not clear it.
	let lastPressSelected = false;

	const setHover = (id: string | null) => {
		if (hoverId === id) {
			return;
		}
		hoverId = id;
		onHoverChange(id);
	};

	const swallow = (event: Event) => {
		event.preventDefault();
		event.stopPropagation();
	};

	const focusStage = () => {
		const active = host?.activeElement;
		if (
			active &&
			active !== window.frameElement &&
			active !== host?.body &&
			typeof (active as HTMLElement).blur === "function"
		) {
			(active as HTMLElement).blur();
		}
		const viewport =
			document.getElementById(STAGE_VIEWPORT_ID) ?? document.body;
		if (document.activeElement !== viewport) {
			viewport.focus({ preventScroll: true });
		}
	};

	const selectAt = (target: StagePointerTarget) => {
		focusStage();
		source.select(target.kind === "layer" ? target.id : null);
	};

	const onPointerDown = (event: PointerEvent) => {
		selecting = false;
		lastPressSelected = false;
		// Any press, a pan included, ends the hover until the pointer moves.
		setHover(null);
		if (event.button !== 0 || spacePressed) {
			return;
		}
		const target = resolveStagePointerTarget(event.composedPath(), source);
		if (target.kind === "chrome" || isScrollbarPress(event)) {
			return;
		}
		selecting = true;
		lastPressSelected = true;
		swallow(event);
		selectAt(target);
	};

	const onContextMenu = (event: MouseEvent) => {
		const target = resolveStagePointerTarget(event.composedPath(), source);
		if (target.kind === "chrome" || isScrollbarPress(event)) {
			return;
		}
		swallow(event);
		selectAt(target);
	};

	// Mouse down and up, pointer up: the rest of a selection press. The
	// click that ends it clears the flag.
	const onPressFollowUp = (event: MouseEvent) => {
		if (selecting) {
			swallow(event);
		}
	};

	const onClick = (event: MouseEvent) => {
		selecting = false;
		const target = resolveStagePointerTarget(event.composedPath(), source);
		if (target.kind === "chrome") {
			return;
		}
		swallow(event);
	};

	const onDoubleClick = (event: MouseEvent) => {
		const target = resolveStagePointerTarget(event.composedPath(), source);
		if (target.kind === "chrome") {
			return;
		}
		swallow(event);
		// Only a double-click made of selection presses drills; a double
		// press while panning (Space held) selects nothing.
		if (
			target.kind !== "layer" ||
			event.button !== 0 ||
			spacePressed ||
			!lastPressSelected
		) {
			return;
		}
		const childId = getStageDrillTarget(source, source.getSelectedId());
		if (childId) {
			source.select(childId);
		}
	};

	const onPointerMove = (event: PointerEvent) => {
		setHover(
			resolveStageHoverId(event.composedPath(), source, {
				buttons: event.buttons,
				spacePressed,
			}),
		);
	};

	const onPointerOut = (event: PointerEvent) => {
		// Leaving the stage document altogether.
		if (!event.relatedTarget) {
			setHover(null);
		}
	};

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === " ") {
			spacePressed = true;
			setHover(null);
			return;
		}
		if (forwardTo) {
			forwardStageKeyEvent(event, forwardTo);
		}
	};

	const onKeyUp = (event: KeyboardEvent) => {
		if (event.key === " ") {
			spacePressed = false;
			return;
		}
		if (forwardTo) {
			forwardStageKeyEvent(event, forwardTo);
		}
	};

	const onBlur = () => {
		spacePressed = false;
		selecting = false;
		lastPressSelected = false;
	};

	const capture = { capture: true };
	const passiveCapture = { capture: true, passive: true };
	window.addEventListener("pointerdown", onPointerDown, capture);
	window.addEventListener("mousedown", onPressFollowUp, capture);
	window.addEventListener("pointerup", onPressFollowUp, capture);
	window.addEventListener("mouseup", onPressFollowUp, capture);
	window.addEventListener("click", onClick, capture);
	window.addEventListener("auxclick", onClick, capture);
	window.addEventListener("dblclick", onDoubleClick, capture);
	window.addEventListener("contextmenu", onContextMenu, capture);
	document.addEventListener("pointermove", onPointerMove, passiveCapture);
	document.addEventListener("pointerout", onPointerOut, passiveCapture);
	window.addEventListener("keydown", onKeyDown);
	window.addEventListener("keyup", onKeyUp);
	window.addEventListener("blur", onBlur);

	return () => {
		window.removeEventListener("pointerdown", onPointerDown, capture);
		window.removeEventListener("mousedown", onPressFollowUp, capture);
		window.removeEventListener("pointerup", onPressFollowUp, capture);
		window.removeEventListener("mouseup", onPressFollowUp, capture);
		window.removeEventListener("click", onClick, capture);
		window.removeEventListener("auxclick", onClick, capture);
		window.removeEventListener("dblclick", onDoubleClick, capture);
		window.removeEventListener("contextmenu", onContextMenu, capture);
		document.removeEventListener("pointermove", onPointerMove, passiveCapture);
		document.removeEventListener("pointerout", onPointerOut, passiveCapture);
		window.removeEventListener("keydown", onKeyDown);
		window.removeEventListener("keyup", onKeyUp);
		window.removeEventListener("blur", onBlur);
		setHover(null);
	};
}

const MISSING_RETRY_MS = 250;

/**
 * Finds the rendered element of a layer, caching it while it stays in the
 * document, so following a selection every frame does not query a large
 * stage every frame. A layer that renders no element of its own is looked
 * up again at most every 250ms.
 */
export function createStageNodeLookup(
	document: Document,
	now: () => number = () => document.defaultView?.performance.now() ?? 0,
) {
	const cache = new Map<string, HTMLElement>();
	const missingSince = new Map<string, number>();

	return (id: string): HTMLElement | null => {
		const cached = cache.get(id);
		if (
			cached?.isConnected &&
			cached.getAttribute(STAGE_NODE_ID_ATTRIBUTE) === id
		) {
			return cached;
		}
		cache.delete(id);
		const lastMiss = missingSince.get(id);
		if (lastMiss !== undefined && now() - lastMiss < MISSING_RETRY_MS) {
			return null;
		}
		const element = document.querySelector<HTMLElement>(
			`[${STAGE_NODE_ID_ATTRIBUTE}="${CSS.escape(id)}"]`,
		);
		if (!element) {
			missingSince.set(id, now());
			return null;
		}
		missingSince.delete(id);
		cache.set(id, element);
		return element;
	};
}
