import { isDeepStrictEqual } from "node:util";
import type { DesignFileRead } from "../../services/design-file-service";
import {
	calculateManifestRevision,
	decodeDesignRevision,
	hashBoardId,
} from "../../services/design-revision";
import type { Node as DesignNode, TrickroomDesign } from "../../types";

/**
 * Board-level revision checks for MCP. Revision tokens stay opaque to agents;
 * Trickroom decodes them here to tell an agent which boards it has to re-read.
 */

/** What changed in a design since a caller's revision. */
export type DesignRevisionChanges = {
	/** Current boards whose content differs from the caller's revision, or that it did not know. */
	changedBoardIds: string[];
	/** Boards in the caller's revision that no longer exist. */
	removedBoardCount: number;
	/** The design's name or settings changed. */
	manifest: boolean;
};

/**
 * Compares a caller's revision with a current read. Returns null when the
 * caller's revision is not a board-level token (for example an older
 * `sha256:` revision), so nothing can be said per board.
 */
export const diffDesignRevision = (
	expectedRevision: string,
	read: Pick<DesignFileRead, "design" | "boards">,
): DesignRevisionChanges | null => {
	const expected = decodeDesignRevision(expectedRevision);
	if (!expected) {
		return null;
	}
	const expectedByIdHash = new Map(
		expected.boards.map((board) => [board.idHash, board.revision]),
	);
	const currentIdHashes = new Set<string>();
	const changedBoardIds: string[] = [];
	for (const board of read.boards) {
		const idHash = hashBoardId(board.id);
		currentIdHashes.add(idHash);
		if (expectedByIdHash.get(idHash) !== board.revision) {
			changedBoardIds.push(board.id);
		}
	}
	return {
		changedBoardIds,
		removedBoardCount: [...expectedByIdHash.keys()].filter(
			(idHash) => !currentIdHashes.has(idHash),
		).length,
		manifest: expected.manifest !== calculateManifestRevision(read.design),
	};
};

/**
 * Whether one board is unchanged between a caller's revision and a read: its
 * revision in the caller's token equals its current revision. A token that is
 * not board-level compares the whole design.
 */
export const isBoardCurrent = (
	expectedRevision: string,
	read: Pick<DesignFileRead, "revision" | "boards">,
	boardId: string,
) => {
	if (expectedRevision === read.revision) {
		return true;
	}
	const expected = decodeDesignRevision(expectedRevision);
	const current = read.boards.find((board) => board.id === boardId);
	if (!expected || !current) {
		return false;
	}
	const idHash = hashBoardId(boardId);
	const matches = expected.boards.filter((board) => board.idHash === idHash);
	return matches.length === 1 && matches[0]?.revision === current.revision;
};

/** The board (root element) that contains an element, or null. */
export const findBoardOfElement = (
	design: TrickroomDesign,
	elementId: string,
): DesignNode | null => {
	const contains = (node: DesignNode): boolean =>
		node.id === elementId ||
		(Array.isArray(node.children) && node.children.some(contains));
	return design.boards.find(contains) ?? null;
};

const isSameValue = (left: unknown, right: unknown) =>
	left === right ||
	(typeof left === "object" &&
		left !== null &&
		typeof right === "object" &&
		right !== null &&
		isDeepStrictEqual(left, right));

/** Whether two element trees hold the same content (key order aside). */
const isSameNode = (left: DesignNode, right: DesignNode): boolean => {
	if (left === right) {
		return true;
	}
	if (left.id !== right.id) {
		return false;
	}
	const leftProps = left.props as Record<string, unknown>;
	const rightProps = right.props as Record<string, unknown>;
	const keys = Object.keys(leftProps);
	if (keys.length !== Object.keys(rightProps).length) {
		return false;
	}
	for (const key of keys) {
		if (!(key in rightProps) || !isSameValue(leftProps[key], rightProps[key])) {
			return false;
		}
	}
	if (typeof left.children === "string" || typeof right.children === "string") {
		return left.children === right.children;
	}
	const rightChildren = right.children;
	return (
		left.children.length === rightChildren.length &&
		left.children.every((child, index) =>
			isSameNode(child, rightChildren[index] as DesignNode),
		)
	);
};

/**
 * Boards of `after` whose content differs from the board with the same id in
 * `before`, or that `before` does not have. Comparing trees is linear in
 * their size and stops at the first difference, much cheaper than hashing.
 */
export const getChangedBoardIds = (
	before: TrickroomDesign,
	after: TrickroomDesign,
): Set<string> => {
	const beforeById = new Map(before.boards.map((board) => [board.id, board]));
	return new Set(
		after.boards
			.filter((board) => {
				const previous = beforeById.get(board.id);
				return previous === undefined || !isSameNode(previous, board);
			})
			.map((board) => board.id),
	);
};

/**
 * The boards a plan touched: the ones whose content changed, plus the ones
 * holding elements it touched without changing them (a write of a value that
 * was already set still reports that element's warnings).
 */
export const getTouchedBoardIds = (
	before: TrickroomDesign,
	after: TrickroomDesign,
	affectedElementIds: Iterable<string>,
): Set<string> => {
	const touched = getChangedBoardIds(before, after);
	const affected = new Set(affectedElementIds);
	if (affected.size === 0) {
		return touched;
	}
	const holdsAffected = (node: DesignNode): boolean =>
		affected.has(node.id) ||
		(Array.isArray(node.children) && node.children.some(holdsAffected));
	for (const board of after.boards) {
		if (!touched.has(board.id) && holdsAffected(board)) {
			touched.add(board.id);
		}
	}
	return touched;
};
