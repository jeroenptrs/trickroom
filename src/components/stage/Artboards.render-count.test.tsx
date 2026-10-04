import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	designStore,
	forceHydrateDesign,
	hydrateDesign,
} from "../../stores/design-store";
import type { Node, TrickroomDesign } from "../../types";
import {
	ResponsiveStageContext,
	type ResponsiveStageContextValue,
} from "../responsive-stage-context";
import { Artboards } from "./Artboards";

// Counts renders per element: every render of an element reads its entity
// through `useElement` exactly once.
const renders = vi.hoisted(() => new Map<string, number>());
vi.mock("../../stores/design-store", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("../../stores/design-store")>();
	return {
		...original,
		useElement: (id: string) => {
			renders.set(id, (renders.get(id) ?? 0) + 1);
			return original.useElement(id);
		},
	};
});

class MinimalNode {
	nodeType: number;
	nodeName: string;
	tagName: string;
	namespaceURI = "http://www.w3.org/1999/xhtml";
	ownerDocument: MinimalDocument | null = null;
	parentNode: MinimalNode | null = null;
	childNodes: MinimalNode[] = [];
	nodeValue: string | null = null;

	constructor(nodeType: number, nodeName: string) {
		this.nodeType = nodeType;
		this.nodeName = nodeName;
		this.tagName = nodeName;
	}

	addEventListener() {}
	removeEventListener() {}

	get firstChild() {
		return this.childNodes[0] ?? null;
	}

	set textContent(text: string) {
		this.childNodes = [];
		if (text) {
			const node = new MinimalNode(3, "#text");
			node.nodeValue = text;
			this.appendChild(node);
		}
	}

	appendChild(child: MinimalNode) {
		child.parentNode?.removeChild(child);
		this.childNodes.push(child);
		child.parentNode = this;
		return child;
	}

	insertBefore(child: MinimalNode, before: MinimalNode | null) {
		child.parentNode?.removeChild(child);
		const index = before ? this.childNodes.indexOf(before) : -1;
		if (index === -1) {
			this.childNodes.push(child);
		} else {
			this.childNodes.splice(index, 0, child);
		}
		child.parentNode = this;
		return child;
	}

	removeChild(child: MinimalNode) {
		this.childNodes = this.childNodes.filter((node) => node !== child);
		child.parentNode = null;
		return child;
	}
}

class MinimalElement extends MinimalNode {
	attributes = new Map<string, string>();
	style: Record<string, string> & { setProperty?: unknown } = {};

	constructor(tagName: string) {
		super(1, tagName.toUpperCase());
		this.style.setProperty = (name: string, value: string) => {
			this.style[name] = value;
		};
	}

	setAttribute(name: string, value: string) {
		this.attributes.set(name, String(value));
	}

	removeAttribute(name: string) {
		this.attributes.delete(name);
	}

	getAttribute(name: string) {
		return this.attributes.get(name) ?? null;
	}
}

class MinimalDocument extends MinimalNode {
	documentElement: MinimalElement;
	body: MinimalElement;
	activeElement: MinimalElement;
	defaultView: { document: MinimalDocument; HTMLIFrameElement: unknown };

	constructor() {
		super(9, "#document");
		this.ownerDocument = this;
		this.documentElement = this.createElement("html");
		this.body = this.createElement("body");
		this.documentElement.appendChild(this.body);
		this.appendChild(this.documentElement);
		this.activeElement = this.body;
		this.defaultView = { document: this, HTMLIFrameElement: class {} };
	}

	createElement(tagName: string) {
		const element = new MinimalElement(tagName);
		element.ownerDocument = this;
		return element;
	}

	createTextNode(text: string) {
		const node = new MinimalNode(3, "#text");
		node.nodeValue = text;
		node.ownerDocument = this;
		return node;
	}
}

const container = (id: string, children: Node[], className = "flex"): Node => ({
	id,
	props: {
		"data-trickroom-name": id,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
		className,
	},
	children,
});

const buildDesign = ({
	leafClassName = "p-2",
	parentClassName = "flex",
} = {}): TrickroomDesign => ({
	name: "Render counts",
	boards: [
		container("board-a", [
			container("a-1", [container("a-1-1", [])]),
			container("a-2", []),
		]),
		container("board-b", [
			container(
				"b-1",
				[container("b-1-1", [], leafClassName)],
				parentClassName,
			),
			container("b-2", []),
		]),
	],
});

const stage: ResponsiveStageContextValue = {
	mode: "canvas",
	activeBoardId: null,
	responsiveWidth: 640,
	breakpoints: [],
	controls: {
		setMode: () => {},
		setActiveBoardId: () => {},
		setResponsiveWidth: () => {},
	},
};

describe("Artboards render counts across a reload", () => {
	const globals = globalThis as Record<string, unknown>;
	let previousActEnvironment: unknown;
	let root: Root | null = null;

	beforeEach(() => {
		previousActEnvironment = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		forceHydrateDesign(buildDesign(), "r2.initial");
		const document = new MinimalDocument();
		vi.stubGlobal("window", document.defaultView);
		vi.stubGlobal("document", document);
		const host = document.createElement("div");
		document.body.appendChild(host);
		root = createRoot(host as unknown as HTMLElement);
		act(() => {
			root?.render(
				<ResponsiveStageContext.Provider value={stage}>
					<Artboards />
				</ResponsiveStageContext.Provider>,
			);
		});
	});

	afterEach(() => {
		act(() => root?.unmount());
		root = null;
		renders.clear();
		vi.unstubAllGlobals();
		globals.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
	});

	it("re-renders only the layer that changed when one board changed", () => {
		expect(renders.get("a-1-1")).toBe(1);
		const before = designStore.get().entitiesById;
		renders.clear();

		act(() => {
			hydrateDesign(buildDesign({ leafClassName: "p-4" }), "r2.changed");
		});

		const after = designStore.get().entitiesById;
		expect(after).not.toBe(before);
		expect(after["b-1-1"]).not.toBe(before["b-1-1"]);
		for (const id of ["board-a", "a-1", "a-1-1", "a-2", "board-b", "b-1"]) {
			expect(after[id]).toBe(before[id]);
		}
		expect(Object.fromEntries(renders)).toEqual({ "b-1-1": 1 });
	});

	it("does not re-render the children of a changed layer", () => {
		renders.clear();

		act(() => {
			hydrateDesign(buildDesign({ parentClassName: "grid" }), "r2.parent");
		});

		expect(Object.fromEntries(renders)).toEqual({ "b-1": 1 });
	});

	it("re-renders nothing when a reload brings identical content", () => {
		renders.clear();

		act(() => {
			forceHydrateDesign(buildDesign(), "r2.same");
		});

		expect(renders.size).toBe(0);
	});
});
