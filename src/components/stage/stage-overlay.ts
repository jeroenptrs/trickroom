import type { CSSProperties } from "react";

// The stage iframe does not load the app's stylesheet, so overlays are
// styled inline: square, cyan on slate, like the editor chrome.
export const STAGE_HIGHLIGHT_CYAN = "#22d3ee";
export const STAGE_HIGHLIGHT_SLATE = "#020617";

/**
 * Marks editor chrome rendered into the stage document (highlights, the
 * selection layer, annotation pins). The stage's pointer handling leaves
 * events inside it alone, so chrome can be interactive without being
 * mistaken for board content.
 */
export const STAGE_CHROME_ATTRIBUTE = "data-trickroom-stage-chrome";

/** Where an overlay box goes, in the unscaled coordinates of its origin. */
export type StageOverlayGeometry = {
	left: number;
	top: number;
	width: number;
	height: number;
	/** The canvas zoom; chrome divides by it to keep a constant screen size. */
	scale: number;
};

/**
 * Measures `element` relative to the zero-size `origin` an overlay box is
 * positioned from, both inside the stage document. The canvas scales the
 * world with a transform; the geometry undoes it.
 */
export function measureStageOverlayBox(
	origin: HTMLElement,
	element: HTMLElement,
): StageOverlayGeometry {
	const world = origin.parentElement;
	const scale =
		world && world.offsetWidth > 0
			? world.getBoundingClientRect().width / world.offsetWidth
			: 1;
	const originRect = origin.getBoundingClientRect();
	const rect = element.getBoundingClientRect();
	return {
		left: (rect.left - originRect.left) / scale,
		top: (rect.top - originRect.top) / scale,
		width: rect.width / scale,
		height: rect.height / scale,
		scale,
	};
}

export function isSameStageOverlayGeometry(
	a: StageOverlayGeometry | null,
	b: StageOverlayGeometry,
) {
	return (
		a !== null &&
		a.left === b.left &&
		a.top === b.top &&
		a.width === b.width &&
		a.height === b.height &&
		a.scale === b.scale
	);
}

/**
 * Shows `box` at `geometry` with a border of `border` screen pixels and a
 * one-pixel slate halo, so it reads on light and dark boards alike.
 */
export function applyStageOverlayBox(
	box: HTMLElement,
	geometry: StageOverlayGeometry,
	border = 2,
) {
	const { scale } = geometry;
	box.style.display = "block";
	box.style.left = `${geometry.left}px`;
	box.style.top = `${geometry.top}px`;
	box.style.width = `${geometry.width}px`;
	box.style.height = `${geometry.height}px`;
	box.style.borderWidth = `${border / scale}px`;
	box.style.boxShadow = `0 0 0 ${1 / scale}px ${STAGE_HIGHLIGHT_SLATE}`;
}

/**
 * Places an outline `box` over `element`, both inside the stage document,
 * relative to the zero-size `origin` the box is positioned from. The outline
 * keeps a constant on-screen size at any zoom. Returns the canvas scale.
 */
export function placeStageOverlayBox(
	origin: HTMLElement,
	box: HTMLElement,
	element: HTMLElement,
) {
	const geometry = measureStageOverlayBox(origin, element);
	applyStageOverlayBox(box, geometry);
	return geometry.scale;
}

/** Sizes a layer name label for the canvas zoom. */
export function applyStageOverlayLabelScale(label: HTMLElement, scale: number) {
	label.style.fontSize = `${10 / scale}px`;
	label.style.padding = `${2 / scale}px ${4 / scale}px`;
}

/** The zero-size, non-interactive origin every overlay box is placed from. */
export const stageOverlayOriginStyle: CSSProperties = {
	position: "absolute",
	left: 0,
	top: 0,
	width: 0,
	height: 0,
	pointerEvents: "none",
};

/** The layer name label above an outline box. */
export const stageOverlayLabelStyle: CSSProperties = {
	position: "absolute",
	left: 0,
	bottom: "100%",
	backgroundColor: STAGE_HIGHLIGHT_SLATE,
	color: STAGE_HIGHLIGHT_CYAN,
	fontFamily: '"IBM Plex Mono", ui-monospace, monospace',
	fontWeight: 500,
	letterSpacing: "0.05em",
	lineHeight: 1.4,
	textTransform: "uppercase",
	whiteSpace: "nowrap",
};
