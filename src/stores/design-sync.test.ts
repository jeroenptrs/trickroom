import { beforeEach, describe, expect, it } from "vitest";
import type { Node, TrickroomDesign } from "../types";
import {
	deleteElement,
	designStore,
	forceHydrateDesign,
	moveElement,
	selectElement,
	serializeDesign,
	setDesignName,
	updateElementProps,
	updateElementText,
} from "./design-store";
import {
	applyDiskDesign,
	commitDesignSaveResult,
	type DiskDesignState,
	getDiskContentNeeds,
	resolveDesignConflicts,
} from "./design-sync";

const text = (id: string, value: string, props = {}): Node => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "text",
		"data-trickroom-role": "text",
		...props,
	},
	children: value,
});

const box = (id: string, children: Node[], props = {}): Node => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
		...props,
	},
	children,
});

const boardA = box("A", [text("a1", "One"), text("a2", "Two")]);
const boardB = box("B", [text("b1", "Three"), box("b-box", [])]);
const boardC = box("C", [text("c1", "Four")]);
const design: TrickroomDesign = {
	name: "Sync",
	boards: [boardA, boardB, boardC],
};

const parts = (revisions: Record<string, string>, manifest = "m1") => ({
	manifest,
	boards: Object.entries(revisions).map(([id, revision]) => ({ id, revision })),
});

/** A disk state where only the listed boards carry content. */
const disk = (
	revision: string,
	revisions: Record<string, string>,
	boards: Record<string, Node>,
	extra: Partial<DiskDesignState> = {},
): DiskDesignState => ({
	revision,
	manifestRevision: "m1",
	order: Object.keys(revisions),
	boardRevisions: revisions,
	boards,
	...extra,
});

const initialRevisions = { A: "a-1", B: "b-1", C: "c-1" };

