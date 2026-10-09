import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import {
	getRenderableProps,
	resolveRegistryComponent,
} from "../../libraries/registry";
import { hydrateDesign } from "../../stores/design-store";
import type { Node, Props, TrickroomDesign } from "../../types";
import {
	type ClassMerge,
	type ComponentClassSource,
	createClassMerge,
} from "../../utils/class-merge";
import {
	ResponsiveStageContext,
	type ResponsiveStageContextValue,
} from "../responsive-stage-context";
import { Artboards } from "./Artboards";
import { ClassMergeContext, type ClassMergeState } from "./class-merge-context";

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
	classMerge?: ClassMergeState,
) {
	const artboards = classMerge ? (
		<ClassMergeContext.Provider value={classMerge}>
			<Artboards />
		</ClassMergeContext.Provider>
	) : (
		<Artboards />
	);
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
			{artboards}
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

	it("marks canvas boards that need the default width and overlay height", () => {
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
		expect(boardTag(canvas, "unsized")).toContain(
			'data-trickroom-board-default-height="canvas"',
		);
		expect(boardTag(canvas, "sized")).not.toContain(
			"data-trickroom-board-default-",
		);
		expect(boardTag(canvas, "fit")).not.toContain(
			"data-trickroom-board-default-width",
		);
		expect(boardTag(canvas, "fit")).toContain(
			'data-trickroom-board-default-height="canvas"',
		);

		const responsive = renderArtboards({
			mode: "responsive",
			activeBoardId: "unsized",
		});
		expect(boardTag(responsive, "unsized")).not.toContain(
			"data-trickroom-board-default-width",
		);
		expect(boardTag(responsive, "unsized")).toContain(
			'data-trickroom-board-default-height="viewport"',
		);
	});

	it("renders no portal host until an overlay in the board asks for one", () => {
		const html = renderArtboards({ mode: "canvas", activeBoardId: null });

		expect(html).not.toContain("data-trickroom-board-portal");
	});
});

describe("Artboards class merging", () => {
	// A card instance: root (flex, override hidden) with a child whose
	// template is `flex` and override `!hidden`.
	const instanceProps = (
		path: string,
		className: string,
		rootMarkers?: { overrides: string },
	): Props => ({
		"data-trickroom-name": path,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
		className,
		"data-trickroom-system-component-system-id": "sys_core",
		"data-trickroom-system-component-id": "cmp_card",
		"data-trickroom-system-component-instance": "inst_1",
		"data-trickroom-system-component-version": "1",
		"data-trickroom-system-component-path": path,
		...(rootMarkers
			? {
					"data-trickroom-system-component-root": "true",
					"data-trickroom-system-component-variant-values": "{}",
					"data-trickroom-system-component-overrides": rootMarkers.overrides,
				}
			: {}),
	});
	const raw = (id: string, className: string): Node => ({
		id,
		props: {
			"data-trickroom-name": id,
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "container",
			"data-trickroom-role": "branch",
			className,
		},
		children: [],
	});
	const source: ComponentClassSource = {
		systemId: "sys_core",
		merge: createClassMerge({ mode: "stock" }) as ClassMerge,
		components: {
			cmp_card: {
				"1": {
					root: {
						path: "root",
						library: "trickroom",
						component: "container",
						className: "flex items-center",
						children: [
							{
								path: "body",
								library: "trickroom",
								component: "container",
								className: "flex",
							},
						],
					},
					overrideTargets: {
						root: { targetId: "root", label: "Card", path: "root" },
						body: { targetId: "body", label: "Body", path: "body" },
					},
				},
			},
		},
	};
	const canvas = { mode: "canvas", activeBoardId: null } as const;

	beforeEach(() => {
		hydrateDesign({
			name: "Class merge test",
			boards: [
				{
					...raw("board", "flex flex-col"),
					children: [
						raw("raw", "flex hidden"),
						{
							id: "instance",
							props: instanceProps("root", "flex items-center hidden", {
								overrides: JSON.stringify({
									root: { className: "hidden" },
									body: { className: "!hidden" },
								}),
							}),
							children: [
								{
									id: "body",
									props: instanceProps("body", "flex !hidden"),
									children: [],
								},
							],
						},
					],
				},
			],
		} satisfies TrickroomDesign);
	});

	it("merges component classes and keeps raw elements as written", () => {
		const html = renderArtboards(canvas, {
			merge: source.merge,
			source,
			ready: true,
		});

		expect(html).toContain('class="flex hidden" data-trickroom-node-id="raw"');
		expect(html).toContain(
			'class="items-center hidden" data-trickroom-node-id="instance"',
		);
		// An internal node resolves with its instance root's overrides; the
		// !important workaround survives the merge.
		expect(html).toContain(
			'class="flex !hidden" data-trickroom-node-id="body"',
		);
	});

	it("renders the stored classes without a merge", () => {
		const html = renderArtboards(canvas);

		expect(html).toContain(
			'class="flex items-center hidden" data-trickroom-node-id="instance"',
		);
	});

	it("waits for the merge settings before rendering boards", () => {
		const html = renderArtboards(canvas, {
			merge: null,
			source: null,
			ready: false,
		});

		expect(html).not.toContain("data-trickroom-root-id");
	});
});
