import { describe, expect, it } from "vitest";
import type { DesignEntity } from "../stores/design-store";
import type { Node, TrickroomDesign } from "../types";
import { designStoreTargetLocator } from "../utils/design-annotation-targets";
import {
	type AnnotationTargetLocator,
	currentBoardOf,
	currentBoardOfWith,
	deriveDetached,
	deriveDetachedWith,
	designTargetLocator,
	emptyAnnotationCounts,
	findAnnotationsSharingChange,
	findDesignLayer,
	getAnnotationMemoryReference,
	isAnnotationTarget,
	isLiveAnnotationStatus,
	summarizeAnnotationCounts,
	summarizeAnnotationCountsWith,
} from "./annotation-model";
import type {
	AnnotationEntry,
	AnnotationStatus,
	AnnotationTarget,
} from "./annotations.types";

const node = (id: string, children: Node[] | string = []): Node => ({
	id,
	props: {
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-name": id,
	},
	children,
});

// b1 > (l1 > l2, l3), b2 > l4
const design: TrickroomDesign = {
	name: "Test",
	boards: [
		node("b1", [node("l1", [node("l2")]), node("l3", "text")]),
		node("b2", [node("l4")]),
	],
};

const entity = (
	source: Node,
	parentId: string | null,
	into: Record<string, DesignEntity>,
) => {
	const childIds =
		typeof source.children === "string"
			? undefined
			: source.children.map((child) => child.id);
	into[source.id] = {
		id: source.id,
		props: source.props,
		parentId,
		role: "branch",
		childIds,
	};
	if (typeof source.children !== "string") {
		for (const child of source.children) entity(child, source.id, into);
	}
};

const buildEntities = (boards: Node[]) => {
	const entities: Record<string, DesignEntity> = {};
	for (const board of boards) entity(board, null, entities);
	return entities;
};

const entitiesById = buildEntities(design.boards);

const layer = (elementId: string, boardId = "b1"): AnnotationTarget => ({
	kind: "layer",
	designId: "d1",
	boardId,
	elementId,
});

describe("isAnnotationTarget", () => {
	it("accepts each target kind", () => {
		expect(isAnnotationTarget({ kind: "design", designId: "d1" })).toBe(true);
		expect(
			isAnnotationTarget({ kind: "board", designId: "d1", boardId: "b1" }),
		).toBe(true);
		expect(isAnnotationTarget(layer("l1"))).toBe(true);
		expect(
			isAnnotationTarget({
				kind: "componentNode",
				systemId: "s",
				componentId: "c",
				nodePath: "",
			}),
		).toBe(true);
		expect(
			isAnnotationTarget({
				kind: "componentNode",
				systemId: "s",
				componentId: "c",
				nodePath: "0.1",
				variants: { size: "lg" },
			}),
		).toBe(true);
	});

	it.each([
		["null", null],
		["a string", "design"],
		["an array", []],
		["an unknown kind", { kind: "page", designId: "d1" }],
		["a design without designId", { kind: "design" }],
		["a design with an empty designId", { kind: "design", designId: "" }],
		["a board without boardId", { kind: "board", designId: "d1" }],
		[
			"a layer without elementId",
			{ kind: "layer", designId: "d1", boardId: "b" },
		],
		[
			"a layer with a numeric elementId",
			{ kind: "layer", designId: "d1", boardId: "b", elementId: 1 },
		],
		[
			"a component node without nodePath",
			{ kind: "componentNode", systemId: "s", componentId: "c" },
		],
		[
			"a component node with non-string variants",
			{
				kind: "componentNode",
				systemId: "s",
				componentId: "c",
				nodePath: "",
				variants: { size: 1 },
			},
		],
		[
			"a component node with array variants",
			{
				kind: "componentNode",
				systemId: "s",
				componentId: "c",
				nodePath: "",
				variants: ["a"],
			},
		],
	])("rejects %s", (_name, value) => {
		expect(isAnnotationTarget(value)).toBe(false);
	});
});

describe("isLiveAnnotationStatus", () => {
	it("is false only for resolved and dismissed", () => {
		const live: AnnotationStatus[] = [
			"open",
			"acknowledged",
			"addressed",
			"needs_input",
		];
		for (const status of live)
			expect(isLiveAnnotationStatus(status)).toBe(true);
		expect(isLiveAnnotationStatus("resolved")).toBe(false);
		expect(isLiveAnnotationStatus("dismissed")).toBe(false);
	});
});

describe("findDesignLayer", () => {
	it("finds nested layers with their board and ancestors", () => {
		const found = findDesignLayer(design, "l2");
		expect(found?.boardId).toBe("b1");
		expect(found?.ancestors.map((ancestor) => ancestor.id)).toEqual([
			"b1",
			"l1",
		]);
	});

	it("treats a board as its own board", () => {
		expect(findDesignLayer(design, "b2")?.boardId).toBe("b2");
	});

	it("returns null for unknown ids", () => {
		expect(findDesignLayer(design, "nope")).toBeNull();
	});
});

