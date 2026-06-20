import { describe, expect, it } from "vitest";
import type { Node } from "../types";
import {
	inlineResources,
	type PrepNode,
	prepareRenderTree,
	type RenderNode,
	type ResolvedResources,
} from "./prepare-tree";

function makeBoard(): Node {
	return {
		id: "board",
		props: {
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "container",
			"data-trickroom-role": "branch",
			"data-trickroom-name": "Board",
			className: "flex gap-2",
		},
		children: [
			{
				id: "text",
				props: {
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "text",
					"data-trickroom-role": "text",
					"data-trickroom-name": "Label",
					className: "text-sm",
				},
				children: "Hello",
			},
			{
				id: "btn",
				props: {
					"data-trickroom-library": "base-ui",
					"data-trickroom-component": "button",
					"data-trickroom-role": "branch",
					"data-trickroom-name": "Button",
					className: "px-2",
					// A recipe marker that must be stripped from the exported DOM.
					"data-trickroom-recipe-instance": "rec-1",
				},
				children: [],
			},
			{
				id: "icon",
				props: {
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "icon",
					"data-trickroom-role": "leaf",
					"data-trickroom-name": "Icon",
					"data-trickroom-icon-id": "lucide/x",
					className: "size-4",
				},
				children: [],
			},
		],
	};
}

function hasTrickroomMarker(props: Record<string, unknown>): boolean {
	return Object.keys(props).some((key) => key.startsWith("data-trickroom-"));
}

describe("prepareRenderTree", () => {
	it("maps trickroom container/text to div and preserves text", () => {
		const { tree } = prepareRenderTree(makeBoard());
		if (!tree || "kind" in tree) {
			throw new Error("expected an element root");
		}
		expect(tree.ref).toBe("div");
		const text = tree.children?.[0];
		if (!text || "kind" in text) {
			throw new Error("expected a text element");
		}
		expect(text.ref).toBe("div");
		expect(text.text).toBe("Hello");
	});

	it("collects used base-ui components, class tokens, and icon ids", () => {
		const prepared = prepareRenderTree(makeBoard());
		expect([...prepared.usedBaseUiComponents]).toEqual(["button"]);
		expect(prepared.classNames).toEqual(
			new Set(["flex", "gap-2", "text-sm", "px-2", "size-4"]),
		);
		expect([...prepared.iconIds]).toEqual(["lucide/x"]);
	});

	it("strips marker and internal props but keeps className", () => {
		const { tree } = prepareRenderTree(makeBoard());
		const button = (tree as Extract<PrepNode, { ref: string }>).children?.[1];
		if (!button || "kind" in button) {
			throw new Error("expected a button element");
		}
		expect(button.props.className).toBe("px-2");
		expect(hasTrickroomMarker(button.props)).toBe(false);
	});
});

describe("inlineResources", () => {
	const resolved: ResolvedResources = {
		icons: new Map([
			["lucide/x", { attrs: { viewBox: "0 0 24 24" }, innerHTML: "<path/>" }],
		]),
		assets: new Map(),
	};

	function iconChild(resources: ResolvedResources): RenderNode {
		const { tree } = prepareRenderTree(makeBoard());
		const final = inlineResources(tree as PrepNode, resources);
		const child = final.children?.[2];
		if (!child) {
			throw new Error("expected an icon child");
		}
		return child;
	}

	it("inlines a resolved icon as an svg with inner markup", () => {
		const icon = iconChild(resolved);
		expect(icon.ref).toBe("svg");
		expect(icon.props.dangerouslySetInnerHTML).toEqual({ __html: "<path/>" });
		expect(icon.props.viewBox).toBe("0 0 24 24");
	});

	it("falls back to a missing-resource span when the icon is absent", () => {
		const icon = iconChild({ icons: new Map(), assets: new Map() });
		expect(icon.ref).toBe("span");
		expect(icon.props["data-trickroom-missing-resource"]).toBe("icon");
	});
});
