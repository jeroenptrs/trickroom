import type { Node, RecipeTemplateNode, TrickroomDesign } from "../types";
import {
	ANNOTATION_STATUSES,
	type Annotation,
	type AnnotationChangeRecord,
	type AnnotationEntry,
	type AnnotationRound,
	type AnnotationStatus,
	type AnnotationTarget,
	CLOSED_ANNOTATION_STATUSES,
} from "./annotations.types";

/**
 * The pure part of the annotation service: target validation, what counts
 * as work, where a target is now, whether it is detached, and the memory
 * reference it graduates with. No Node imports, so the editor (rail markers, pins, the
 * inspector) uses the same definitions as the server and MCP.
 */

/** An acknowledgement stays active this long after the session's last tool call. */
export const ACKNOWLEDGEMENT_TTL_MS = 15 * 60 * 1000;

type AcknowledgementView = {
	sessionId: string;
	at: string;
	active: boolean;
	/** Older servers left it out. */
	lastSeenAt?: string;
};

/**
 * Whether an acknowledgement is still active at `now`: the server's answer,
 * counted down from `lastSeenAt` without asking again. One the server
 * reported idle stays idle until a newer `lastSeenAt` arrives.
 */
export const isAcknowledgementActive = (
	acknowledgement: Pick<AcknowledgementView, "active" | "lastSeenAt">,
	now: number,
) => {
	if (!acknowledgement.active) return false;
	const lastSeen = acknowledgement.lastSeenAt
		? new Date(acknowledgement.lastSeenAt).getTime()
		: Number.NaN;
	return Number.isNaN(lastSeen) || now - lastSeen <= ACKNOWLEDGEMENT_TTL_MS;
};

/** When an active acknowledgement goes idle, or null when it is not counting down. */
export const acknowledgementExpiresAt = (
	acknowledgement: Pick<AcknowledgementView, "active" | "lastSeenAt">,
) => {
	if (!acknowledgement.active || !acknowledgement.lastSeenAt) return null;
	const lastSeen = new Date(acknowledgement.lastSeenAt).getTime();
	return Number.isNaN(lastSeen) ? null : lastSeen + ACKNOWLEDGEMENT_TTL_MS;
};

/**
 * Of two reads of the same acknowledgement, the one that knows more,
 * whatever order they arrived in: the later `lastSeenAt` (the session
 * called since), and on a tie the idle one (read later, past the expiry).
 * Another acknowledgement altogether takes `incoming`.
 */
export const latestAcknowledgement = <
	Acknowledgement extends AcknowledgementView,
