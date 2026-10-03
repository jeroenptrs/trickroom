import { describe, expect, it } from "vitest";
import {
	canScrollStageViewport,
	clampResponsiveStageZoom,
	formatResponsiveStageZoom,
	getResponsiveStageViewportHeight,
	getResponsiveStageWheelZoom,
	getZoomAnchoredScroll,
	isForwardedStageWheel,
	markForwardedStageWheel,
	normalizeStageWheelDelta,
	RESPONSIVE_STAGE_MAX_ZOOM,
	RESPONSIVE_STAGE_MIN_ZOOM,
	resolveResponsiveStageScale,
	stepResponsiveStageZoom,
} from "./responsive-stage-zoom";

describe("responsive stage zoom scale", () => {
	it("uses the fit scale at fit zoom and the chosen scale otherwise", () => {
		expect(resolveResponsiveStageScale("fit", 0.6)).toBe(0.6);
		expect(resolveResponsiveStageScale(1, 0.6)).toBe(1);
		expect(resolveResponsiveStageScale(2.5, 0.6)).toBe(2.5);
	});

	it("clamps manual zoom between 25% and 400%", () => {
		expect(RESPONSIVE_STAGE_MIN_ZOOM).toBe(0.25);
		expect(RESPONSIVE_STAGE_MAX_ZOOM).toBe(4);
		expect(clampResponsiveStageZoom(10)).toBe(4);
		expect(clampResponsiveStageZoom(0.01)).toBe(0.25);
		expect(clampResponsiveStageZoom(Number.NaN)).toBe(1);
		expect(resolveResponsiveStageScale(8, 0.6)).toBe(4);
	});

	it("zooms in on wheel up and out on wheel down, within bounds", () => {
		expect(getResponsiveStageWheelZoom(1, -100)).toBeGreaterThan(1);
		expect(getResponsiveStageWheelZoom(1, 100)).toBeLessThan(1);
		expect(getResponsiveStageWheelZoom(1, 0)).toBe(1);
		expect(getResponsiveStageWheelZoom(3.9, -10_000)).toBe(4);
		expect(getResponsiveStageWheelZoom(0.3, 10_000)).toBe(0.25);
	});

	it("steps through zoom levels from any scale, including odd fit scales", () => {
		expect(stepResponsiveStageZoom(1, "in")).toBe(1.25);
		expect(stepResponsiveStageZoom(1, "out")).toBe(0.75);
		expect(stepResponsiveStageZoom(0.62, "in")).toBe(0.67);
		expect(stepResponsiveStageZoom(0.62, "out")).toBe(0.5);
		expect(stepResponsiveStageZoom(0.6667, "in")).toBe(0.75);
		expect(stepResponsiveStageZoom(4, "in")).toBe(4);
		expect(stepResponsiveStageZoom(0.25, "out")).toBe(0.25);
	});

	it("formats zoom as a rounded percentage", () => {
		expect(formatResponsiveStageZoom(0.6234)).toBe("62%");
		expect(formatResponsiveStageZoom(4)).toBe("400%");
	});
});

describe("responsive stage viewport height", () => {
	it("fills the available height at fit zoom", () => {
		expect(getResponsiveStageViewportHeight(700, 1)).toBe(700);
		expect(getResponsiveStageViewportHeight(700, 0.5)).toBe(1400);
	});

	it("falls back to a minimum before the stage is measured", () => {
		expect(getResponsiveStageViewportHeight(0, 1)).toBe(320);
		expect(getResponsiveStageViewportHeight(100, 1)).toBe(320);
	});
});

