import { beforeEach, describe, expect, it } from "vitest";
import {
	componentDraftStore,
	hydrateComponentDraft,
	resetComponentDraftStore,
} from "../../stores/component-draft-store";
import { designStore, hydrateDesign } from "../../stores/design-store";
import type { Props, TrickroomDesign } from "../../types";
import { getStageLayerAncestry } from "./stage-interaction";
import {
	componentDraftStageSelection,
	designLayerTree,
	designStageSelection,
	draftLayerTree,
} from "./stage-selection-sources";

const layer = (name: string, component = "container"): Props => ({
	"data-trickroom-name": name,
	"data-trickroom-library": "trickroom",
	"data-trickroom-component": component,
	"data-trickroom-role": component === "text" ? "text" : "branch",
});

const design = {
	name: "Breadcrumbs",
	boards: [
		{
			id: "board",
			props: layer("Board"),
			children: [
				{
					id: "card",
					props: layer("  "),
					children: [
						{ id: "label", props: layer("Label", "text"), children: "Hi" },
					],
				},
			],
		},
	],
} satisfies TrickroomDesign;

describe("design stage selection", () => {
	beforeEach(() => {
		hydrateDesign(design);
	});

	it("reads ancestry with layer names, falling back to the component", () => {
		expect(
			getStageLayerAncestry(designLayerTree(designStore.get()), "label"),
		).toEqual([
			{ id: "board", name: "Board" },
			{ id: "card", name: "container" },
			{ id: "label", name: "Label" },
		]);
	});

	it("selects through the design store and notifies subscribers", () => {
		let calls = 0;
		const unsubscribe = designStageSelection.subscribe(() => {
			calls += 1;
		});
		designStageSelection.select("card");
		expect(designStore.get().selectedId).toBe("card");
		expect(designStageSelection.getSelectedId()).toBe("card");
		expect(designStageSelection.getChildIds("card")).toEqual(["label"]);
		expect(calls).toBeGreaterThan(0);
		unsubscribe();
		designStageSelection.select(null);
		expect(designStore.get().selectedId).toBeNull();
	});
});

describe("component draft stage selection", () => {
	beforeEach(() => {
		resetComponentDraftStore();
		hydrateComponentDraft({
			componentId: "button",
			root: {
				path: "root",
				library: "trickroom",
				component: "container",
				name: "Button",
				children: [
					{
						path: "root.0",
						library: "trickroom",
						component: "text",
						text: "Label",
					},
				],
			},
		});
	});

	it("uses template paths as ids", () => {
		expect(
			getStageLayerAncestry(
				draftLayerTree(componentDraftStore.get()),
				"root.0",
			),
		).toEqual([
			{ id: "root", name: "Button" },
			{ id: "root.0", name: "text" },
		]);
		componentDraftStageSelection.select("root.0");
		expect(componentDraftStore.get().selectedPath).toBe("root.0");
		expect(componentDraftStageSelection.getParentId("root.0")).toBe("root");
		componentDraftStageSelection.select("missing");
		expect(componentDraftStore.get().selectedPath).toBeNull();
	});
});
