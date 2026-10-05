import { describe, expect, it } from "vitest";
import { buildDesignPath, resolveDesignDeepLink } from "./design-deep-link";

const design = {
	rootIds: ["board-a", "board-b"],
	entitiesById: {
		"board-a": { parentId: null },
		"board-b": { parentId: null },
		card: { parentId: "board-b" },
		title: { parentId: "card" },
	},
};

describe("design deep links", () => {
	it("builds design paths with optional board and layer", () => {
		expect(buildDesignPath("d1")).toBe("/design/d1");
		expect(buildDesignPath("d1", { boardId: "b 1" })).toBe(
			"/design/d1?board=b+1",
		);
		expect(buildDesignPath("d1", { boardId: "b", layerId: "l" })).toBe(
			"/design/d1?board=b&layer=l",
		);
	});

	it("selects the layer's own board", () => {
		expect(
			resolveDesignDeepLink(design, { boardId: "board-a", layerId: "title" }),
		).toEqual({ boardId: "board-b", layerId: "title", missing: [] });
	});

	it("falls back to the board when the layer is missing", () => {
		expect(
			resolveDesignDeepLink(design, { boardId: "board-a", layerId: "gone" }),
		).toEqual({ boardId: "board-a", layerId: null, missing: ["layer"] });
	});

	it("reports unknown boards", () => {
		expect(resolveDesignDeepLink(design, { boardId: "nope" })).toEqual({
			boardId: null,
			layerId: null,
			missing: ["board"],
		});
	});
});
