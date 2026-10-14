// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { designStore, normalizeDesign } from "../../stores/design-store";
import type { Props, TrickroomDesign } from "../../types";
import { attachStageInteraction } from "../stage/stage-interaction";
import { designStageSelection } from "../stage/stage-selection-sources";
import { Layer } from "./Layers";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const layer = (name: string): Props => ({
	"data-trickroom-name": name,
	"data-trickroom-library": "trickroom",
	"data-trickroom-component": "container",
	"data-trickroom-role": "branch",
});

const design = {
	name: "Rename",
	boards: [
		{
			id: "board",
			props: layer("Board"),
			children: [
				{ id: "a", props: layer("Original A"), children: [] },
				{ id: "b", props: layer("B"), children: [] },
			],
		},
	],
} satisfies TrickroomDesign;

const nameOf = (id: string) =>
	designStore.get().entitiesById[id]?.props["data-trickroom-name"];

// The stage document is the iframe's in the app; here it shares the test
// document, which is enough for its pointer handling and focus moves.
function renderStage() {
	const stage = document.createElement("div");
	stage.innerHTML = `
		<div id="trickroom-viewport" tabindex="0">
			<section data-trickroom-node-id="board" data-trickroom-root-id="board">
				<div data-trickroom-node-id="a">A</div>
				<div data-trickroom-node-id="b" id="stage-b">B</div>
			</section>
		</div>`;
	document.body.append(stage);
	return stage;
}

function typeInto(input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

// Like the Layers rail: an edit request is cleared once the row handled it.
function Row({ editRequestId }: { editRequestId: string | null }) {
	const [request, setRequest] = useState(editRequestId);
	return (
		<Layer
			id="a"
			depth={1}
			designId="design"
			editRequestId={request}
			hasTopSeparator={false}
			open
			onDraggingChange={() => {}}
			onEditRequestHandled={() => setRequest(null)}
			onToggleOpen={() => {}}
		/>
	);
}

describe("design layer rename", () => {
	let container: HTMLDivElement;
	let root: Root;
	let stage: HTMLElement;
	let detach: () => void;

	let renders = 0;
	const renderRow = (editRequestId: string | null) => {
		renders += 1;
		act(() =>
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<MemoryRouter>
						<Row key={renders} editRequestId={editRequestId} />
					</MemoryRouter>
				</QueryClientProvider>,
			),
		);
	};

	const startRename = (value: string) => {
		renderRow("a");
		const input = container.querySelector("input") as HTMLInputElement;
		expect(input).not.toBeNull();
		expect(document.activeElement).toBe(input);
		act(() => typeInto(input, value));
		return input;
	};

	const pressStage = (id: string) =>
		act(() => {
			document.getElementById(id)?.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					cancelable: true,
					button: 0,
				}),
			);
		});

	beforeEach(() => {
		// The row's menus query the server; nothing here needs an answer.
		vi.stubGlobal(
			"fetch",
			vi.fn(() => new Promise<Response>(() => {})),
		);
		designStore.setState(() => normalizeDesign(design));
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		stage = renderStage();
		detach = attachStageInteraction({
			document,
			window,
			source: designStageSelection,
			host: document,
			onHoverChange: () => {},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		detach();
		act(() => root.unmount());
		container.remove();
		stage.remove();
	});

	it("commits the rename when a stage press selects another layer", () => {
		startRename("Renamed A");
		pressStage("stage-b");
		expect(nameOf("a")).toBe("Renamed A");
		expect(designStore.get().selectedId).toBe("b");
		expect(container.querySelector("input")).toBeNull();
	});

	it("commits on blur only once and never after Escape", () => {
		const input = startRename("Escaped A");
		act(() => {
			input.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
			);
		});
		pressStage("stage-b");
		expect(nameOf("a")).toBe("Original A");

		act(() => designStageSelection.select("a"));
		const second = startRename("Entered A");
		act(() => {
			second.dispatchEvent(
				new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
		expect(nameOf("a")).toBe("Entered A");
		act(() => designStageSelection.select("b"));
		expect(nameOf("a")).toBe("Entered A");
	});
});
