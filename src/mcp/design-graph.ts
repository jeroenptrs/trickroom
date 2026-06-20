import { normalizeRole } from "../libraries/registry";
import type { Node as DesignNode, TrickroomDesign } from "../types";

export type DesignGraphOptions = {
	rootElementId?: string;
	includeProps?: boolean;
	includeText?: boolean;
};

type ElementGraphNode = {
	id: string;
	name: string;
	library: string;
	component: string;
	role: string;
	childIds: string[];
	textLength?: number;
	textPreview?: string;
	props?: DesignNode["props"];
	text?: string;
	addresses: {
		element: string;
		props: string;
		children: string;
		className?: string;
		name: string;
		text?: string;
	};
};

export type DesignGraph = {
	rootElementIds: string[];
	elementsById: Record<string, ElementGraphNode>;
	parentIdByElementId: Record<string, string | null>;
	childIdsByElementId: Record<string, string[]>;
	addressByElementId: Record<string, string>;
};

const getTextPreview = (text: string) =>
	text.length <= 80 ? text : `${text.slice(0, 77)}...`;

const escapeJsonPointerSegment = (segment: string) =>
	segment.replace(/~/g, "~0").replace(/\//g, "~1");

const getChildIds = (node: DesignNode) =>
	Array.isArray(node.children) ? node.children.map((child) => child.id) : [];

const findNode = (
	nodes: DesignNode[],
	elementId: string,
): DesignNode | null => {
	for (const node of nodes) {
		if (node.id === elementId) {
			return node;
		}

		if (Array.isArray(node.children)) {
			const found = findNode(node.children, elementId);
			if (found) {
				return found;
			}
		}
	}

	return null;
};

export const buildDesignGraph = (
	design: TrickroomDesign,
	options: DesignGraphOptions = {},
): DesignGraph => {
	const scopeRoot = options.rootElementId
		? findNode(design.boards, options.rootElementId)
		: null;
	const scopedRootIds = scopeRoot
		? [scopeRoot.id]
		: design.boards.map((board) => board.id);
	const includeProps = options.includeProps === true;
	const includeText = options.includeText !== false;
	const elementsById: Record<string, ElementGraphNode> = {};
	const parentIdByElementId: Record<string, string | null> = {};
	const childIdsByElementId: Record<string, string[]> = {};
	const addressByElementId: Record<string, string> = {};
	const includeAll = options.rootElementId === undefined;
	let scopeReached = options.rootElementId === undefined;

	const visit = (
		node: DesignNode,
		parentId: string | null,
		address: string,
		inScope: boolean,
	) => {
		const nextInScope = inScope || node.id === options.rootElementId;
		if (node.id === options.rootElementId) {
			scopeReached = true;
		}
		const childIds = getChildIds(node);

		if (includeAll || nextInScope) {
			const text = typeof node.children === "string" ? node.children : null;
			elementsById[node.id] = {
				id: node.id,
				name: node.props["data-trickroom-name"],
				library: node.props["data-trickroom-library"],
				component: node.props["data-trickroom-component"],
				role: normalizeRole(node.props["data-trickroom-role"]),
				childIds,
				...(text !== null
					? {
							textLength: text.length,
							textPreview: getTextPreview(text),
						}
					: {}),
				...(includeProps ? { props: node.props } : {}),
				...(includeText && text !== null ? { text } : {}),
				addresses: {
					element: address,
					props: `${address}/props`,
					children: `${address}/children`,
					name: `${address}/props/${escapeJsonPointerSegment("data-trickroom-name")}`,
					...(node.props.className !== undefined
						? { className: `${address}/props/className` }
						: {}),
					...(text !== null ? { text: `${address}/children` } : {}),
				},
			};
			parentIdByElementId[node.id] = parentId;
			childIdsByElementId[node.id] = childIds;
			addressByElementId[node.id] = address;
		}

		if (Array.isArray(node.children)) {
			for (const [childIndex, child] of node.children.entries()) {
				visit(child, node.id, `${address}/children/${childIndex}`, nextInScope);
			}
		}
	};

	for (const [rootIndex, board] of design.boards.entries()) {
		visit(board, null, `/boards/${rootIndex}`, includeAll);
	}

	if (options.rootElementId !== undefined && !scopeReached) {
		throw new Error(`Unknown element "${options.rootElementId}"`);
	}

	return {
		rootElementIds: scopedRootIds,
		elementsById,
		parentIdByElementId,
		childIdsByElementId,
		addressByElementId,
	};
};
