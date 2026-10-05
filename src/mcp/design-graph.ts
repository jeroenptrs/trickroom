import { createElementNotFoundError } from "../services/element-lookup-hints";
import type { Node as DesignNode, TrickroomDesign } from "../types";
import {
	countElementNodes,
	describeNode,
	getRecipeAttachmentSummaries,
	type TreeReadBounds,
} from "./payloads/design-tree";

export type DesignGraphOptions = {
	rootElementId?: string;
	includeProps?: boolean;
};

type ElementGraphNode = Record<string, unknown> & {
	parentId: string | null;
};

export type DesignGraph = {
	rootElementIds: string[];
	elementsById: Record<string, ElementGraphNode>;
	returnedNodeCount: number;
	omittedNodeCount: number;
	truncatedElementIds: string[];
};

type GraphEntry = {
	node: DesignNode;
	parentId: string | null;
};

const findScopeEntry = (
	design: TrickroomDesign,
	elementId: string,
): GraphEntry | null => {
	const visit = (entry: GraphEntry): GraphEntry | null => {
		if (entry.node.id === elementId) {
			return entry;
		}
		if (!Array.isArray(entry.node.children)) {
			return null;
		}
		for (const child of entry.node.children) {
			const found = visit({
				node: child,
				parentId: entry.node.id,
			});
			if (found) {
				return found;
			}
		}
		return null;
	};

	for (const board of design.boards) {
		const found = visit({
			node: board,
			parentId: null,
		});
		if (found) {
			return found;
		}
	}
	return null;
};

/**
 * Flat, bounded outline of a design: one entry per element keyed by id, in
 * breadth-first order (siblings keep their order), with parentId, childCount
 * and the compact fields minus className. Elements are taken from the scope
 * roots until `maxNodes`/`depth` run out; an element whose descendants were
 * cut carries `more` (the omitted element count).
 */
export const buildDesignGraph = (
	design: TrickroomDesign,
	bounds: TreeReadBounds,
	options: DesignGraphOptions = {},
): DesignGraph => {
	let roots: GraphEntry[];
	if (options.rootElementId !== undefined) {
		const scope = findScopeEntry(design, options.rootElementId);
		if (!scope) {
			throw createElementNotFoundError(design, options.rootElementId);
		}
		roots = [scope];
	} else {
		roots = design.boards.map((board) => ({
			node: board,
			parentId: null,
		}));
	}

	const recipeSummaries = getRecipeAttachmentSummaries(design);
	const detail = options.includeProps === true ? "full" : "compact";
	const elementsById: Record<string, ElementGraphNode> = {};
	const selected = new Set<DesignNode>();
	const graph: DesignGraph = {
		rootElementIds: roots.map((entry) => entry.node.id),
		elementsById,
		returnedNodeCount: 0,
		omittedNodeCount: 0,
		truncatedElementIds: [],
	};

	let level = roots;
	let depth = 0;
	while (level.length > 0) {
		const next: GraphEntry[] = [];
		for (const entry of level) {
			if (bounds.maxNodes !== null && selected.size >= bounds.maxNodes) {
				break;
			}
			selected.add(entry.node);
			const { id: _id, ...described } = describeNode(
				entry.node,
				detail,
				recipeSummaries,
			);
			// The outline is structure only: styling stays in the tree view
			// unless every prop is requested.
			delete described.className;
			const children = Array.isArray(entry.node.children)
				? entry.node.children
				: [];
			elementsById[entry.node.id] = {
				parentId: entry.parentId,
				...described,
				...(children.length > 0 ? { childCount: children.length } : {}),
			};
			if (bounds.maxDepth === null || depth < bounds.maxDepth) {
				for (const child of children) {
					next.push({
						node: child,
						parentId: entry.node.id,
					});
				}
			}
		}
		level = next;
		depth += 1;
	}

	graph.returnedNodeCount = selected.size;
	for (const node of selected) {
		if (!Array.isArray(node.children)) {
			continue;
		}
		let omitted = 0;
		for (const child of node.children) {
			if (!selected.has(child)) {
				omitted += countElementNodes(child);
			}
		}
		if (omitted > 0) {
			elementsById[node.id].more = omitted;
			graph.omittedNodeCount += omitted;
			graph.truncatedElementIds.push(node.id);
		}
	}
	for (const root of roots) {
		if (!selected.has(root.node)) {
			graph.omittedNodeCount += countElementNodes(root.node);
		}
	}

	return graph;
};
