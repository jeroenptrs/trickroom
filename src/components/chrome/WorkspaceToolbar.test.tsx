import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { ViewState } from "../../hooks/useStageNavigation";
import { hydrateDesign } from "../../stores/design-store";
import type { TrickroomDesign } from "../../types";
import type { ResolvedBreakpoint } from "../../utils/resolved-breakpoints";
import { IFrameViewContext } from "../contexts";
import {
	ResponsiveStageContext,
	type ResponsiveStageContextValue,
} from "../responsive-stage-context";
import {
	getResponsiveWidthDraftError,
	RESPONSIVE_DEVICE_WIDTH_PRESETS,
	resolveResponsiveWidthDraftCommit,
	WorkspaceToolbar,
} from "./WorkspaceToolbar";

const SAMPLE_DESIGN = {
	name: "Toolbar test",
	boards: [
		{
			id: "board-1",
			props: {
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
				"data-trickroom-name": "Home",
			},
			children: [],
		},
		{
			id: "board-2",
			props: {
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
				"data-trickroom-name": "About",
			},
			children: [],
		},
	],
} satisfies TrickroomDesign;

const noopControls = {
	setMode: () => {},
	setActiveBoardId: () => {},
	setResponsiveWidth: () => {},
} satisfies ResponsiveStageContextValue["controls"];

const TEST_BREAKPOINTS = [
	{ name: "sm", value: "40rem", px: 640, source: "default" },
	{ name: "md", value: "48rem", px: 768, source: "default" },
	{
		name: "fluid",
		value: "var(--breakpoint-fluid)",
		px: null,
		source: "system",
	},
] satisfies ResolvedBreakpoint[];

function renderToolbar(
	stage: Pick<
		ResponsiveStageContextValue,
		"mode" | "activeBoardId" | "responsiveWidth"
	> & {
		breakpoints?: readonly ResolvedBreakpoint[];
	},
	view: ViewState = { x: 0, y: 0, scale: 1.25 },
) {
	return renderToStaticMarkup(
		<IFrameViewContext.Provider value={view}>
			<ResponsiveStageContext.Provider
				value={{
					mode: stage.mode,
					activeBoardId: stage.activeBoardId,
					responsiveWidth: stage.responsiveWidth,
					breakpoints: stage.breakpoints ?? TEST_BREAKPOINTS,
					controls: noopControls,
				}}
			>
				<WorkspaceToolbar />
			</ResponsiveStageContext.Provider>
		</IFrameViewContext.Provider>,
	);
}

describe("WorkspaceToolbar", () => {
	beforeEach(() => {
		hydrateDesign(SAMPLE_DESIGN);
	});

	it("shows zoom in canvas mode", () => {
		const html = renderToolbar({
			mode: "canvas",
			activeBoardId: "board-1",
			responsiveWidth: 768,
		});

		expect(html).toContain("Zoom");
		expect(html).toContain("125%");
		expect(html).toContain('aria-pressed="true"');
		expect(html).toContain("Canvas");
	});

	it("shows board cycling controls when in responsive mode", () => {
		const html = renderToolbar({
			mode: "responsive",
			activeBoardId: "board-2",
			responsiveWidth: 768,
		});

		expect(html).toContain("Board 2 / 2");
		expect(html).toContain('aria-label="Previous board"');
		expect(html).toContain('aria-label="Next board"');
		expect(html).toContain('aria-label="Viewport width in pixels"');
		expect(html).toContain('value="768"');
		expect(html).toContain("Presets");
		expect(html).toContain("md");
		expect(html).toContain("768");
		expect(html).toContain("fluid");
		expect(html).toContain("disabled");
		expect(html).toContain("cannot be converted to pixels");
		expect(html).not.toContain("Zoom");
		expect(html).toContain('aria-pressed="true"');
		expect(html).toContain("Responsive");
	});

	it("does not show board cycling controls in canvas mode", () => {
		const html = renderToolbar({
			mode: "canvas",
			activeBoardId: "board-1",
			responsiveWidth: 768,
		});

		expect(html).not.toContain("Board 1 / 2");
		expect(html).not.toContain('aria-label="Previous board"');
	});

	it("defines the expected device-ish width presets", () => {
		expect(
			RESPONSIVE_DEVICE_WIDTH_PRESETS.map(({ label, width }) => ({
				label,
				width,
			})),
		).toEqual([
			{ label: "Mobile S", width: 320 },
			{ label: "Mobile M", width: 375 },
			{ label: "Mobile L", width: 425 },
			{ label: "Tablet", width: 768 },
			{ label: "Laptop", width: 1024 },
			{ label: "Desktop", width: 1440 },
		]);
	});

	it("validates and commits responsive width drafts", () => {
		expect(getResponsiveWidthDraftError("")).toBe("Enter a viewport width.");
		expect(getResponsiveWidthDraftError("wide")).toBe(
			"Enter a numeric viewport width.",
		);
		expect(getResponsiveWidthDraftError("800px")).toBe(
			"Enter a numeric viewport width.",
		);
		expect(getResponsiveWidthDraftError("12")).toContain(
			"between 320px and 2400px",
		);
		expect(getResponsiveWidthDraftError("768")).toBeNull();

		expect(resolveResponsiveWidthDraftCommit("1440.4", 768)).toEqual({
			draft: "1440",
			width: 1440,
		});
		expect(resolveResponsiveWidthDraftCommit("9999", 768)).toEqual({
			draft: "2400",
			width: 2400,
		});
		expect(resolveResponsiveWidthDraftCommit("wide", 768)).toEqual({
			draft: "768",
			width: null,
		});
	});
});
