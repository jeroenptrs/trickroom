// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LayerBreadcrumb } from "./LayerBreadcrumb";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const crumbs = [
	{ id: "board", name: "Board" },
	{ id: "card", name: "Card" },
	{ id: "title", name: "Title" },
];

describe("LayerBreadcrumb", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => root.unmount());
		container.remove();
	});

	it("renders nothing for a root layer", () => {
		expect(
			renderToStaticMarkup(
				<LayerBreadcrumb crumbs={[crumbs[0]]} onSelect={() => {}} />,
			),
		).toBe("");
	});

	it("lists ancestors root first and marks the selected layer", () => {
		act(() => {
			root.render(<LayerBreadcrumb crumbs={crumbs} onSelect={() => {}} />);
		});
		const nav = container.querySelector('nav[aria-label="Layer path"]');
		expect(nav?.textContent).toBe("Board/Card/Title");
		expect(nav?.querySelectorAll("button")).toHaveLength(2);
		expect(nav?.querySelector('[aria-current="location"]')?.textContent).toBe(
			"Title",
		);
	});

	it("selects the clicked ancestor", () => {
		const onSelect = vi.fn();
		act(() => {
			root.render(<LayerBreadcrumb crumbs={crumbs} onSelect={onSelect} />);
		});
		const card = Array.from(container.querySelectorAll("button")).find(
			(button) => button.textContent === "Card",
		);
		act(() => card?.click());
		expect(onSelect).toHaveBeenCalledWith("card");
	});
});
