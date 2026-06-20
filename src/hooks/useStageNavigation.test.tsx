import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { designStore } from "../stores/design-store";
import {
	findStageRootBoard,
	shouldStartStagePan,
	shouldZoomStageFromWheel,
	useStageNavigation,
} from "./useStageNavigation";

type Listener = (event: { type: string }) => void;

class MinimalEventTarget {
	addCount = 0;
	removeCount = 0;
	private listeners = new Map<string, Set<Listener>>();

	addEventListener(type: string, listener: Listener) {
		this.addCount += 1;
		const listeners = this.listeners.get(type) ?? new Set<Listener>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: Listener) {
		this.removeCount += 1;
		this.listeners.get(type)?.delete(listener);
	}
}

class MinimalNode extends MinimalEventTarget {
	nodeType: number;
	nodeName: string;
	tagName: string;
	namespaceURI = "http://www.w3.org/1999/xhtml";
	ownerDocument: MinimalDocument | null = null;
	parentNode: MinimalNode | null = null;
	childNodes: MinimalNode[] = [];

	constructor(nodeType: number, nodeName: string) {
		super();
		this.nodeType = nodeType;
		this.nodeName = nodeName;
		this.tagName = nodeName;
	}

	appendChild(child: MinimalNode) {
		this.childNodes.push(child);
		child.parentNode = this;
		return child;
	}

	insertBefore(child: MinimalNode, before: MinimalNode | null) {
		child.parentNode = this;
		if (!before) {
			this.childNodes.push(child);
			return child;
		}

		const beforeIndex = this.childNodes.indexOf(before);
		if (beforeIndex === -1) {
			this.childNodes.push(child);
			return child;
		}

		this.childNodes.splice(beforeIndex, 0, child);
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
	className = "";
	style: Record<string, string> = {};

	constructor(tagName: string) {
		super(1, tagName.toUpperCase());
	}

	setAttribute(name: string, value: string) {
		this.attributes.set(name, String(value));
		if (name === "class") {
			this.className = String(value);
		}
	}

	getAttribute(name: string) {
		return this.attributes.get(name) ?? null;
	}
}

class MinimalTextNode extends MinimalNode {
	nodeValue: string;

	constructor(text: string) {
		super(3, "#text");
		this.nodeValue = text;
	}
}

class MinimalDocument extends MinimalNode {
	activeElement: MinimalElement;
	body: MinimalElement;
	defaultView: typeof globalThis = globalThis;
	documentElement: MinimalElement;

	constructor() {
		super(9, "#document");
		this.namespaceURI = "";
		this.ownerDocument = this;
		this.documentElement = new MinimalElement("html");
		this.documentElement.ownerDocument = this;
		this.body = new MinimalElement("body");
		this.body.ownerDocument = this;
		this.activeElement = this.body;
		this.documentElement.appendChild(this.body);
		this.appendChild(this.documentElement);
	}

	createElement(tagName: string) {
		const element = new MinimalElement(tagName);
		element.ownerDocument = this;
		return element;
	}

	createTextNode(text: string) {
		const textNode = new MinimalTextNode(text);
		textNode.ownerDocument = this;
		return textNode;
	}
}

class ResizeObserverDouble {
	observe() {}
	disconnect() {}
}

class MutationObserverDouble {
	observe() {}
	disconnect() {}
}

class StageWindowDouble extends MinimalEventTarget {
	ResizeObserver = ResizeObserverDouble;
	MutationObserver = MutationObserverDouble;

	requestAnimationFrame() {
		return 1;
	}

