import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
	getRenderableProps,
	resolveRegistryComponent,
} from "../../libraries/registry";
import { hydrateDesign } from "../../stores/design-store";
import type { TrickroomDesign } from "../../types";
import {
	ResponsiveStageContext,
	type ResponsiveStageContextValue,
} from "../responsive-stage-context";
import { Artboards } from "./Artboards";

const boardOneId = "board-one";
const boardTwoId = "board-two";

const designFixture = {
	name: "Root marker test",
	boards: [
		{
			id: boardOneId,
			props: {
				"data-trickroom-name": "Board One",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
			},
			children: [],
		},
		{
			id: boardTwoId,
			props: {
				"data-trickroom-name": "Board Two",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
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

function renderArtboards(
	stage: Pick<ResponsiveStageContextValue, "mode" | "activeBoardId">,
) {
	return renderToStaticMarkup(
		<ResponsiveStageContext.Provider
			value={{
				mode: stage.mode,
				activeBoardId: stage.activeBoardId,
				responsiveWidth: 640,
				breakpoints: [],
				controls: noopControls,
			}}
		>
			<Artboards />
		</ResponsiveStageContext.Provider>,
	);
}

describe("Artboards", () => {
	beforeEach(() => {
		hydrateDesign(designFixture);
	});

	it("marks each rendered root with data-trickroom-root-id", () => {
		const html = renderArtboards({ mode: "canvas", activeBoardId: null });

		expect(html).toContain(`data-trickroom-root-id="${boardOneId}"`);
		expect(html).toContain(`data-trickroom-root-id="${boardTwoId}"`);
		expect(html).toContain(
			`data-trickroom-library="trickroom" data-trickroom-component="container" data-trickroom-role="branch" data-trickroom-root-id="${boardOneId}"`,
		);
		expect(html).not.toContain(`data-trickroom-root-id="${boardOneId}"><div`);

		const boardOneMarkerCount = (
			html.match(new RegExp(`data-trickroom-root-id="${boardOneId}"`, "g")) ??
			[]
		).length;
		const boardTwoMarkerCount = (
			html.match(new RegExp(`data-trickroom-root-id="${boardTwoId}"`, "g")) ??
			[]
		).length;
		expect(boardOneMarkerCount).toBe(1);
		expect(boardTwoMarkerCount).toBe(1);
	});

	it("renders only the active root in responsive mode", () => {
		const html = renderArtboards({
			mode: "responsive",
			activeBoardId: boardTwoId,
		});

		expect(html).toContain(`data-trickroom-root-id="${boardTwoId}"`);
		expect(html).not.toContain(`data-trickroom-root-id="${boardOneId}"`);
	});

	it("falls back to the first root in responsive mode when active board is unset", () => {
		const html = renderArtboards({ mode: "responsive", activeBoardId: null });

		expect(html).toContain(`data-trickroom-root-id="${boardOneId}"`);
		expect(html).not.toContain(`data-trickroom-root-id="${boardTwoId}"`);
	});

	it("does not pass data-trickroom-root-id through getRenderableProps", () => {
		const resolution = resolveRegistryComponent("trickroom", "container");
		expect(resolution.status).toBe("known");
		if (resolution.status !== "known") {
			return;
		}

		const renderableProps = getRenderableProps(
			{
				"data-trickroom-name": "Board",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				"data-trickroom-role": "branch",
				"data-trickroom-root-id": boardOneId,
			},
			resolution.definition,
		);

		expect(renderableProps).not.toHaveProperty("data-trickroom-root-id");
	});
});
