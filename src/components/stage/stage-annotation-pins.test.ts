// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { AnnotationTargetLocator } from "../../services/annotation-model";
import type {
	AnnotationEntry,
	AnnotationStatus,
	AnnotationTarget,
	AnnotationView,
} from "../../services/annotations.types";
import type { AnnotationDraft } from "../../stores/annotation-draft-store";
import {
	applyStageAnnotationPin,
	buildStageAnnotationPins,
	placeStageAnnotationPin,
	STAGE_ANNOTATION_PIN_ATTRIBUTE,
	STAGE_ANNOTATION_PIN_SIZE,
	type StageAnnotationPin,
} from "./stage-annotation-pins";

const layerTarget = (elementId: string, boardId = "b1"): AnnotationTarget => ({
	kind: "layer",
	designId: "d1",
	boardId,
	elementId,
});
const boardTarget = (boardId: string): AnnotationTarget => ({
	kind: "board",
	designId: "d1",
	boardId,
});

let counter = 0;
const view = (
	target: AnnotationTarget,
	status: AnnotationStatus = "open",
	overrides: Partial<AnnotationView> = {},
): AnnotationView => {
	counter += 1;
	return {
		version: 2,
		id: `a${counter}`,
		projectId: "p1",
		target,
		branch: "main",
		worktreePath: "/work",
		snapshot: { branch: "main", worktreePath: "/work" },
		status,
		createdAt: "2026-10-14T10:00:00.000Z",
		updatedAt: "2026-10-14T10:00:00.000Z",
		entries: [],
		transitions: [],
		revision: "r1",
		...overrides,
	};
};

const draft = (target: AnnotationTarget): AnnotationDraft => ({
	key: JSON.stringify(target),
	target,
	body: "draft",
	updatedAt: 1,
});

// b1 > l1, l2; b2 > l3
const layers: Record<string, string> = { l1: "b1", l2: "b1", l3: "b2" };
const locator: AnnotationTargetLocator = {
	boardOfLayer: (id) => layers[id] ?? null,
	hasBoard: (id) => id === "b1" || id === "b2",
};

const build = (
	annotations: AnnotationView[],
	drafts: AnnotationDraft[] = [],
	showResolved = false,
) => buildStageAnnotationPins({ annotations, drafts, showResolved, locator });

const byKey = (pins: StageAnnotationPin[]) =>
	Object.fromEntries(pins.map((pin) => [pin.key, pin]));

