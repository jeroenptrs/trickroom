import { describe, expect, it } from "vitest";
import type { TrickroomDesign } from "../types";
import { resolveCaptureBoardId } from "./Capture";

const design = {
	name: "Capture fixture",
	boards: [
		{
			id: "board-a",
			props: {
				"data-trickroom-name": "Board A",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [
				{
					id: "node-a",
					props: {
						"data-trickroom-name": "Node A",
						"data-trickroom-library": "trickroom",
						"data-trickroom-component": "container",
					},
					children: [],
				},
			],
		},
		{
			id: "board-b",
			props: {
				"data-trickroom-name": "Board B",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: [],
		},
	],
} satisfies TrickroomDesign;

describe("capture board resolution", () => {
	it("uses an explicit board and rejects unknown boards", () => {
		expect(resolveCaptureBoardId(design, "board-b", undefined)).toBe("board-b");
		expect(resolveCaptureBoardId(design, "missing", undefined)).toBeNull();
	});

	it("infers a node's containing board", () => {
		expect(resolveCaptureBoardId(design, undefined, "node-a")).toBe("board-a");
		expect(resolveCaptureBoardId(design, undefined, "missing")).toBeNull();
	});

	it("defaults to the first board", () => {
		expect(resolveCaptureBoardId(design, undefined, undefined)).toBe("board-a");
	});
});
