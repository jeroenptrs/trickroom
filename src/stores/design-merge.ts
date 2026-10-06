import type { Node, Props, TrickroomDesign } from "../types";

/**
 * Three-way merges for the design editor's live sync: a board, the order of
 * boards and the design's top-level fields, each against the last version
 * both sides share (the base). Pure functions over serialized nodes, so they
 * do not depend on the store.
 */

type NodeRecord = {
	props: Props;
	/** Set for nodes whose children are text. */
	text?: string;
	/** Set for nodes whose children are nodes. */
	childIds?: string[];
};

export type BoardMergeResult =
	| { status: "merged"; board: Node }
	| {
			status: "conflict";
			/** Layers changed on both sides, or whose place in the tree conflicts. */
			nodeIds: string[];
	  };

/** Deep equality for JSON values; absent and `undefined` keys are equal. */
export function isSameJson(left: unknown, right: unknown): boolean {
	if (left === right) {
		return true;
	}
	if (
		left === null ||
		right === null ||
		typeof left !== "object" ||
		typeof right !== "object"
	) {
		return false;
	}
	if (Array.isArray(left) || Array.isArray(right)) {
		return (
			Array.isArray(left) &&
			Array.isArray(right) &&
			left.length === right.length &&
			left.every((item, index) => isSameJson(item, right[index]))
		);
	}
	const leftRecord = left as Record<string, unknown>;
	const rightRecord = right as Record<string, unknown>;
	const leftKeys = Object.keys(leftRecord).filter(
		(key) => leftRecord[key] !== undefined,
	);
	const rightKeys = Object.keys(rightRecord).filter(
		(key) => rightRecord[key] !== undefined,
	);
	return (
		leftKeys.length === rightKeys.length &&
		leftKeys.every((key) => isSameJson(leftRecord[key], rightRecord[key]))
	);
}

const sameSequence = (left: readonly string[], right: readonly string[]) =>
	left.length === right.length &&
	left.every((entry, index) => entry === right[index]);

/** Flattens a board into records by id; false when an id repeats. */
function flattenBoard(node: Node, out: Map<string, NodeRecord>): boolean {
	if (out.has(node.id)) {
		return false;
	}
	if (typeof node.children === "string") {
		out.set(node.id, { props: node.props, text: node.children });
		return true;
	}
	out.set(node.id, {
		props: node.props,
		childIds: node.children.map((child) => child.id),
	});
	return node.children.every((child) => flattenBoard(child, out));
}

type Merged<T> = { ok: true; value: T } | { ok: false };

/** Takes the side that changed; a conflict when both changed differently. */
function mergeValue<T>(
	base: T,
	local: T,
	theirs: T,
	isSame: (left: T, right: T) => boolean = isSameJson,
): Merged<T> {
	if (isSame(local, theirs)) return { ok: true, value: local };
	if (isSame(base, local)) return { ok: true, value: theirs };
	if (isSame(base, theirs)) return { ok: true, value: local };
	return { ok: false };
}

/**
 * Inserts `extra` ids into `sequence`, each right after the closest entry
 * that precedes it in `reference` and is already placed (first when none is).
 */
export function insertAfterPredecessors(
	sequence: readonly string[],
	extra: readonly string[],
	reference: readonly string[],
): string[] {
	const result = [...sequence];
	const extraSet = new Set(extra);
	reference.forEach((id, referenceIndex) => {
		if (!extraSet.has(id) || result.includes(id)) {
			return;
		}
		let insertAt = 0;
		for (let index = referenceIndex - 1; index >= 0; index -= 1) {
			const placed = result.indexOf(reference[index] as string);
			if (placed !== -1) {
				insertAt = placed + 1;
				break;
			}
		}
		result.splice(insertAt, 0, id);
	});
	return result;
}

/**
 * Merges two edits of one list of child ids. Removals from either side and
 * insertions from either side combine; a reorder of kept children on either
 * side (when both sides changed the list) is a conflict.
 */
export function mergeIdLists(
	base: readonly string[],
	local: readonly string[],
	theirs: readonly string[],
): string[] | null {
	const merged = mergeValue(base, local, theirs, sameSequence);
	if (merged.ok) {
		return [...merged.value];
	}
	const localSet = new Set(local);
	const theirsSet = new Set(theirs);
	const baseSet = new Set(base);
	const kept = base.filter((id) => localSet.has(id) && theirsSet.has(id));
	const keptSet = new Set(kept);
	if (
		!sameSequence(
			local.filter((id) => keptSet.has(id)),
			kept,
		) ||
		!sameSequence(
			theirs.filter((id) => keptSet.has(id)),
			kept,
		)
	) {
		return null;
	}
	const localAdded = local.filter((id) => !baseSet.has(id));
	const theirsAdded = theirs.filter((id) => !baseSet.has(id));
	return insertAfterPredecessors(
		insertAfterPredecessors(kept, localAdded, local),
		theirsAdded,
		theirs,
	);
}

