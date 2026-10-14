import { describe, expect, it } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import {
	BOARD_ORDER_CHANGE,
	captureDesignChange,
	DESIGN_SETTINGS_CHANGE,
	findChangedSince,
	restoreDesignChange,
} from "./design-layer-changes";

const layer = (
	id: string,
	children: Node[] | string = [],
	className = "",
): Node => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component":
			typeof children === "string" ? "text" : "container",
		"data-trickroom-role": typeof children === "string" ? "text" : "branch",
		...(className ? { className } : {}),
	},
	children,
});

const design = (boards: Node[], name = "Checkout"): TrickroomDesign => ({
	name,
	boards,
});

const base = () =>
	design([
		layer("board-1", [
			layer("header", [layer("title", "Hello")]),
			layer("body", [layer("card", [layer("price", "$10")])]),
		]),
		layer("board-2", [layer("footer")]),
	]);

/** Applies `change` to a copy of `before` and checks that revert round-trips. */
const roundTrip = (
	before: TrickroomDesign,
	after: TrickroomDesign,
	expectations: {
		boards?: string[];
		layerIds?: string[];
		touched?: string[];
	} = {},
) => {
	const capture = captureDesignChange(before, after);
	expect(capture).not.toBeNull();
	if (!capture) throw new Error("unreachable");
	if (expectations.boards) {
		expect(capture.boards.sort()).toEqual([...expectations.boards].sort());
	}
	if (expectations.layerIds) {
		expect(capture.layerIds.sort()).toEqual([...expectations.layerIds].sort());
	}
	if (expectations.touched) {
		expect(Object.keys(capture.before.layers).sort()).toEqual(
			[...expectations.touched].sort(),
		);
	}
	expect(findChangedSince(after, capture.after)).toEqual([]);
	expect(restoreDesignChange(after, capture.before)).toEqual(before);
	return capture;
};

describe("captureDesignChange", () => {
	it("returns null when nothing changed", () => {
		expect(captureDesignChange(base(), base())).toBeNull();
		expect(
			captureDesignChange(base(), {
				...base(),
				updatedAt: "2026-10-14T00:00:00Z",
			}),
		).toBeNull();
	});

	it("records a prop edit as one touched layer", () => {
		const after = base();
		const header = (after.boards[0]?.children as Node[])[0] as Node;
		header.props = { ...header.props, className: "p-4" };
		roundTrip(base(), after, {
			boards: ["board-1"],
			layerIds: ["header"],
			touched: ["header"],
		});
	});

	it("records a text edit", () => {
		const after = design([
			layer("board-1", [
				layer("header", [layer("title", "Bye")]),
				layer("body", [layer("card", [layer("price", "$10")])]),
			]),
			layer("board-2", [layer("footer")]),
		]);
		roundTrip(base(), after, { layerIds: ["title"], touched: ["title"] });
	});

	it("records an added layer and its parent's child list", () => {
		const after = design([
			layer("board-1", [
				layer("header", [layer("title", "Hello"), layer("subtitle", "Sub")]),
				layer("body", [layer("card", [layer("price", "$10")])]),
			]),
			layer("board-2", [layer("footer")]),
		]);
		const capture = roundTrip(base(), after, {
			layerIds: ["subtitle"],
			touched: ["header", "subtitle"],
		});
		expect(capture.before.layers.subtitle).toBeNull();
	});

	it("records a deleted subtree with every descendant, revealing its parent", () => {
		const after = design([
			layer("board-1", [
				layer("header", [layer("title", "Hello")]),
				layer("body"),
			]),
			layer("board-2", [layer("footer")]),
		]);
		const capture = roundTrip(base(), after, {
			boards: ["board-1"],
			layerIds: ["body"],
			touched: ["body", "card", "price"],
		});
		expect(capture.after.layers.card).toBeNull();
		expect(capture.after.layers.price).toBeNull();
	});

	it("records a move between boards", () => {
		const after = design([
			layer("board-1", [
				layer("header", [layer("title", "Hello")]),
				layer("body"),
			]),
			layer("board-2", [
				layer("footer"),
				layer("card", [layer("price", "$10")]),
			]),
		]);
		roundTrip(base(), after, {
			boards: ["board-1", "board-2"],
			layerIds: ["card"],
			touched: ["body", "board-2", "card"],
		});
	});

	it("records a reorder as the parent only", () => {
		const after = design([
			layer("board-1", [
				layer("body", [layer("card", [layer("price", "$10")])]),
				layer("header", [layer("title", "Hello")]),
			]),
			layer("board-2", [layer("footer")]),
		]);
		roundTrip(base(), after, { layerIds: [], touched: ["board-1"] });
	});

	it("records added and removed boards with the board order", () => {
		const added = design([...base().boards, layer("board-3", [layer("x")])]);
		const capture = roundTrip(base(), added, { touched: ["board-3", "x"] });
		expect(capture.before.boardOrder).toEqual(["board-1", "board-2"]);
		expect(capture.after.boardOrder).toEqual(["board-1", "board-2", "board-3"]);

		const removed = design([base().boards[0] as Node]);
		roundTrip(base(), removed, { touched: ["board-2", "footer"] });
	});

	it("records a rename as a settings change", () => {
		const capture = roundTrip(base(), { ...base(), name: "Payment" });
		expect(capture.before.settings).toEqual({ name: "Checkout" });
		expect(Object.keys(capture.before.layers)).toEqual([]);
	});
});