describe("locators", () => {
	const locators: [string, AnnotationTargetLocator][] = [
		["design", designTargetLocator(design)],
		["store", designStoreTargetLocator(entitiesById)],
	];

	describe.each(locators)("%s locator", (_name, locator) => {
		it("finds the board of a layer", () => {
			expect(locator.boardOfLayer("l2")).toBe("b1");
			expect(locator.boardOfLayer("l4")).toBe("b2");
			expect(locator.boardOfLayer("gone")).toBeNull();
		});

		it("knows boards", () => {
			expect(locator.hasBoard("b1")).toBe(true);
			expect(locator.hasBoard("gone")).toBe(false);
		});
	});

	it("does not treat a layer as a board in the store locator", () => {
		expect(designStoreTargetLocator(entitiesById).hasBoard("l1")).toBe(false);
	});
});

describe("deriveDetachedWith", () => {
	const locator = designTargetLocator(design);

	it("never detaches a design target", () => {
		expect(
			deriveDetachedWith({ kind: "design", designId: "d1" }, locator),
		).toBe(false);
	});

	it("detaches a board that is gone", () => {
		const board = (boardId: string): AnnotationTarget => ({
			kind: "board",
			designId: "d1",
			boardId,
		});
		expect(deriveDetachedWith(board("b1"), locator)).toBe(false);
		expect(deriveDetachedWith(board("gone"), locator)).toBe(true);
	});

	it("detaches a layer whose id is gone, even if its board exists", () => {
		expect(deriveDetachedWith(layer("l2"), locator)).toBe(false);
		expect(deriveDetachedWith(layer("gone", "b1"), locator)).toBe(true);
	});

	it("does not derive for component nodes", () => {
		expect(
			deriveDetachedWith(
				{
					kind: "componentNode",
					systemId: "s",
					componentId: "c",
					nodePath: "",
				},
				locator,
			),
		).toBeUndefined();
	});

	it("agrees with deriveDetached on a design", () => {
		for (const target of [
			layer("l1"),
			layer("gone"),
			{ kind: "board", designId: "d1", boardId: "b2" } as const,
			{ kind: "board", designId: "d1", boardId: "gone" } as const,
			{ kind: "design", designId: "d1" } as const,
		]) {
			expect(deriveDetachedWith(target, locator)).toBe(
				deriveDetached(target, design),
			);
		}
	});
});

describe("currentBoardOfWith", () => {
	const locator = designTargetLocator(design);

	it("returns the board of a board target", () => {
		expect(
			currentBoardOfWith(
				{ kind: "board", designId: "d1", boardId: "b9" },
				locator,
			),
		).toBe("b9");
	});

	it("follows a layer that moved to another board", () => {
		expect(currentBoardOfWith(layer("l4", "b1"), locator)).toBe("b2");
		expect(currentBoardOf(layer("l4", "b1"), design)).toBe("b2");
	});

	it("falls back to the recorded board for a gone layer or no locator", () => {
		expect(currentBoardOfWith(layer("gone", "b1"), locator)).toBe("b1");
		expect(currentBoardOfWith(layer("l4", "b1"), null)).toBe("b1");
		expect(currentBoardOfWith(layer("l4", "b1"), undefined)).toBe("b1");
		expect(currentBoardOf(layer("l4", "b1"), null)).toBe("b1");
	});

	it("has no board for design and component node targets", () => {
		expect(
			currentBoardOfWith({ kind: "design", designId: "d1" }, locator),
		).toBeNull();
		expect(
			currentBoardOfWith(
				{
					kind: "componentNode",
					systemId: "s",
					componentId: "c",
					nodePath: "",
				},
				locator,
			),
		).toBeNull();
	});
});

