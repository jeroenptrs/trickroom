import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Node, TrickroomDesign } from "../types";
import type {
	AnnotationChangeState,
	AnnotationDesignSettings,
	AnnotationLayerState,
} from "./annotations.types";
import { stableStringify } from "./design-revision";

/**
 * What one design write changed, layer by layer, and how to undo it. A
 * layer's own state is its parent, its props and its text or child ids, so
 * a write touches exactly the layers whose own state differs: edited ones,
 * added and removed ones (with every removed descendant), and the parents
 * whose child list changed. Restoring the before state of those layers
 * undoes the write without touching anything else, and is safe while each
 * of them still has the state the write left it in.
 */

/** Fields of a design that are neither boards nor storage bookkeeping. */
const nonSettingKeys = new Set(["boards", "version", "updatedAt"]);

export type FlatDesignLayers = {
	layers: Map<string, AnnotationLayerState>;
	boardOrder: string[];
	settings: AnnotationDesignSettings;
};

export const getDesignSettings = (
	design: TrickroomDesign,
): AnnotationDesignSettings => {
	const settings: AnnotationDesignSettings = {};
	for (const [key, value] of Object.entries(design)) {
		if (!nonSettingKeys.has(key) && value !== undefined) settings[key] = value;
	}
	return settings;
};

/** Every layer's own state, keyed by id, plus board order and settings. */
export const flattenDesignLayers = (
	design: TrickroomDesign,
): FlatDesignLayers => {
	const layers = new Map<string, AnnotationLayerState>();
	const visit = (node: Node, parentId: string | null) => {
		layers.set(node.id, {
			parentId,
			props: node.props,
			children:
				typeof node.children === "string"
					? node.children
					: node.children.map((child) => child.id),
		});
		if (typeof node.children !== "string") {
			for (const child of node.children) visit(child, node.id);
		}
	};
	for (const board of design.boards) visit(board, null);
	return {
		layers,
		boardOrder: design.boards.map((board) => board.id),
		settings: getDesignSettings(design),
	};
};

export const hashLayerState = (state: AnnotationLayerState) =>
	`sha256:${createHash("sha256").update(stableStringify(state)).digest("hex")}`;

const boardOf = (
	layers: Map<string, AnnotationLayerState>,
	layerId: string,
): string | null => {
	let current = layerId;
	const seen = new Set<string>();
	for (;;) {
		const state = layers.get(current);
		if (!state || seen.has(current)) return null;
		if (state.parentId === null) return current;
		seen.add(current);
		current = state.parentId;
	}
};

export type DesignChangeCapture = {
	boards: string[];
	layerIds: string[];
	before: AnnotationChangeState<AnnotationLayerState>;
	after: AnnotationChangeState<string>;
};

/**
 * The layers `after` changed relative to `before`, with their before state
 * and after hashes. Null when nothing changed (a write that only stamped
 * `updatedAt`).
 */
