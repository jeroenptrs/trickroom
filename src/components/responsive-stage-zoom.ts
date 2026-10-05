import {
	createContext,
	type Dispatch,
	type SetStateAction,
	useContext,
} from "react";

/**
 * Visual zoom of the responsive frame. `"fit"` tracks the fit-to-width scale;
 * a number is a fixed scale chosen by the user. Zoom is applied as a transform
 * on the frame wrapper in the parent document, so the iframe keeps the chosen
 * responsive width as its layout width and breakpoints stay correct.
 */
export type ResponsiveStageZoom = "fit" | number;

export const RESPONSIVE_STAGE_MIN_ZOOM = 0.25;
export const RESPONSIVE_STAGE_MAX_ZOOM = 4;
export const RESPONSIVE_STAGE_ZOOM_PRESETS = [0.5, 1, 2, 4] as const;

const RESPONSIVE_STAGE_ZOOM_STEPS = [
	0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4,
] as const;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const WHEEL_LINE_HEIGHT_PX = 16;
const MIN_VIEWPORT_HEIGHT_PX = 320;

export function clampResponsiveStageZoom(scale: number) {
	if (!Number.isFinite(scale)) {
		return 1;
	}

	return Math.min(
		RESPONSIVE_STAGE_MAX_ZOOM,
		Math.max(RESPONSIVE_STAGE_MIN_ZOOM, scale),
	);
}

export function resolveResponsiveStageScale(
	zoom: ResponsiveStageZoom,
	fitScale: number,
) {
	return zoom === "fit" ? fitScale : clampResponsiveStageZoom(zoom);
}

export function getResponsiveStageWheelZoom(
	currentScale: number,
	deltaY: number,
) {
	return clampResponsiveStageZoom(
		currentScale * Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY),
	);
}

export function stepResponsiveStageZoom(
	currentScale: number,
	direction: "in" | "out",
) {
	// Tolerate fit scales that sit a hair off a step (e.g. 0.6667).
	const epsilon = 0.01;
	const next =
		direction === "in"
			? RESPONSIVE_STAGE_ZOOM_STEPS.find(
					(step) => step > currentScale + epsilon,
				)
			: RESPONSIVE_STAGE_ZOOM_STEPS.findLast(
					(step) => step < currentScale - epsilon,
				);

	return clampResponsiveStageZoom(
		next ??
			(direction === "in"
				? RESPONSIVE_STAGE_MAX_ZOOM
				: RESPONSIVE_STAGE_MIN_ZOOM),
	);
}

export function formatResponsiveStageZoom(scale: number) {
	return `${Math.round(scale * 100)}%`;
}

/**
 * Layout height of the responsive viewport (what `100vh` resolves to inside
 * the iframe). Chosen so the frame fills the available height at fit zoom,
 * and independent of the user's zoom so zooming never relayouts the design.
 */
export function getResponsiveStageViewportHeight(
	availableHeight: number,
	fitScale: number,
) {
	if (availableHeight <= 0 || fitScale <= 0) {
		return MIN_VIEWPORT_HEIGHT_PX;
	}

	return Math.max(
		MIN_VIEWPORT_HEIGHT_PX,
		Math.round(availableHeight / fitScale),
	);
}

type Point = { x: number; y: number };
type ScrollPosition = { left: number; top: number };

/**
 * Scroll position that keeps the frame point under `anchor` (relative to the
 * scroll container's visible box) in place across a zoom change. Slot offsets
 * are the frame's position inside the scroll content, independent of scroll.
 */
export function getZoomAnchoredScroll({
	anchor,
	previousScroll,
	previousSlot,
	previousScale,
	nextSlot,
	nextScale,
}: {
	anchor: Point;
	previousScroll: ScrollPosition;
	previousSlot: ScrollPosition;
	previousScale: number;
	nextSlot: ScrollPosition;
	nextScale: number;
}): ScrollPosition {
	const frameX =
		(previousScroll.left + anchor.x - previousSlot.left) / previousScale;
	const frameY =
		(previousScroll.top + anchor.y - previousSlot.top) / previousScale;

	return {
		left: Math.max(0, nextSlot.left + frameX * nextScale - anchor.x),
		top: Math.max(0, nextSlot.top + frameY * nextScale - anchor.y),
	};
}

/** Wheel delta in pixels, with Shift+wheel mapped to horizontal scrolling. */
export function normalizeStageWheelDelta(
	event: Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "shiftKey">,
	pageHeight: number,
): Point {
	const unit =
		event.deltaMode === 1
			? WHEEL_LINE_HEIGHT_PX
			: event.deltaMode === 2
				? pageHeight
				: 1;
	const x = event.deltaX * unit;
	const y = event.deltaY * unit;

	if (event.shiftKey && x === 0) {
		return { x: y, y: 0 };
	}

	return { x, y };
}

type ScrollMetrics = {
	scrollLeft: number;
	scrollTop: number;
	scrollWidth: number;
	scrollHeight: number;
	clientWidth: number;
	clientHeight: number;
};

/** Whether a scroller can still move in the wheel's dominant direction. */
export function canScrollStageViewport(metrics: ScrollMetrics, delta: Point) {
	const vertical = Math.abs(delta.y) >= Math.abs(delta.x);
	const amount = vertical ? delta.y : delta.x;
	if (amount === 0) {
		return false;
	}

	const position = vertical ? metrics.scrollTop : metrics.scrollLeft;
	const max = vertical
		? metrics.scrollHeight - metrics.clientHeight
		: metrics.scrollWidth - metrics.clientWidth;

	// Sub-pixel slack: scroll positions can land a fraction short of max.
	return amount > 0 ? position < max - 1 : position > 0;
}

// Wheel events inside the iframe do not reach the parent document, so the
// stage re-dispatches them on the iframe element. Marking them lets the frame
// wrapper apply the scroll itself (synthetic events never scroll natively).
const forwardedStageWheelEvents = new WeakSet<Event>();

export function markForwardedStageWheel(event: Event) {
	forwardedStageWheelEvents.add(event);
}

export function isForwardedStageWheel(event: Event) {
	return forwardedStageWheelEvents.has(event);
}

export type ResponsiveStageZoomContextValue = {
	zoom: ResponsiveStageZoom;
	/** Fit-to-width scale of the current frame, reported by the frame wrapper. */
	fitScale: number;
	/** Effective scale: `fitScale` at fit zoom, otherwise the chosen zoom. */
	scale: number;
	setZoom: Dispatch<SetStateAction<ResponsiveStageZoom>>;
	setFitScale: (fitScale: number) => void;
};

export const ResponsiveStageZoomContext = createContext<
	ResponsiveStageZoomContextValue | undefined
>(undefined);

export function useResponsiveStageZoom() {
	const context = useContext(ResponsiveStageZoomContext);
	if (!context) {
		throw new Error(
			"useResponsiveStageZoom must be used within ResponsiveStageZoomContext",
		);
	}

	return context;
}
