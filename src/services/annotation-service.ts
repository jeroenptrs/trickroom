import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Node, TrickroomDesign } from "../types";
import { isAnnotationTarget } from "./annotation-file-schema";
import {
	type AnnotationStore,
	AnnotationStoreError,
	getAnnotationContainer,
	isSameAnnotationContainer,
	type StoredAnnotation,
} from "./annotation-store";
import {
	ANNOTATION_FILE_VERSION,
	ANNOTATION_STATUSES,
	type Annotation,
	type AnnotationActor,
	type AnnotationChangeRecord,
	type AnnotationContainer,
	type AnnotationEntry,
	type AnnotationScope,
	type AnnotationSnapshot,
	type AnnotationStatus,
	type AnnotationTarget,
	type AnnotationView,
	CLOSED_ANNOTATION_STATUSES,
} from "./annotations.types";
import type {
	DesignAfterWriteContext,
	DesignFileService,
} from "./design-file-service";
import {
	captureDesignChange,
	DesignRestoreError,
	findChangedSince,
	restoreDesignChange,
} from "./design-layer-changes";
import { calculateDesignRevision } from "./design-revision";
import type { AnnotationAnchorLookup } from "./design-transform-service";

/**
 * The annotation lifecycle (docs/proposals/agent-annotations.md#lifecycle):
 *
 * ```text
 * open ──▶ acknowledged ──▶ addressed ──▶ resolved
 *   │           │               │            ▲
 *   │           └──▶ needs_input ┘            │
 *   └──────────────────────────────▶ dismissed
 * ```
 *
 * Every write takes an explicit `by`: the HTTP layer passes the human, the
 * MCP layer the agent with its session id. What is enforced is attribution,
 * not permission: both may resolve and dismiss. Transitions are per
 * annotation, never per batch, and each one is recorded with who and when.
 */

/** An acknowledgement stays active this long after the session's last tool call. */
export const ACKNOWLEDGEMENT_TTL_MS = 15 * 60 * 1000;

export type AnnotationServiceErrorCode =
	| "INVALID_INPUT"
	| "TARGET_NOT_FOUND"
	| "WRONG_CONTAINER"
	| "INVALID_TRANSITION"
	| "NOT_REVERTIBLE"
	| "CHANGED_SINCE"
	| "REVERT_NOT_RECORDED"
	| "DESIGN_BUSY"
	| "WRONG_BRANCH";

export class AnnotationServiceError extends Error {
	readonly code: AnnotationServiceErrorCode;
	readonly details?: Record<string, unknown>;

	constructor(
		code: AnnotationServiceErrorCode,
		message: string,
		details?: Record<string, unknown>,
	) {
		super(message);
		this.name = "AnnotationServiceError";
		this.code = code;
		if (details !== undefined) this.details = details;
	}
}

export type AnnotationServiceContext = {
	store: AnnotationStore;
	/** Clock for entry, transition and expiry times. */
	now?: () => Date;
};

const nowOf = (context: AnnotationServiceContext) =>
	context.now?.() ?? new Date();

const isLive = (status: AnnotationStatus) =>
	!CLOSED_ANNOTATION_STATUSES.has(status);

/** `record[key]` only when it is the record's own entry, never inherited. */
const ownValue = <Value>(
	record: Readonly<Record<string, Value>> | undefined,
	key: string,
): Value | undefined =>
	record && Object.hasOwn(record, key) ? record[key] : undefined;

const invalidInput = (message: string, details?: Record<string, unknown>) =>
	new AnnotationServiceError("INVALID_INPUT", message, details);

const requireText = (value: unknown, label: string): string => {
	const text = typeof value === "string" ? value.trim() : "";
	if (!text) throw invalidInput(`${label} must be a non-empty string.`);
	return text;
};

