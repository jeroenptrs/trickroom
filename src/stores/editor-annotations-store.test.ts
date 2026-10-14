import { beforeEach, describe, expect, it } from "vitest";
import type { AnnotationTargetLocator } from "../services/annotation-model";
import type {
	AnnotationContainer,
	AnnotationScope,
	AnnotationStatus,
	AnnotationTarget,
	AnnotationView,
} from "../services/annotations.types";
import {
	deriveAnnotationRowMarkers,
	editorAnnotationsStore,
	getAnnotationStateWith,
	hydrateAnnotations,
	openAnnotationContainer,
	openAnnotationThread,
	refreshAnnotationMarkers,
	removeAnnotation,
	requestAnnotationComposer,
	resetEditorAnnotations,
	setAnnotationsError,
	setInspectorTab,
	upsertAnnotation,
} from "./editor-annotations-store";

const container: AnnotationContainer = { kind: "design", designId: "d1" };
const scope: AnnotationScope = { branch: "main", worktreePath: "/work" };

const layerTarget = (elementId: string, boardId = "b1"): AnnotationTarget => ({
	kind: "layer",
	designId: "d1",
	boardId,
	elementId,
});
const boardTarget = (boardId: string): AnnotationTarget => ({
	kind: "board",
	designId: "d1",
	boardId,
});

let counter = 0;
const view = (
	overrides: Partial<AnnotationView> & { target?: AnnotationTarget } = {},
): AnnotationView => {
	counter += 1;
	return {
		version: 1,
		id: `a${counter}`,
		projectId: "p1",
		target: layerTarget("l1"),
		branch: "main",
		worktreePath: "/work",
		snapshot: { branch: "main", worktreePath: "/work" },
		status: "open" as AnnotationStatus,
		createdAt: "2026-10-14T10:00:00.000Z",
		updatedAt: "2026-10-14T10:00:00.000Z",
		entries: [],
		transitions: [],
		revision: "r1",
		...overrides,
	};
};

// b1 > l1, l2; b2 > l3
const layers: Record<string, string> = { l1: "b1", l2: "b1", l3: "b2" };
const locator: AnnotationTargetLocator = {
	boardOfLayer: (id) => layers[id] ?? null,
	hasBoard: (id) => id === "b1" || id === "b2",
};

const ready = (annotations: AnnotationView[] = []) => {
	openAnnotationContainer(container);
	hydrateAnnotations(container, scope, annotations);
};

const state = () => editorAnnotationsStore.get();

beforeEach(() => {
	counter = 0;
	resetEditorAnnotations();
});

describe("opening and hydrating", () => {
	it("starts idle and empty", () => {
		expect(state()).toMatchObject({
			container: null,
			scope: null,
			status: "idle",
			byId: {},
			inspectorTab: "properties",
			activeAnnotationId: null,
		});
	});

	it("opens a container in the loading state", () => {
		openAnnotationContainer(container);
		expect(state().container).toEqual(container);
		expect(state().status).toBe("loading");
	});

	it("keeps the state when the same container is opened again", () => {
		ready([view()]);
		const before = state();
		openAnnotationContainer({ kind: "design", designId: "d1" });
		expect(state()).toBe(before);
	});

	it("starts over for another container", () => {
		ready([view()]);
		openAnnotationThread("a1");
		openAnnotationContainer({ kind: "design", designId: "d2" });
		expect(state()).toMatchObject({
			status: "loading",
			scope: null,
			byId: {},
			activeAnnotationId: null,
		});
		openAnnotationContainer({
			kind: "component",
			systemId: "s",
			componentId: "c",
		});
		openAnnotationContainer({
			kind: "component",
			systemId: "s",
			componentId: "c",
		});
		expect(state().status).toBe("loading");
		openAnnotationContainer(null);
		expect(state().status).toBe("idle");
	});

	it("hydrates the list and the scope", () => {
		const a = view();
		ready([a]);
		expect(state().status).toBe("ready");
		expect(state().scope).toEqual(scope);
		expect(state().byId).toEqual({ [a.id]: a });
	});

	it("ignores hydration for a different container", () => {
		openAnnotationContainer(container);
		const before = state();
		hydrateAnnotations({ kind: "design", designId: "other" }, scope, [view()]);
		expect(state()).toBe(before);
		hydrateAnnotations(
			{ kind: "component", systemId: "s", componentId: "c" },
			scope,
			[view()],
		);
		expect(state()).toBe(before);
	});

	it("keeps object identity for annotations with the same revision", () => {
		const a = view({ revision: "r1" });
		const b = view({ revision: "r1" });
		ready([a, b]);
		const sameA = { ...a };
		const newB = { ...b, revision: "r2" };
		hydrateAnnotations(container, scope, [sameA, newB]);
		expect(state().byId[a.id]).toBe(a);
		expect(state().byId[b.id]).toBe(newB);
	});

	it("drops annotations missing from a new list", () => {
		const a = view();
		const b = view();
		ready([a, b]);
		hydrateAnnotations(container, scope, [a]);
		expect(Object.keys(state().byId)).toEqual([a.id]);
	});

	it("flags an error only for the open container", () => {
		openAnnotationContainer(container);
		setAnnotationsError({ kind: "design", designId: "other" });
		expect(state().status).toBe("loading");
		setAnnotationsError(container);
		expect(state().status).toBe("error");
	});
});

