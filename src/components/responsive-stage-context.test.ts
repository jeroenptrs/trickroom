import { describe, expect, it } from "vitest";
import type { DesignEntity } from "../stores/design-store";
import {
	clampResponsiveStageWidth,
	cycleResponsiveStageBoard,
	getResponsiveBoardCycleDirectionFromKey,
	getResponsiveStageBoardPosition,
	resolveResponsiveStageActiveBoardId,
	shouldPreserveSelectionOnActiveBoard,
} from "./responsive-stage-context";

const boardOneId = "board-1";
const boardTwoId = "board-2";
const boardOneChildId = "board-1-child";
const boardTwoChildId = "board-2-child";

const multiBoardEntities: Record<string, DesignEntity> = {
	[boardOneId]: {
		id: boardOneId,
		parentId: null,
		role: "branch",
		props: {},
		childIds: [boardOneChildId],
	},
	[boardOneChildId]: {
		id: boardOneChildId,
		parentId: boardOneId,
		role: "text",
		props: {},
		text: "Board one",
	},
	[boardTwoId]: {
		id: boardTwoId,
		parentId: null,
		role: "branch",
		props: {},
		childIds: [boardTwoChildId],
	},
	[boardTwoChildId]: {
		id: boardTwoChildId,
		parentId: boardTwoId,
		role: "text",
		props: {},
		text: "Board two",
	},
};

describe("clampResponsiveStageWidth", () => {
	it("keeps widths inside the responsive frame range", () => {
		expect(clampResponsiveStageWidth(319)).toBe(320);
		expect(clampResponsiveStageWidth(768.4)).toBe(768);
		expect(clampResponsiveStageWidth(2401)).toBe(2400);
	});
});

describe("resolveResponsiveStageActiveBoardId", () => {
	it("falls back to the first root when no active board is set", () => {
		expect(
			resolveResponsiveStageActiveBoardId(["board-1", "board-2"], null),
		).toBe("board-1");
	});

	it("keeps the active board when it still exists", () => {
		expect(
			resolveResponsiveStageActiveBoardId(["board-1", "board-2"], "board-2"),
		).toBe("board-2");
	});

	it("falls back to the first root when the current board disappears", () => {
		expect(
			resolveResponsiveStageActiveBoardId(["board-1", "board-2"], "board-3"),
		).toBe("board-1");
	});

	it("returns null when no roots exist", () => {
		expect(resolveResponsiveStageActiveBoardId([], "board-1")).toBeNull();
	});
});

describe("getResponsiveStageBoardPosition", () => {
	it("reports one-based board position", () => {
		expect(
			getResponsiveStageBoardPosition(["board-1", "board-2"], "board-2"),
		).toEqual({
			activeBoardId: "board-2",
			index: 2,
			total: 2,
		});
	});
});

describe("cycleResponsiveStageBoard", () => {
	const rootIds = ["board-1", "board-2", "board-3"] as const;

	it("moves to the next board with wrap-around", () => {
		expect(cycleResponsiveStageBoard(rootIds, "board-3", "next")).toBe(
			"board-1",
		);
	});

	it("moves to the previous board with wrap-around", () => {
		expect(cycleResponsiveStageBoard(rootIds, "board-1", "previous")).toBe(
			"board-3",
		);
	});
});

describe("getResponsiveBoardCycleDirectionFromKey", () => {
	it("maps arrow keys without modifiers", () => {
		expect(
			getResponsiveBoardCycleDirectionFromKey({
				key: "ArrowUp",
				metaKey: false,
				ctrlKey: false,
				altKey: false,
				shiftKey: false,
			}),
		).toBe("previous");
		expect(
			getResponsiveBoardCycleDirectionFromKey({
				key: "ArrowDown",
				metaKey: false,
				ctrlKey: false,
				altKey: false,
				shiftKey: false,
			}),
		).toBe("next");
	});

	it("ignores arrow keys when modifiers are active", () => {
		expect(
			getResponsiveBoardCycleDirectionFromKey({
				key: "ArrowUp",
				metaKey: true,
				ctrlKey: false,
				altKey: false,
				shiftKey: false,
			}),
		).toBeNull();
	});
});

describe("shouldPreserveSelectionOnActiveBoard", () => {
	it("preserves selection on the active board root", () => {
		expect(
			shouldPreserveSelectionOnActiveBoard(
				multiBoardEntities,
				boardOneId,
				boardOneId,
			),
		).toBe(true);
	});

	it("preserves selection inside the active board subtree", () => {
		expect(
			shouldPreserveSelectionOnActiveBoard(
				multiBoardEntities,
				boardOneChildId,
				boardOneId,
			),
		).toBe(true);
	});

	it("clears selection that belongs to another board", () => {
		expect(
			shouldPreserveSelectionOnActiveBoard(
				multiBoardEntities,
				boardTwoChildId,
				boardOneId,
			),
		).toBe(false);
	});

	it("preserves when there is no selection or active board", () => {
		expect(
			shouldPreserveSelectionOnActiveBoard(
				multiBoardEntities,
				null,
				boardOneId,
			),
		).toBe(true);
		expect(
			shouldPreserveSelectionOnActiveBoard(
				multiBoardEntities,
				boardOneChildId,
				null,
			),
		).toBe(true);
	});
});