const assertActor = (by: AnnotationActor) => {
	if (by.role === "agent" ? !by.sessionId : by.role !== "human") {
		throw invalidInput("by must be the human, or an agent with a session id.");
	}
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Drops every change record's revert state (`before` and `after`). */
export const pruneRevertState = (annotation: Annotation): Annotation => ({
	...annotation,
	entries: annotation.entries.map((entry) => {
		if (
			entry.kind !== "change" ||
			(!entry.change.before && !entry.change.after)
		) {
			return entry;
		}
		const { before: _before, after: _after, ...change } = entry.change;
		return { ...entry, change };
	}),
});

const withTransition = (
	annotation: Annotation,
	to: AnnotationStatus,
	by: AnnotationActor,
	at: string,
): Annotation => {
	const next: Annotation = {
		...annotation,
		status: to,
		updatedAt: at,
		transitions: [
			...annotation.transitions,
			{ from: annotation.status, to, at, by },
		],
	};
	if (to === "open") {
		// A reopened annotation is fresh work: the next agent to see it
		// acknowledges it again.
		delete next.acknowledged;
	}
	return CLOSED_ANNOTATION_STATUSES.has(to) ? pruneRevertState(next) : next;
};

const withEntry = (
	annotation: Annotation,
	entry: AnnotationEntry,
): Annotation => ({
	...annotation,
	updatedAt: entry.at,
	entries: [...annotation.entries, entry],
});

/** Who made the last transition to `resolved`, while the annotation is resolved. */
export const getResolvedBy = (
	annotation: Annotation,
): AnnotationActor | undefined => {
	if (annotation.status !== "resolved") return undefined;
	for (let index = annotation.transitions.length - 1; index >= 0; index -= 1) {
		const transition = annotation.transitions[index];
		if (transition?.to === "resolved") return transition.by;
	}
	return undefined;
};

/**
 * Resolving, with the one rule for repeats every resolve path follows: a
 * live or dismissed annotation becomes resolved; a resolved one changes
 * only when the human resolves what an agent resolved (a resolved →
 * resolved transition recording the acceptance). Any other repeat, an
 * agent resolving again in particular, is null: nothing to write.
 */
const applyResolve = (
	annotation: Annotation,
	by: AnnotationActor,
	at: string,
	summary?: string,
): Annotation | null => {
	if (
		annotation.status === "resolved" &&
		!(by.role === "human" && getResolvedBy(annotation)?.role === "agent")
	) {
		return null;
	}
	const next =
		summary === undefined
			? annotation
			: withEntry(annotation, {
					id: randomUUID(),
					kind: "resolution",
					at,
					by,
					summary,
				});
	return withTransition(next, "resolved", by, at);
};

/** Dismissing; dismissing a dismissed annotation again is null. */
const applyDismiss = (
	annotation: Annotation,
	by: AnnotationActor,
	at: string,
	reason: string,
): Annotation | null =>
	annotation.status === "dismissed"
		? null
		: withTransition(
				withEntry(annotation, {
					id: randomUUID(),
					kind: "dismissal",
					at,
					by,
					reason,
				}),
				"dismissed",
				by,
				at,
			);

/**
 * The acknowledgement with its expiry: active while the session's last
 * tool call (or the acknowledgement itself, when later or the session is
 * unknown) is within `ACKNOWLEDGEMENT_TTL_MS`. Derived on read, nothing on
 * disk changes when it expires.
 */
export const deriveAcknowledgement = (
	annotation: Annotation,
	sessionLastCallAt: Date | null,
	now: Date,
): AnnotationView["acknowledgement"] => {
	if (annotation.status !== "acknowledged" || !annotation.acknowledged) {
		return undefined;
	}
	const acknowledgedAt = new Date(annotation.acknowledged.at).getTime();
	const lastSeen = Math.max(
		Number.isNaN(acknowledgedAt) ? 0 : acknowledgedAt,
		sessionLastCallAt?.getTime() ?? 0,
	);
	return {
		...annotation.acknowledged,
		active: now.getTime() - lastSeen <= ACKNOWLEDGEMENT_TTL_MS,
	};
};

type DesignLayerLocation = {
	node: Node;
	boardId: string;
	/** Ancestors, board first, nearest parent last. */
	ancestors: Node[];
};

const findDesignLayer = (
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

const nodeName = (node: Node) => node.props["data-trickroom-name"];
const nodeComponent = (node: Node) => {
	const library = node.props["data-trickroom-library"];
	const component = node.props["data-trickroom-component"];
	return library && component ? `${library}/${component}` : undefined;
};

/**
 * Whether the target no longer exists in `design`: a layer whose id is
 * gone, a board that is no longer a board. Design targets never detach
 * while the design exists. Component node targets are not derived here
 * (undefined).
 */
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
const currentBoardOf = (
	target: AnnotationTarget,
	design: TrickroomDesign | null | undefined,
): string | null => {
	if (target.kind === "board") return target.boardId;
	if (target.kind !== "layer") return null;
	const found = design ? findDesignLayer(design, target.elementId) : null;
	return found?.boardId ?? target.boardId;
};

/**
 * Checks a design target against the design and describes it for the
 * snapshot. A layer target's board is corrected to the board it is on.
 */
export const describeDesignTarget = (
	design: TrickroomDesign,
	target: AnnotationTarget,
): {
	target: AnnotationTarget;
	snapshot: Pick<
		AnnotationSnapshot,
		"layerName" | "component" | "ancestorNames"
	>;
} => {
	switch (target.kind) {
		case "design":
			return { target, snapshot: { layerName: design.name } };
		case "board": {
			const board = design.boards.find((entry) => entry.id === target.boardId);
			if (!board) {
				throw new AnnotationServiceError(
					"TARGET_NOT_FOUND",
					`Board ${target.boardId} is not in design ${target.designId}.`,
				);
			}
			return {
				target,
				snapshot: {
					layerName: nodeName(board),
					...(nodeComponent(board) ? { component: nodeComponent(board) } : {}),
					ancestorNames: [],
				},
			};
		}
		case "layer": {
			const found = findDesignLayer(design, target.elementId);
			if (!found) {
				throw new AnnotationServiceError(
					"TARGET_NOT_FOUND",
					`Layer ${target.elementId} is not in design ${target.designId}.`,
				);
			}
			return {
				target: { ...target, boardId: found.boardId },
				snapshot: {
					layerName: nodeName(found.node),
					...(nodeComponent(found.node)
						? { component: nodeComponent(found.node) }
						: {}),
					ancestorNames: found.ancestors.map(nodeName),
				},
			};
		}
		case "componentNode":
			throw invalidInput("A component node target is not part of a design.");
	}
};

/**
 * Element ids (layers and boards) with the live annotations anchored to
 * them, for delete warnings: `applyDeleteElement` reports the annotations
 * on a deleted element and its descendants.
 */
export type AnnotationAnchorIndex = AnnotationAnchorLookup;

export const buildAnnotationAnchorIndex = (
	annotations: readonly Annotation[],
): AnnotationAnchorIndex => {
	const index = new Map<string, string[]>();
	for (const annotation of annotations) {
		if (!isLive(annotation.status)) continue;
		const { target } = annotation;
		const anchor =
			target.kind === "layer"
				? target.elementId
				: target.kind === "board"
					? target.boardId
					: null;
		if (!anchor) continue;
		const ids = index.get(anchor) ?? [];
		ids.push(annotation.id);
		index.set(anchor, ids);
	}
	return index;
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

const matchesBranch = (
	annotation: Annotation,
	scope: AnnotationScope,
	branch: AnnotationBranchFilter = "current",
) =>
	branch === "all" ||
	annotation.branch === (branch === "current" ? scope.branch : branch);

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** `current` (default): the checkout's branch. `all`: every branch. Or a branch name. */
export type AnnotationBranchFilter = "current" | "all" | (string & {});

export type ViewOptions = {
	/** The design read alongside, to derive `detached`. */
	design?: TrickroomDesign | null;
};

/** Session last-call times, read once per session per call. */
const createSessionClock = (store: AnnotationStore) => {
	const cache = new Map<string, Promise<Date | null>>();
	return (sessionId: string) => {
		let time = cache.get(sessionId);
		if (!time) {
			time = store.readSessionLastCall(sessionId);
			cache.set(sessionId, time);
		}
		return time;
	};
};

const toView = async (
	stored: StoredAnnotation,
	{
		now,
		design,
		sessionClock,
	}: {
		now: Date;
		design?: TrickroomDesign | null;
		sessionClock: (sessionId: string) => Promise<Date | null>;
	},
): Promise<AnnotationView> => {
	const { annotation, revision } = stored;
	const resolvedBy = getResolvedBy(annotation);
	const acknowledgement =
		annotation.status === "acknowledged" && annotation.acknowledged
			? deriveAcknowledgement(
					annotation,
					await sessionClock(annotation.acknowledged.sessionId),
					now,
				)
			: undefined;
	const detached = design
		? deriveDetached(annotation.target, design)
		: undefined;
	return {
		...annotation,
		revision,
		...(resolvedBy ? { resolvedBy } : {}),
		...(acknowledgement ? { acknowledgement } : {}),
		...(detached !== undefined ? { detached } : {}),
	};
};

export const viewAnnotation = (
	context: AnnotationServiceContext,
	stored: StoredAnnotation,
	options: ViewOptions = {},
) =>
	toView(stored, {
		now: nowOf(context),
		design: options.design,
		sessionClock: createSessionClock(context.store),
	});

const loadAnnotation = async (
	context: AnnotationServiceContext,
	annotationId: string,
	hint?: AnnotationContainer,
): Promise<{ container: AnnotationContainer; stored: StoredAnnotation }> => {
	const container = await context.store.locate(annotationId, hint);
	const stored = container
		? await context.store.read(container, annotationId)
		: null;
	if (!container || !stored) {
		throw new AnnotationStoreError(
			"ANNOTATION_NOT_FOUND",
			`Annotation ${annotationId} does not exist.`,
			{ annotationId },
		);
	}
	return { container, stored };
};

export const getAnnotation = async (
	context: AnnotationServiceContext,
	{
		annotationId,
		container,
		design,
	}: {
		annotationId: string;
		container?: AnnotationContainer;
		design?: TrickroomDesign | null;
	},
): Promise<AnnotationView> => {
	const { stored } = await loadAnnotation(context, annotationId, container);
	return viewAnnotation(context, stored, { design });
};

export type ListAnnotationsInput = {
	container: AnnotationContainer;
	/** The checkout reading; `branch` filters against it. */
	scope: AnnotationScope;
	branch?: AnnotationBranchFilter;
	statuses?: readonly AnnotationStatus[];
	/** Board and layer annotations on this board (a moved layer counts where it is now). */
	boardId?: string;
	/** Layer annotations on this element. */
	elementId?: string;
	/** The design read alongside, to derive `detached` and current boards. */
	design?: TrickroomDesign | null;
};

export const listAnnotations = async (
	context: AnnotationServiceContext,
	input: ListAnnotationsInput,
) => {
	const { annotations, problems } = await context.store.list(input.container);
	const statuses = input.statuses ? new Set(input.statuses) : null;
	const now = nowOf(context);
	const sessionClock = createSessionClock(context.store);
	const selected = annotations.filter(({ annotation }) => {
		if (!matchesBranch(annotation, input.scope, input.branch)) return false;
		if (statuses && !statuses.has(annotation.status)) return false;
		if (
			input.boardId !== undefined &&
			currentBoardOf(annotation.target, input.design) !== input.boardId
		) {
			return false;
		}
		if (
			input.elementId !== undefined &&
			!(
				annotation.target.kind === "layer" &&
				annotation.target.elementId === input.elementId
			)
		) {
			return false;
		}
		return true;
	});
	return {
		annotations: await Promise.all(
			selected.map((stored) =>
				toView(stored, { now, design: input.design, sessionClock }),
			),
		),
		problems,
	};
};

/**
 * What counts as work, for every surface (MCP results and counts, the
 * editor's rail markers and badges), so they agree:
 *
 * - agent work: `open` and `acknowledged`. Sent and not yet answered;
 *   acknowledged is advisory and stays work for every session.
 * - human work: `needs_input` (a question to answer) and `addressed` (a
 *   change to review). Waiting on the designer, not on an agent.
 * - live: both, i.e. everything but `resolved` and `dismissed`.
 */
export const AGENT_WORK_STATUSES: readonly AnnotationStatus[] = [
	"open",
	"acknowledged",
];
export const HUMAN_WORK_STATUSES: readonly AnnotationStatus[] = [
	"needs_input",
	"addressed",
];

export type AnnotationCounts = {
	/** Everything but resolved and dismissed. */
	live: number;
	/** `open` + `acknowledged`. */
	agentWork: number;
	/** `needs_input` + `addressed`. */
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

const emptyCounts = (): AnnotationCounts => ({
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
	if (!isLive(status)) return;
	counts.live += 1;
	if (AGENT_WORK_STATUSES.includes(status)) counts.agentWork += 1;
	if (HUMAN_WORK_STATUSES.includes(status)) counts.humanWork += 1;
	if (detached) counts.detached += 1;
};

/**
 * Counts already-listed annotations by status, work owner, board and
 * layer. With `design`, layers follow moves and detached ones are counted.
 */
export const summarizeAnnotationCounts = (
	annotations: readonly Annotation[],
	design?: TrickroomDesign | null,
): AnnotationCountSummary => {
	// Keyed by element ids, which may be any safe path segment
	// (`constructor`, `__proto__`): no prototype to collide with.
	const summary: AnnotationCountSummary = {
		total: emptyCounts(),
		design: emptyCounts(),
		boards: Object.create(null) as Record<string, AnnotationCounts>,
		layers: Object.create(null) as Record<string, AnnotationCounts>,
	};
	for (const annotation of annotations) {
		const { target, status } = annotation;
		const detached = design ? deriveDetached(target, design) === true : false;
		addToCounts(summary.total, status, detached);
		if (target.kind === "design") {
			addToCounts(summary.design, status, detached);
			continue;
		}
		const boardId = currentBoardOf(target, design);
		if (boardId) {
			summary.boards[boardId] ??= emptyCounts();
			addToCounts(summary.boards[boardId], status, detached);
		}
		if (target.kind === "layer") {
			summary.layers[target.elementId] ??= emptyCounts();
			addToCounts(summary.layers[target.elementId], status, detached);
		}
	}
	return summary;
};

/**
 * Counts of a design's (or component's) annotations on the checkout's
 * branch (or `branch`), the one definition of open work WP3 and WP4 use.
 */
export const countAnnotations = async (
	context: AnnotationServiceContext,
	input: {
		container: AnnotationContainer;
		scope: AnnotationScope;
		branch?: AnnotationBranchFilter;
		design?: TrickroomDesign | null;
	},
): Promise<AnnotationCountSummary> => {
	const { annotations } = await context.store.list(input.container);
	return summarizeAnnotationCounts(
		annotations
			.map(({ annotation }) => annotation)
			.filter((annotation) =>
				matchesBranch(annotation, input.scope, input.branch),
			),
		input.design,
	);
};

/** Live annotations of a design on the checkout's branch, by anchored element. */
export const getAnnotationAnchorIndex = async (
	context: AnnotationServiceContext,
	{ designId, scope }: { designId: string; scope: AnnotationScope },
): Promise<AnnotationAnchorIndex> => {
	const { annotations } = await context.store.list({
		kind: "design",
		designId,
	});
	return buildAnnotationAnchorIndex(
		annotations
			.map(({ annotation }) => annotation)
			.filter((annotation) => matchesBranch(annotation, scope)),
	);
};

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type AnnotationWriteResult = {
	annotation: AnnotationView;
	/** False when the call changed nothing (for example resolving a resolved one). */
	written: boolean;
};

const finishWrite = async (
	context: AnnotationServiceContext,
	outcome: { stored: StoredAnnotation; written: boolean },
	options: ViewOptions = {},
): Promise<AnnotationWriteResult> => ({
	annotation: await viewAnnotation(context, outcome.stored, options),
	written: outcome.written,
});

export type CreateAnnotationInput = {
	target: AnnotationTarget;
	body: string;
	by: AnnotationActor;
	/** The checkout it is created from; `branch` is required. */
	scope: AnnotationScope;
	/** What the designer was looking at (stage mode, responsive width, and for component nodes their names). */
	snapshot?: Omit<AnnotationSnapshot, "branch" | "worktreePath">;
	/**
	 * The design of a design target, read by the caller: the target must
	 * exist in it, and it fills the snapshot's names and revision.
	 */
	design?: { design: TrickroomDesign; revision: string };
};

/** A new annotation, `open`, with the remark as its first entry. */
export const createAnnotation = async (
	context: AnnotationServiceContext,
	input: CreateAnnotationInput,
): Promise<AnnotationWriteResult> => {
	assertActor(input.by);
	if (!isAnnotationTarget(input.target)) {
		throw invalidInput("target is not a valid annotation target.");
	}
	const body = requireText(input.body, "body");
	const branch =
		typeof input.scope?.branch === "string" ? input.scope.branch.trim() : "";
	if (!branch)
		throw invalidInput("An annotation needs the branch it is made on.");

	let target = input.target;
	let described: Partial<AnnotationSnapshot> = {};
	if (target.kind !== "componentNode") {
		if (!input.design) {
			throw invalidInput("A design target needs the design it is made on.");
		}
		const result = describeDesignTarget(input.design.design, target);
		target = result.target;
		described = {
			...result.snapshot,
			designRevision: input.design.revision,
		};
	}
	const at = nowOf(context).toISOString();
	const scope: AnnotationScope = {
		branch,
		worktreePath: input.scope.worktreePath,
	};
	const annotation: Annotation = {
		version: ANNOTATION_FILE_VERSION,
		id: randomUUID(),
		projectId: context.store.projectId,
		target,
		branch,
		worktreePath: scope.worktreePath,
		snapshot: {
			...(input.snapshot ?? {}),
			...described,
			...scope,
		},
		status: "open",
		createdAt: at,
		updatedAt: at,
		entries: [
			input.by.role === "human"
				? { id: randomUUID(), kind: "remark", at, by: input.by, body }
				: { id: randomUUID(), kind: "reply", at, by: input.by, body },
		],
		transitions: [{ from: null, to: "open", at, by: input.by }],
	};
	const stored = await context.store.create(annotation);
	return finishWrite(
		context,
		{ stored, written: true },
		{ design: input.design?.design },
	);
};

type AnnotationRef = {
	annotationId: string;
	/** Where it is, when the caller knows; otherwise it is looked up. */
	container?: AnnotationContainer;
	/** Refuse the write unless the annotation is still at this revision. */
	expectedRevision?: string;
	/**
	 * Refuse the write (`WRONG_BRANCH`) unless the annotation is on this
	 * branch, checked under its lock: a caller acting for one checkout (an
	 * MCP session) cannot write another branch's annotations. Absent: not
	 * checked.
	 */
	branch?: string;
};

/** `WRONG_BRANCH`: the annotation is on another branch than the caller's checkout. */
export const wrongBranchError = (annotation: Annotation, branch: string) =>
	new AnnotationServiceError(
		"WRONG_BRANCH",
		`Annotation ${annotation.id} is on branch "${annotation.branch}", not this checkout's branch "${branch}". It is not this checkout's work: list other branches' annotations with branch: "all", and ask the designer to bring it here with "Move here" in the editor.`,
		{
			annotationId: annotation.id,
			branch: annotation.branch,
			currentBranch: branch,
		},
	);

const assertBranch = (annotation: Annotation, branch: string | undefined) => {
	if (branch !== undefined && annotation.branch !== branch) {
		throw wrongBranchError(annotation, branch);
	}
};

/** Read-modify-write of one annotation found by id. */
const updateAnnotation = async (
	context: AnnotationServiceContext,
	ref: AnnotationRef,
	mutate: (annotation: Annotation, at: string) => Annotation | null,
) => {
	const container = await context.store.locate(ref.annotationId, ref.container);
	if (!container) {
		throw new AnnotationStoreError(
			"ANNOTATION_NOT_FOUND",
			`Annotation ${ref.annotationId} does not exist.`,
			{ annotationId: ref.annotationId },
		);
	}
	return context.store.update(
		container,
		ref.annotationId,
		({ annotation }) => {
			assertBranch(annotation, ref.branch);
			return {
				annotation: mutate(annotation, nowOf(context).toISOString()),
				result: undefined,
			};
		},
		{ expectedRevision: ref.expectedRevision },
	);
};

export type ReplyInput = AnnotationRef & {
	by: AnnotationActor;
	/** Text: a human remark or an agent reply. */
	body?: string;
	/** An agent's question: the annotation needs input. */
	question?: string;
	/** Not doing this. */
	dismiss?: { reason: string };
	/** Done. */
	resolve?: { summary?: string };
};

/**
 * A reply without a design write. A human remark reopens an addressed,
 * needs-input, resolved or dismissed annotation; an agent reply on an open
 * one acknowledges it; a question sets `needs_input` (agents only);
 * `dismiss` and `resolve` close it. At most one of question, dismiss and
 * resolve per call.
 */
export const replyToAnnotation = async (
	context: AnnotationServiceContext,
	input: ReplyInput,
): Promise<AnnotationWriteResult> => {
	assertActor(input.by);
	const body =
		input.body === undefined ? undefined : requireText(input.body, "body");
	const question =
		input.question === undefined
			? undefined
			: requireText(input.question, "question");
	const reason =
		input.dismiss === undefined
			? undefined
			: requireText(input.dismiss?.reason, "dismiss.reason");
	const summary =
		input.resolve?.summary === undefined
			? undefined
			: requireText(input.resolve.summary, "resolve.summary");
	const actions = [question, input.dismiss, input.resolve].filter(
		(action) => action !== undefined,
	);
	if (actions.length > 1) {
		throw invalidInput("Pass at most one of question, dismiss and resolve.");
	}
	if (body === undefined && actions.length === 0) {
		throw invalidInput("Pass a body, a question, dismiss or resolve.");
	}
	if (question !== undefined && input.by.role !== "agent") {
		throw invalidInput(
			"Questions are asked by agents; a designer replies with a body.",
		);
	}
	const { by } = input;

	const outcome = await updateAnnotation(context, input, (annotation, at) => {
		let next = annotation;
		if (body !== undefined) {
			next = withEntry(
				next,
				by.role === "human"
					? { id: randomUUID(), kind: "remark", at, by, body }
					: { id: randomUUID(), kind: "reply", at, by, body },
			);
		}
		if (question !== undefined) {
			next = withEntry(next, {
				id: randomUUID(),
				kind: "question",
				at,
				by,
				body: question,
			});
			return withTransition(next, "needs_input", by, at);
		}
		// A repeated dismiss or resolve keeps only the text, if any.
		const unchanged = next === annotation ? null : next;
		if (reason !== undefined) {
			return applyDismiss(next, by, at, reason) ?? unchanged;
		}
		if (input.resolve) {
			return applyResolve(next, by, at, summary) ?? unchanged;
		}
		if (by.role === "human") {
			// The designer answering, or adding to, work the agent considered
			// done or blocked on them: it is open again.
			return next.status === "open" || next.status === "acknowledged"
				? next
				: withTransition(next, "open", by, at);
		}
		if (next.status === "open") {
			// An agent replying has seen it.
			return {
				...withTransition(next, "acknowledged", by, at),
				acknowledged: { sessionId: by.sessionId, at },
			};
		}
		return next;
	});
	return finishWrite(context, outcome);
};

export type TransitionInput = AnnotationRef & {
	by: AnnotationActor;
	to: "open" | "resolved" | "dismissed";
	/** Required for `dismissed`. */
	reason?: string;
	/** Optional for `resolved`. */
	summary?: string;
};

/**
 * Resolve, dismiss or reopen. Resolving an annotation an agent resolved,
 * as the human, records the human's acceptance (a resolved → resolved
 * transition); other repeats change nothing.
 */
export const transitionAnnotation = async (
	context: AnnotationServiceContext,
	input: TransitionInput,
): Promise<AnnotationWriteResult> => {
	assertActor(input.by);
	const { by } = input;
	switch (input.to) {
		case "resolved": {
			const summary =
				input.summary === undefined
					? undefined
					: requireText(input.summary, "summary");
			const outcome = await updateAnnotation(context, input, (annotation, at) =>
				applyResolve(annotation, by, at, summary),
			);
			return finishWrite(context, outcome);
		}
		case "dismissed": {
			const reason = requireText(input.reason, "reason");
			const outcome = await updateAnnotation(context, input, (annotation, at) =>
				applyDismiss(annotation, by, at, reason),
			);
			return finishWrite(context, outcome);
		}
		case "open": {
			const outcome = await updateAnnotation(
				context,
				input,
				(annotation, at) =>
					annotation.status === "open"
						? null
						: withTransition(annotation, "open", by, at),
			);
			return finishWrite(context, outcome);
		}
		default:
			throw new AnnotationServiceError(
				"INVALID_TRANSITION",
				`Cannot move an annotation to ${String((input as { to: unknown }).to)} directly: acknowledged, addressed and needs_input follow from what agents do.`,
			);
	}
};

/**
 * Marks an annotation seen by an agent session: `open` becomes
 * `acknowledged`; an acknowledged one gets this session and time; every
 * other status is left alone (an addressed, needs-input or closed
 * annotation never goes back to acknowledged).
 *
 * With `branch`, an annotation on another branch is left alone. With
 * `keepActive`, an acknowledgement by another session that is still active
 * is left alone too (and one by this session is not re-stamped). Both are
 * checked under the annotation's lock, so two sessions acknowledging at
 * once, or a move to another branch in between, cannot be overwritten. The
 * result is the annotation as it is now; `written` says whether this call
 * acknowledged it (moved it from `open`, or took over an expired
 * acknowledgement), and `previousStatus` what was stored before it. `onlyIf` is checked under the lock too, on the
 * annotation as stored before this call: a caller acknowledges only what
 * it is about to show.
 */
export const acknowledgeAnnotation = async (
	context: AnnotationServiceContext,
	input: Omit<AnnotationRef, "expectedRevision"> & {
		sessionId: string;
		branch?: string;
		keepActive?: boolean;
		onlyIf?: (annotation: Annotation) => boolean;
	},
): Promise<
	AnnotationWriteResult & {
		/** The status as stored before this call (under the lock). */
		previousStatus: AnnotationStatus;
	}
> => {
	const sessionId = requireText(input.sessionId, "sessionId");
	const by: AnnotationActor = { role: "agent", sessionId };
	const container = await context.store.locate(
		input.annotationId,
		input.container,
	);
	if (!container) {
		throw new AnnotationStoreError(
			"ANNOTATION_NOT_FOUND",
			`Annotation ${input.annotationId} does not exist.`,
			{ annotationId: input.annotationId },
		);
	}
	const outcome = await context.store.update(
		container,
		input.annotationId,
		async ({ annotation }) => {
			const at = nowOf(context).toISOString();
			const unchanged = { annotation: null, result: annotation.status };
			if (input.branch !== undefined && annotation.branch !== input.branch) {
				return unchanged;
			}
			if (input.onlyIf && !input.onlyIf(annotation)) return unchanged;
			if (annotation.status === "open") {
				return {
					annotation: {
						...withTransition(annotation, "acknowledged", by, at),
						acknowledged: { sessionId, at },
					},
					result: annotation.status,
				};
			}
			if (annotation.status !== "acknowledged") return unchanged;
			if (input.keepActive && annotation.acknowledged) {
				if (annotation.acknowledged.sessionId === sessionId) return unchanged;
				const current = deriveAcknowledgement(
					annotation,
					await context.store.readSessionLastCall(
						annotation.acknowledged.sessionId,
					),
					nowOf(context),
				);
				if (current?.active) return unchanged;
			}
			return {
				annotation: { ...annotation, acknowledged: { sessionId, at } },
				result: annotation.status,
			};
		},
	);
	return {
		...(await finishWrite(context, outcome)),
		previousStatus: outcome.result,
	};
};

/** Records an MCP session's tool call: the clock acknowledgement expiry reads. */
export const recordSessionCall = (
	context: AnnotationServiceContext,
	sessionId: string,
) =>
	context.store.writeSession(
		requireText(sessionId, "sessionId"),
		nowOf(context),
	);

export type BulkResolveInput = {
	container: AnnotationContainer;
	by: AnnotationActor;
	/** Resolve exactly these (any live status, or agent-resolved ones to accept them). */
	annotationIds?: readonly string[];
	/** Otherwise: the annotations of the checkout's branch with these statuses (default `addressed`). */
	scope?: AnnotationScope;
	statuses?: readonly AnnotationStatus[];
	boardId?: string;
	design?: TrickroomDesign | null;
	/** Per annotation: skip it unless it is still at this revision. */
	expectedRevisions?: Readonly<Record<string, string>>;
};

/** An annotation a bulk write left alone, and why. */
export type BulkSkip = {
	annotationId: string;
	/** `STATUS_CHANGED`, `ALREADY_RESOLVED`, or an `AnnotationStoreError` code. */
	code: string;
	reason: string;
};

/**
 * "Resolve all addressed on this board", and with `statuses: ["resolved"]`
 * as the human, "accept all agent-resolved". Each annotation is its own
 * write; one that changed status meanwhile is skipped.
 */
export const resolveAnnotations = async (
	context: AnnotationServiceContext,
	input: BulkResolveInput,
) => {
	assertActor(input.by);
	const { by } = input;
	let ids: string[];
	let statuses: Set<AnnotationStatus> | null = null;
	if (input.annotationIds) {
		ids = [...input.annotationIds];
	} else {
		if (!input.scope)
			throw invalidInput("Pass annotationIds or the checkout scope.");
		statuses = new Set(input.statuses ?? ["addressed"]);
		const listed = await listAnnotations(context, {
			container: input.container,
			scope: input.scope,
			statuses: [...statuses],
			...(input.boardId !== undefined ? { boardId: input.boardId } : {}),
			design: input.design,
		});
		ids = listed.annotations.map((annotation) => annotation.id);
	}

	const resolved: AnnotationView[] = [];
	const skipped: BulkSkip[] = [];
	for (const annotationId of ids) {
		try {
			const outcome = await context.store.update(
				input.container,
				annotationId,
				({
					annotation,
				}): {
					annotation: Annotation | null;
					result: BulkSkip | null;
				} => {
					if (statuses && !statuses.has(annotation.status)) {
						return {
							annotation: null,
							result: {
								annotationId,
								code: "STATUS_CHANGED",
								reason: `status is ${annotation.status}`,
							},
						};
					}
					const next = applyResolve(
						annotation,
						by,
						nowOf(context).toISOString(),
					);
					return next
						? { annotation: next, result: null }
						: {
								annotation: null,
								result: {
									annotationId,
									code: "ALREADY_RESOLVED",
									reason: "already resolved",
								},
							};
				},
				{ expectedRevision: ownValue(input.expectedRevisions, annotationId) },
			);
			if (outcome.result) {
				skipped.push(outcome.result);
			} else {
				resolved.push(await viewAnnotation(context, outcome.stored));
			}
		} catch (error) {
			if (error instanceof AnnotationStoreError) {
				skipped.push({ annotationId, code: error.code, reason: error.message });
				continue;
			}
			throw error;
		}
	}
	return { resolved, skipped };
};

export type ReanchorInput = AnnotationRef & {
	by: AnnotationActor;
	/**
	 * A reply added in the same write, after the re-anchor entry (a human
	 * remark or an agent reply); the status is unchanged either way.
	 */
	body?: string;
	/** The new target, in the same design (or component). */
	target: AnnotationTarget;
	/** The design, for design targets: the new target must exist in it. */
	design?: { design: TrickroomDesign; revision: string };
	snapshot?: Omit<AnnotationSnapshot, "branch" | "worktreePath">;
};

/**
 * Moves an annotation to another target in the same design or component:
 * steps that mint ids never move annotations, so the designer or agent
 * re-anchors explicitly. The snapshot describes the new target; the
 * status is unchanged.
 */
export const reanchorAnnotation = async (
	context: AnnotationServiceContext,
	input: ReanchorInput,
): Promise<AnnotationWriteResult> => {
	assertActor(input.by);
	if (!isAnnotationTarget(input.target)) {
		throw invalidInput("target is not a valid annotation target.");
	}
	const body =
		input.body === undefined ? undefined : requireText(input.body, "body");
	let target = input.target;
	let described: Partial<AnnotationSnapshot> = {};
	if (target.kind !== "componentNode") {
		if (!input.design) {
			throw invalidInput("A design target needs the design it is made on.");
		}
		const result = describeDesignTarget(input.design.design, target);
		target = result.target;
		described = { ...result.snapshot, designRevision: input.design.revision };
	}
	const { by } = input;
	const outcome = await updateAnnotation(context, input, (annotation, at) => {
		if (
			!isSameAnnotationContainer(
				getAnnotationContainer(annotation.target),
				getAnnotationContainer(target),
			)
		) {
			throw new AnnotationServiceError(
				"WRONG_CONTAINER",
				"An annotation can only be re-anchored within its own design or component.",
			);
		}
		const reanchored = withEntry(annotation, {
			id: randomUUID(),
			kind: "reanchor",
			at,
			by,
			from: annotation.target,
			to: target,
		});
		const next =
			body === undefined
				? reanchored
				: withEntry(
						reanchored,
						by.role === "human"
							? { id: randomUUID(), kind: "remark", at, by, body }
							: { id: randomUUID(), kind: "reply", at, by, body },
					);
		const {
			layerName: _layerName,
			component: _component,
			ancestorNames: _ancestorNames,
			...kept
		} = annotation.snapshot;
		return {
			...next,
			target,
			snapshot: { ...kept, ...(input.snapshot ?? {}), ...described },
		};
	});
	return finishWrite(context, outcome, { design: input.design?.design });
};

/** Moves an annotation to the checkout's branch (after a merge, say). */
export const moveAnnotationToBranch = async (
	context: AnnotationServiceContext,
	input: AnnotationRef & { by: AnnotationActor; scope: AnnotationScope },
): Promise<AnnotationWriteResult> => {
	assertActor(input.by);
	const branch = requireText(input.scope.branch, "scope.branch");
	const to: AnnotationScope = {
		branch,
		worktreePath: input.scope.worktreePath,
	};
	const outcome = await updateAnnotation(context, input, (annotation, at) =>
		annotation.branch === to.branch &&
		annotation.worktreePath === to.worktreePath
			? null
			: {
					...withEntry(annotation, {
						id: randomUUID(),
						kind: "move",
						at,
						by: input.by,
						from: {
							branch: annotation.branch,
							worktreePath: annotation.worktreePath,
						},
						to,
					}),
					...to,
				},
	);
	return finishWrite(context, outcome);
};

/**
 * Deletes the resolved and dismissed annotations of a container on the
 * checkout's branch (optionally one board's). Each is re-checked under its
 * lock and deleted only while closed and unchanged since it was listed (or
 * since `expectedRevisions[id]`, when the caller passes what it saw), so
 * one reopened or replied to meanwhile stays, reported in `skipped`.
 */
export const clearAnnotations = async (
	context: AnnotationServiceContext,
	input: {
		container: AnnotationContainer;
		scope: AnnotationScope;
		branch?: AnnotationBranchFilter;
		boardId?: string;
		design?: TrickroomDesign | null;
		expectedRevisions?: Readonly<Record<string, string>>;
	},
) => {
	const listed = await listAnnotations(context, {
		container: input.container,
		scope: input.scope,
		branch: input.branch,
		statuses: [...CLOSED_ANNOTATION_STATUSES],
		...(input.boardId !== undefined ? { boardId: input.boardId } : {}),
		design: input.design,
	});
	const cleared: string[] = [];
	const skipped: BulkSkip[] = [];
	for (const annotation of listed.annotations) {
		const expected =
			ownValue(input.expectedRevisions, annotation.id) ?? annotation.revision;
		let reason: BulkSkip | null = null;
		const removed = await context.store.remove(
			input.container,
			annotation.id,
			(current) => {
				if (isLive(current.annotation.status)) {
					reason = {
						annotationId: annotation.id,
						code: "STATUS_CHANGED",
						reason: `status is ${current.annotation.status}`,
					};
					return false;
				}
				if (current.revision !== expected) {
					reason = {
						annotationId: annotation.id,
						code: "ANNOTATION_REVISION_MISMATCH",
						reason: "changed since it was read",
					};
					return false;
				}
				return true;
			},
		);
		if (removed) cleared.push(annotation.id);
		else if (reason) skipped.push(reason);
	}
	return { cleared, skipped };
};

// ---------------------------------------------------------------------------
// Change records
// ---------------------------------------------------------------------------

/** One annotation a design write addresses, with the agent's reply. */
export type AnnotationAddress = {
	annotationId: string;
	reply?: string;
	/**
	 * The entries the agent had seen when it made the change. A designer
	 * remark that is not among them (sent while the agent worked) is
	 * unanswered: the change is recorded, but the annotation stays agent
	 * work instead of becoming addressed. Absent: not checked.
	 */
	knownEntryIds?: readonly string[];
};

export type AddressProblem = {
	annotationId: string;
	code:
		| "ANNOTATION_NOT_FOUND"
		| "WRONG_DESIGN"
		| "ANNOTATION_CLOSED"
		| "WRONG_BRANCH";
	message: string;
	/** WRONG_BRANCH: the annotation's branch. */
	branch?: string;
};

/**
 * Checks, before a design write, that every addressed annotation exists,
 * belongs to the design and is live. `design_apply` refuses the write with
 * these as step errors.
 */
export const validateAddresses = async (
	context: AnnotationServiceContext,
	{
		designId,
		addresses,
		branch,
	}: {
		designId: string;
		addresses: readonly AnnotationAddress[];
		/** Also refuse annotations on another branch (`WRONG_BRANCH`). */
		branch?: string;
	},
): Promise<AddressProblem[]> => {
	const problems: AddressProblem[] = [];
	const container: AnnotationContainer = { kind: "design", designId };
	for (const { annotationId } of addresses) {
		const stored = await context.store
			.read(container, annotationId)
			.catch(() => null);
		if (!stored) {
			const elsewhere = await context.store
				.locate(annotationId)
				.catch(() => null);
			problems.push(
				elsewhere
					? {
							annotationId,
							code: "WRONG_DESIGN",
							message: `Annotation ${annotationId} is not on design ${designId}.`,
						}
					: {
							annotationId,
							code: "ANNOTATION_NOT_FOUND",
							message: `Annotation ${annotationId} does not exist.`,
						},
			);
			continue;
		}
		if (branch !== undefined && stored.annotation.branch !== branch) {
			problems.push({
				annotationId,
				code: "WRONG_BRANCH",
				message: wrongBranchError(stored.annotation, branch).message,
				branch: stored.annotation.branch,
			});
			continue;
		}
		if (!isLive(stored.annotation.status)) {
			problems.push({
				annotationId,
				code: "ANNOTATION_CLOSED",
				message: `Annotation ${annotationId} is ${stored.annotation.status}.`,
			});
		}
	}
	return problems;
};

export type RecordChangeResult =
	| {
			annotationId: string;
			status: "recorded";
			entryId: string;
			annotation: AnnotationView;
			/**
			 * Designer remarks the agent had not seen (see
			 * `AnnotationAddress.knownEntryIds`): the annotation was left as
			 * agent work. Absent when there are none.
			 */
			unseenRemarkIds?: string[];
	  }
	| { annotationId: string; status: "failed"; code: string; message: string };

/**
 * Appends a change entry to each addressed annotation and moves live ones
 * to `addressed`. A closed one (resolved or dismissed after the write was
 * validated) still gets the entry, without revert state, and keeps its
 * status. Each annotation is its own write; failures are reported per
 * annotation and never thrown, since the design write has happened.
 */
export const recordChange = async (
	context: AnnotationServiceContext,
	{
		designId,
		addresses,
		change,
		by,
		branch,
	}: {
		designId: string;
		addresses: readonly AnnotationAddress[];
		change: AnnotationChangeRecord;
		by: AnnotationActor;
		/**
		 * Record only on annotations on this branch, checked under each one's
		 * lock; others fail with `WRONG_BRANCH`. Absent: not checked.
		 */
		branch?: string;
	},
): Promise<RecordChangeResult[]> => {
	assertActor(by);
	const container: AnnotationContainer = { kind: "design", designId };
	const results: RecordChangeResult[] = [];
	for (const { annotationId, reply, knownEntryIds } of addresses) {
		const entryId = randomUUID();
		try {
			const outcome = await context.store.update(
				container,
				annotationId,
				({ annotation }) => {
					assertBranch(annotation, branch);
					const at = nowOf(context).toISOString();
					const live = isLive(annotation.status);
					const known = knownEntryIds ? new Set(knownEntryIds) : null;
					const unseenRemarkIds = known
						? annotation.entries
								.filter(
									(entry) =>
										entry.kind === "remark" &&
										entry.by.role === "human" &&
										!known.has(entry.id),
								)
								.map((entry) => entry.id)
						: [];
					const { before, after, ...record } = change;
					const next = withEntry(annotation, {
						id: entryId,
						kind: "change",
						at,
						by,
						...(reply?.trim() ? { body: reply.trim() } : {}),
						change:
							live && before && after ? { ...record, before, after } : record,
					});
					return {
						// A remark the agent has not seen is still unanswered: the
						// annotation stays agent work (as a designer reply on an
						// addressed one reopens it).
						annotation:
							live && unseenRemarkIds.length === 0
								? withTransition(next, "addressed", by, at)
								: next,
						result: unseenRemarkIds,
					};
				},
			);
			results.push({
				annotationId,
				status: "recorded",
				entryId,
				annotation: await viewAnnotation(context, outcome.stored),
				...(outcome.result.length > 0
					? { unseenRemarkIds: outcome.result }
					: {}),
			});
		} catch (error) {
			results.push({
				annotationId,
				status: "failed",
				code:
					error instanceof AnnotationStoreError ||
					error instanceof AnnotationServiceError
						? error.code
						: "ANNOTATION_WRITE_FAILED",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return results;
};

/**
 * The after-write step for a design write that addresses annotations
 * (`design_apply` with `addresses`): pass `afterWrite` to
 * `DesignFileService.updateDesignFile`. It runs under the design lock once
 * the write is stored, captures what the write changed against the stored
 * design before it, and records it on every addressed annotation. A write
 * that fails never runs it, so nothing is recorded. `results()` reports per
 * annotation afterwards (empty when the write did not happen).
 */
export const createAddressesRecorder = (
	context: AnnotationServiceContext,
	{
		designId,
		addresses,
		by,
		operations,
		summary,
		branch,
	}: {
		designId: string;
		addresses: readonly AnnotationAddress[];
		by: AnnotationActor;
		operations: { operation: string; summary: string }[];
		summary: string;
		/** See `recordChange`. */
		branch?: string;
	},
) => {
	let results: RecordChangeResult[] = [];
	return {
		afterWrite: async ({ before, write }: DesignAfterWriteContext) => {
			const capture = before ? captureDesignChange(before, write.design) : null;
			const change: AnnotationChangeRecord = {
				revisionBefore: before
					? calculateDesignRevision(before)
					: write.revision,
				revisionAfter: write.revision,
				boards: capture?.boards ?? [],
				layerIds: capture?.layerIds ?? [],
				operations,
				summary,
				...(capture ? { before: capture.before, after: capture.after } : {}),
			};
			results = await recordChange(context, {
				designId,
				addresses,
				change,
				by,
				...(branch !== undefined ? { branch } : {}),
			});
		},
		results: () => results,
	};
};

const maxRevertAttempts = 3;

/**
 * Undoes a change record: restores the touched layers' before state while
 * every one of them still has the state the change left it in, else fails
 * with `CHANGED_SINCE` listing the layers that moved on.
 *
 * The design write is revision-checked per board. Under the design lock,
 * and before the design changes, it takes the annotation's lock and checks
 * that the change is still revertible (not reverted, resolved, dismissed or
 * cleared meanwhile, and the annotation still at `expectedRevision` when
 * given); it holds that lock through the design write and the annotation
 * write. The change loses its revert state, a `revert` entry is added and
 * an addressed annotation is open again. When the design was written but
 * the annotation could not be, it fails with `REVERT_NOT_RECORDED` naming
 * the design revision.
 */
export const revertChange = async (
	context: AnnotationServiceContext,
	input: {
		annotationId: string;
		entryId: string;
		by: AnnotationActor;
		designService: DesignFileService;
		container?: AnnotationContainer;
		/** Refuse unless the annotation is still at this revision. */
		expectedRevision?: string;
	},
) => {
	assertActor(input.by);
	const { by } = input;
	const { container, stored } = await loadAnnotation(
		context,
		input.annotationId,
		input.container,
	);
	if (container.kind !== "design") {
		throw new AnnotationServiceError(
			"NOT_REVERTIBLE",
			"Only design changes can be reverted here.",
		);
	}
	const findChange = (annotation: Annotation) => {
		const entry = annotation.entries.find(
			(candidate) => candidate.id === input.entryId,
		);
		if (!entry || entry.kind !== "change") {
			throw new AnnotationServiceError(
				"NOT_REVERTIBLE",
				`Entry ${input.entryId} is not a change record of annotation ${input.annotationId}.`,
			);
		}
		const { before, after } = entry.change;
		if (!before || !after) {
			throw new AnnotationServiceError(
				"NOT_REVERTIBLE",
				entry.revertedBy
					? "This change has already been reverted."
					: "This change can no longer be reverted: its annotation was resolved or dismissed.",
			);
		}
		return { entry, before, after };
	};
	if (
		input.expectedRevision !== undefined &&
		input.expectedRevision !== stored.revision
	) {
		throw new AnnotationStoreError(
			"ANNOTATION_REVISION_MISMATCH",
			`Annotation ${input.annotationId} changed since revision ${input.expectedRevision}.`,
			{ annotationId: input.annotationId, currentRevision: stored.revision },
		);
	}
	const { before, after } = findChange(stored.annotation);

	for (let attempt = 0; attempt < maxRevertAttempts; attempt += 1) {
		const read = await input.designService.readDesignFile(container.designId);
		const changed = findChangedSince(read.design, after);
		if (changed.length > 0) {
			throw new AnnotationServiceError(
				"CHANGED_SINCE",
				`The layers this change touched have changed since: ${changed.join(", ")}.`,
				{ layers: changed, currentRevision: read.revision },
			);
		}
		let restored: TrickroomDesign;
		try {
			restored = restoreDesignChange(read.design, before);
		} catch (error) {
			if (error instanceof DesignRestoreError) {
				throw new AnnotationServiceError("CHANGED_SINCE", error.message, {
					layers: [],
					currentRevision: read.revision,
				});
			}
			throw error;
		}
		let recorded: StoredAnnotation | null = null;
		let designRevision: string | null = null;
		const revertEntryId = randomUUID();
		let outcome: Awaited<ReturnType<DesignFileService["updateDesignFile"]>>;
		try {
			outcome = await input.designService.updateDesignFile(container.designId, {
				expectedRevision: read.revision,
				read: async () => read,
				mutate: async () => ({ design: restored }),
				// Design lock held; the plan passed its revision check.
				aroundStore: async (storeDesign) => {
					const result = await context.store.update(
						container,
						input.annotationId,
						async ({ annotation }) => {
							// Annotation lock held: refuse before the design changes
							// when the change stopped being revertible meanwhile.
							const locked = findChange(annotation);
							if (
								!isDeepStrictEqual(locked.before, before) ||
								!isDeepStrictEqual(locked.after, after)
							) {
								throw new AnnotationServiceError(
									"NOT_REVERTIBLE",
									"The change record changed while reverting; try again.",
								);
							}
							const { write } = await storeDesign();
							designRevision = write.revision;
							const at = nowOf(context).toISOString();
							let next: Annotation = {
								...annotation,
								entries: annotation.entries.map((entry) => {
									if (entry.id !== input.entryId || entry.kind !== "change") {
										return entry;
									}
									const {
										before: _before,
										after: _after,
										...change
									} = entry.change;
									return { ...entry, change, revertedBy: revertEntryId };
								}),
							};
							next = withEntry(next, {
								id: revertEntryId,
								kind: "revert",
								at,
								by,
								entryId: input.entryId,
								revisionBefore: read.revision,
								revisionAfter: write.revision,
							});
							if (next.status === "addressed") {
								next = withTransition(next, "open", by, at);
							}
							return { annotation: next, result: undefined };
						},
						{ expectedRevision: input.expectedRevision },
					);
					recorded = result.stored;
				},
			});
		} catch (error) {
			if (designRevision !== null) {
				throw new AnnotationServiceError(
					"REVERT_NOT_RECORDED",
					`The design was reverted (revision ${designRevision}), but annotation ${input.annotationId} could not record it: ${error instanceof Error ? error.message : String(error)}`,
					{ revision: designRevision, annotationId: input.annotationId },
				);
			}
			throw error;
		}
		if (outcome.status === "revision-mismatch") continue;
		if (outcome.status !== "written" || !recorded) break;
		return {
			annotation: await viewAnnotation(context, recorded, {
				design: outcome.write.design,
			}),
			revision: outcome.write.revision,
			restoredLayerIds: Object.keys(before.layers),
		};
	}
	throw new AnnotationServiceError(
		"DESIGN_BUSY",
		"The design kept changing while reverting; try again.",
	);
};
