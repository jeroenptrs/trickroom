import {
	isAcknowledgementActive,
	isLiveAnnotationStatus,
} from "../services/annotation-model";
import type {
	AnnotationActor,
	AnnotationStatus,
	AnnotationTarget,
	AnnotationView,
} from "../services/annotations.types";

/**
 * How an annotation reads in the editor: one state per annotation, shared by
 * the stage pins, the rail markers, the inspector's status chips and the
 * command menu, so they always agree. Derived, never stored.
 *
 * - `draft`: written, not sent; it lives only in the browser.
 * - `open` and `acknowledged`: sent, agent work.
 * - `addressed`, `needs_input` and `proposed`: waiting on the designer.
 * - `detached`: live, but its layer or board is gone.
 * - `agent_resolved`: resolved by an agent and not yet accepted.
 * - `resolved` and `dismissed`: closed.
 */
export type AnnotationPresentationState =
	| "draft"
	| AnnotationStatus
	| "detached"
	| "agent_resolved";

/**
 * The visual of each state (docs/proposals/agent-annotations-workplan.md):
 * open is a cyan square, addressed a hollow cyan square, needs input a
 * slate square with a cyan border, detached dashed slate, resolved slate
 * at 40%, a draft dashed cyan, agent-resolved a hollow check. Proposed
 * looks like addressed: a result for the designer to accept.
 */
export type AnnotationMarkerLook =
	| "filled"
	| "hollow"
	| "question"
	| "detached"
	| "draft"
	| "muted"
	/** Resolved by an agent, not yet accepted: a hollow check. */
	| "check";

export const ANNOTATION_MARKER_LOOK: Record<
	AnnotationPresentationState,
	AnnotationMarkerLook
> = {
	draft: "draft",
	open: "filled",
	acknowledged: "filled",
	addressed: "hollow",
	needs_input: "question",
	proposed: "hollow",
	detached: "detached",
	agent_resolved: "check",
	resolved: "muted",
	dismissed: "muted",
};

export const ANNOTATION_STATE_LABELS: Record<
	AnnotationPresentationState,
	string
> = {
	draft: "Draft",
	open: "Open",
	acknowledged: "Seen",
	addressed: "Addressed",
	needs_input: "Needs input",
	proposed: "Proposed",
	detached: "Detached",
	agent_resolved: "Resolved by agent",
	resolved: "Resolved",
	dismissed: "Dismissed",
};

/**
 * Lower first: what a group of annotations on one layer shows. Whatever
 * waits on the designer wins, then agent work, then closed.
 */
const STATE_PRIORITY: Record<AnnotationPresentationState, number> = {
	needs_input: 0,
	addressed: 1,
	proposed: 2,
	detached: 3,
	open: 4,
	acknowledged: 5,
	draft: 6,
	agent_resolved: 7,
	resolved: 8,
	dismissed: 9,
};

export const compareAnnotationStates = (
	a: AnnotationPresentationState,
	b: AnnotationPresentationState,
) => STATE_PRIORITY[a] - STATE_PRIORITY[b];

/** An agent resolved it and the designer has not accepted it yet. */
export const isAgentResolved = (
	annotation: Pick<AnnotationView, "status" | "resolvedBy">,
) =>
	annotation.status === "resolved" && annotation.resolvedBy?.role === "agent";

export const getAnnotationPresentationState = (
	annotation: Pick<AnnotationView, "status" | "resolvedBy">,
	detached: boolean,
): AnnotationPresentationState => {
	if (isAgentResolved(annotation)) return "agent_resolved";
	if (!isLiveAnnotationStatus(annotation.status)) return annotation.status;
	return detached ? "detached" : annotation.status;
};

/** Live annotations, plus closed ones when they are shown. */
export const isAnnotationShown = (
	annotation: Pick<AnnotationView, "status">,
	showResolved: boolean,
) => showResolved || isLiveAnnotationStatus(annotation.status);

export type AnnotationMarker = {
	count: number;
	state: AnnotationPresentationState;
};

/** One marker for several annotations: their count and the most urgent state. */
export const groupAnnotationMarker = (
	states: readonly AnnotationPresentationState[],
): AnnotationMarker | null => {
	let state: AnnotationPresentationState | null = null;
	for (const next of states) {
		if (state === null || compareAnnotationStates(next, state) < 0) {
			state = next;
		}
	}
	return state === null ? null : { count: states.length, state };
};

export const isSameAnnotationMarker = (
	a: AnnotationMarker | null | undefined,
	b: AnnotationMarker | null | undefined,
) => a === b || (!!a && !!b && a.count === b.count && a.state === b.state);

/**
 * "Seen by an agent 3 min ago", for an acknowledged annotation; "(session
 * idle)" once the session has been quiet for 15 minutes, counted at `now`.
 */
export const formatAcknowledgement = (
	acknowledgement: { at: string; active: boolean; lastSeenAt?: string },
	now: number,
) => {
	const at = new Date(acknowledgement.at).getTime();
	const minutes = Number.isNaN(at)
		? null
		: Math.max(0, Math.floor((now - at) / 60_000));
	const ago =
		minutes === null
			? ""
			: minutes < 1
				? " just now"
				: minutes < 60
					? ` ${minutes} min ago`
					: ` ${Math.floor(minutes / 60)} h ago`;
	return `Seen by an agent${ago}${isAcknowledgementActive(acknowledgement, now) ? "" : " (session idle)"}`;
};

/** Who wrote an entry, as the thread shows it. */
export const describeAnnotationActor = (by: AnnotationActor) =>
	by.role === "human" ? "You" : `Agent ${by.sessionId.slice(0, 8)}`;

/**
 * A target as one stable string: drafts and pins are keyed by it. A
 * component node's key leaves out the variant values it is pinned to: one
 * draft per node, whose target carries the pin (toggling it keeps the
 * text).
 */
export const annotationTargetKey = (target: AnnotationTarget) => {
	switch (target.kind) {
		case "design":
			return `design:${target.designId}`;
		case "board":
			return `board:${target.designId}/${target.boardId}`;
		case "layer":
			return `layer:${target.designId}/${target.elementId}`;
		case "componentNode":
			return `node:${target.systemId}/${target.componentId}/${target.nodePath}`;
	}
};

/** The element a pin or rail marker hangs on: a layer, or a board. */
export const annotationAnchorId = (target: AnnotationTarget) =>
	target.kind === "layer"
		? target.elementId
		: target.kind === "board"
			? target.boardId
			: target.kind === "componentNode"
				? target.nodePath
				: null;

export const describeChangeCount = (layerCount: number) =>
	`Changed ${layerCount} ${layerCount === 1 ? "layer" : "layers"}`;

/** `size: lg · tone: danger`: a pinned variant configuration, by axis. */
export const describeVariantPin = (
	variants: Readonly<Record<string, string>>,
) =>
	Object.keys(variants)
		.sort()
		.map((axis) => `${axis}: ${variants[axis]}`)
		.join(" · ");
