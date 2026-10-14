// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STAGE_BOARD_PORTAL_ATTRIBUTE } from "../../libraries/stage-portal";
import type { StageSelectionSource } from "./stage-interaction";
import { startStageSelectionOverlay } from "./stage-selection-overlay";

const nodes: Record<string, { parentId: string | null; childIds: string[] }> = {
	board: { parentId: null, childIds: ["title", "cta"] },
	title: { parentId: "board", childIds: [] },
	cta: { parentId: "board", childIds: [] },
	popup: { parentId: "board", childIds: [] },
};

function createSource(): StageSelectionSource {
	let selectedId: string | null = null;
	const listeners = new Set<() => void>();
	return {
		has: (id) => nodes[id] !== undefined,
		getParentId: (id) => nodes[id]?.parentId ?? null,
		getChildIds: (id) => nodes[id]?.childIds ?? [],
		getName: (id) => id.toUpperCase(),
		getSelectedId: () => selectedId,
		select: (id) => {
			selectedId = id;
			for (const listener of listeners) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

describe("startStageSelectionOverlay", () => {
	let frames: FrameRequestCallback[] = [];
	let stop: () => void = () => {};
	let source: StageSelectionSource;

	const flush = () => {
		const pending = frames;
		frames = [];
		for (const callback of pending) callback(0);
	};
	const outline = (kind: "selection" | "hover") => {
		const box = document.querySelector<HTMLElement>(`[data-test=${kind}]`);
		return box?.style.display === "block" ? box.textContent : null;
	};
	const move = (id: string, buttons = 0) =>
		document
			.querySelector(`[data-trickroom-node-id=${id}]`)
			?.dispatchEvent(
				new PointerEvent("pointermove", { bubbles: true, buttons }),
			);
	const portalHost = () =>
		document.querySelector(`[${STAGE_BOARD_PORTAL_ATTRIBUTE}]`) as HTMLElement;

	beforeEach(() => {
		frames = [];
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			frames.push(cb);
			return frames.length;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
		document.body.innerHTML = `
			<div id="trickroom-viewport" tabindex="0">
				<div class="frame-content">
					<main>
						<section data-trickroom-node-id="board" data-trickroom-root-id="board">
							<div ${STAGE_BOARD_PORTAL_ATTRIBUTE}=""></div>
							<h2 data-trickroom-node-id="title">Title</h2>
							<a data-trickroom-node-id="cta" href="#">Go</a>
						</section>
					</main>
					<div data-trickroom-stage-chrome="" id="origin">
						<div data-test="hover" style="display:none"><span></span></div>
						<div data-test="selection" style="display:none"><span></span></div>
					</div>
				</div>
			</div>`;
		source = createSource();
		const box = (kind: string) =>
			document.querySelector(`[data-test=${kind}]`) as HTMLElement;
		stop = startStageSelectionOverlay({
			document,
			window,
			origin: document.getElementById("origin") as HTMLElement,
			selection: {
				box: box("selection"),
				label: box("selection").firstElementChild as HTMLElement,
			},
			hover: {
				box: box("hover"),
				label: box("hover").firstElementChild as HTMLElement,
			},
			source,
		});
		flush();
	});

	afterEach(() => {
		stop();
		vi.restoreAllMocks();
	});

	it("paints the selection and idles with nothing to show", () => {
		expect(frames).toHaveLength(0);
		source.select("title");
		flush();
		expect(outline("selection")).toBe("TITLE");
		expect(frames).toHaveLength(1);
		source.select(null);
		flush();
		expect(outline("selection")).toBeNull();
		expect(frames).toHaveLength(0);
	});

	it("hides a resting hover when an overlay opens in its board, and shows it when it closes", () => {
		move("cta");
		flush();
		expect(outline("hover")).toBe("CTA");

		const popup = document.createElement("div");
		popup.setAttribute("data-trickroom-node-id", "popup");
		portalHost().append(popup);
		flush();
		expect(outline("hover")).toBeNull();

		popup.remove();
		flush();
		expect(outline("hover")).toBe("CTA");
	});

	it("hides the hover on a middle-button press until the pointer moves", () => {
		move("cta");
		flush();
		expect(outline("hover")).toBe("CTA");
		document
			.querySelector("[data-trickroom-node-id=cta]")
			?.dispatchEvent(
				new PointerEvent("pointerdown", { bubbles: true, button: 1 }),
			);
		flush();
		expect(outline("hover")).toBeNull();
		move("cta", 4);
		flush();
		expect(outline("hover")).toBeNull();
		move("cta");
		flush();
		expect(outline("hover")).toBe("CTA");
	});

	it("does not draw the hover over the selected layer", () => {
		source.select("cta");
		move("cta");
		flush();
		expect(outline("selection")).toBe("CTA");
		expect(outline("hover")).toBeNull();
	});
});
