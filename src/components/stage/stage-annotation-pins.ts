import type { CSSProperties } from "react";
import { isStageStylesReady } from "../../hooks/useStageNavigation";
import {
	type AnnotationTargetLocator,
	deriveDetachedWith,
} from "../../services/annotation-model";
import type { AnnotationView } from "../../services/annotations.types";
import type { AnnotationDraft } from "../../stores/annotation-draft-store";
import {
	ANNOTATION_MARKER_LOOK,
	ANNOTATION_STATE_LABELS,
	type AnnotationMarkerLook,
	type AnnotationPresentationState,
	compareAnnotationStates,
	getAnnotationPresentationState,
	isAnnotationShown,
} from "../../utils/annotation-presentation";
import {
	measureStageOverlayBox,
	STAGE_HIGHLIGHT_CYAN,
	STAGE_HIGHLIGHT_SLATE,
	type StageOverlayGeometry,
} from "./stage-overlay";

/**
 * Annotation pins on the stage: one square per layer (or board) with
 * annotations, state-coloured, with the count when several share it. A
 * second overlay kind next to the selection outline, placed with the same
 * measuring (`measureStageOverlayBox`) inside the stage document and marked
 * as stage chrome, so a press on a pin reaches the pin instead of selecting
 * the layer underneath.
 *
 * The overlay origin sits inside the panned and zoomed world, so pins keep
 * their place while the canvas pans; they are measured again only when
 * something could have moved them (an edit, an annotation, a zoom, a
 * resize), for a short burst of frames, and idle otherwise.
 */

/** Pin edge, in screen pixels at any zoom. */
export const STAGE_ANNOTATION_PIN_SIZE = 16;
const PIN_GAP = 2;

export const STAGE_ANNOTATION_PIN_ATTRIBUTE = "data-trickroom-annotation-pin";

export type StageAnnotationPinCorner = "top-left" | "top-right";

export type StageAnnotationPin = {
	/** Stable per pin: `layer:<id>`, `board:<id>`, `detached:<boardId>`, `draft:<id>`. */
	key: string;
	/** The element the pin sits on (a layer or a board). */
	anchorId: string;
	corner: StageAnnotationPinCorner;
	/** Steps away from the corner, for a second pin on the same element. */
	slot: number;
	state: AnnotationPresentationState;
	count: number;
	/** Most urgent first; empty for a draft pin. */
	annotationIds: string[];
	/** What a click selects: the layer or board. */
	selectId: string;
	title: string;
};

type PinGroup = Omit<StageAnnotationPin, "state" | "count" | "title"> & {
	entries: { state: AnnotationPresentationState; id: string | null }[];
};