export const captureDesignChange = (
	before: TrickroomDesign,
	after: TrickroomDesign,
): DesignChangeCapture | null => {
	const previous = flattenDesignLayers(before);
	const next = flattenDesignLayers(after);
	const touched: string[] = [];
	const ids = new Set([...previous.layers.keys(), ...next.layers.keys()]);
	for (const id of ids) {
		const was = previous.layers.get(id);
		const is = next.layers.get(id);
		if (!was || !is || !isDeepStrictEqual(was, is)) touched.push(id);
	}
	const orderChanged = !isDeepStrictEqual(previous.boardOrder, next.boardOrder);
	const settingsChanged = !isDeepStrictEqual(previous.settings, next.settings);
	if (touched.length === 0 && !orderChanged && !settingsChanged) return null;

	const boards = new Set<string>();
	const layerIds = new Set<string>();
	for (const id of touched) {
		const was = previous.layers.get(id);
		const is = next.layers.get(id);
		const board = boardOf(next.layers, id) ?? boardOf(previous.layers, id);
		if (board) boards.add(board);
		if (is) {
			// Added, or own content changed: reveal it. A parent whose only
			// change is its child list is revealed through those children.
			const textChanged =
				(typeof was?.children === "string" ||
					typeof is.children === "string") &&
				was?.children !== is.children;
			const ownChanged =
				!was ||
				was.parentId !== is.parentId ||
				!isDeepStrictEqual(was.props, is.props) ||
				textChanged;
			if (ownChanged) layerIds.add(id);
		} else if (was?.parentId && next.layers.has(was.parentId)) {
			// Removed: reveal where it was.
			layerIds.add(was.parentId);
		}
	}

	return {
		boards: [...boards],
		layerIds: [...layerIds],
		before: {
			layers: Object.fromEntries(
				touched.map((id) => [id, previous.layers.get(id) ?? null]),
			),
			...(orderChanged ? { boardOrder: previous.boardOrder } : {}),
			...(settingsChanged ? { settings: previous.settings } : {}),
		},
		after: {
			layers: Object.fromEntries(
				touched.map((id) => {
					const state = next.layers.get(id);
					return [id, state ? hashLayerState(state) : null];
				}),
			),
			...(orderChanged ? { boardOrder: next.boardOrder } : {}),
			...(settingsChanged ? { settings: next.settings } : {}),
		},
	};
};

/** Pseudo layer ids `findChangedSince` reports for order and settings. */
export const BOARD_ORDER_CHANGE = "$boardOrder";
export const DESIGN_SETTINGS_CHANGE = "$settings";

/**
 * The parts of a change that no longer have the state the write left them
 * in: touched layer ids, plus `$boardOrder` and `$settings` when those
 * moved on. Empty when the change can be reverted.
 */
export const findChangedSince = (
	current: TrickroomDesign,
	after: AnnotationChangeState<string>,
): string[] => {
	const flat = flattenDesignLayers(current);
	const changed: string[] = [];
	for (const [id, hash] of Object.entries(after.layers)) {
		const state = flat.layers.get(id);
		const currentHash = state ? hashLayerState(state) : null;
		if (currentHash !== hash) changed.push(id);
	}
	if (
		after.boardOrder &&
		!isDeepStrictEqual(flat.boardOrder, after.boardOrder)
	) {
		changed.push(BOARD_ORDER_CHANGE);
	}
	if (after.settings && !isDeepStrictEqual(flat.settings, after.settings)) {
		changed.push(DESIGN_SETTINGS_CHANGE);
	}
	return changed;
};

export class DesignRestoreError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DesignRestoreError";
	}
}

/**
 * `current` with the before state of a change put back: touched layers
 * take their recorded state (or are removed when they did not exist),
 * board order and settings return when the change moved them. Callers check
 * `findChangedSince` first; the result is then consistent.
 */
export const restoreDesignChange = (
	current: TrickroomDesign,
	before: AnnotationChangeState<AnnotationLayerState>,
): TrickroomDesign => {
	const flat = flattenDesignLayers(current);
	for (const [id, state] of Object.entries(before.layers)) {
		if (state) flat.layers.set(id, state);
		else flat.layers.delete(id);
	}
	const boardOrder = before.boardOrder ?? flat.boardOrder;
	const built = new Set<string>();
	const build = (id: string, parentId: string | null): Node => {
		const state = flat.layers.get(id);
		if (!state) {
			throw new DesignRestoreError(
				`Layer ${id} is missing from the restored design.`,
			);
		}
		if (state.parentId !== parentId || built.has(id)) {
			throw new DesignRestoreError(
				`Layer ${id} is not where the restored design expects it.`,
			);
		}
		built.add(id);
		return {
			id,
			props: state.props,
			children:
				typeof state.children === "string"
					? state.children
					: state.children.map((childId) => build(childId, id)),
		};
	};
	const boards = boardOrder.map((id) => build(id, null));
	const settings = before.settings ?? flat.settings;
	const restored: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(current)) {
		if (nonSettingKeys.has(key) && key !== "boards") restored[key] = value;
	}
	return {
		...restored,
		...settings,
		boards,
	} as TrickroomDesign;
};
