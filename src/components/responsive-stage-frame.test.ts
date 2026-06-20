import { describe, expect, it } from "vitest";
import {
	getActiveResponsiveBreakpoint,
	getDraggedResponsiveStageWidth,
	getResponsiveStagePreviewScale,
	getResponsiveStageRulerTicks,
} from "./responsive-stage-frame";

describe("getDraggedResponsiveStageWidth", () => {
	it("increases width when the right rail moves right", () => {
		expect(getDraggedResponsiveStageWidth(640, 100, 180, "right")).toBe(720);
	});

	it("increases width when the left rail moves left", () => {
		expect(getDraggedResponsiveStageWidth(640, 100, 40, "left")).toBe(700);
	});

	it("clamps dragged widths to the responsive frame range", () => {
		expect(getDraggedResponsiveStageWidth(640, 100, -1000, "right")).toBe(320);
		expect(getDraggedResponsiveStageWidth(2200, 100, 500, "right")).toBe(2400);
	});

	it("maps visual drag distance through preview scale", () => {
		expect(getDraggedResponsiveStageWidth(1440, 100, 200, "right", 0.5)).toBe(
			1640,
		);
		expect(getDraggedResponsiveStageWidth(1440, 100, 50, "left", 0.5)).toBe(
			1540,
		);
	});
});

describe("getResponsiveStagePreviewScale", () => {
	it("keeps normal widths at full scale", () => {
		expect(getResponsiveStagePreviewScale(640, 1000)).toBe(1);
	});

	it("auto-fits large widths down to the minimum preview scale", () => {
		expect(getResponsiveStagePreviewScale(1440, 800)).toBe(0.5);
		expect(getResponsiveStagePreviewScale(2400, 400)).toBe(0.25);
	});
});

describe("getActiveResponsiveBreakpoint", () => {
	const breakpoints = [
		{ name: "sm", value: "40rem", px: 640, source: "default" },
		{ name: "md", value: "48rem", px: 768, source: "default" },
		{ name: "fluid", value: "clamp(...)", px: null, source: "system" },
	] as const;

	it("returns the highest parsed breakpoint below the current width", () => {
		expect(getActiveResponsiveBreakpoint(breakpoints, 767)?.name).toBe("sm");
		expect(getActiveResponsiveBreakpoint(breakpoints, 1024)?.name).toBe("md");
	});

	it("ignores unparseable breakpoints", () => {
		expect(getActiveResponsiveBreakpoint(breakpoints, 500)).toBeNull();
	});
});

describe("getResponsiveStageRulerTicks", () => {
	it("builds minor and labelled major ticks", () => {
		expect(getResponsiveStageRulerTicks(425)).toEqual([
			{ px: 0, major: true, label: "0" },
			{ px: 50, major: false, label: null },
			{ px: 100, major: false, label: null },
			{ px: 150, major: false, label: null },
			{ px: 200, major: true, label: "200" },
			{ px: 250, major: false, label: null },
			{ px: 300, major: false, label: null },
			{ px: 350, major: false, label: null },
			{ px: 400, major: true, label: "400" },
			{ px: 425, major: true, label: "425" },
		]);
	});
});
