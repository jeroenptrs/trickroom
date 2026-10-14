// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type LayerOpenMap,
	useLayerSelectionReveal,
} from "./useLayerSelectionReveal";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// board > card > title
const parents: Record<string, string | null> = {
	board: null,
	card: "board",
	title: "card",
};
const getParentId = (id: string) => parents[id] ?? null;

let openMap: LayerOpenMap = {};
let setOpenMap: (next: LayerOpenMap) => void = () => {};
const reveal = vi.fn(() => true);

function Rail({ selectedId }: { selectedId: string | null }) {
	const [state, setState] = useState<LayerOpenMap>({});
	openMap = state;
	setOpenMap = setState;
	useLayerSelectionReveal({
		selectedId,
		getParentId,
		openMap: state,
		setOpenMap: setState,
		reveal,
	});
	return null;
}

describe("useLayerSelectionReveal", () => {
	let container: HTMLDivElement;
	let root: Root;
	const render = (selectedId: string | null) =>
		act(() => root.render(<Rail selectedId={selectedId} />));

	beforeEach(() => {
		reveal.mockClear();
		container = document.createElement("div");
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
	});

	it("opens collapsed ancestors, then reveals the row once per selection", () => {
		render(null);
		act(() => setOpenMap({ board: false, card: false }));
		render("title");
		expect(openMap).toEqual({ board: true, card: true });
		expect(reveal).toHaveBeenCalledWith("title");

		// Collapsing an ancestor of the selection afterwards sticks.
		act(() => setOpenMap({ ...openMap, card: false }));
		render("title");
		expect(openMap.card).toBe(false);
		expect(reveal).toHaveBeenCalledTimes(1);
	});

	it("reveals the same layer again after the selection was cleared", () => {
		render("title");
		act(() => setOpenMap({ card: false }));
		render(null);
		render("title");
		expect(openMap.card).toBe(true);
		expect(reveal).toHaveBeenCalledTimes(2);
	});

	it("retries until the row can be revealed", () => {
		reveal.mockReturnValueOnce(false);
		render("card");
		expect(reveal).toHaveBeenCalledTimes(1);
		act(() => setOpenMap({ other: true }));
		expect(reveal).toHaveBeenCalledTimes(2);
		act(() => setOpenMap({ other: false }));
		expect(reveal).toHaveBeenCalledTimes(2);
	});
});