describe("upsertAnnotation", () => {
	it("adds a new annotation", () => {
		ready();
		const a = view();
		upsertAnnotation(a);
		expect(state().byId[a.id]).toBe(a);
	});

	it("replaces on a new revision", () => {
		const a = view({ revision: "r1" });
		ready([a]);
		const next = { ...a, revision: "r2", status: "addressed" as const };
		upsertAnnotation(next);
		expect(state().byId[a.id]).toBe(next);
	});

	it("keeps the state and identity on the same revision", () => {
		const a = view({ revision: "r1" });
		ready([a]);
		const before = state();
		upsertAnnotation({ ...a });
		expect(state()).toBe(before);
		expect(state().byId[a.id]).toBe(a);
	});

	it("removes an annotation that moved to another branch", () => {
		const a = view();
		ready([a]);
		upsertAnnotation({ ...a, branch: "feature", revision: "r2" });
		expect(state().byId[a.id]).toBeUndefined();
	});

	it("ignores an unknown annotation from another branch", () => {
		ready();
		const before = state();
		upsertAnnotation(view({ branch: "feature" }));
		expect(state()).toBe(before);
	});

	it("accepts any branch while the scope is unknown", () => {
		openAnnotationContainer(container);
		const a = view({ branch: "feature" });
		upsertAnnotation(a);
		expect(state().byId[a.id]).toBe(a);
	});
});

describe("removeAnnotation", () => {
	it("removes an annotation", () => {
		const a = view();
		const b = view();
		ready([a, b]);
		removeAnnotation(a.id);
		expect(Object.keys(state().byId)).toEqual([b.id]);
	});

	it("keeps the state for an unknown id", () => {
		ready([view()]);
		const before = state();
		removeAnnotation("nope");
		expect(state()).toBe(before);
	});
});

describe("inspector tab and thread", () => {
	it("sets the tab, keeping the state when unchanged", () => {
		setInspectorTab("annotations");
		expect(state().inspectorTab).toBe("annotations");
		const before = state();
		setInspectorTab("annotations");
		expect(state()).toBe(before);
	});

	it("opens a thread in the annotations tab", () => {
		openAnnotationThread("a7");
		expect(state().inspectorTab).toBe("annotations");
		expect(state().activeAnnotationId).toBe("a7");
	});

	it("requests the composer: tab, no active thread, bumped request", () => {
		openAnnotationThread("a7");
		const before = state().composerFocusRequest;
		requestAnnotationComposer();
		expect(state().inspectorTab).toBe("annotations");
		expect(state().activeAnnotationId).toBeNull();
		expect(state().composerFocusRequest).toBe(before + 1);
		requestAnnotationComposer();
		expect(state().composerFocusRequest).toBe(before + 2);
	});
});

describe("getAnnotationStateWith", () => {
	it("derives detached from the locator", () => {
		expect(
			getAnnotationStateWith(view({ target: layerTarget("gone") }), locator),
		).toBe("detached");
		expect(
			getAnnotationStateWith(view({ target: layerTarget("l1") }), locator),
		).toBe("open");
	});

	it("falls back to the server's detached flag without a locator", () => {
		expect(getAnnotationStateWith(view({ detached: true }), null)).toBe(
			"detached",
		);
		expect(getAnnotationStateWith(view({ detached: false }), null)).toBe(
			"open",
		);
	});

	it("reports agent resolutions", () => {
		const annotation = view({
			status: "resolved",
			resolvedBy: { role: "agent", sessionId: "s" },
		});
		expect(getAnnotationStateWith(annotation, locator)).toBe("agent_resolved");
	});
});