describe("summarizing annotation counts", () => {
	const annotations: { target: AnnotationTarget; status: AnnotationStatus }[] =
		[
			{ target: layer("l1"), status: "open" },
			{ target: layer("l1"), status: "acknowledged" },
			{ target: layer("l2"), status: "needs_input" },
			{ target: layer("l3"), status: "addressed" },
			{ target: layer("l3"), status: "resolved" },
			{ target: layer("l3"), status: "dismissed" },
			// Gone: still counted on its recorded board, as detached.
			{ target: layer("gone", "b1"), status: "open" },
			{ target: layer("gone", "b1"), status: "resolved" },
			// Recorded on b1, now on b2.
			{ target: layer("l4", "b1"), status: "open" },
			{
				target: { kind: "board", designId: "d1", boardId: "b2" },
				status: "needs_input",
			},
			{
				target: { kind: "board", designId: "d1", boardId: "gone" },
				status: "open",
			},
			{ target: { kind: "design", designId: "d1" }, status: "addressed" },
		];

	const withDesign = summarizeAnnotationCounts(annotations, design);
	const withStore = summarizeAnnotationCountsWith(
		annotations,
		designStoreTargetLocator(entitiesById),
	);

	it("gives identical summaries from a design and from the store", () => {
		expect(withStore).toEqual(withDesign);
	});

	it("counts work owners and closed statuses in the total", () => {
		const { total } = withDesign;
		expect(total.live).toBe(9);
		expect(total.agentWork).toBe(5);
		expect(total.humanWork).toBe(4);
		expect(total.byStatus.resolved).toBe(2);
		expect(total.byStatus.dismissed).toBe(1);
		expect(total.byStatus.open).toBe(4);
		// Live annotations whose layer or board is gone.
		expect(total.detached).toBe(2);
	});

	it("keeps closed annotations out of live and work counts", () => {
		const l3 = withDesign.layers.l3;
		expect(l3.live).toBe(1);
		expect(l3.humanWork).toBe(1);
		expect(l3.agentWork).toBe(0);
		expect(l3.byStatus.resolved).toBe(1);
		expect(l3.byStatus.dismissed).toBe(1);
	});

	it("counts a detached layer on its recorded board and its own layer entry", () => {
		expect(withDesign.layers.gone.detached).toBe(1);
		expect(withDesign.layers.gone.live).toBe(1);
		expect(withDesign.boards.b1.detached).toBe(1);
	});

	it("counts a layer that moved on its current board", () => {
		expect(withDesign.layers.l4.live).toBe(1);
		const b2 = withDesign.boards.b2;
		// l4 (open) + the board annotation (needs_input).
		expect(b2.live).toBe(2);
		expect(b2.agentWork).toBe(1);
		expect(b2.humanWork).toBe(1);
		// b1: l1 x2, l2, l3 (one live), gone (one live) -- but not l4.
		expect(withDesign.boards.b1.byStatus.open).toBe(2);
		expect(withDesign.boards.b1.live).toBe(5);
	});

	it("counts a board target on its board and as detached when gone", () => {
		expect(withDesign.boards.gone.live).toBe(1);
		expect(withDesign.boards.gone.detached).toBe(1);
		expect(withDesign.layers.gone.live).toBe(1);
	});

	it("counts design targets only in design and total", () => {
		expect(withDesign.design.live).toBe(1);
		expect(withDesign.design.humanWork).toBe(1);
		expect(withDesign.design.detached).toBe(0);
		expect(Object.keys(withDesign.boards).sort()).toEqual(["b1", "b2", "gone"]);
	});

	it("counts nothing as detached without a design", () => {
		const summary = summarizeAnnotationCounts(annotations);
		expect(summary.total.detached).toBe(0);
		expect(summary.total.live).toBe(9);
		// Without a locator, layers stay on their recorded board.
		expect(summary.boards.b1.live).toBe(6);
		expect(summary.boards.b2.live).toBe(1);
	});

	it("starts empty", () => {
		expect(summarizeAnnotationCounts([]).total).toEqual(
			emptyAnnotationCounts(),
		);
	});

	it("handles ids that collide with object prototype keys", () => {
		const summary = summarizeAnnotationCounts([
			{ target: layer("constructor", "__proto__"), status: "open" },
		]);
		expect(summary.layers["constructor"]?.live).toBe(1);
		expect(summary.boards["__proto__"]?.live).toBe(1);
	});
});

describe("getAnnotationMemoryReference", () => {
	it("references each target kind", () => {
		expect(
			getAnnotationMemoryReference({ kind: "design", designId: "d1" }),
		).toBe("{{design:d1}}");
		expect(
			getAnnotationMemoryReference({
				kind: "board",
				designId: "d1",
				boardId: "b1",
			}),
		).toBe("{{board:d1/b1}}");
		expect(getAnnotationMemoryReference(layer("l1"))).toBe("{{layer:d1/l1}}");
		expect(
			getAnnotationMemoryReference({
				kind: "componentNode",
				systemId: "s",
				componentId: "button",
				nodePath: "0",
			}),
		).toBe("{{component:button}}");
	});
});

describe("findAnnotationsSharingChange", () => {
	const human = { role: "human" } as const;
	const change = (revisionBefore: string, revisionAfter: string) => ({
		revisionBefore,
		revisionAfter,
		boards: [],
		layerIds: [],
		operations: [],
		summary: "",
	});
	const changeEntry = (
		id: string,
		revisions: [string, string],
		revertedBy?: string,
	): AnnotationEntry => ({
		id,
		kind: "change",
		at: "2026-10-14T10:00:00.000Z",
		by: human,
		change: change(...revisions),
		...(revertedBy ? { revertedBy } : {}),
	});

	it("finds the other annotations one write addressed, not reverted ones", () => {
		const annotations = [
			{ id: "a", entries: [changeEntry("a1", ["r1", "r2"])] },
			{ id: "b", entries: [changeEntry("b1", ["r1", "r2"])] },
			{ id: "c", entries: [changeEntry("c1", ["r1", "r2"], "c2")] },
			{ id: "d", entries: [changeEntry("d1", ["r2", "r3"])] },
			{ id: "e", entries: [changeEntry("e1", ["r0", "r2"])] },
		];
		expect(
			findAnnotationsSharingChange(annotations, "a", change("r1", "r2")).map(
				({ annotation, entryId }) => [annotation.id, entryId],
			),
		).toEqual([["b", "b1"]]);
	});
});