>(
	held: Acknowledgement,
	incoming: Acknowledgement,
): Acknowledgement => {
	if (held.sessionId !== incoming.sessionId || held.at !== incoming.at) {
		return incoming;
	}
	const heldSeen = held.lastSeenAt ? Date.parse(held.lastSeenAt) : 0;
	const incomingSeen = incoming.lastSeenAt
		? Date.parse(incoming.lastSeenAt)
		: 0;
	if (incomingSeen !== heldSeen) {
		return incomingSeen > heldSeen ? incoming : held;
	}
	return held.active && !incoming.active ? incoming : held;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;

/** Whether `value` is a well-formed annotation target. */
export const isAnnotationTarget = (
	value: unknown,
): value is AnnotationTarget => {
	if (!isPlainRecord(value)) return false;
	switch (value.kind) {
		case "design":
			return isNonEmptyString(value.designId);
		case "board":
			return (
				isNonEmptyString(value.designId) && isNonEmptyString(value.boardId)
			);
		case "layer":
			return (
				isNonEmptyString(value.designId) &&
				isNonEmptyString(value.boardId) &&
				isNonEmptyString(value.elementId)
			);
		case "componentNode":
			return (
				isNonEmptyString(value.systemId) &&
				isNonEmptyString(value.componentId) &&
				typeof value.nodePath === "string" &&
				(value.variants === undefined ||
					(isPlainRecord(value.variants) &&
						Object.values(value.variants).every(
							(entry) => typeof entry === "string",
						)))
			);
		default:
			return false;
	}
};

/** Everything but resolved and dismissed. */
export const isLiveAnnotationStatus = (status: AnnotationStatus) =>
	!CLOSED_ANNOTATION_STATUSES.has(status);

/**
 * What counts as work, for every surface (MCP results and counts, the
 * editor's rail markers and badges), so they agree:
 *
 * - agent work: `open` and `acknowledged`. Sent and not yet answered;
 *   acknowledged is advisory and stays work for every session.
 * - human work: `needs_input` (a question to answer), `addressed` (a
 *   change to review) and `proposed` (a resolution to accept). Waiting on
 *   the designer, not on an agent.
 * - live: both, i.e. everything but `resolved` and `dismissed`.
 */
export const AGENT_WORK_STATUSES: readonly AnnotationStatus[] = [
	"open",
	"acknowledged",
];
export const HUMAN_WORK_STATUSES: readonly AnnotationStatus[] = [
	"needs_input",
	"addressed",
	"proposed",
];

export type AnnotationCounts = {
	/** Everything but resolved and dismissed. */
	live: number;
	/** `open` + `acknowledged`. */
	agentWork: number;
	/** `needs_input` + `addressed` + `proposed`. */
	humanWork: number;
	byStatus: Record<AnnotationStatus, number>;
	/** Live annotations whose target is gone (counted only with a design). */
	detached: number;
};

export type AnnotationCountSummary = {
	/** Every annotation counted. */
	total: AnnotationCounts;
	/** Design-level annotations only. */
	design: AnnotationCounts;
	/**
	 * Per board: board annotations plus layer annotations on it (a layer
	 * that moved boards counts where it is now), as the rail counts up.
	 */
	boards: Record<string, AnnotationCounts>;
	/** Per layer: annotations anchored to that element. */
	layers: Record<string, AnnotationCounts>;
};

export const emptyAnnotationCounts = (): AnnotationCounts => ({
	live: 0,
	agentWork: 0,
	humanWork: 0,
	byStatus: Object.fromEntries(
		ANNOTATION_STATUSES.map((status) => [status, 0]),
	) as Record<AnnotationStatus, number>,
	detached: 0,
});

const addToCounts = (
	counts: AnnotationCounts,
	status: AnnotationStatus,
	detached: boolean,
) => {
	counts.byStatus[status] += 1;
	if (!isLiveAnnotationStatus(status)) return;
	counts.live += 1;
	if (AGENT_WORK_STATUSES.includes(status)) counts.agentWork += 1;
	if (HUMAN_WORK_STATUSES.includes(status)) counts.humanWork += 1;
	if (detached) counts.detached += 1;
};

/**
 * Where design targets are now. The server answers from a design read
 * (`designTargetLocator`), the editor from its store, so a layer moved or
 * deleted locally counts where it is before it is saved.
 */
export type AnnotationTargetLocator = {
	/** The board a layer is on now; null when the layer is gone. */
	boardOfLayer: (elementId: string) => string | null;
	hasBoard: (boardId: string) => boolean;
	/**
	 * Component editor: whether a component node target still exists (its
	 * template path, and the variant values it is pinned to). Absent for a
	 * design: component node targets are then not derived.
	 */
	hasComponentNode?: (
		nodePath: string,
		variants: Readonly<Record<string, string>> | undefined,
	) => boolean;
	/**
	 * Component editor: the template's root path (it plays the board), so a
	 * detached node annotation still counts in the component's total.
	 */
	componentRootId?: () => string | null;
	/**
	 * A layer's parent now (null for a board or a missing layer). With it,
	 * the rail sums a collapsed row's descendants into its marker.
	 */
	parentOfLayer?: (elementId: string) => string | null;
};

type DesignLayerLocation = {
	node: Node;
	boardId: string;
	/** Ancestors, board first, nearest parent last. */
	ancestors: Node[];
};

export const findDesignLayer = (
	design: TrickroomDesign,
	elementId: string,
): DesignLayerLocation | null => {
	const visit = (node: Node, ancestors: Node[]): DesignLayerLocation | null => {
		if (node.id === elementId) {
			return { node, boardId: ancestors[0]?.id ?? node.id, ancestors };
		}
		if (typeof node.children === "string") return null;
		for (const child of node.children) {
			const found = visit(child, [...ancestors, node]);
			if (found) return found;
		}
		return null;
	};
	for (const board of design.boards) {
		const found = visit(board, []);
		if (found) return found;
	}
	return null;
};

/** A locator over a design read; layer lookups are indexed once. */
export const designTargetLocator = (
	design: TrickroomDesign,
): AnnotationTargetLocator => {
	let index: Map<string, string> | null = null;
	const boardIds = new Set(design.boards.map((board) => board.id));
	return {
		boardOfLayer: (elementId) => {
			if (!index) {
				index = new Map();
				const visit = (node: Node, boardId: string) => {
					index?.set(node.id, boardId);
					if (typeof node.children === "string") return;
					for (const child of node.children) visit(child, boardId);
				};
				for (const board of design.boards) visit(board, board.id);
			}
			return index.get(elementId) ?? null;
		},
		hasBoard: (boardId) => boardIds.has(boardId),
	};
};

/**
 * Whether the target no longer exists: a layer whose id is gone, a board
 * that is no longer a board. Design targets never detach while the design
 * exists. Component node targets are not derived here (undefined).
 */
export const deriveDetachedWith = (
	target: AnnotationTarget,
	locator: AnnotationTargetLocator,
): boolean | undefined => {
	switch (target.kind) {
		case "design":
			return false;
		case "board":
			return !locator.hasBoard(target.boardId);
		case "layer":
			return locator.boardOfLayer(target.elementId) === null;
		case "componentNode":
			return locator.hasComponentNode
				? !locator.hasComponentNode(target.nodePath, target.variants)
				: undefined;
	}
};

export const deriveDetached = (
	target: AnnotationTarget,
	design: TrickroomDesign,
): boolean | undefined => {
	switch (target.kind) {
		case "design":
			return false;
		case "board":
			return !design.boards.some((board) => board.id === target.boardId);
		case "layer":
			return findDesignLayer(design, target.elementId) === null;
		case "componentNode":
			return undefined;
	}
};

/** The board a design target is on now: a layer moved to another board follows it. */
export const currentBoardOfWith = (
	target: AnnotationTarget,
	locator: AnnotationTargetLocator | null | undefined,
): string | null => {
	if (target.kind === "board") return target.boardId;
	if (target.kind !== "layer") return null;
	return locator?.boardOfLayer(target.elementId) ?? target.boardId;
};

export const currentBoardOf = (
	target: AnnotationTarget,
	design: TrickroomDesign | null | undefined,
): string | null => {
	if (target.kind === "board") return target.boardId;
	if (target.kind !== "layer") return null;
	const found = design ? findDesignLayer(design, target.elementId) : null;
	return found?.boardId ?? target.boardId;
};

/**
 * Counts already-listed annotations by status, work owner, board and layer.
 * With a locator, layers follow moves and detached ones are counted.
 */
export const summarizeAnnotationCountsWith = (
	annotations: readonly Pick<Annotation, "target" | "status">[],
	locator?: AnnotationTargetLocator | null,
): AnnotationCountSummary => {
	// Keyed by element ids, which may be any safe path segment
	// (`constructor`, `__proto__`): no prototype to collide with.
	const summary: AnnotationCountSummary = {
		total: emptyAnnotationCounts(),
		design: emptyAnnotationCounts(),
		boards: Object.create(null) as Record<string, AnnotationCounts>,
		layers: Object.create(null) as Record<string, AnnotationCounts>,
	};
	for (const annotation of annotations) {
		const { target, status } = annotation;
		const detached = locator
			? deriveDetachedWith(target, locator) === true
			: false;
		addToCounts(summary.total, status, detached);
		if (target.kind === "design") {
			addToCounts(summary.design, status, detached);
			continue;
		}
		const boardId = currentBoardOfWith(target, locator);
		if (boardId) {
			summary.boards[boardId] ??= emptyAnnotationCounts();
			addToCounts(summary.boards[boardId], status, detached);
		}
		// Component nodes count per template path, as layers do per id.
		const layerId =
			target.kind === "layer"
				? target.elementId
				: target.kind === "componentNode"
					? target.nodePath
					: null;
		if (layerId !== null) {
			summary.layers[layerId] ??= emptyAnnotationCounts();
			addToCounts(summary.layers[layerId], status, detached);
		}
	}
	return summary;
};

/**
 * Counts already-listed annotations by status, work owner, board and
 * layer (component nodes by template path). With `design` (or a
 * component's template), layers follow moves and detached ones are
 * counted.
 */
export const summarizeAnnotationCounts = (
	annotations: readonly Pick<Annotation, "target" | "status">[],
	design?: TrickroomDesign | null,
	component?: ComponentAnchorTemplate | null,
): AnnotationCountSummary =>
	summarizeAnnotationCountsWith(
		annotations,
		design
			? designTargetLocator(design)
			: component
				? componentTargetLocator(component)
				: null,
	);

// ---------------------------------------------------------------------------
// Component nodes
// ---------------------------------------------------------------------------

/**
 * What component node annotations anchor to: the component's template (the
 * draft's, or the published version's when there is no draft) and its
 * variant schema. Template paths are stable identifiers (unique, never
 * renumbered: inserting or moving a node keeps every path), so an
 * annotation follows its node as a layer annotation follows its element id.
 */
export type ComponentAnchorTemplate = {
	root: RecipeTemplateNode;
	variants?: {
		axes: Record<string, { values: Record<string, unknown> }>;
	} | null;
};

type ComponentNodeLocation = {
	node: RecipeTemplateNode;
	/** Ancestors, root first, nearest parent last. */
	ancestors: RecipeTemplateNode[];
};

export const findComponentNode = (
	root: RecipeTemplateNode,
	nodePath: string,
): ComponentNodeLocation | null => {
	const visit = (
		node: RecipeTemplateNode,
		ancestors: RecipeTemplateNode[],
	): ComponentNodeLocation | null => {
		if (node.path === nodePath) return { node, ancestors };
		for (const child of node.children ?? []) {
			const found = visit(child, [...ancestors, node]);
			if (found) return found;
		}
		return null;
	};
	return visit(root, []);
};

/** Every template path of a component, root included. */
export const collectComponentNodePaths = (root: RecipeTemplateNode) => {
	const paths = new Set<string>();
	const visit = (node: RecipeTemplateNode) => {
		paths.add(node.path);
		for (const child of node.children ?? []) visit(child);
	};
	visit(root);
	return paths;
};

/**
 * Whether every pinned axis and value is still in the variant schema. A
 * pin to a value that no longer exists can never be in view again, so its
 * annotation counts as detached (re-anchor or unpin it).
 */
export const hasPinnedVariants = (
	variants: Readonly<Record<string, string>> | undefined,
	schema: ComponentAnchorTemplate["variants"],
) =>
	!variants ||
	Object.entries(variants).every(([axis, value]) => {
		const axes = schema?.axes;
		const entry = axes && Object.hasOwn(axes, axis) ? axes[axis] : undefined;
		return !!entry && Object.hasOwn(entry.values, value);
	});

/** A locator over a component's template: only component nodes resolve. */
export const componentTargetLocator = (
	template: ComponentAnchorTemplate,
): AnnotationTargetLocator => {
	let paths: Set<string> | null = null;
	return {
		boardOfLayer: () => null,
		hasBoard: () => false,
		hasComponentNode: (nodePath, variants) => {
			paths ??= collectComponentNodePaths(template.root);
			return (
				paths.has(nodePath) && hasPinnedVariants(variants, template.variants)
			);
		},
	};
};

/** Whether a component node target is gone from the template (see `componentTargetLocator`). */
export const deriveComponentDetached = (
	target: AnnotationTarget,
	template: ComponentAnchorTemplate,
): boolean | undefined =>
	target.kind === "componentNode"
		? deriveDetachedWith(target, componentTargetLocator(template))
		: undefined;

/**
 * Whether the configuration in view shows a pinned annotation: every pinned
 * axis has the pinned value in view. An unpinned annotation (no variants)
 * shows in every configuration.
 */
export const matchesVariantConfiguration = (
	pinned: Readonly<Record<string, string>> | undefined,
	inView: Readonly<Record<string, string | undefined>>,
) =>
	!pinned ||
	Object.entries(pinned).every(
		([axis, value]) => Object.hasOwn(inView, axis) && inView[axis] === value,
	);

/**
 * The variant values of a pin, without empty ones; null when nothing is
 * left (an empty pin is no pin).
 */
export const normalizePinnedVariants = (
	variants: Readonly<Record<string, string>> | undefined | null,
): Record<string, string> | null => {
	if (!variants) return null;
	const entries = Object.entries(variants)
		.filter(([axis, value]) => axis.length > 0 && value.length > 0)
		.sort(([a], [b]) => a.localeCompare(b));
	// fromEntries defines own properties: `__proto__` is just a key.
	return entries.length > 0 ? Object.fromEntries(entries) : null;
};

/**
 * Whether two change records come from one write: a write that addresses
 * several annotations stores the same `writeId` on each record. Records
 * without one (written before it existed) match nothing, not even each
 * other: equal revisions can come from two separate, identical edits.
 */
export const isSameChangeWrite = (
	a: Pick<AnnotationChangeRecord, "writeId">,
	b: Pick<AnnotationChangeRecord, "writeId">,
) => a.writeId !== undefined && a.writeId === b.writeId;

/**
 * The other annotations of a container that the write behind `change`
 * addressed too, with their change entry of it (not reverted). Reverting
 * the change from any of them undoes that whole write.
 */
export const findAnnotationsSharingChange = <
	A extends { id: string; entries: readonly AnnotationEntry[] },
>(
	annotations: Iterable<A>,
	annotationId: string,
	change: Pick<AnnotationChangeRecord, "writeId">,
): { annotation: A; entryId: string }[] => {
	const shared: { annotation: A; entryId: string }[] = [];
	for (const annotation of annotations) {
		if (annotation.id === annotationId) continue;
		const entry = annotation.entries.find(
			(candidate) =>
				candidate.kind === "change" &&
				!candidate.revertedBy &&
				isSameChangeWrite(candidate.change, change),
		);
		if (entry) shared.push({ annotation, entryId: entry.id });
	}
	return shared;
};

/**
 * The memory reference a resolved annotation graduates with:
 * `{{layer:<designId>/<elementId>}}`, `{{board:…}}`, `{{design:…}}` or
 * `{{component:<componentId>}}`.
 */
export const getAnnotationMemoryReference = (target: AnnotationTarget) => {
	switch (target.kind) {
		case "design":
			return `{{design:${target.designId}}}`;
		case "board":
			return `{{board:${target.designId}/${target.boardId}}}`;
		case "layer":
			return `{{layer:${target.designId}/${target.elementId}}}`;
		case "componentNode":
			return `{{component:${target.componentId}}}`;
	}
};

// ---------------------------------------------------------------------------
// Rounds
// ---------------------------------------------------------------------------

/**
 * How long an annotation whose round does not list it stays pending. A
 * send lists its annotations in the round file right after writing them;
 * one still unlisted after this is from a send that never finished (its
 * server stopped in between), and lands rather than being hidden for good.
 */
export const ROUND_PENDING_MS = 30_000;

/**
 * Sent in a round whose file does not list it yet: agents do not see it,
 * so they never get half a batch. False once listed, without a round, or
 * after `ROUND_PENDING_MS`.
 */
export const isPendingAnnotation = (
	annotation: Pick<Annotation, "id" | "roundId" | "createdAt">,
	roundsById: ReadonlyMap<string, Pick<AnnotationRound, "annotationIds">>,
	now: Date,
) => {
	if (!annotation.roundId) return false;
	if (
		roundsById.get(annotation.roundId)?.annotationIds.includes(annotation.id)
	) {
		return false;
	}
	return (
		now.getTime() - new Date(annotation.createdAt).getTime() < ROUND_PENDING_MS
	);
};

export type AnnotationRoundCounts = {
	/** Annotations sent in the round. */
	total: number;
	/** Resolved or dismissed (cleared ones count: only closed ones are cleared). */
	closed: number;
	agentWork: number;
	humanWork: number;
	/** Non-zero statuses of the round's annotations that still exist. */
	byStatus: Partial<Record<AnnotationStatus, number>>;
};

/** Progress of a round over its annotations as they are now. */
export const summarizeRound = (
	round: Pick<AnnotationRound, "annotationIds">,
	annotations: readonly Pick<Annotation, "id" | "status">[],
): AnnotationRoundCounts => {
	const byId = new Map(
		annotations.map((annotation) => [annotation.id, annotation]),
	);
	const counts: AnnotationRoundCounts = {
		total: round.annotationIds.length,
		closed: 0,
		agentWork: 0,
		humanWork: 0,
		byStatus: {},
	};
	for (const id of new Set(round.annotationIds)) {
		const status = byId.get(id)?.status;
		if (!status) {
			counts.closed += 1;
			continue;
		}
		counts.byStatus[status] = (counts.byStatus[status] ?? 0) + 1;
		if (!isLiveAnnotationStatus(status)) counts.closed += 1;
		if (AGENT_WORK_STATUSES.includes(status)) counts.agentWork += 1;
		if (HUMAN_WORK_STATUSES.includes(status)) counts.humanWork += 1;
	}
	return counts;
};
