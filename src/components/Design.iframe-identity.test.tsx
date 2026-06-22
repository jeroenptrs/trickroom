import {
	act,
	type Dispatch,
	type SetStateAction,
	useCallback,
	useMemo,
	useRef,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useResponsiveStageFrame } from "../hooks/useResponsiveStageFrame";
import { StageFrame } from "./Design";
import {
	ResponsiveStageContext,
	type ResponsiveStageMode,
} from "./responsive-stage-context";
import { ResponsiveStageFrameWrapper } from "./responsive-stage-frame";

type Listener = (event: { type: string }) => void;

class MinimalEventTarget {
	private listeners = new Map<string, Set<Listener>>();

	addEventListener(type: string, listener: Listener) {
		const listeners = this.listeners.get(type) ?? new Set<Listener>();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: Listener) {
		this.listeners.get(type)?.delete(listener);
	}

	dispatchEvent(event: { type: string }) {
		for (const listener of this.listeners.get(event.type) ?? []) {
			listener(event);
		}

		return true;
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

	get firstChild() {
		return this.childNodes[0] ?? null;
	}

	get firstElementChild() {
		return this.childNodes.find((node) => node.nodeType === 1) ?? null;
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

	removeAttribute(name: string) {
		this.attributes.delete(name);
		if (name === "class") {
			this.className = "";
		}
	}

	querySelector(selector: string): MinimalElement | null {
		return findElement(this, (element) => matchesSelector(element, selector));
	}
}

class MinimalTextNode extends MinimalNode {
	nodeValue: string;

	constructor(text: string) {
		super(3, "#text");
		this.nodeValue = text;
	}
}

class MinimalWindow extends MinimalEventTarget {
	document: MinimalDocument;

	constructor(document: MinimalDocument) {
		super();
		this.document = document;
	}
}

class MinimalIFrameElement extends MinimalElement {
	contentDocument: MinimalDocument;
	contentWindow: MinimalWindow;

	constructor(ownerDocument: MinimalDocument) {
		super("iframe");
		this.ownerDocument = ownerDocument;
		this.contentDocument = createMinimalDocument();
		this.contentWindow = new MinimalWindow(this.contentDocument);
		this.contentDocument.defaultView = this.contentWindow;
	}
}

class MinimalDocument extends MinimalNode {
	activeElement: MinimalElement;
	body: MinimalElement;
	defaultView: MinimalWindow | typeof globalThis = globalThis;
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
		const element =
			tagName.toLowerCase() === "iframe"
				? new MinimalIFrameElement(this)
				: new MinimalElement(tagName);
		element.ownerDocument = this;
		return element;
	}

	createTextNode(text: string) {
		const textNode = new MinimalTextNode(text);
		textNode.ownerDocument = this;
		return textNode;
	}

	querySelector(selector: string) {
		return this.documentElement.querySelector(selector);
	}
}

function createMinimalDocument() {
	return new MinimalDocument();
}

function findElement(
	node: MinimalNode,
	predicate: (element: MinimalElement) => boolean,
): MinimalElement | null {
	for (const child of node.childNodes) {
		if (child instanceof MinimalElement && predicate(child)) {
			return child;
		}

		const match = findElement(child, predicate);
		if (match) {
			return match;
		}
	}

	return null;
}

function matchesSelector(element: MinimalElement, selector: string) {
	if (selector.startsWith("#")) {
		return element.getAttribute("id") === selector.slice(1);
	}

	if (selector.startsWith(".")) {
		return element.className.split(/\s+/).includes(selector.slice(1));
	}

	return element.tagName.toLowerCase() === selector.toLowerCase();
}

function createContainer() {
	const document = createMinimalDocument();
	const container = document.createElement("div");
	document.body.appendChild(container);
	return { document, container };
}

const noopDispatch = (() => {}) as Dispatch<SetStateAction<never>>;

function ResponsiveStageFrameHarness({
	mode,
	responsiveWidth,
}: {
	mode: ResponsiveStageMode;
	responsiveWidth: number;
}) {
	const iframeRef = useRef<HTMLIFrameElement>(null);
	useResponsiveStageFrame(iframeRef, { mode, responsiveWidth });
	const handleMount = useCallback(() => {}, []);
	const responsiveStage = useMemo(
		() => ({
			mode,
			activeBoardId: null,
			responsiveWidth,
			breakpoints: [],
			controls: {
				setMode: noopDispatch as Dispatch<SetStateAction<ResponsiveStageMode>>,
				setActiveBoardId: noopDispatch as Dispatch<
					SetStateAction<string | null>
				>,
				setResponsiveWidth: noopDispatch as Dispatch<SetStateAction<number>>,
			},
		}),
		[mode, responsiveWidth],
	);

	return (
		<ResponsiveStageContext.Provider value={responsiveStage}>
			<ResponsiveStageFrameWrapper>
				<StageFrame
					iframeRef={iframeRef}
					onMount={handleMount}
					previewDarkMode={false}
				/>
			</ResponsiveStageFrameWrapper>
		</ResponsiveStageContext.Provider>
	);
}

describe("Design stage iframe identity", () => {
	let root: Root | null = null;

	beforeEach(() => {
		globalThis.IS_REACT_ACT_ENVIRONMENT = true;
		const document = createMinimalDocument();
		Object.assign(globalThis, {
			document,
			HTMLElement: MinimalElement,
			HTMLIFrameElement: MinimalIFrameElement,
			window: globalThis,
		});
	});

	afterEach(async () => {
		if (root) {
			await act(async () => {
				root?.unmount();
			});
			root = null;
		}
	});

	it("keeps the same react-frame-component iframe DOM node across mode toggles and width changes", async () => {
		const { container } = createContainer();
		root = createRoot(container as unknown as Element);

		await act(async () => {
			root?.render(
				<ResponsiveStageFrameHarness mode="canvas" responsiveWidth={640} />,
			);
		});

		const iframe = container.querySelector(
			"iframe",
		) as HTMLIFrameElement | null;
		expect(iframe).not.toBeNull();

		await act(async () => {
			root?.render(
				<ResponsiveStageFrameHarness mode="responsive" responsiveWidth={640} />,
			);
		});
		expect(container.querySelector("iframe")).toBe(iframe);
		expect(iframe?.style.width).toBe("640px");

		await act(async () => {
			root?.render(
				<ResponsiveStageFrameHarness mode="responsive" responsiveWidth={768} />,
			);
		});
		expect(container.querySelector("iframe")).toBe(iframe);
		expect(iframe?.style.width).toBe("768px");

		await act(async () => {
			root?.render(
				<ResponsiveStageFrameHarness mode="canvas" responsiveWidth={768} />,
			);
		});
		expect(container.querySelector("iframe")).toBe(iframe);
		expect(iframe?.style.width).toBe("");
	});
});