function mergeProps(base: Props, local: Props, theirs: Props): Props | null {
	if (isSameJson(local, theirs)) return local;
	if (isSameJson(base, local)) return theirs;
	if (isSameJson(base, theirs)) return local;
	const merged: Record<string, unknown> = {};
	const keys = new Set([
		...Object.keys(base),
		...Object.keys(local),
		...Object.keys(theirs),
	]);
	for (const key of keys) {
		const value = mergeValue<unknown>(
			(base as Record<string, unknown>)[key],
			(local as Record<string, unknown>)[key],
			(theirs as Record<string, unknown>)[key],
		);
		if (!value.ok) return null;
		if (value.value !== undefined) merged[key] = value.value;
	}
	return merged as Props;
}

function mergeRecord(
	base: NodeRecord | undefined,
	local: NodeRecord,
	theirs: NodeRecord,
): NodeRecord | null {
	if (isSameJson(local, theirs)) return local;
	if (!base) return null;
	if (isSameJson(base, local)) return theirs;
	if (isSameJson(base, theirs)) return local;
	const props = mergeProps(base.props, local.props, theirs.props);
	if (!props) return null;
	const text = mergeValue(base.text, local.text, theirs.text);
	if (!text.ok) return null;
	let childIds: string[] | undefined;
	if (
		local.childIds === undefined ||
		theirs.childIds === undefined ||
		base.childIds === undefined
	) {
		const ids = mergeValue(base.childIds, local.childIds, theirs.childIds);
		if (!ids.ok) return null;
		childIds = ids.value;
	} else {
		const ids = mergeIdLists(base.childIds, local.childIds, theirs.childIds);
		if (!ids) return null;
		childIds = ids;
	}
	if (text.value !== undefined && childIds !== undefined) return null;
	return {
		props,
		...(text.value !== undefined ? { text: text.value } : {}),
		...(childIds !== undefined ? { childIds } : {}),
	};
}

/**
 * Merges a board edited locally (`local`) and on disk (`theirs`) since
 * `base`, node by node: a layer changed on one side takes that side's
 * version; a layer changed on both sides merges prop by prop; child lists
 * combine insertions and removals from both sides. Conflicts are a prop or
 * text changed differently on both sides, a layer deleted on one side and
 * changed on the other, a child list reordered while the other side changed
 * it, or a tree that does not assemble (a layer in two places).
 *
 * `isIdTaken` reports ids used by other boards of the local design, so a
 * merge cannot duplicate an id across boards.
 */
export function mergeBoard(
	base: Node,
	local: Node,
	theirs: Node,
	isIdTaken: (id: string) => boolean = () => false,
): BoardMergeResult {
	if (isSameJson(local, theirs)) {
		return { status: "merged", board: local };
	}
	if (isSameJson(base, local)) {
		return { status: "merged", board: theirs };
	}
	if (isSameJson(base, theirs)) {
		return { status: "merged", board: local };
	}

	const baseRecords = new Map<string, NodeRecord>();
	const localRecords = new Map<string, NodeRecord>();
	const theirsRecords = new Map<string, NodeRecord>();
	if (
		!flattenBoard(base, baseRecords) ||
		!flattenBoard(local, localRecords) ||
		!flattenBoard(theirs, theirsRecords)
	) {
		return { status: "conflict", nodeIds: [] };
	}

	const conflicts = new Set<string>();
	const merged = new Map<string, NodeRecord>();
	const ids = new Set([
		...baseRecords.keys(),
		...localRecords.keys(),
		...theirsRecords.keys(),
	]);
	for (const id of ids) {
		const baseRecord = baseRecords.get(id);
		const localRecord = localRecords.get(id);
		const theirsRecord = theirsRecords.get(id);
		if (localRecord && theirsRecord) {
			const record = mergeRecord(baseRecord, localRecord, theirsRecord);
			if (record) {
				merged.set(id, record);
			} else {
				conflicts.add(id);
			}
			continue;
		}
		const present = localRecord ?? theirsRecord;
		if (!present) {
			continue;
		}
		if (!baseRecord) {
			// Added on one side.
			merged.set(id, present);
			continue;
		}
		// Deleted on one side: fine only when the other side left it alone.
		if (!isSameJson(baseRecord, present)) {
			conflicts.add(id);
		}
	}

	if (conflicts.size === 0) {
		const visited = new Set<string>();
		const build = (id: string, parentId: string | null): Node | null => {
			const record = merged.get(id);
			if (!record || visited.has(id) || (id !== local.id && isIdTaken(id))) {
				conflicts.add(record ? id : (parentId ?? id));
				return null;
			}
			visited.add(id);
			if (record.text !== undefined) {
				return { id, props: record.props, children: record.text };
			}
			const children: Node[] = [];
			for (const childId of record.childIds ?? []) {
				const child = build(childId, id);
				if (child) children.push(child);
			}
			return { id, props: record.props, children };
		};
		const board = build(local.id, null);
		for (const id of merged.keys()) {
			if (!visited.has(id)) conflicts.add(id);
		}
		if (board && conflicts.size === 0) {
			return { status: "merged", board };
		}
	}

	return { status: "conflict", nodeIds: [...conflicts] };
}

