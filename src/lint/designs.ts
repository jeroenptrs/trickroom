import type { Node, TrickroomDesign } from "../types";
import { getSystemComponentStructuralMetadata } from "../utils/system-component-markers";

/**
 * The design side of a lint run: the Designs linked to the linted system,
 * reduced to what design rules check (classes, instance markers, element
 * ids, paths), plus where each of the system's components is placed. Pure:
 * `run-lint.ts` and `design-lint.ts` read the designs and hand them in.
 * Documented in docs/lint.md.
 */

/** The instance markers a node of a placed component carries. */
export type LintDesignInstanceMarker = {
	systemId: string;
	componentId: string;
	instanceId: string;
	/** The published version the instance uses. */
	version: string;
	/** The node's template path inside the component. */
	templatePath: string;
	root: boolean;
	/** Selected variant values; only the root records them. */
	variantValues: Record<string, string>;
};

export type LintDesignNode = {
	/** Element id. */
	element: string;
	/** Path of the node in the design file, e.g. `boards[0].children[2]`. */
	path: string;
	className: string | null;
	instance: LintDesignInstanceMarker | null;
};

export type LintDesignBoard = {
	id: string;
	/** The board layer's name, when it has one. */
	name: string | null;
	/** Every node of the board, the board included, depth first. */
	nodes: LintDesignNode[];
};

export type LintDesign = {
	/** Design file id. */
	id: string;
	name: string;
	boards: LintDesignBoard[];
};

/** One placed instance (its root) of a component of the linted system. */
export type LintDesignUsage = {
	design: string;
	board: string;
	element: string;
	path: string;
	instanceId: string;
	version: string;
	variantValues: Record<string, string>;
};

export type LintDesignIndex = {
	systemId: string;
	/** The linked designs, sorted by id. */
	designs: LintDesign[];
	/**
	 * Instance roots of this system's components, keyed by component id, in
	 * design, board and document order. Instances of other systems are left
	 * out.
	 */
	usages: Record<string, LintDesignUsage[]>;
};

export type LintDesignInput = {
	id: string;
	design: TrickroomDesign;
	/** Only these boards; every board when absent. Paths keep the design's indexes. */
	boardIds?: ReadonlySet<string>;
};

const nameOf = (node: Node) => {
	const name = node.props["data-trickroom-name"];
	return typeof name === "string" ? name : null;
};

const toMarker = (node: Node): LintDesignInstanceMarker | null => {
	const metadata = getSystemComponentStructuralMetadata(node.props);
	if (!metadata) return null;
	return {
		systemId: metadata.systemId,
		componentId: metadata.componentId,
		instanceId: metadata.instanceId,
		version: metadata.version,
		templatePath: metadata.path,
		root: metadata.isRoot,
		variantValues: metadata.variantValues,
	};
};

const walkBoard = (board: Node, boardPath: string): LintDesignNode[] => {
	const nodes: LintDesignNode[] = [];
	const visit = (node: Node, nodePath: string) => {
		const className = node.props.className;
		nodes.push({
			element: node.id,
			path: nodePath,
			className:
				typeof className === "string" && className.trim().length > 0
					? className
					: null,
			instance: toMarker(node),
		});
		if (Array.isArray(node.children)) {
			for (const [index, child] of node.children.entries()) {
				visit(child, `${nodePath}.children[${index}]`);
			}
		}
	};
	visit(board, boardPath);
	return nodes;
};

const compareIds = (left: { id: string }, right: { id: string }) =>
	left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

/** The index over designs already known to link the system. */
export function buildLintDesignIndex({
	systemId,
	designs,
}: {
	systemId: string;
	designs: readonly LintDesignInput[];
}): LintDesignIndex {
	const indexed: LintDesign[] = [];
	const usages: Record<string, LintDesignUsage[]> = {};
	for (const input of [...designs].sort(compareIds)) {
		const boards: LintDesignBoard[] = [];
		for (const [index, board] of input.design.boards.entries()) {
			if (input.boardIds && !input.boardIds.has(board.id)) continue;
			const nodes = walkBoard(board, `boards[${index}]`);
			boards.push({ id: board.id, name: nameOf(board), nodes });
			for (const node of nodes) {
				const instance = node.instance;
				if (!instance?.root || instance.systemId !== systemId) continue;
				const list = usages[instance.componentId] ?? [];
				list.push({
					design: input.id,
					board: board.id,
					element: node.element,
					path: node.path,
					instanceId: instance.instanceId,
					version: instance.version,
					variantValues: instance.variantValues,
				});
				usages[instance.componentId] = list;
			}
		}
		indexed.push({ id: input.id, name: input.design.name, boards });
	}
	return {
		systemId,
		designs: indexed,
		usages: Object.fromEntries(
			Object.entries(usages).sort(([left], [right]) =>
				left < right ? -1 : left > right ? 1 : 0,
			),
		),
	};
}

/** An index with no designs, for runs that have none to check. */
export const emptyLintDesignIndex = (systemId: string): LintDesignIndex => ({
	systemId,
	designs: [],
	usages: {},
});

/** How many instances of each component (by id) the index places. */
export const countDesignUsages = (
	index: LintDesignIndex,
): Record<string, number> =>
	Object.fromEntries(
		Object.entries(index.usages).map(([componentId, list]) => [
			componentId,
			list.length,
		]),
	);
