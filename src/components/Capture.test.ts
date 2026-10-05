import { describe, expect, it } from "vitest";
import type { Node as DesignNode, TrickroomDesign } from "../types";
import { systemComponentVariantValuesProp } from "../utils/system-component-markers";
import { createFixturePublishedRecord } from "../utils/system-component-test-fixtures";
import {
	buildComponentCaptureDesign,
	COMPONENT_CAPTURE_BOARD_ID,
	resolveCaptureBoardId,
} from "./Capture";

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

describe("component capture design", () => {
	const record = createFixturePublishedRecord();
	const texts = (node: DesignNode): string[] =>
		typeof node.children === "string"
			? [node.children]
			: node.children.flatMap(texts);
	const variantValues = (node: DesignNode) =>
		node.props[systemComponentVariantValuesProp];

	it("renders one instance on a capture board", () => {
		const design = buildComponentCaptureDesign({
			systemId: "sys",
			record,
			source: "published",
			variants: { tone: "brand" },
		});
		const board = design.boards[0];
		expect(design.systemId).toBe("sys");
		expect(board?.id).toBe(COMPONENT_CAPTURE_BOARD_ID);
		const [instance] = Array.isArray(board?.children) ? board.children : [];
		expect(instance?.props.className).toContain("text-blue-600");
		expect(texts(instance as DesignNode)).toEqual(["Label"]);
	});

	it("renders a labelled matrix of every axis value", () => {
		const design = buildComponentCaptureDesign({
			systemId: "sys",
			record,
			source: "published",
			variants: {},
			rows: "tone",
		});
		const board = design.boards[0] as DesignNode;
		const grid = (board.children as DesignNode[])[0] as DesignNode;
		expect(grid.props.className).toContain("grid-cols-[auto_repeat(1,auto)]");
		const cells = grid.children as DesignNode[];
		expect(cells.map((cell) => cell.props["data-trickroom-name"])).toEqual([
			"tone=brand",
			"Container",
			"tone=neutral",
			"Container",
		]);
		expect(cells[1]?.props.className).toContain("text-blue-600");
		expect(cells[3]?.props.className).toContain("text-zinc-700");
		expect(variantValues(cells[3] as DesignNode)).toBeDefined();
	});

	it("adds a column header row for a two-axis matrix", () => {
		const twoAxes = createFixturePublishedRecord();
		const version = twoAxes.published?.versions["1"];
		if (!version?.variants) throw new Error("fixture has no variants");
		version.variants.axes.size = {
			label: "Size",
			defaultValue: "sm",
			values: { sm: {}, lg: {} },
		};
		const design = buildComponentCaptureDesign({
			systemId: "sys",
			record: twoAxes,
			source: "published",
			variants: {},
			rows: "tone",
			columns: "size",
		});
		const grid = ((design.boards[0] as DesignNode).children as DesignNode[])[0];
		const names = (grid?.children as DesignNode[]).map(
			(cell) => cell.props["data-trickroom-name"],
		);
		expect(grid?.props.className).toContain("grid-cols-[auto_repeat(2,auto)]");
		expect(names.slice(0, 3)).toEqual(["Corner", "size=sm", "size=lg"]);
		expect(names).toHaveLength(9);
	});

	it("renders the draft and rejects unknown axes", () => {
		const draftOnly = { ...record, published: undefined };
		expect(
			buildComponentCaptureDesign({
				systemId: "sys",
				record: draftOnly,
				source: "draft",
				variants: {},
			}).boards,
		).toHaveLength(1);
		expect(() =>
			buildComponentCaptureDesign({
				systemId: "sys",
				record: draftOnly,
				source: "published",
				variants: {},
			}),
		).toThrow(/not published/);
		expect(() =>
			buildComponentCaptureDesign({
				systemId: "sys",
				record,
				source: "published",
				variants: {},
				rows: "shape",
			}),
		).toThrow(/no variant axis "shape"/);
	});
});
