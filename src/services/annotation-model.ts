import type { Node, TrickroomDesign } from "../types";
import {
	ANNOTATION_STATUSES,
	type Annotation,
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
			return undefined;
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
		if (target.kind === "layer") {
			summary.layers[target.elementId] ??= emptyAnnotationCounts();
			addToCounts(summary.layers[target.elementId], status, detached);
		}
	}
	return summary;
};

/**
 * Counts already-listed annotations by status, work owner, board and
 * layer. With `design`, layers follow moves and detached ones are counted.
 */
export const summarizeAnnotationCounts = (
	annotations: readonly Pick<Annotation, "target" | "status">[],
	design?: TrickroomDesign | null,
): AnnotationCountSummary =>
	summarizeAnnotationCountsWith(
		annotations,
		design ? designTargetLocator(design) : null,
	);

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