describe("findChangedSince", () => {
	const editHeader = () => {
		const after = base();
		const header = (after.boards[0]?.children as Node[])[0] as Node;
		header.props = { ...header.props, className: "p-4" };
		return after;
	};

	it("is empty while the touched layers are as the change left them, whatever else changed", () => {
		const after = editHeader();
		const capture = captureDesignChange(base(), after);
		if (!capture) throw new Error("expected a change");
		const later = structuredClone(after);
		const footer = (later.boards[1]?.children as Node[])[0] as Node;
		footer.props = { ...footer.props, className: "mt-8" };
		expect(findChangedSince(later, capture.after)).toEqual([]);
		// Revert keeps the unrelated later edit.
		const reverted = restoreDesignChange(later, capture.before);
		expect(
			((reverted.boards[1]?.children as Node[])[0] as Node).props.className,
		).toBe("mt-8");
		expect(
			((reverted.boards[0]?.children as Node[])[0] as Node).props.className,
		).toBeUndefined();
	});

	it("lists touched layers that moved on, and deleted ones", () => {
		const after = editHeader();
		const capture = captureDesignChange(base(), after);
		if (!capture) throw new Error("expected a change");
		const later = structuredClone(after);
		const header = (later.boards[0]?.children as Node[])[0] as Node;
		header.props = { ...header.props, className: "p-8" };
		expect(findChangedSince(later, capture.after)).toEqual(["header"]);

		const gone = design([
			layer("board-1", []),
			layer("board-2", [layer("footer")]),
		]);
		expect(findChangedSince(gone, capture.after)).toEqual(["header"]);
	});

	it("notices a parent whose child list changed after an addition", () => {
		const after = design([
			layer("board-1", [
				layer("header", [layer("title", "Hello"), layer("subtitle", "Sub")]),
				layer("body", [layer("card", [layer("price", "$10")])]),
			]),
			layer("board-2", [layer("footer")]),
		]);
		const capture = captureDesignChange(base(), after);
		if (!capture) throw new Error("expected a change");
		const later = structuredClone(after);
		const header = (later.boards[0]?.children as Node[])[0] as Node;
		(header.children as Node[]).push(layer("badge"));
		expect(findChangedSince(later, capture.after)).toEqual(["header"]);
	});

	it("reports board order and settings that moved on", () => {
		const renamed = { ...base(), name: "Payment" };
		const capture = captureDesignChange(base(), renamed);
		if (!capture) throw new Error("expected a change");
		expect(
			findChangedSince({ ...renamed, name: "Other" }, capture.after),
		).toEqual([DESIGN_SETTINGS_CHANGE]);

		const added = design([...base().boards, layer("board-3")]);
		const orderCapture = captureDesignChange(base(), added);
		if (!orderCapture) throw new Error("expected a change");
		const reordered = design([layer("board-3"), ...(base().boards as Node[])]);
		expect(findChangedSince(reordered, orderCapture.after)).toEqual([
			BOARD_ORDER_CHANGE,
		]);
	});
});