describe("deriveAnnotationRowMarkers", () => {
	it("marks layers and their boards", () => {
		const markers = deriveAnnotationRowMarkers(
			[
				view({ target: layerTarget("l1"), status: "open" }),
				view({ target: layerTarget("l1"), status: "needs_input" }),
				view({ target: layerTarget("l3", "b2"), status: "addressed" }),
				view({ target: boardTarget("b1"), status: "open" }),
			],
			locator,
			false,
		);
		expect(markers.layers).toEqual({
			l1: { count: 2, state: "needs_input" },
			l3: { count: 1, state: "addressed" },
		});
		expect(markers.boards).toEqual({
			b1: { count: 3, state: "needs_input" },
			b2: { count: 1, state: "addressed" },
		});
	});

	it("puts a moved layer on its current board", () => {
		const markers = deriveAnnotationRowMarkers(
			[view({ target: layerTarget("l3", "b1") })],
			locator,
			false,
		);
		expect(markers.boards.b2).toEqual({ count: 1, state: "open" });
		expect(markers.boards.b1).toBeUndefined();
	});

	it("shows a detached layer on its board only, as detached", () => {
		const markers = deriveAnnotationRowMarkers(
			[view({ target: layerTarget("gone", "b1") })],
			locator,
			false,
		);
		expect(markers.boards.b1).toEqual({ count: 1, state: "detached" });
		expect(markers.layers.gone).toEqual({ count: 1, state: "detached" });
	});

	it("drops markers for boards that no longer exist", () => {
		const markers = deriveAnnotationRowMarkers(
			[view({ target: boardTarget("gone") })],
			locator,
			false,
		);
		expect(markers.boards).toEqual({});
	});

	it("skips design and component node annotations", () => {
		const markers = deriveAnnotationRowMarkers(
			[
				view({ target: { kind: "design", designId: "d1" } }),
				view({
					target: {
						kind: "componentNode",
						systemId: "s",
						componentId: "c",
						nodePath: "0",
					},
				}),
			],
			locator,
			true,
		);
		expect(markers).toEqual({ layers: {}, boards: {} });
	});

	it("shows closed annotations only with showResolved", () => {
		const closed = [
			view({ target: layerTarget("l1"), status: "resolved" }),
			view({ target: boardTarget("b2"), status: "dismissed" }),
		];
		expect(deriveAnnotationRowMarkers(closed, locator, false)).toEqual({
			layers: {},
			boards: {},
		});
		const shown = deriveAnnotationRowMarkers(closed, locator, true);
		expect(shown.layers.l1).toEqual({ count: 1, state: "resolved" });
		expect(shown.boards.b2).toEqual({ count: 1, state: "dismissed" });
		expect(shown.boards.b1).toEqual({ count: 1, state: "resolved" });
	});

	it("reuses unchanged markers and the whole result when nothing changed", () => {
		const annotations = [
			view({ target: layerTarget("l1") }),
			view({ target: layerTarget("l3", "b2"), status: "addressed" }),
		];
		const first = deriveAnnotationRowMarkers(annotations, locator, false);
		const again = deriveAnnotationRowMarkers(
			annotations.map((annotation) => ({ ...annotation })),
			locator,
			false,
			first,
		);
		expect(again).toBe(first);
	});

	it("keeps the identity of unchanged markers when another one changes", () => {
		const l1 = view({ target: layerTarget("l1") });
		const l3 = view({ target: layerTarget("l3", "b2") });
		const first = deriveAnnotationRowMarkers([l1, l3], locator, false);
		const next = deriveAnnotationRowMarkers(
			[l1, { ...l3, status: "needs_input" }],
			locator,
			false,
			first,
		);
		expect(next).not.toBe(first);
		expect(next.layers.l1).toBe(first.layers.l1);
		expect(next.boards.b1).toBe(first.boards.b1);
		expect(next.layers.l3).toEqual({ count: 1, state: "needs_input" });
		expect(next.boards.b2).not.toBe(first.boards.b2);
	});

	it("notices a marker that disappeared", () => {
		const l1 = view({ target: layerTarget("l1") });
		const l3 = view({ target: layerTarget("l3", "b2") });
		const first = deriveAnnotationRowMarkers([l1, l3], locator, false);
		const next = deriveAnnotationRowMarkers([l1], locator, false, first);
		expect(next).not.toBe(first);
		expect(next.layers).toEqual({ l1: first.layers.l1 });
		expect(next.layers.l1).toBe(first.layers.l1);
		expect(next.boards.b2).toBeUndefined();
	});
});

describe("refreshAnnotationMarkers", () => {
	it("stores the derived markers and keeps the state when nothing changed", () => {
		ready([view({ target: layerTarget("l1") })]);
		refreshAnnotationMarkers(locator);
		expect(state().markers.layers.l1).toEqual({ count: 1, state: "open" });
		const before = state();
		refreshAnnotationMarkers(locator);
		expect(state()).toBe(before);
	});

	it("follows showResolved from the state", () => {
		ready([view({ status: "resolved" })]);
		refreshAnnotationMarkers(locator);
		expect(state().markers.layers).toEqual({});
		editorAnnotationsStore.setState((current) => ({
			...current,
			showResolved: true,
		}));
		refreshAnnotationMarkers(locator);
		expect(state().markers.layers.l1).toEqual({ count: 1, state: "resolved" });
	});
});
