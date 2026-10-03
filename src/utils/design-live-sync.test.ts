import { describe, expect, it } from "vitest";
import {
	getDesignSyncDecision,
	resolveActiveBoardAfterHydrate,
} from "./design-live-sync";

const revisionA = `sha256:${"a".repeat(64)}` as const;
const revisionB = `sha256:${"b".repeat(64)}` as const;

describe("design live-sync decisions", () => {
	it("hot reloads an external revision when the store is clean", () => {
		expect(
			getDesignSyncDecision({
				snapshotRevision: revisionB,
				persistedRevision: revisionA,
				hasUnsavedChanges: false,
				savePending: false,
			}),
		).toBe("reload");
	});

	it("opens the conflict path instead of clobbering a dirty store", () => {
		expect(
			getDesignSyncDecision({
				snapshotRevision: revisionB,
				persistedRevision: revisionA,
				hasUnsavedChanges: true,
				savePending: false,
			}),
		).toBe("conflict");
	});

	it("ignores the persisted revision and defers while saving", () => {
		expect(
			getDesignSyncDecision({
				snapshotRevision: revisionA,
				persistedRevision: revisionA,
				hasUnsavedChanges: true,
				savePending: false,
			}),
		).toBe("ignore");
		expect(
			getDesignSyncDecision({
				snapshotRevision: revisionB,
				persistedRevision: revisionA,
				hasUnsavedChanges: true,
				savePending: true,
			}),
		).toBe("ignore");
	});
});

describe("active board after hydrating a snapshot", () => {
	const boardIds = ["board-1", "board-2", "board-3"];

	it("keeps the current board when a reload still contains it", () => {
		expect(
			resolveActiveBoardAfterHydrate({
				boardIds,
				currentBoardId: "board-2",
				isReload: true,
			}),
		).toBe("board-2");
	});

	it("falls back to the first board when a reload removed the current board", () => {
		expect(
			resolveActiveBoardAfterHydrate({
				boardIds: ["board-1", "board-3"],
				currentBoardId: "board-2",
				isReload: true,
			}),
		).toBe("board-1");
	});

	it("starts on the first board on initial load", () => {
		expect(
			resolveActiveBoardAfterHydrate({
				boardIds,
				currentBoardId: null,
				isReload: false,
			}),
		).toBe("board-1");
		expect(
			resolveActiveBoardAfterHydrate({
				boardIds,
				currentBoardId: "board-2",
				isReload: false,
			}),
		).toBe("board-1");
	});

	it("returns null for a design without boards", () => {
		expect(
			resolveActiveBoardAfterHydrate({
				boardIds: [],
				currentBoardId: "board-2",
				isReload: true,
			}),
		).toBeNull();
	});
});
