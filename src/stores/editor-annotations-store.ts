import { createStore, useSelector } from "@tanstack/react-store";
import { useMemo } from "react";
import type { OpenRound } from "../queries/annotations";
import {
	type AnnotationRoundCounts,
	type AnnotationTargetLocator,
	currentBoardOfWith,
	deriveDetachedWith,
	latestAcknowledgement,
	summarizeRound,
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

// The annotations of what the editor has open (a design, or a component
// in the component editor), on the checkout's branch, as the server last reported them, plus
// the editor's view of them: which thread is open, whether closed ones
// show, which inspector tab is up. Per-user working state, never design
// data: nothing here reaches the design file.

export type InspectorTab = "properties" | "annotations";

export type AnnotationRowMarkers = {
	/** Per layer row: the annotations anchored to it. */
	layers: Record<string, AnnotationMarker>;
	/** Per board row: board annotations plus those on its layers. */
	boards: Record<string, AnnotationMarker>;
	/**
	 * Per layer row with annotated descendants: its own and theirs, what the
	 * row shows while it is collapsed. Needs the locator's `parentOfLayer`.
	 */
	subtrees: Record<string, AnnotationMarker>;
};

export type EditorAnnotationsState = {
	container: AnnotationContainer | null;
	/** The server's checkout (branch and worktree). */
	scope: AnnotationScope | null;
	status: "idle" | "loading" | "ready" | "error";
	byId: Record<string, AnnotationView>;
	/** The open round of the container on this branch, if there is one. */
	round: OpenRound | null;
	/** Show resolved and dismissed annotations on the stage and in the rail. */
	showResolved: boolean;
	inspectorTab: InspectorTab;
	/** The thread the inspector opens and scrolls to. */
	activeAnnotationId: string | null;
	/** Bumped to move focus to the new-annotation composer. */
	composerFocusRequest: number;
	/** The command menu asked to close the round; the round header answers. */
	closeRoundRequested: boolean;
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

/**
 * A record keyed by ids (layer, board and annotation ids may be any safe
 * path segment, `constructor` and `__proto__` included): no prototype to
 * read through or write into.
 */
export const createIdRecord = <Value>(
	entries?: Iterable<readonly [string, Value]>,
): Record<string, Value> => {
	const record = Object.create(null) as Record<string, Value>;
	for (const [id, value] of entries ?? []) record[id] = value;
	return record;
};

const withoutId = <Value>(record: Record<string, Value>, id: string) =>
	createIdRecord(Object.entries(record).filter(([key]) => key !== id));

const withId = <Value>(
	record: Record<string, Value>,
	id: string,
	value: Value,
) => {
	const next = createIdRecord(Object.entries(record));
	next[id] = value;
	return next;
};

const emptyMarkers = (): AnnotationRowMarkers => ({
	layers: createIdRecord(),
	boards: createIdRecord(),
	subtrees: createIdRecord(),
});

const initialState = (): EditorAnnotationsState => ({
	container: null,
	scope: null,
	status: "idle",
	byId: createIdRecord(),
	round: null,
	showResolved: readShowResolved(),
	inspectorTab: "properties",
	activeAnnotationId: null,
	composerFocusRequest: 0,
	closeRoundRequested: false,
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

const sameScope = (a: AnnotationScope, b: AnnotationScope) =>
	a.branch === b.branch && a.worktreePath === b.worktreePath;

/**
 * `held` with what `incoming`, a read of the same content revision, knows
 * newer about state derived on read rather than stored (the
 * acknowledgement's expiry, from the agent session's clock): that changes
 * without the revision, so it never waits on the revision order. `held`
 * itself when nothing differs.
 */
const withLatestPresentation = (
	held: AnnotationView,
	incoming: AnnotationView,
): AnnotationView => {
	if (!held.acknowledgement || !incoming.acknowledgement) return held;
	const acknowledgement = latestAcknowledgement(
		held.acknowledgement,
		incoming.acknowledgement,
	);
	return acknowledgement === held.acknowledgement
		? held
		: { ...held, acknowledgement };
};

const containerOfTarget = (
	target: AnnotationView["target"],
): AnnotationContainer =>
	target.kind === "componentNode"
		? {
				kind: "component",
				systemId: target.systemId,
				componentId: target.componentId,
			}
		: { kind: "design", designId: target.designId };

// ---------------------------------------------------------------------------
// Ordering. Annotations change from three directions at once: list reads,
// single reads after an `annotation` event, and the editor's own writes.
// Responses can arrive in any order, and revisions are content hashes with
// no order of their own. So every read takes a sequence number when it
// starts, and every annotation remembers the sequence of whatever last set
// it (a read, a write, a delete, or an event confirming what the editor
// holds). A response older than that is not applied. Opening another
// container starts a new generation, and nothing from an older one applies.
// ---------------------------------------------------------------------------

let clock = 0;
let generation = 0;
/** Per annotation: the sequence of whatever last set (or removed) it. */
let settledAt = new Map<string, number>();
/**
 * The newest list applied: what it held and when it started. An id it did
 * not list counts as removed at that sequence, so an older read cannot
 * bring it back.
 */
let lastList: { sequence: number; ids: ReadonlySet<string> } | null = null;

/**
 * A request in flight (a list, a single read, or one of the editor's own
 * writes): its container's generation and when it started.
 */
export type AnnotationReadToken = { generation: number; sequence: number };

/** Call when a list or single read starts; pass the token to apply it. */
export function beginAnnotationRead(): AnnotationReadToken {
	clock += 1;
	return { generation, sequence: clock };
}

/** Call when one of the editor's writes starts; pass the token to apply its answer. */
export const beginAnnotationWrite = beginAnnotationRead;

const settle = (annotationId: string, sequence = ++clock) => {
	settledAt.set(annotationId, sequence);
};

/** The sequence a request must be newer than to set this annotation. */
const settledSequence = (annotationId: string) =>
	Math.max(
		settledAt.get(annotationId) ?? 0,
		lastList && !lastList.ids.has(annotationId) ? lastList.sequence : 0,
	);

const isCurrent = (token: AnnotationReadToken, annotationId: string) =>
	token.generation === generation &&
	token.sequence > settledSequence(annotationId);

const belongsHere = (
	state: EditorAnnotationsState,
	annotation: AnnotationView,
) =>
	state.container !== null &&
	sameContainer(state.container, containerOfTarget(annotation.target));

/** Starts over for another design or component (or none). */
export function openAnnotationContainer(container: AnnotationContainer | null) {
	if (sameContainer(editorAnnotationsStore.get().container, container)) return;
	// Requests still in flight for the previous container are void.
	generation += 1;
	settledAt = new Map();
	lastList = null;
	editorAnnotationsStore.setState((state) => ({
		...state,
		container,
		scope: null,
		status: container ? "loading" : "idle",
		byId: createIdRecord(),
		round: null,
		activeAnnotationId: null,
		markers: emptyMarkers(),
	}));
}

/**
 * Applies a full list read. Annotations set since the read started (by an
 * event's read, or the editor's own write) keep what they have, and so do
 * ones added since; the rest take the list's version or leave. A list of
 * another scope than the one held (the checkout changed) replaces
 * everything, as `changeAnnotationScope` does, and says `"scope-changed"`.
 */
export function hydrateAnnotations(
	container: AnnotationContainer,
	scope: AnnotationScope,
	annotations: readonly AnnotationView[],
	token: AnnotationReadToken = beginAnnotationRead(),
): "applied" | "scope-changed" | "ignored" {
	if (token.generation !== generation) return "ignored";
	// A list older than one already applied says nothing new.
	if (lastList && token.sequence < lastList.sequence) return "ignored";
	const held = editorAnnotationsStore.get();
	if (!sameContainer(held.container, container)) return "ignored";
	if (held.scope && !sameScope(held.scope, scope)) {
		// The checkout changed since the editor last listed: what it holds
		// is another branch's. This list is the first of the new scope.
		startScope(scope);
		token = beginAnnotationRead();
	}
	const listed = new Map(
		annotations
			.filter((annotation) =>
				sameContainer(container, containerOfTarget(annotation.target)),
			)
			.map((annotation) => [annotation.id, annotation]),
	);
	editorAnnotationsStore.setState((state) => {
		const byId = createIdRecord<AnnotationView>();
		for (const [id, held] of Object.entries(state.byId)) {
			// Held but not listed: removed, unless set after the list started.
			if (listed.has(id)) continue;
			if (isCurrent(token, id)) settle(id, token.sequence);
			else byId[id] = held;
		}
		for (const [id, annotation] of listed) {
			const previous = state.byId[id];
			const sameRevision = previous?.revision === annotation.revision;
			if (!isCurrent(token, id)) {
				if (previous) {
					byId[id] = sameRevision
						? withLatestPresentation(previous, annotation)
						: previous;
				}
				continue;
			}
			settle(id, token.sequence);
			// Keep the object of an unchanged annotation, so its views do not
			// re-render.
			byId[id] =
				previous && sameRevision
					? withLatestPresentation(previous, annotation)
					: annotation;
		}
		return { ...state, scope, status: "ready", byId };
	});
	lastList = { sequence: token.sequence, ids: new Set(listed.keys()) };
	return held.scope && !sameScope(held.scope, scope)
		? "scope-changed"
		: "applied";
}

/**
 * Starts a new generation for another checkout scope of the same
 * container: requests in flight belong to the old scope and are void, and
 * nothing of it is shown.
 */
const startScope = (scope: AnnotationScope | null) => {
	generation += 1;
	settledAt = new Map();
	lastList = null;
	editorAnnotationsStore.setState((state) => ({
		...state,
		scope,
		status: state.container ? "loading" : "idle",
		byId: createIdRecord(),
		round: null,
		activeAnnotationId: null,
		markers: emptyMarkers(),
	}));
};

/**
 * The server reported the checkout scope `scope` (another branch checked
 * out with the container open, an `annotation-scope` event or a
 * `SCOPE_CHANGED` refusal). When it is not the one held, the annotations
 * held are another branch's: they are dropped, and true says to list
 * again. Drafts are not touched: they are keyed by target, not branch.
 */
export function changeAnnotationScope(scope: AnnotationScope): boolean {
	const state = editorAnnotationsStore.get();
	if (!state.container) return false;
	if (state.scope && sameScope(state.scope, scope)) return false;
	startScope(scope);
	return true;
}

/** Whether `scope` is the checkout the editor's annotations are of (true before a list). */
export const isHeldAnnotationScope = (scope: AnnotationScope) => {
	const held = editorAnnotationsStore.get().scope;
	return !held || sameScope(held, scope);
};

export function setAnnotationsError(container: AnnotationContainer) {
	editorAnnotationsStore.setState((state) =>
		sameContainer(state.container, container)
			? { ...state, status: "error" }
			: state,
	);
}

const putAnnotation = (
	state: EditorAnnotationsState,
	annotation: AnnotationView,
): EditorAnnotationsState => {
	const previous = state.byId[annotation.id];
	const onBranch = !state.scope || annotation.branch === state.scope.branch;
	if (!onBranch) {
		return previous
			? { ...state, byId: withoutId(state.byId, annotation.id) }
			: state;
	}
	if (previous?.revision === annotation.revision) {
		const next = withLatestPresentation(previous, annotation);
		return next === previous
			? state
			: { ...state, byId: withId(state.byId, annotation.id, next) };
	}
	return { ...state, byId: withId(state.byId, annotation.id, annotation) };
};

/**
 * Puts an annotation in place unconditionally, as the newest state: reads
 * started before it no longer apply. The editor's writes go through
 * `applyAnnotationWrite`, which also checks the order.
 * One that moved to another branch leaves the list (it shows under other
 * branches). An annotation of another container is ignored.
 */
export function upsertAnnotation(annotation: AnnotationView) {
	if (!belongsHere(editorAnnotationsStore.get(), annotation)) return;
	settle(annotation.id);
	editorAnnotationsStore.setState((state) =>
		belongsHere(state, annotation) ? putAnnotation(state, annotation) : state,
	);
}

/**
 * Applies the answer of one of the editor's own writes, started with
 * `token`. It applies only if nothing (an event, a read, another write, a
 * delete) set that annotation since the write started, in the same
 * container visit; then it is the newest state, and reads started before
 * now no longer apply. Returns `"stale"` when something newer got there
 * first: the caller reads the annotation again through the ordered path.
 * Revisions are content hashes, so they are never compared for order.
 */
export function applyAnnotationWrite(
	token: AnnotationReadToken,
	annotation: AnnotationView,
): "applied" | "stale" | "ignored" {
	const state = editorAnnotationsStore.get();
	if (token.generation !== generation || !belongsHere(state, annotation)) {
		return "ignored";
	}
	if (!isCurrent(token, annotation.id)) return "stale";
	settle(annotation.id);
	editorAnnotationsStore.setState((current) =>
		putAnnotation(current, annotation),
	);
	return "applied";
}

/**
 * Applies a single read started with `token`. Returns `"applied"`, or
 * `"stale"` when something newer set the annotation since the read started
 * (or the container changed); a stale answer whose revision differs from
 * what the editor holds may be newer still, and is worth reading again.
 */
export function applyAnnotationRead(
	token: AnnotationReadToken,
	annotation: AnnotationView,
): "applied" | "stale" | "ignored" {
	const state = editorAnnotationsStore.get();
	if (token.generation !== generation || !belongsHere(state, annotation)) {
		return "ignored";
	}
	if (!isCurrent(token, annotation.id)) {
		if (state.byId[annotation.id]?.revision !== annotation.revision) {
			return "stale";
		}
		// The same content: only what is derived on read may be newer.
		editorAnnotationsStore.setState((current) =>
			putAnnotation(current, annotation),
		);
		return "ignored";
	}
	settle(annotation.id, token.sequence);
	editorAnnotationsStore.setState((current) =>
		putAnnotation(current, annotation),
	);
	return "applied";
}

/**
 * An event said the annotation is at the revision the editor already
 * holds: reads started before it are older than what is shown.
 */
export function confirmAnnotationRevision(annotationId: string) {
	settle(annotationId);
}

export function removeAnnotation(annotationId: string) {
	settle(annotationId);
	editorAnnotationsStore.setState((state) =>
		state.byId[annotationId]
			? { ...state, byId: withoutId(state.byId, annotationId) }
			: state,
	);
}

// ---------------------------------------------------------------------------
// The open round. It is read on its own (a fetch, an `annotation-round`
// event, or the answer of a send or a close), so it has its own order: an
// answer applies only when it started after the newest one applied. An
// answer of another container or another checkout scope than the one held
// does not apply.
// ---------------------------------------------------------------------------

let roundClock = 0;
let roundApplied = 0;

/** Call when a round read starts; for a write's answer, call when it arrives. */
export const beginRoundRead = () => (roundClock += 1);

/**
 * Shows the open round of `container` (null: none is open), read in
 * `scope` when `scope` is known. False when it did not apply.
 */
export function applyOpenRound(
	sequence: number,
	container: AnnotationContainer,
	scope: AnnotationScope | null,
	round: OpenRound | null,
): boolean {
	const state = editorAnnotationsStore.get();
	if (!sameContainer(state.container, container)) return false;
	if (scope && state.scope && !sameScope(state.scope, scope)) return false;
	if (sequence <= roundApplied) return false;
	roundApplied = sequence;
	editorAnnotationsStore.setState((current) => ({ ...current, round }));
	return true;
}

/**
 * The open round with its progress counted from the annotations the
 * editor holds, so it moves as they do. An annotation the round lists and
 * the editor does not hold counts as closed.
 */
export function useOpenRound(): {
	round: OpenRound;
	counts: AnnotationRoundCounts;
	/** The round's annotations waiting for the designer to close them. */
	proposed: AnnotationView[];
} | null {
	const round = useSelector(editorAnnotationsStore, (state) => state.round);
	const byId = useSelector(editorAnnotationsStore, (state) => state.byId);
	const ready = useSelector(
		editorAnnotationsStore,
		(state) => state.status === "ready",
	);
	return useMemo(() => {
		if (!round) return null;
		const listed = new Set(round.annotationIds);
		const held = Object.values(byId);
		return {
			round,
			// Before the list arrives the server's counts are the best there is.
			counts: ready ? summarizeRound(round, held) : round.counts,
			proposed: held.filter(
				(annotation) =>
					annotation.status === "proposed" && listed.has(annotation.id),
			),
		};
	}, [byId, ready, round]);
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

/**
 * Opens the Annotations tab and asks the round header to close the round
 * (it confirms first when annotations stay open).
 */
export function requestCloseRound() {
	editorAnnotationsStore.setState((state) => ({
		...state,
		inspectorTab: "annotations",
		closeRoundRequested: true,
	}));
}

/** The round header took the request. */
export function clearCloseRoundRequest() {
	editorAnnotationsStore.setState((state) =>
		state.closeRoundRequested
			? { ...state, closeRoundRequested: false }
			: state,
	);
}

/** Test and reset helper. */
export function resetEditorAnnotations() {
	generation += 1;
	roundApplied = 0;
	settledAt = new Map();
	lastList = null;
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
 * layers that moved), and each layer with annotated descendants its
 * subtree, for when it is collapsed. Entries equal to `previous` keep their
 * object, so a row whose marker did not change does not re-render.
 */
export function deriveAnnotationRowMarkers(
	annotations: readonly AnnotationView[],
	locator: AnnotationTargetLocator,
	showResolved: boolean,
	previous: AnnotationRowMarkers = emptyMarkers(),
): AnnotationRowMarkers {
	// Maps: ids may be `constructor` or `__proto__`.
	const layerStates = new Map<string, AnnotationPresentationState[]>();
	const boardStates = new Map<string, AnnotationPresentationState[]>();
	const subtreeStates = new Map<string, AnnotationPresentationState[]>();
	const push = (
		states: Map<string, AnnotationPresentationState[]>,
		id: string,
		state: AnnotationPresentationState,
	) => {
		const list = states.get(id);
		if (list) list.push(state);
		else states.set(id, [state]);
	};
	for (const annotation of annotations) {
		if (!isAnnotationShown(annotation, showResolved)) continue;
		const { target } = annotation;
		if (target.kind === "componentNode") {
			// The component rail (a component locator only): each node row
			// its own, the root row (the locator's board) everything in the
			// component.
			if (!locator.hasComponentNode) continue;
			const state = getAnnotationStateWith(annotation, locator);
			// A detached one (its path gone) still counts on the root, as a
			// detached layer annotation counts on its board.
			const rootId =
				locator.boardOfLayer(target.nodePath) ??
				locator.componentRootId?.() ??
				null;
			if (rootId !== null) push(boardStates, rootId, state);
			push(layerStates, target.nodePath, state);
			continue;
		}
		if (target.kind !== "layer" && target.kind !== "board") continue;
		const state = getAnnotationStateWith(annotation, locator);
		const boardId = currentBoardOfWith(target, locator);
		if (boardId && locator.hasBoard(boardId)) {
			push(boardStates, boardId, state);
		}
		if (target.kind === "layer") {
			push(layerStates, target.elementId, state);
			// The layer and its ancestors below the board (the board row
			// counts everything already). Bounded against a broken tree.
			let id: string | null = target.elementId;
			for (let depth = 0; id !== null && depth < 1000; depth += 1) {
				const parent: string | null = locator.parentOfLayer?.(id) ?? null;
				if (parent === null) break;
				push(subtreeStates, id, state);
				id = parent;
			}
		}
	}
	const reuse = (
		states: Map<string, AnnotationPresentationState[]>,
		before: Record<string, AnnotationMarker>,
	) => {
		const next = createIdRecord<AnnotationMarker>();
		let changed = Object.keys(before).length !== states.size;
		for (const [id, list] of states) {
			const marker = groupAnnotationMarker(list);
			if (!marker) continue;
			const held = Object.hasOwn(before, id) ? before[id] : undefined;
			if (held && isSameAnnotationMarker(held, marker)) {
				next[id] = held;
			} else {
				next[id] = marker;
				changed = true;
			}
		}
		return changed ? next : before;
	};
	const layers = reuse(layerStates, previous.layers);
	const boards = reuse(boardStates, previous.boards);
	const subtrees = reuse(subtreeStates, previous.subtrees);
	return layers === previous.layers &&
		boards === previous.boards &&
		subtrees === previous.subtrees
		? previous
		: { layers, boards, subtrees };
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
 * layer row's its own, and a collapsed layer row's its own and its hidden
 * descendants'. Selected by id, so an annotation event re-renders only the
 * rows whose marker changed.
 */
export function useAnnotationRowMarker(id: string, collapsed = false) {
	return useSelector(
		editorAnnotationsStore,
		(state) =>
			state.markers.boards[id] ??
			(collapsed ? state.markers.subtrees[id] : undefined) ??
			state.markers.layers[id] ??
			null,
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