describe("design live sync", () => {
	beforeEach(() => {
		forceHydrateDesign(design, "r2.one", parts(initialRevisions));
		selectElement(null);
	});

	it("tracks dirty boards, order and manifest explicitly", () => {
		updateElementText("a1", "Changed");
		moveElement("b1", "A", 0);
		deleteElement("C");
		setDesignName("Renamed");

		const state = designStore.get();
		expect(Object.keys(state.dirtyBoards ?? {}).sort()).toEqual([
			"A",
			"B",
			"C",
		]);
		expect(state.manifestDirtyAt).not.toBeNull();
		expect(state.orderDirtyAt).toBeNull();

		moveElement("B", null, 0);
		expect(designStore.get().orderDirtyAt).not.toBeNull();
	});

	it("applies an external change to an untouched board while another is dirty", () => {
		updateElementText("a1", "Mine");
		selectElement("a2");
		const before = designStore.get();
		const changedB = box("B", [text("b1", "Agent"), box("b-box", [])]);
		const revisions = { A: "a-1", B: "b-2", C: "c-1" };

		expect(getDiskContentNeeds(before, disk("r2.two", revisions, {}))).toEqual({
			boardIds: ["B"],
			manifest: false,
		});
		const change = applyDiskDesign(disk("r2.two", revisions, { B: changedB }));

		const state = designStore.get();
		expect(change.boards).toEqual({ B: ["b1"] });
		expect(change.conflicts).toBe(false);
		expect(state.entitiesById.b1?.text).toBe("Agent");
		expect(state.entitiesById.a1?.text).toBe("Mine");
		expect(state.entitiesById.a2).toBe(before.entitiesById.a2);
		expect(state.entitiesById.C).toBe(before.entitiesById.C);
		expect(state.selectedId).toBe("a2");
		expect(Object.keys(state.dirtyBoards ?? {})).toEqual(["A"]);
		expect(state.persistedRevision).toBe("r2.two");
		expect(state.conflicts).toBeNull();
	});

	it("merges changes to different layers of the same board", () => {
		updateElementText("a1", "Mine");
		const theirs = box("A", [text("a1", "One"), text("a2", "Agent")]);

		const change = applyDiskDesign(
			disk("r2.two", { A: "a-2", B: "b-1", C: "c-1" }, { A: theirs }),
		);

		const state = designStore.get();
		expect(change.boards).toEqual({ A: ["a2"] });
		expect(state.entitiesById.a1?.text).toBe("Mine");
		expect(state.entitiesById.a2?.text).toBe("Agent");
		expect(state.dirtyBoards?.A).toBeDefined();
		expect(state.base?.boards.A?.node).toBe(theirs);
		expect(state.persistedRevision).toBe("r2.two");
	});

	it("raises a per-board conflict and resolves it by taking theirs", () => {
		updateElementText("a1", "Mine");
		const theirs = box("A", [text("a1", "Agent"), text("a2", "Two")]);
		const revisions = { A: "a-2", B: "b-1", C: "c-1" };

		const change = applyDiskDesign(disk("r2.two", revisions, { A: theirs }));

		expect(change.conflicts).toBe(true);
		let state = designStore.get();
		expect(state.conflicts?.boards).toMatchObject([
			{ boardId: "A", reason: "changed", nodeIds: ["a1"] },
		]);
		expect(state.entitiesById.a1?.text).toBe("Mine");
		expect(state.persistedRevision).toBe("r2.one");
		// The conflicting version is kept, so a repeat event needs no fetch.
		expect(getDiskContentNeeds(state, disk("r2.two", revisions, {}))).toEqual({
			boardIds: [],
			manifest: false,
		});

		resolveDesignConflicts({ boards: { A: "theirs" } });

		state = designStore.get();
		expect(state.entitiesById.a1?.text).toBe("Agent");
		expect(state.dirtyBoards).toEqual({});
		expect(state.conflicts).toBeNull();
		expect(state.persistedRevision).toBe("r2.two");
	});

	it("keeps mine as a deliberate overwrite of that board only", () => {
		updateElementText("a1", "Mine");
		const theirs = box("A", [text("a1", "Agent"), text("a2", "Two")]);
		applyDiskDesign(
			disk("r2.two", { A: "a-2", B: "b-1", C: "c-1" }, { A: theirs }),
		);

		resolveDesignConflicts({ boards: { A: "mine" } });

		const state = designStore.get();
		expect(state.entitiesById.a1?.text).toBe("Mine");
		expect(state.dirtyBoards?.A).toBeDefined();
		expect(state.base?.boards.A).toEqual({ node: theirs, revision: "a-2" });
		// The save is checked against the disk version the human chose over.
		expect(state.persistedRevision).toBe("r2.two");
	});

	it("applies boards added, removed and reordered on disk", () => {
		selectElement("c1");
		const boardD = box("D", [text("d1", "New")]);

		const change = applyDiskDesign(
			disk("r2.two", { B: "b-1", D: "d-1", A: "a-1" }, { D: boardD }),
		);

		const state = designStore.get();
		expect(state.rootIds).toEqual(["B", "D", "A"]);
		expect(state.entitiesById.c1).toBeUndefined();
		expect(state.entitiesById.d1?.text).toBe("New");
		expect(state.selectedId).toBeNull();
		expect(change).toMatchObject({
			addedBoardIds: ["D"],
			removedBoardIds: ["C"],
			order: true,
		});
		expect(state.persistedRevision).toBe("r2.two");
	});

	it("reports a board deleted locally and changed on disk", () => {
		deleteElement("C");
		const theirs = box("C", [text("c1", "Agent")]);

		applyDiskDesign(
			disk("r2.two", { A: "a-1", B: "b-1", C: "c-2" }, { C: theirs }),
		);

		expect(designStore.get().conflicts?.boards).toMatchObject([
			{ boardId: "C", reason: "deleted-here" },
		]);
		resolveDesignConflicts({ boards: { C: "theirs" } });
		expect(designStore.get().rootIds).toEqual(["A", "B", "C"]);
		expect(designStore.get().entitiesById.c1?.text).toBe("Agent");
	});

	it("commits a save and keeps edits made while it was in flight", () => {
		updateElementText("a1", "Saved");
		const sent = serializeDesign();
		const savedStoreRevision = designStore.get().revision;
		updateElementText("a2", "Later");
		updateElementText("b1", "Later too");

		commitDesignSaveResult({
			sent,
			savedStoreRevision,
			saved: {
				design: sent,
				revision: "r2.saved",
				parts: parts({ A: "a-2", B: "b-1", C: "c-1" }),
			},
		});

		const state = designStore.get();
		expect(Object.keys(state.dirtyBoards ?? {}).sort()).toEqual(["A", "B"]);
		expect(state.base?.boards.A?.revision).toBe("a-2");
		expect(state.persistedRevision).toBe("r2.saved");
		expect(state.entitiesById.a2?.text).toBe("Later");
	});

	it("applies another writer's board kept by a merged save", () => {
		updateElementText("a1", "Saved");
		const sent = serializeDesign();
		const savedStoreRevision = designStore.get().revision;
		const agentB = box("B", [text("b1", "Agent"), box("b-box", [])]);
		const stored = {
			...sent,
			boards: [sent.boards[0] as Node, agentB, boardC],
		};

		const change = commitDesignSaveResult({
			sent,
			savedStoreRevision,
			saved: {
				design: stored,
				revision: "r2.merged",
				parts: parts({ A: "a-2", B: "b-2", C: "c-1" }),
			},
		});

		const state = designStore.get();
		expect(change.boards).toEqual({ B: ["b1"] });
		expect(state.entitiesById.b1?.text).toBe("Agent");
		expect(state.dirtyBoards).toEqual({});
		expect(state.persistedRevision).toBe("r2.merged");
		expect(state.conflicts).toBeNull();
	});

	it("merges a design rename on disk with local board edits", () => {
		updateElementProps("a1", { className: "p-2" });

		applyDiskDesign(
			disk(
				"r2.two",
				initialRevisions,
				{},
				{
					manifestRevision: "m2",
					manifest: { name: "Renamed by agent" },
				},
			),
		);

		const state = designStore.get();
		expect(state.name).toBe("Renamed by agent");
		expect(state.manifestDirtyAt).toBeNull();
		expect(state.persistedRevision).toBe("r2.two");
	});
});