describe("buildStageAnnotationPins", () => {
	it("builds no pins for nothing", () => {
		expect(build([])).toEqual([]);
	});

	it("pins one square per layer with count and most urgent state", () => {
		const a = view(layerTarget("l1"), "open");
		const b = view(layerTarget("l1"), "needs_input");
		const c = view(layerTarget("l2"), "addressed");
		const pins = byKey(build([a, b, c]));

		expect(Object.keys(pins).sort()).toEqual(["layer:l1", "layer:l2"]);
		expect(pins["layer:l1"]).toMatchObject({
			anchorId: "l1",
			selectId: "l1",
			corner: "top-right",
			slot: 0,
			count: 2,
			state: "needs_input",
		});
		expect(pins["layer:l1"].annotationIds).toEqual([b.id, a.id]);
		expect(pins["layer:l2"]).toMatchObject({ count: 1, state: "addressed" });
	});

	it("pins board annotations to the top-left corner, slot 0", () => {
		const [pin] = build([view(boardTarget("b1"))]);
		expect(pin).toMatchObject({
			key: "board:b1",
			anchorId: "b1",
			corner: "top-left",
			slot: 0,
			count: 1,
			state: "open",
		});
	});

	it("pins a moved layer to the layer itself", () => {
		const [pin] = build([view(layerTarget("l3", "b1"))]);
		expect(pin.key).toBe("layer:l3");
	});

	it("sends detached layer annotations to their board in slot 1", () => {
		const a = view(layerTarget("gone1"));
		const b = view(layerTarget("gone2"));
		const pins = byKey(build([a, b, view(boardTarget("b1"))]));

		expect(pins["detached:b1"]).toMatchObject({
			anchorId: "b1",
			selectId: "b1",
			corner: "top-left",
			slot: 1,
			state: "detached",
			count: 2,
		});
		expect(pins["detached:b1"].annotationIds.sort()).toEqual(
			[a.id, b.id].sort(),
		);
		expect(pins["board:b1"].slot).toBe(0);
	});

	it("drops detached annotations when their board is gone, too", () => {
		expect(build([view(layerTarget("gone", "nope"))])).toEqual([]);
		expect(build([view(boardTarget("nope"))])).toEqual([]);
	});

	it("does not show a detached state for closed annotations", () => {
		const closed = view(layerTarget("gone"), "resolved");
		const pins = build([closed], [], true);
		expect(pins[0]).toMatchObject({ key: "detached:b1", state: "resolved" });
	});

	it("adds draft pins: slot 1 for layers, slot 2 for boards", () => {
		const pins = byKey(
			build([], [draft(layerTarget("l1")), draft(boardTarget("b2"))]),
		);
		expect(pins["draft:l1"]).toMatchObject({
			anchorId: "l1",
			corner: "top-right",
			slot: 1,
			state: "draft",
			count: 1,
			annotationIds: [],
			title: "Draft annotation",
		});
		expect(pins["draft:b2"]).toMatchObject({
			anchorId: "b2",
			corner: "top-left",
			slot: 2,
			state: "draft",
		});
	});

	it("keeps a draft pin beside the layer's own pin", () => {
		const pins = byKey(
			build([view(layerTarget("l1"))], [draft(layerTarget("l1"))]),
		);
		expect(pins["layer:l1"].slot).toBe(0);
		expect(pins["draft:l1"].slot).toBe(1);
	});

	it("drops drafts whose layer or board is gone, and design drafts", () => {
		expect(
			build(
				[],
				[
					draft(layerTarget("gone")),
					draft(boardTarget("gone")),
					draft({ kind: "design", designId: "d1" }),
				],
			),
		).toEqual([]);
	});

	it("shows closed annotations only with showResolved", () => {
		const closed = [
			view(layerTarget("l1"), "resolved"),
			view(boardTarget("b1"), "dismissed"),
		];
		expect(build(closed)).toEqual([]);
		const pins = byKey(build(closed, [], true));
		expect(pins["layer:l1"].state).toBe("resolved");
		expect(pins["board:b1"].state).toBe("dismissed");
	});

	it("lets live annotations outrank closed ones in a shown group", () => {
		const live = view(layerTarget("l1"), "open");
		const closed = view(layerTarget("l1"), "resolved");
		const [pin] = build([closed, live], [], true);
		expect(pin.state).toBe("open");
		expect(pin.annotationIds).toEqual([live.id, closed.id]);
	});

	it("marks agent-resolved annotations", () => {
		const [pin] = build(
			[
				view(layerTarget("l1"), "resolved", {
					resolvedBy: { role: "agent", sessionId: "s" },
				}),
			],
			[],
			true,
		);
		expect(pin.state).toBe("agent_resolved");
	});

	it("produces no pin for design-level and component node annotations", () => {
		expect(
			build([
				view({ kind: "design", designId: "d1" }),
				view({
					kind: "componentNode",
					systemId: "s",
					componentId: "c",
					nodePath: "0",
				}),
			]),
		).toEqual([]);
	});

	describe("titles", () => {
		const remark: AnnotationEntry = {
			id: "e1",
			at: "2026-10-14T10:00:00.000Z",
			by: { role: "human" },
			kind: "remark",
			body: "Tighten the spacing\nand the padding",
		};

		it("uses the label and first line of the remark for one annotation", () => {
			const [pin] = build([
				view(layerTarget("l1"), "open", { entries: [remark] }),
			]);
			expect(pin.title).toBe("Open: Tighten the spacing");
		});

		it("truncates a long first line", () => {
			const [pin] = build([
				view(layerTarget("l1"), "open", {
					entries: [{ ...remark, body: "x".repeat(200) }],
				}),
			]);
			expect(pin.title).toBe(`Open: ${"x".repeat(79)}…`);
		});

		it("summarizes several annotations", () => {
			const [pin] = build([
				view(layerTarget("l1"), "open"),
				view(layerTarget("l1"), "needs_input"),
			]);
			expect(pin.title).toBe("2 annotations (needs input)");
		});

		it("falls back to the label without a remark", () => {
			const [pin] = build([view(layerTarget("l1"), "addressed")]);
			expect(pin.title).toBe("Addressed");
		});
	});
});