/**
 * The order of boards after merging a local and a disk change against the
 * base order. Boards only one side has are placed after their predecessor
 * on that side. When only one side reordered the boards both know, its order
 * wins; when both did, differently, it is a conflict and the local order is
 * kept until it is resolved.
 */
export function mergeBoardOrder({
	base,
	local,
	disk,
	present,
}: {
	base: readonly string[];
	local: readonly string[];
	disk: readonly string[];
	/** Boards that exist after the merge. */
	present: ReadonlySet<string>;
}): { order: string[]; conflict: boolean } {
	const restrictTo = (sequence: readonly string[], keep: ReadonlySet<string>) =>
		sequence.filter((id) => keep.has(id));
	const baseSet = new Set(base);
	const localSet = new Set(local);
	const diskSet = new Set(disk);
	const localKnown = new Set(local.filter((id) => baseSet.has(id)));
	const diskKnown = new Set(disk.filter((id) => baseSet.has(id)));
	const localReordered = !sameSequence(
		restrictTo(local, localKnown),
		restrictTo(base, localKnown),
	);
	const diskReordered = !sameSequence(
		restrictTo(disk, diskKnown),
		restrictTo(base, diskKnown),
	);
	const followDisk = () =>
		insertAfterPredecessors(
			disk.filter((id) => present.has(id)),
			local.filter((id) => present.has(id) && !diskSet.has(id)),
			local,
		);
	const followLocal = () =>
		insertAfterPredecessors(
			local.filter((id) => present.has(id)),
			disk.filter((id) => present.has(id) && !localSet.has(id)),
			disk,
		);
	if (!localReordered) {
		return { order: followDisk(), conflict: false };
	}
	if (!diskReordered) {
		return { order: followLocal(), conflict: false };
	}
	const shared = new Set(local.filter((id) => diskSet.has(id)));
	return {
		order: followLocal(),
		conflict: !sameSequence(
			restrictTo(local, shared),
			restrictTo(disk, shared),
		),
	};
}

/**
 * The design's editable top-level fields: what `design.json` holds besides
 * boards and the server-owned `version` and `updatedAt`. The server sets
 * `updatedAt` on every write that changes the design, never from what the
 * browser sends, so the store neither keeps nor merges it: the later value
 * is always the one on disk.
 */
export type DesignManifest = Pick<
	TrickroomDesign,
	"name" | "systemId" | "systemName" | "componentMigrationPolicy"
>;

export const manifestFieldLabels = {
	name: "name",
	systemId: "design system",
	componentMigrationPolicy: "component update policy",
} as const;

export type ManifestField = keyof typeof manifestFieldLabels;

const manifestFields = Object.keys(manifestFieldLabels) as ManifestField[];

/**
 * Merges the design's top-level fields field by field. `systemName` is
 * display data that follows `systemId`.
 */
export function mergeManifest(
	base: DesignManifest,
	local: DesignManifest,
	theirs: DesignManifest,
): { manifest: DesignManifest; conflicts: ManifestField[] } {
	const manifest: DesignManifest = { ...local };
	const conflicts: ManifestField[] = [];
	for (const field of manifestFields) {
		const value = mergeValue<unknown>(base[field], local[field], theirs[field]);
		if (!value.ok) {
			conflicts.push(field);
			continue;
		}
		if (value.value === undefined) {
			delete manifest[field];
		} else {
			(manifest as Record<string, unknown>)[field] = value.value;
		}
		if (field === "systemId" && isSameJson(value.value, theirs.systemId)) {
			if (theirs.systemName === undefined) {
				delete manifest.systemName;
			} else {
				manifest.systemName = theirs.systemName;
			}
		}
	}
	return { manifest, conflicts };
}

/** Whether two manifests hold the same stored fields (`systemName` aside). */
export const isSameManifest = (left: DesignManifest, right: DesignManifest) =>
	manifestFields.every((field) => isSameJson(left[field], right[field]));