describe("zoom anchored scroll", () => {
	it("keeps the anchored frame point under the cursor", () => {
		// Frame starts 40px into the scroll content at 50%; cursor 300px into the
		// visible area with no scroll, so frame point x = (300 - 40) / 0.5 = 520.
		const next = getZoomAnchoredScroll({
			anchor: { x: 300, y: 200 },
			previousScroll: { left: 0, top: 0 },
			previousSlot: { left: 40, top: 80 },
			previousScale: 0.5,
			nextSlot: { left: 40, top: 80 },
			nextScale: 2,
		});

		// At 200% that point sits at 40 + 520 * 2 = 1080 in the content.
		expect(next.left).toBe(1080 - 300);
		expect(next.top).toBe(80 + ((200 - 80) / 0.5) * 2 - 200);
	});

	it("accounts for existing scroll and a moved frame", () => {
		const next = getZoomAnchoredScroll({
			anchor: { x: 100, y: 100 },
			previousScroll: { left: 500, top: 300 },
			previousSlot: { left: 40, top: 80 },
			previousScale: 2,
			nextSlot: { left: 200, top: 80 },
			nextScale: 1,
		});

		expect(next.left).toBe(200 + (500 + 100 - 40) / 2 - 100);
		expect(next.top).toBe(80 + (300 + 100 - 80) / 2 - 100);
	});

	it("never asks for negative scroll", () => {
		expect(
			getZoomAnchoredScroll({
				anchor: { x: 500, y: 400 },
				previousScroll: { left: 0, top: 0 },
				previousSlot: { left: 40, top: 80 },
				previousScale: 1,
				nextSlot: { left: 100, top: 80 },
				nextScale: 0.5,
			}),
		).toEqual({ left: 0, top: 0 });
	});
});

describe("responsive stage wheel handling", () => {
	it("normalizes line and page deltas to pixels", () => {
		expect(
			normalizeStageWheelDelta(
				{ deltaX: 0, deltaY: 3, deltaMode: 1, shiftKey: false },
				800,
			),
		).toEqual({ x: 0, y: 48 });
		expect(
			normalizeStageWheelDelta(
				{ deltaX: 0, deltaY: -1, deltaMode: 2, shiftKey: false },
				800,
			),
		).toEqual({ x: 0, y: -800 });
	});

	it("maps Shift+wheel to horizontal scrolling", () => {
		expect(
			normalizeStageWheelDelta(
				{ deltaX: 0, deltaY: 40, deltaMode: 0, shiftKey: true },
				800,
			),
		).toEqual({ x: 40, y: 0 });
		expect(
			normalizeStageWheelDelta(
				{ deltaX: 25, deltaY: 0, deltaMode: 0, shiftKey: true },
				800,
			),
		).toEqual({ x: 25, y: 0 });
	});

	const tallViewport = {
		scrollLeft: 0,
		scrollTop: 0,
		scrollWidth: 1440,
		scrollHeight: 3000,
		clientWidth: 1440,
		clientHeight: 900,
	};

	it("lets the iframe viewport scroll while it has room", () => {
		expect(canScrollStageViewport(tallViewport, { x: 0, y: 100 })).toBe(true);
		expect(
			canScrollStageViewport(
				{ ...tallViewport, scrollTop: 1000 },
				{ x: 0, y: -100 },
			),
		).toBe(true);
	});

	it("hands the wheel to the parent at the viewport edges and sideways", () => {
		expect(canScrollStageViewport(tallViewport, { x: 0, y: -100 })).toBe(false);
		expect(
			canScrollStageViewport(
				{ ...tallViewport, scrollTop: 2100 },
				{ x: 0, y: 100 },
			),
		).toBe(false);
		expect(canScrollStageViewport(tallViewport, { x: 100, y: 10 })).toBe(false);
		expect(canScrollStageViewport(tallViewport, { x: 0, y: 0 })).toBe(false);
	});

	it("scrolls wide boards horizontally inside the viewport", () => {
		expect(
			canScrollStageViewport(
				{ ...tallViewport, scrollWidth: 2000 },
				{ x: 100, y: 0 },
			),
		).toBe(true);
	});

	it("marks forwarded wheel events", () => {
		const forwarded = new Event("wheel");
		const native = new Event("wheel");
		markForwardedStageWheel(forwarded);

		expect(isForwardedStageWheel(forwarded)).toBe(true);
		expect(isForwardedStageWheel(native)).toBe(false);
	});
});