	cancelAnimationFrame() {}
}

function createRootBoardDouble(rootId: string) {
	return {
		getAttribute(name: string) {
			return name === "data-trickroom-root-id" ? rootId : null;
		},
		getBoundingClientRect() {
			return { left: 40, top: 50, width: 320, height: 240 };
		},
	};
}

function createWorldDouble(rootIds: string[]) {
	const boards = rootIds.map(createRootBoardDouble);

	return {
		style: {} as Record<string, string>,
		querySelector(selector: string) {
			return selector === "main"
				? { firstElementChild: boards[0] ?? null }
				: null;
		},
		querySelectorAll(selector: string) {
			return selector === "[data-trickroom-root-id]" ? boards : [];
		},
		getBoundingClientRect() {
			return { left: 0, top: 0, width: 0, height: 0 };
		},
	};
}

function createStageFrameDouble(rootIds = ["board-1"]) {
	const viewport = Object.assign(new MinimalEventTarget(), {
		classList: { toggle() {} },
		clientWidth: 1000,
		clientHeight: 800,
		releasePointerCapture() {},
		setPointerCapture() {},
	});
	const world = createWorldDouble(rootIds);
	const window = new StageWindowDouble();
	const documentElement = {
		hasAttribute() {
			return false;
		},
	};
	const contentDocument = {
		documentElement,
		getElementById(id: string) {
			return id === "trickroom-viewport" ? viewport : null;
		},
		getElementsByClassName(className: string) {
			return {
				item(index: number) {
					return className === "frame-content" && index === 0 ? world : null;
				},
			};
		},
	};

	return {
		iframe: {
			contentDocument,
			contentWindow: window,
		} as unknown as HTMLIFrameElement,
		viewport,
		window,
	};
}

function createContainer() {
	const document = new MinimalDocument();
	const container = document.createElement("div");
	document.body.appendChild(container);
	return { document, container };
}

function StageNavigationHarness({
	frame,
	responsiveWidth,
}: {
	frame: ReturnType<typeof createStageFrameDouble>;
	responsiveWidth: number;
}) {
	const iframeRef = useRef<HTMLIFrameElement | null>(frame.iframe);
	useStageNavigation(iframeRef, true, {
		mode: "responsive",
		activeBoardId: "board-1",
		responsiveWidth,
	});
	return null;
}

describe("stage navigation helpers", () => {
	it("finds the active root board by data marker", () => {
		const world = createWorldDouble(["board-1", "board-2"]);

		expect(
			findStageRootBoard(world as unknown as Element, "board-2")?.getAttribute(
				"data-trickroom-root-id",
			),
		).toBe("board-2");
	});

	it("does not fall back to the first board when a requested active marker is missing", () => {
		const world = createWorldDouble(["board-1", "board-2"]);

		expect(
			findStageRootBoard(world as unknown as Element, "board-3"),
		).toBeNull();
	});

	it("keeps pan and zoom gestures canvas-only", () => {
		expect(shouldStartStagePan("canvas", 1, false)).toBe(true);
		expect(shouldStartStagePan("canvas", 0, true)).toBe(true);
		expect(shouldStartStagePan("responsive", 1, false)).toBe(false);
		expect(shouldStartStagePan("responsive", 0, true)).toBe(false);

		expect(
			shouldZoomStageFromWheel("canvas", { ctrlKey: true, metaKey: false }),
		).toBe(true);
		expect(
			shouldZoomStageFromWheel("responsive", {
				ctrlKey: true,
				metaKey: false,
			}),
		).toBe(false);
	});
});

describe("useStageNavigation listener setup", () => {
	let root: Root | null = null;

	beforeEach(() => {
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const document = new MinimalDocument();
		Object.assign(globalThis, {
			document,
			HTMLElement: MinimalElement,
			HTMLIFrameElement: MinimalElement,
			window: globalThis,
		});
		designStore.setState((state) => ({
			...state,
			rootIds: ["board-1"],
			entitiesById: {},
		}));
	});

	afterEach(async () => {
		if (root) {
			await act(async () => {
				root?.unmount();
			});
			root = null;
		}
	});

	it("does not reinstall iframe listeners when responsive width changes", async () => {
		const frame = createStageFrameDouble();
		const { container } = createContainer();
		root = createRoot(container as unknown as Element);

		await act(async () => {
			root?.render(
				<StageNavigationHarness frame={frame} responsiveWidth={640} />,
			);
		});

		const viewportAddCount = frame.viewport.addCount;
		const windowAddCount = frame.window.addCount;

		await act(async () => {
			root?.render(
				<StageNavigationHarness frame={frame} responsiveWidth={768} />,
			);
		});

		expect(frame.viewport.addCount).toBe(viewportAddCount);
		expect(frame.window.addCount).toBe(windowAddCount);
		expect(frame.viewport.removeCount).toBe(0);
		expect(frame.window.removeCount).toBe(0);
	});
});
