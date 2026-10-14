// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
	attachStageInteraction,
	type StageSelectionSource,
} from "../../stage/stage-interaction";
import { ClassField } from "./ClassField";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("ClassField and a stage press", () => {
	it("commits the pending class string before the stage changes the selection", () => {
		// The class catalog queries the server; nothing here needs an answer.
		vi.stubGlobal(
			"fetch",
			vi.fn(() => new Promise<Response>(() => {})),
		);
		const order: string[] = [];
		const onCommit = vi.fn((next: string) => order.push(`commit ${next}`));
		let selectedId: string | null = "a";
		const source: StageSelectionSource = {
			has: (id) => id === "a" || id === "b",
			getParentId: () => null,
			getChildIds: () => [],
			getName: (id) => id,
			getSelectedId: () => selectedId,
			select: (id) => {
				order.push(`select ${id}`);
				selectedId = id;
			},
			subscribe: () => () => {},
		};

		const stage = document.createElement("div");
		stage.innerHTML = `<div id="trickroom-viewport" tabindex="0"><div data-trickroom-node-id="b" id="stage-b">B</div></div>`;
		document.body.append(stage);
		const detach = attachStageInteraction({
			document,
			window,
			source,
			host: document,
			onHoverChange: () => {},
		});
		const container = document.createElement("div");
		document.body.append(container);
		const root = createRoot(container);
		act(() =>
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<ClassField
						value="p-2"
						onCommit={onCommit}
						systemId={null}
						label="Classes"
					/>
				</QueryClientProvider>,
			),
		);

		const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
		act(() => {
			textarea.focus();
			Object.getOwnPropertyDescriptor(
				HTMLTextAreaElement.prototype,
				"value",
			)?.set?.call(textarea, "p-2 m-4");
			textarea.dispatchEvent(new Event("input", { bubbles: true }));
		});
		act(() => {
			document.getElementById("stage-b")?.dispatchEvent(
				new PointerEvent("pointerdown", {
					bubbles: true,
					cancelable: true,
					button: 0,
				}),
			);
		});

		expect(order).toEqual(["commit p-2 m-4", "select b"]);
		detach();
		act(() => root.unmount());
		container.remove();
		stage.remove();
		vi.unstubAllGlobals();
	});
});