describe("placeStageAnnotationPin", () => {
	const geometry = { left: 100, top: 50, width: 200, height: 80, scale: 1 };

	it("centres a top-right pin on the corner", () => {
		expect(placeStageAnnotationPin(geometry, "top-right", 0)).toEqual({
			left: 100 + 200 - 8,
			top: 50 - 8,
			size: STAGE_ANNOTATION_PIN_SIZE,
		});
	});

	it("centres a top-left pin on the corner", () => {
		expect(placeStageAnnotationPin(geometry, "top-left", 0)).toEqual({
			left: 100 - 8,
			top: 50 - 8,
			size: 16,
		});
	});

	it("steps slots inward from the corner by size plus gap", () => {
		expect(placeStageAnnotationPin(geometry, "top-right", 2).left).toBe(
			100 + 200 - 8 - 2 * 18,
		);
		expect(placeStageAnnotationPin(geometry, "top-left", 1).left).toBe(
			100 - 8 + 18,
		);
	});

	it("divides sizes by the scale to keep a constant screen size", () => {
		const zoomed = { ...geometry, scale: 2 };
		expect(placeStageAnnotationPin(zoomed, "top-left", 1)).toEqual({
			left: 100 - 4 + 9,
			top: 50 - 4,
			size: 8,
		});
		expect(placeStageAnnotationPin(zoomed, "top-right", 0, 20).size).toBe(10);
	});
});

describe("applyStageAnnotationPin", () => {
	const geometry = { left: 10, top: 20, width: 100, height: 40, scale: 1 };
	const pin = (
		overrides: Partial<StageAnnotationPin> = {},
	): StageAnnotationPin => ({
		key: "layer:l1",
		anchorId: "l1",
		corner: "top-right",
		slot: 0,
		state: "open",
		count: 1,
		annotationIds: ["a1"],
		selectId: "l1",
		title: "Open",
		...overrides,
	});
	const paint = (next: StageAnnotationPin, scale = 1) => {
		const element = document.createElement("div");
		applyStageAnnotationPin(element, next, { ...geometry, scale });
		return element;
	};

	it("positions and sizes the pin", () => {
		const element = paint(pin());
		expect(element.style.display).toBe("flex");
		expect(element.style.left).toBe(`${10 + 100 - 8}px`);
		expect(element.style.top).toBe("12px");
		expect(element.style.width).toBe("16px");
		expect(element.style.height).toBe("16px");
	});

	it("scales the size and border with the zoom", () => {
		const element = paint(pin({ state: "addressed" }), 2);
		expect(element.style.width).toBe("8px");
		expect(element.style.borderWidth).toBe("1px");
		expect(element.style.fontSize).toBe("5px");
	});

	it("shows the count only when more than one", () => {
		expect(paint(pin({ count: 1 })).textContent).toBe("");
		expect(paint(pin({ count: 3 })).textContent).toBe("3");
	});

	it("shows a check for agent-resolved, whatever the count", () => {
		expect(paint(pin({ state: "agent_resolved" })).textContent).toBe("✓");
		expect(paint(pin({ state: "agent_resolved", count: 4 })).textContent).toBe(
			"✓",
		);
	});

	it("marks the element with the pin key, state and title", () => {
		const element = paint(
			pin({ key: "board:b1", state: "needs_input", title: "Q" }),
		);
		expect(element.getAttribute(STAGE_ANNOTATION_PIN_ATTRIBUTE)).toBe(
			"board:b1",
		);
		expect(STAGE_ANNOTATION_PIN_ATTRIBUTE).toBe(
			"data-trickroom-annotation-pin",
		);
		expect(element.getAttribute("data-state")).toBe("needs_input");
		expect(element.title).toBe("Q");
	});

	it("repaints a pooled element when the state changes", () => {
		const element = paint(pin({ count: 2 }));
		applyStageAnnotationPin(element, pin({ count: 1 }), geometry);
		expect(element.textContent).toBe("");
		expect(element.style.borderStyle).toBe("none");
		applyStageAnnotationPin(element, pin({ state: "draft" }), geometry);
		expect(element.style.borderStyle).toBe("dashed");
	});
});
