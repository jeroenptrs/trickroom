import { createStore, useSelector } from "@tanstack/react-store";
import {
	type AnnotationTargetLocator,
	currentBoardOfWith,
	deriveDetachedWith,
} from "../services/annotation-model";
import type {
	AnnotationContainer,
	AnnotationScope,
	AnnotationView,
} from "../services/annotations.types";
import {
	type AnnotationMarker,
	type AnnotationPresentationState,
	getAnnotationPresentationState,
	groupAnnotationMarker,
	isAnnotationShown,
	isSameAnnotationMarker,
} from "../utils/annotation-presentation";

// The annotations of what the editor has open (a design; a component in
// WP5), on the checkout's branch, as the server last reported them, plus
// the editor's view of them: which thread is open, whether closed ones
// show, which inspector tab is up. Per-user working state, never design
// data: nothing here reaches the design file.

export type InspectorTab = "properties" | "annotations";

export type AnnotationRowMarkers = {
	/** Per layer row: the annotations anchored to it. */
	layers: Record<string, AnnotationMarker>;
	/** Per board row: board annotations plus those on its layers. */
	boards: Record<string, AnnotationMarker>;
};

export type EditorAnnotationsState = {
	container: AnnotationContainer | null;
	/** The server's checkout (branch and worktree). */
	scope: AnnotationScope | null;
	status: "idle" | "loading" | "ready" | "error";
	byId: Record<string, AnnotationView>;
	/** Show resolved and dismissed annotations on the stage and in the rail. */
	showResolved: boolean;
	inspectorTab: InspectorTab;
	/** The thread the inspector opens and scrolls to. */
	activeAnnotationId: string | null;
	/** Bumped to move focus to the new-annotation composer. */
	composerFocusRequest: number;
	/** Derived for the open design; see `refreshAnnotationMarkers`. */
	markers: AnnotationRowMarkers;
};

const SHOW_RESOLVED_STORAGE_KEY = "trickroom:annotations-show-resolved";

const readShowResolved = () => {
	try {
		return (
			typeof window !== "undefined" &&
			window.localStorage.getItem(SHOW_RESOLVED_STORAGE_KEY) === "true"
		);
	} catch {
		return false;
	}
};

const emptyMarkers = (): AnnotationRowMarkers => ({ layers: {}, boards: {} });

const initialState = (): EditorAnnotationsState => ({
	container: null,
	scope: null,
	status: "idle",
	byId: {},
	showResolved: readShowResolved(),
	inspectorTab: "properties",
	activeAnnotationId: null,
	composerFocusRequest: 0,
	markers: emptyMarkers(),
});

export const editorAnnotationsStore = createStore<EditorAnnotationsState>(
	initialState(),
);

const sameContainer = (
	a: AnnotationContainer | null,
	b: AnnotationContainer | null,
) =>
	a === b ||
	(!!a &&
		!!b &&
		(a.kind === "design"
			? b.kind === "design" && a.designId === b.designId
			: b.kind === "component" &&
				a.systemId === b.systemId &&
				a.componentId === b.componentId));

/** Starts over for another design or component (or none). */
export function openAnnotationContainer(container: AnnotationContainer | null) {
	editorAnnotationsStore.setState((state) =>
		sameContainer(state.container, container)
			? state
			: {
					...state,
					container,
					scope: null,
					status: container ? "loading" : "idle",
					byId: {},
					activeAnnotationId: null,
					markers: emptyMarkers(),
				},
	);
}

/** Replaces the annotations with a full list read. */
export function hydrateAnnotations(
	container: AnnotationContainer,
	scope: AnnotationScope,
	annotations: readonly AnnotationView[],
) {
	editorAnnotationsStore.setState((state) => {
		if (!sameContainer(state.container, container)) return state;
		const byId: Record<string, AnnotationView> = {};
		for (const annotation of annotations) {
			// Keep the object a single-annotation refetch already put here, so
			// views of unchanged annotations do not re-render.
			const previous = state.byId[annotation.id];
			byId[annotation.id] =
				previous?.revision === annotation.revision ? previous : annotation;
		}
		return { ...state, scope, status: "ready", byId };
	});
}

export function setAnnotationsError(container: AnnotationContainer) {
	editorAnnotationsStore.setState((state) =>
		sameContainer(state.container, container)
			? { ...state, status: "error" }
			: state,
	);
}

/**
 * Puts an annotation read or written through the API in place. One that
 * moved to another branch leaves the list (it shows under other branches).
 */
export function upsertAnnotation(annotation: AnnotationView) {
	editorAnnotationsStore.setState((state) => {
		const previous = state.byId[annotation.id];
		const onBranch = !state.scope || annotation.branch === state.scope.branch;
		if (!onBranch) {
			if (!previous) return state;
			const byId = { ...state.byId };
			delete byId[annotation.id];
			return { ...state, byId };
		}
		if (previous?.revision === annotation.revision) return state;
		return { ...state, byId: { ...state.byId, [annotation.id]: annotation } };
	});
}

