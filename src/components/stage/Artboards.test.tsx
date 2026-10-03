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
			`data-trickroom-library="trickroom" data-trickroom-component="container" data-trickroom-role="branch" data-trickroom-node-id="${boardOneId}" data-trickroom-root-id="${boardOneId}"`,
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

	it("renders a visible placeholder for components without a renderer", () => {
		hydrateDesign({
			name: "Missing renderer test",
			boards: [
				{
					id: boardOneId,
					props: {
						"data-trickroom-name": "Board One",
						"data-trickroom-library": "base-ui",
						"data-trickroom-component": "not-a-component",
						"data-trickroom-role": "branch",
					},
					children: [
						{
							id: "child-text",
							props: {
								"data-trickroom-name": "Text",
								"data-trickroom-library": "trickroom",
								"data-trickroom-component": "text",
								"data-trickroom-role": "text",
							},
							children: "Still visible",
						},
					],
				},
			],
		} satisfies TrickroomDesign);

		const html = renderArtboards({ mode: "canvas", activeBoardId: null });

		expect(html).toContain(
			'data-trickroom-missing-renderer="base-ui/not-a-component"',
		);
		expect(html).toContain("No renderer for base-ui/not-a-component");
		expect(html).toContain(`data-trickroom-node-id="${boardOneId}"`);
		expect(html).toContain(`data-trickroom-root-id="${boardOneId}"`);
		expect(html).toContain("Still visible");
	});

	it("marks canvas boards that need the default width", () => {
		hydrateDesign({
			name: "Board sizing test",
			boards: [
				{
					id: "unsized",
					props: {
						"data-trickroom-name": "Unsized",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
						className: "bg-white p-6",
					},
					children: [],
				},
				{
					id: "sized",
					props: {
						"data-trickroom-name": "Sized",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
						className: "w-[640px] h-[480px]",
					},
					children: [],
				},
				{
					id: "fit",
					props: {
						"data-trickroom-name": "Fit",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
						"data-trickroom-role": "branch",
						className: "w-fit",
					},
					children: [],
				},
			],
		} satisfies TrickroomDesign);

		const boardTag = (html: string, id: string) =>
			html.match(
				new RegExp(`<div[^>]*data-trickroom-root-id="${id}"[^>]*>`),
			)?.[0] ?? "";

		const canvas = renderArtboards({ mode: "canvas", activeBoardId: null });
		expect(boardTag(canvas, "unsized")).toContain(
			"data-trickroom-board-default-width",
		);
		expect(boardTag(canvas, "sized")).not.toContain(
			"data-trickroom-board-default-width",
		);
		expect(boardTag(canvas, "fit")).not.toContain(
			"data-trickroom-board-default-width",
		);

		const responsive = renderArtboards({
			mode: "responsive",
			activeBoardId: "unsized",
		});
		expect(boardTag(responsive, "unsized")).not.toContain(
			"data-trickroom-board-default-width",
		);
	});
});
