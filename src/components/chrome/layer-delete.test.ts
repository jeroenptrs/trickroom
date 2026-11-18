import { beforeEach, describe, expect, it } from "vitest";
import { designStore, hydrateDesign } from "../../stores/design-store";
import type { TrickroomDesign } from "../../types";
import { requestLayerDelete } from "./layer-delete";

type Node = TrickroomDesign["boards"][number];

const node = (id: string, children: Node[] = []): Node => ({
	id,
	props: {
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
		"data-trickroom-name": id,
	},
	children,
});

const DESIGN: TrickroomDesign = {
	name: "Delete test",
	boards: [node("board", [node("card", [node("title")]), node("leaf")])],
};

describe("requestLayerDelete", () => {
	beforeEach(() => {
		hydrateDesign(DESIGN);
	});

	it("deletes a leaf layer at once", () => {
		requestLayerDelete("leaf");
		expect(designStore.get().entitiesById.leaf).toBeUndefined();
	});

	it("keeps a layer with children until the delete is confirmed", () => {
		requestLayerDelete("card");
		expect(designStore.get().entitiesById.card).toBeDefined();
		expect(designStore.get().entitiesById.title).toBeDefined();
	});

	it("keeps a board until the delete is confirmed", () => {
		requestLayerDelete("board");
		expect(designStore.get().rootIds).toContain("board");
	});
});