export function removeAnnotation(annotationId: string) {
	editorAnnotationsStore.setState((state) => {
		if (!state.byId[annotationId]) return state;
		const byId = { ...state.byId };
		delete byId[annotationId];
		return { ...state, byId };
	});
}

export function setShowResolvedAnnotations(showResolved: boolean) {
	try {
		window.localStorage.setItem(
			SHOW_RESOLVED_STORAGE_KEY,
			showResolved ? "true" : "false",
		);
	} catch {
		// Only the preference is lost.
	}
	editorAnnotationsStore.setState((state) => ({ ...state, showResolved }));
}

export function setInspectorTab(inspectorTab: InspectorTab) {
	editorAnnotationsStore.setState((state) =>
		state.inspectorTab === inspectorTab ? state : { ...state, inspectorTab },
	);
}

/** Shows a thread in the Annotations tab (the caller selects its layer). */
export function openAnnotationThread(annotationId: string | null) {
	editorAnnotationsStore.setState((state) => ({
		...state,
		inspectorTab: "annotations",
		activeAnnotationId: annotationId,
	}));
}

/** Opens the Annotations tab with the new-annotation composer focused. */
export function requestAnnotationComposer() {
	editorAnnotationsStore.setState((state) => ({
		...state,
		inspectorTab: "annotations",
		activeAnnotationId: null,
		composerFocusRequest: state.composerFocusRequest + 1,
	}));
}

/** Test and reset helper. */
export function resetEditorAnnotations() {
	editorAnnotationsStore.setState(() => initialState());
}

/** The presentation state of one annotation against the editor's tree. */
export function getAnnotationStateWith(
	annotation: AnnotationView,
	locator: AnnotationTargetLocator | null,
): AnnotationPresentationState {
	const detached = locator
		? deriveDetachedWith(annotation.target, locator) === true
		: annotation.detached === true;
	return getAnnotationPresentationState(annotation, detached);
}

/**
 * The rail markers of `annotations`: each layer row counts its own, each
 * board row everything on the board (its own and its layers', following
 * layers that moved). Entries equal to `previous` keep their object, so a
 * row whose marker did not change does not re-render.
 */
export function deriveAnnotationRowMarkers(
	annotations: readonly AnnotationView[],
	locator: AnnotationTargetLocator,
	showResolved: boolean,
	previous: AnnotationRowMarkers = emptyMarkers(),
): AnnotationRowMarkers {
	const layerStates: Record<string, AnnotationPresentationState[]> = {};
	const boardStates: Record<string, AnnotationPresentationState[]> = {};
	for (const annotation of annotations) {
		if (!isAnnotationShown(annotation, showResolved)) continue;
		const { target } = annotation;
		if (target.kind !== "layer" && target.kind !== "board") continue;
		const state = getAnnotationStateWith(annotation, locator);
		const boardId = currentBoardOfWith(target, locator);
		if (boardId && locator.hasBoard(boardId)) {
			boardStates[boardId] ??= [];
			boardStates[boardId].push(state);
		}
		if (target.kind === "layer") {
			layerStates[target.elementId] ??= [];
			layerStates[target.elementId].push(state);
		}
	}
	const reuse = (
		states: Record<string, AnnotationPresentationState[]>,
		before: Record<string, AnnotationMarker>,
	) => {
		const next: Record<string, AnnotationMarker> = {};
		let changed = Object.keys(before).length !== Object.keys(states).length;
		for (const [id, list] of Object.entries(states)) {
			const marker = groupAnnotationMarker(list);
			if (!marker) continue;
			if (isSameAnnotationMarker(before[id], marker)) {
				next[id] = before[id] as AnnotationMarker;
			} else {
				next[id] = marker;
				changed = true;
			}
		}
		return changed ? next : before;
	};
	const layers = reuse(layerStates, previous.layers);
	const boards = reuse(boardStates, previous.boards);
	return layers === previous.layers && boards === previous.boards
		? previous
		: { layers, boards };
}

/** Recomputes the rail markers against the editor's current tree. */
export function refreshAnnotationMarkers(locator: AnnotationTargetLocator) {
	editorAnnotationsStore.setState((state) => {
		const markers = deriveAnnotationRowMarkers(
			Object.values(state.byId),
			locator,
			state.showResolved,
			state.markers,
		);
		return markers === state.markers ? state : { ...state, markers };
	});
}

/**
 * A rail row's marker: a board row's counts everything on the board, a
 * layer row's its own. Selected by id, so an annotation event re-renders
 * only the rows whose marker changed.
 */
export function useAnnotationRowMarker(id: string) {
	return useSelector(
		editorAnnotationsStore,
		(state) => state.markers.boards[id] ?? state.markers.layers[id] ?? null,
	);
}

export function useShowResolvedAnnotations() {
	return useSelector(editorAnnotationsStore, (state) => state.showResolved);
}

export function useInspectorTab() {
	return useSelector(editorAnnotationsStore, (state) => state.inspectorTab);
}

export function useAnnotationsById() {
	return useSelector(editorAnnotationsStore, (state) => state.byId);
}