const firstLine = (text: string) => {
	const line = text.split("\n", 1)[0]?.trim() ?? "";
	return line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

const remarkOf = (annotation: AnnotationView) => {
	const remark = annotation.entries.find((entry) => entry.kind === "remark");
	return remark && remark.kind === "remark" ? firstLine(remark.body) : "";
};

/**
 * The pins for `annotations` and `drafts` against the editor's tree:
 *
 * - layer annotations pin to their layer's top-right corner,
 * - board annotations to the board's top-left corner,
 * - live annotations whose layer is gone (detached) to their board's
 *   top-left corner, next to the board's own pin,
 * - drafts beside the pin of their target, dashed.
 *
 * Closed annotations pin only while `showResolved`. Design-level
 * annotations have nothing to pin to.
 */
export function buildStageAnnotationPins({
	annotations,
	drafts,
	showResolved,
	locator,
}: {
	annotations: readonly AnnotationView[];
	drafts: readonly AnnotationDraft[];
	showResolved: boolean;
	locator: AnnotationTargetLocator;
}): StageAnnotationPin[] {
	const groups = new Map<string, PinGroup>();
	const add = (
		group: Omit<PinGroup, "entries">,
		entry: PinGroup["entries"][number],
	) => {
		const existing = groups.get(group.key);
		if (existing) {
			existing.entries.push(entry);
		} else {
			groups.set(group.key, { ...group, entries: [entry] });
		}
	};
	const remarks = new Map<string, string>();

	for (const annotation of annotations) {
		if (!isAnnotationShown(annotation, showResolved)) continue;
		const { target } = annotation;
		if (target.kind !== "layer" && target.kind !== "board") continue;
		const detached = deriveDetachedWith(target, locator) === true;
		const entry = {
			state: getAnnotationPresentationState(annotation, detached),
			id: annotation.id,
		};
		remarks.set(annotation.id, remarkOf(annotation));
		if (!detached) {
			const anchorId =
				target.kind === "layer" ? target.elementId : target.boardId;
			add(
				{
					key: `${target.kind}:${anchorId}`,
					anchorId,
					corner: target.kind === "layer" ? "top-right" : "top-left",
					slot: 0,
					annotationIds: [],
					selectId: anchorId,
				},
				entry,
			);
			continue;
		}
		// A detached board has nowhere to go; a detached layer goes to its
		// board while the board exists.
		if (target.kind === "layer" && locator.hasBoard(target.boardId)) {
			add(
				{
					key: `detached:${target.boardId}`,
					anchorId: target.boardId,
					corner: "top-left",
					slot: 1,
					annotationIds: [],
					selectId: target.boardId,
				},
				entry,
			);
		}
	}

	for (const draft of drafts) {
		const { target } = draft;
		if (target.kind === "layer") {
			if (locator.boardOfLayer(target.elementId) === null) continue;
			add(
				{
					key: `draft:${target.elementId}`,
					anchorId: target.elementId,
					corner: "top-right",
					slot: 1,
					annotationIds: [],
					selectId: target.elementId,
				},
				{ state: "draft", id: null },
			);
		} else if (target.kind === "board" && locator.hasBoard(target.boardId)) {
			add(
				{
					key: `draft:${target.boardId}`,
					anchorId: target.boardId,
					corner: "top-left",
					slot: 2,
					annotationIds: [],
					selectId: target.boardId,
				},
				{ state: "draft", id: null },
			);
		}
	}

	return [...groups.values()].map(({ entries, ...group }) => {
		const sorted = [...entries].sort((a, b) =>
			compareAnnotationStates(a.state, b.state),
		);
		const state = sorted[0]?.state ?? "open";
		const annotationIds = sorted
			.map((entry) => entry.id)
			.filter((id): id is string => id !== null);
		const label = ANNOTATION_STATE_LABELS[state];
		const remark = annotationIds[0] ? remarks.get(annotationIds[0]) : "";
		const title =
			state === "draft"
				? entries.length > 1
					? `${entries.length} drafts`
					: "Draft annotation"
				: entries.length > 1
					? `${entries.length} annotations (${label.toLowerCase()})`
					: `${label}${remark ? `: ${remark}` : ""}`;
		return {
			...group,
			state,
			count: entries.length,
			annotationIds,
			title,
		};
	});
}

/** Where a pin goes, in the origin's unscaled coordinates. */
export function placeStageAnnotationPin(
	geometry: StageOverlayGeometry,
	corner: StageAnnotationPinCorner,
	slot: number,
	size = STAGE_ANNOTATION_PIN_SIZE,
) {
	const edge = size / geometry.scale;
	const step = (size + PIN_GAP) / geometry.scale;
	return {
		left:
			corner === "top-right"
				? geometry.left + geometry.width - edge / 2 - slot * step
				: geometry.left - edge / 2 + slot * step,
		top: geometry.top - edge / 2,
		size: edge,
	};
}

// The stage does not load the app's stylesheet: the looks of
// `components/ui/annotation-marker.tsx`, inline. Tailwind's slate and cyan.
const SLATE_50 = "#f8fafc";
const SLATE_400 = "#94a3b8";
const SLATE_600 = "#475569";
const CYAN_700 = "#0e7490";

export const STAGE_ANNOTATION_PIN_LOOKS: Record<
	AnnotationMarkerLook,
	{
		background: string;
		color: string;
		borderStyle: "solid" | "dashed" | "none";
		borderColor: string;
		opacity: number;
	}
> = {
	filled: {
		background: STAGE_HIGHLIGHT_CYAN,
		color: STAGE_HIGHLIGHT_SLATE,
		borderStyle: "none",
		borderColor: "transparent",
		opacity: 1,
	},
	hollow: {
		background: SLATE_50,
		color: CYAN_700,
		borderStyle: "solid",
		borderColor: STAGE_HIGHLIGHT_CYAN,
		opacity: 1,
	},
	question: {
		background: STAGE_HIGHLIGHT_SLATE,
		color: STAGE_HIGHLIGHT_CYAN,
		borderStyle: "solid",
		borderColor: STAGE_HIGHLIGHT_CYAN,
		opacity: 1,
	},
	detached: {
		background: SLATE_50,
		color: SLATE_600,
		borderStyle: "dashed",
		borderColor: SLATE_400,
		opacity: 1,
	},
	draft: {
		background: SLATE_50,
		color: CYAN_700,
		borderStyle: "dashed",
		borderColor: STAGE_HIGHLIGHT_CYAN,
		opacity: 1,
	},
	muted: {
		background: STAGE_HIGHLIGHT_SLATE,
		color: SLATE_50,
		borderStyle: "none",
		borderColor: "transparent",
		opacity: 0.4,
	},
	check: {
		background: SLATE_50,
		color: CYAN_700,
		borderStyle: "solid",
		borderColor: STAGE_HIGHLIGHT_CYAN,
		opacity: 1,
	},
};

export const stageAnnotationPinStyle: CSSProperties = {
	position: "absolute",
	display: "none",
	boxSizing: "border-box",
	alignItems: "center",
	justifyContent: "center",
	pointerEvents: "auto",
	cursor: "pointer",
	fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
	fontWeight: 600,
	lineHeight: 1,
	userSelect: "none",
};

/** Paints `pin` on `element` (a pooled pin box). */
export function applyStageAnnotationPin(
	element: HTMLElement,
	pin: StageAnnotationPin,
	geometry: StageOverlayGeometry,
) {
	const { left, top, size } = placeStageAnnotationPin(
		geometry,
		pin.corner,
		pin.slot,
	);
	const look = STAGE_ANNOTATION_PIN_LOOKS[ANNOTATION_MARKER_LOOK[pin.state]];
	const { scale } = geometry;
	const style = element.style;
	style.display = "flex";
	style.left = `${left}px`;
	style.top = `${top}px`;
	style.width = `${size}px`;
	style.height = `${size}px`;
	style.fontSize = `${10 / scale}px`;
	style.background = look.background;
	style.color = look.color;
	style.opacity = String(look.opacity);
	style.borderStyle = look.borderStyle;
	style.borderColor = look.borderColor;
	style.borderWidth = look.borderStyle === "none" ? "0" : `${2 / scale}px`;
	// A one-pixel slate halo, like the outlines, so pins read on any board.
	style.boxShadow = `0 0 0 ${1 / scale}px ${STAGE_HIGHLIGHT_SLATE}`;
	const text =
		ANNOTATION_MARKER_LOOK[pin.state] === "check"
			? "✓"
			: pin.count > 1
				? String(pin.count)
				: "";
	if (element.textContent !== text) element.textContent = text;
	if (element.title !== pin.title) element.title = pin.title;
	element.setAttribute(STAGE_ANNOTATION_PIN_ATTRIBUTE, pin.key);
	element.setAttribute("data-state", pin.state);
}

/** How long pins keep being measured after something could have moved them. */
const BURST_MS = 600;

export type StageAnnotationPinsOptions = {
	document: Document;
	window: Window;
	/** The zero-size origin the pins are positioned from. */
	origin: HTMLElement;
	/** The pins to show now. */
	getPins: () => readonly StageAnnotationPin[];
	/** Finds the rendered element of a layer or board. */
	lookup: (id: string) => HTMLElement | null;
	/** Calls `listener` after anything that may change the pins or move them. */
	subscribe: (listener: () => void) => () => void;
	onPinClick: (pin: StageAnnotationPin) => void;
};

/**
 * Runs the pins: one pooled box per pin key, one delegated click listener on
 * the origin, painting in animation frames for a short burst after any
 * change (stores, zoom, resize, fonts) and idling otherwise. Geometry is
 * read only in the frame. Returns the cleanup.
 */
export function startStageAnnotationPins({
	document,
	window,
	origin,
	getPins,
	lookup,
	subscribe,
	onPinClick,
}: StageAnnotationPinsOptions) {
	const boxes = new Map<string, HTMLElement>();
	let pins = new Map<string, StageAnnotationPin>();
	let frame = 0;
	let burstUntil = 0;
	let lastScale: number | null = null;

	const paint = () => {
		const next = new Map<string, StageAnnotationPin>();
		for (const pin of getPins()) next.set(pin.key, pin);
		pins = next;
		for (const [key, box] of boxes) {
			if (!next.has(key)) {
				box.remove();
				boxes.delete(key);
			}
		}
		const ready = isStageStylesReady(document);
		for (const pin of next.values()) {
			let box = boxes.get(pin.key);
			if (!box) {
				box = document.createElement("div");
				Object.assign(box.style, stageAnnotationPinStyle);
				origin.appendChild(box);
				boxes.set(pin.key, box);
			}
			const element = ready ? lookup(pin.anchorId) : null;
			if (!element) {
				box.style.display = "none";
				continue;
			}
			const geometry = measureStageOverlayBox(origin, element);
			lastScale = geometry.scale;
			applyStageAnnotationPin(box, pin, geometry);
		}
	};

	const step = () => {
		frame = 0;
		paint();
		if (window.performance.now() < burstUntil) {
			frame = window.requestAnimationFrame(step);
		}
	};

	const schedule = () => {
		burstUntil = window.performance.now() + BURST_MS;
		if (!frame) {
			frame = window.requestAnimationFrame(step);
		}
	};

	const onClick = (event: MouseEvent) => {
		const target = event.target as Element | null;
		const box = target?.closest?.(`[${STAGE_ANNOTATION_PIN_ATTRIBUTE}]`);
		const key = box?.getAttribute(STAGE_ANNOTATION_PIN_ATTRIBUTE);
		const pin = key ? pins.get(key) : undefined;
		if (!pin) return;
		event.preventDefault();
		event.stopPropagation();
		onPinClick(pin);
	};
	origin.addEventListener("click", onClick);

	// A zoom rescales pins; a pan moves the world they live in and needs
	// nothing. The world's transform is one style attribute.
	const world = origin.parentElement;
	const frameWindow = window as Window & typeof globalThis;
	const MutationObserverCtor = frameWindow.MutationObserver;
	const worldObserver =
		world && MutationObserverCtor
			? new MutationObserverCtor(() => {
					if (lastScale === null || world.offsetWidth === 0) return;
					const scale = world.getBoundingClientRect().width / world.offsetWidth;
					if (Math.abs(scale - lastScale) > 1e-6) schedule();
				})
			: null;
	if (world) worldObserver?.observe(world, { attributeFilter: ["style"] });

	// Layout changes that do not go through a store: compiled styles landing,
	// fonts, the responsive viewport resizing.
	const ResizeObserverCtor = frameWindow.ResizeObserver;
	const resizeObserver = ResizeObserverCtor
		? new ResizeObserverCtor(() => schedule())
		: null;
	const main = world?.querySelector(":scope > main");
	if (main) resizeObserver?.observe(main);
	resizeObserver?.observe(document.documentElement);
	void document.fonts?.ready.then(schedule);

	const unsubscribe = subscribe(schedule);
	schedule();

	return () => {
		unsubscribe();
		window.cancelAnimationFrame(frame);
		origin.removeEventListener("click", onClick);
		worldObserver?.disconnect();
		resizeObserver?.disconnect();
		for (const box of boxes.values()) box.remove();
		boxes.clear();
	};
}
