import { beforeEach, describe, expect, it } from "vitest";
import type { Node } from "../types";
import { forceHydrateDesign } from "./design-store";
import type { ExternalDesignChange } from "./design-sync";
import {
	clearExternalChanges,
	externalChangeStore,
	getOutlinedLayerIds,
	recordExternalChange,
	resetExternalChanges,
	showExternalChanges,
} from "./external-change-store";

const node = (id: string, children: Node[] = []): Node => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
	},
	children,
});

const change = (
	boards: Record<string, string[]>,
	removedBoardIds: string[] = [],
): ExternalDesignChange => ({
	boards,
	addedBoardIds: [],
	removedBoardIds,
	manifest: false,
	order: false,
	conflicts: false,
});

describe("changed externally markers", () => {
	beforeEach(() => {
		resetExternalChanges();
		forceHydrateDesign(
			{
				name: "Markers",
				boards: [
					node("a", [node("a1", [node("a1x")]), node("a2")]),
					node("b", [node("b1")]),
				],
			},
			"r2.one",
		);
	});

	it("marks boards and layers, merging repeated changes", () => {
		recordExternalChange(change({ a: ["a1"] }));
		recordExternalChange(change({ a: ["a2"], b: ["b1"] }));

		const state = externalChangeStore.get();
		expect(state.boards.a).toEqual({ layerIds: ["a1", "a2"], shownAt: null });
		expect(state.layers).toEqual({ a1: "a", a2: "a", b1: "b" });
	});

	it("outlines only the topmost changed layers of boards in view", () => {
		recordExternalChange(change({ a: ["a1", "a1x", "a2"], b: ["b1"] }));

		showExternalChanges(["a"], 1000);

		const state = externalChangeStore.get();
		expect(state.flash?.layerIds).toEqual(["a1", "a2"]);
		expect(state.boards.a?.shownAt).toBe(1000);
		expect(state.boards.b?.shownAt).toBeNull();
		expect(getOutlinedLayerIds(["a1x", "gone"])).toEqual(["a1x"]);
	});

	it("clears viewed or touched boards and boards removed on disk", () => {
		recordExternalChange(change({ a: ["a1"], b: ["b1"] }));

		clearExternalChanges(["a"]);
		expect(Object.keys(externalChangeStore.get().boards)).toEqual(["b"]);
		expect(externalChangeStore.get().layers).toEqual({ b1: "b" });

		recordExternalChange(change({}, ["b"]));
		expect(externalChangeStore.get().boards).toEqual({});
	});

	it("marks a board again when it changes after being shown", () => {
		recordExternalChange(change({ a: ["a1"] }));
		showExternalChanges(["a"], 1000);

		recordExternalChange(change({ a: ["a2"] }));

		expect(externalChangeStore.get().boards.a).toEqual({
			layerIds: ["a1", "a2"],
			shownAt: null,
		});
	});
});
