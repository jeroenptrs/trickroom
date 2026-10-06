import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it } from "vitest";
import type { ViewState } from "../../hooks/useStageNavigation";
import { hydrateDesign } from "../../stores/design-store";
import {
	resetEditorChrome,
	setEditorPanelOpen,
} from "../../stores/editor-chrome-store";
import type { TrickroomDesign } from "../../types";
import type { ResolvedBreakpoint } from "../../utils/resolved-breakpoints";
import { IFrameViewContext, ProjectConfigContext } from "../contexts";
import {
	ResponsiveStageContext,
	type ResponsiveStageContextValue,
} from "../responsive-stage-context";
import {
	type ResponsiveStageZoom,
	ResponsiveStageZoomContext,
	resolveResponsiveStageScale,
} from "../responsive-stage-zoom";
import { getPanelToggleLabel, getPanelToggleTitle } from "./DesignHeader";
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
		zoom?: ResponsiveStageZoom;
		fitScale?: number;
	},
	view: ViewState = { x: 0, y: 0, scale: 1.25 },
) {
	const zoom = stage.zoom ?? "fit";
	const fitScale = stage.fitScale ?? 0.5;

	return renderToStaticMarkup(
		<MemoryRouter>
			<ProjectConfigContext.Provider value={{ name: "Toolbar project" }}>
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
						<ResponsiveStageZoomContext.Provider
							value={{
								zoom,
								fitScale,
								scale: resolveResponsiveStageScale(zoom, fitScale),
								setZoom: () => {},
								setFitScale: () => {},
							}}
						>
							<WorkspaceToolbar />
						</ResponsiveStageZoomContext.Provider>
					</ResponsiveStageContext.Provider>
				</IFrameViewContext.Provider>
			</ProjectConfigContext.Provider>
		</MemoryRouter>,
	);
}

describe("WorkspaceToolbar", () => {
	beforeEach(() => {
		hydrateDesign(SAMPLE_DESIGN);
		resetEditorChrome();
	});

	it("starts with the collapsed rail's header and ends with a collapsed properties toggle", () => {
		const stage = {
			mode: "canvas",
			activeBoardId: "board-1",
			responsiveWidth: 768,
		} as const;
		const html = renderToolbar(stage);

		// Both panels start collapsed, so the rail's header leads the toolbar.
		expect(html).toContain('title="Back to project"');
		expect(html).toContain("Toolbar test");
		expect(html).toContain("No design system");
		expect(html).toMatch(/aria-label="Show layers"[^>]*aria-expanded="false"/);
		expect(html).toContain('title="Show layers (Alt+[)"');
		expect(html).toContain("lucide-panel-left-open");
		expect(html.indexOf("Back to project")).toBeLessThan(
			html.indexOf("Canvas"),
		);

		expect(html).toMatch(
			/aria-label="Show properties"[^>]*aria-expanded="false"/,
		);
		expect(html).toContain('title="Show properties (Alt+])"');
		expect(html).toContain("lucide-panel-right-open");
		expect(html.indexOf("Show properties")).toBeGreaterThan(
			html.indexOf("Responsive"),
		);
	});

	it("gives panel toggles the tokens button's shell and dark icon", () => {
		const html = renderToolbar({
			mode: "canvas",
			activeBoardId: "board-1",
			responsiveWidth: 768,
		});

		for (const label of ["Show layers", "Show properties"]) {
			const button = html.slice(
				html.lastIndexOf("<button", html.indexOf(`aria-label="${label}"`)),
			);
			expect(button).toMatch(
				/^<button[^>]*class="[^"]*flex size-7 shrink-0 items-center justify-center p-0"/,
			);
			// No selected (cyan) fill: the icon and aria-expanded carry the state.
			expect(button).not.toMatch(
				/^<button[^>]*class="[^"]*[" ]bg-cyan-100[" ]/,
			);
			expect(button.slice(0, button.indexOf("</button>"))).toContain(
				"size-4 text-slate-900",
			);
		}
	});

	it("drops the rail header once the rail is open", () => {
		setEditorPanelOpen("design", "rail", true);
		setEditorPanelOpen("design", "inspector", true);
		const html = renderToolbar({
			mode: "canvas",
			activeBoardId: "board-1",
			responsiveWidth: 768,
		});

		// The open rail carries its own header and collapse toggle.
		expect(html).not.toContain("Back to project");
		expect(html).not.toContain("layers");
		expect(html).toMatch(
			/aria-label="Hide properties"[^>]*aria-expanded="true"/,
		);
		expect(html).toContain('title="Hide properties (Alt+])"');
		expect(html).toContain("lucide-panel-right-close");
	});

	it("labels panel toggles by the action they take", () => {
		expect(getPanelToggleLabel("rail", true)).toBe("Hide layers");
		expect(getPanelToggleLabel("rail", false)).toBe("Show layers");
		expect(getPanelToggleLabel("inspector", true)).toBe("Hide properties");
		expect(getPanelToggleLabel("inspector", false)).toBe("Show properties");
		expect(getPanelToggleTitle("rail", true)).toBe("Hide layers (Alt+[)");
		expect(getPanelToggleTitle("rail", false)).toBe("Show layers (Alt+[)");
		expect(getPanelToggleTitle("inspector", false)).toBe(
			"Show properties (Alt+])",
		);
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
		expect(html).toContain('aria-pressed="true"');
		expect(html).toContain("Responsive");
	});

	it("shows the frame zoom instead of the canvas zoom in responsive mode", () => {
		const fitHtml = renderToolbar({
			mode: "responsive",
			activeBoardId: "board-1",
			responsiveWidth: 1440,
			zoom: "fit",
			fitScale: 0.5,
		});

		expect(fitHtml).toContain('aria-label="Zoom out"');
		expect(fitHtml).toContain('aria-label="Zoom level"');
		expect(fitHtml).toContain('aria-label="Zoom in"');
		expect(fitHtml).toContain("Fit");
		expect(fitHtml).toContain("50%");
		// The canvas zoom (125% in the iframe view) is not shown.
		expect(fitHtml).not.toContain("125%");

		const zoomedHtml = renderToolbar({
			mode: "responsive",
			activeBoardId: "board-1",
			responsiveWidth: 1440,
			zoom: 4,
			fitScale: 0.5,
		});
		expect(zoomedHtml).toContain("400%");
		expect(zoomedHtml).not.toContain(">Fit<");
		expect(zoomedHtml).toMatch(/aria-label="Zoom in"[^>]*disabled/);
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
