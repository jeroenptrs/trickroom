import { normalizeRole } from "../../libraries/registry";
import { getElementRecipeMetadata } from "../../recipes/ownership";
import {
	type RecipeInstanceValidationReport,
	validateRecipeInstances,
} from "../../recipes/validation";
import {
	createDesignFileService,
	type DesignFileRead,
} from "../../services/design-file-service";
import { DesignTransformError } from "../../services/design-transform-service";
import { createElementNotFoundError } from "../../services/element-lookup-hints";
import type { Node as DesignNode, TrickroomDesign } from "../../types";
import type { TrickroomMcpServerContext } from "../server-types";

type ElementContext = {
	element: DesignNode;
	parent: DesignNode | null;
	index: number | null;
	rootIndex: number | null;
	siblingIds: string[];
};

export const getDesignSystemHandle = (
	design: Pick<TrickroomDesign, "systemId" | "systemName">,
) => {
	if (design.systemId !== undefined) {
		return design.systemId;
	}

	return design.systemName ?? null;
};

export const getDesignMetadata = (
	designFileId: string,
	read: DesignFileRead,
) => {
	const systemHandle = getDesignSystemHandle(read.design);
	return {
		id: designFileId,
		file: read.file,
		name: read.design.name,
		systemId: read.design.systemId ?? null,
		systemName: systemHandle === null ? null : (read.design.systemName ?? null),
		revision: read.revision,
	};
};

export const createBlankDesign = (
	name: string,
	systemId: string | null | undefined,
): TrickroomDesign => ({
	name,
	...(systemId !== undefined ? { systemId } : {}),
	boards: [],
});

export const getNodeName = (node: DesignNode) =>
	node.props["data-trickroom-name"];

const getChildIds = (node: DesignNode) =>
	Array.isArray(node.children) ? node.children.map((child) => child.id) : [];

const getTextPreview = (text: string) =>
	text.length <= 80 ? text : `${text.slice(0, 77)}...`;

type TreeReadBounds = {
	maxDepth: number | null;
	maxNodes: number | null;
	allowLarge: boolean;
};

type TreeReadStats = TreeReadBounds & {
	returnedNodeCount: number;
	omittedNodeCount: number;
	truncated: boolean;
};

export type TreeReadInput = {
	depth?: number;
	maxNodes?: number;
	allowLarge?: boolean;
};

const defaultTreeReadDepth = 2;
const defaultTreeReadMaxNodes = 100;
const safeTreeReadMaxDepth = 4;
const safeTreeReadMaxNodes = 500;

export const createTreeReadBounds = (
	input: TreeReadInput = {},
): TreeReadBounds => {
	const allowLarge = input.allowLarge === true;
	if (
		!allowLarge &&
		input.depth !== undefined &&
		input.depth > safeTreeReadMaxDepth
	) {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			`Depth ${input.depth} requires allowLarge: true. Default MCP reads are capped at depth ${safeTreeReadMaxDepth}.`,
		);
	}
	if (
		!allowLarge &&
		input.maxNodes !== undefined &&
		input.maxNodes > safeTreeReadMaxNodes
	) {
		throw new DesignTransformError(
			"INVALID_OPERATION_PARAMETERS",
			`maxNodes ${input.maxNodes} requires allowLarge: true. Default MCP reads are capped at ${safeTreeReadMaxNodes} nodes.`,
		);
	}

	return {
		maxDepth: allowLarge
			? (input.depth ?? null)
			: (input.depth ?? defaultTreeReadDepth),
		maxNodes: allowLarge
			? (input.maxNodes ?? null)
			: (input.maxNodes ?? defaultTreeReadMaxNodes),
		allowLarge,
	};
};

export const createTreeReadStats = (bounds: TreeReadBounds): TreeReadStats => ({
	...bounds,
	returnedNodeCount: 0,
	omittedNodeCount: 0,
	truncated: false,
});

const countElementNodes = (node: DesignNode): number =>
	Array.isArray(node.children)
		? 1 +
			node.children.reduce(
				(count, child) => count + countElementNodes(child),
				0,
			)
		: 1;

const countTextLeaves = (node: DesignNode): number =>
	typeof node.children === "string"
		? 1
		: node.children.reduce((count, child) => count + countTextLeaves(child), 0);

const getMaxElementDepth = (node: DesignNode, depth = 0): number =>
	Array.isArray(node.children) && node.children.length > 0
		? Math.max(
				...node.children.map((child) => getMaxElementDepth(child, depth + 1)),
			)
		: depth;

export const getDesignCounts = (design: TrickroomDesign) => {
	const elementCount = design.boards.reduce(
		(count, board) => count + countElementNodes(board),
		0,
	);
	const textLeavesCount = design.boards.reduce(
		(count, board) => count + countTextLeaves(board),
		0,
	);
	const maxDepth =
		design.boards.length === 0
			? 0
			: Math.max(...design.boards.map((board) => getMaxElementDepth(board)));

	return {
		boardsCount: design.boards.length,
		layersCount: elementCount - design.boards.length,
		elementCount,
		textLeavesCount,
		maxDepth,
	};
};

const omitElementSubtree = (stats: TreeReadStats, node: DesignNode) => {
	stats.omittedNodeCount += countElementNodes(node);
	stats.truncated = true;
};

const hasTreeNodeBudget = (stats: TreeReadStats) =>
	stats.maxNodes === null || stats.returnedNodeCount < stats.maxNodes;

export const getTreeReadMetadata = (stats: TreeReadStats) => ({
	depth: stats.maxDepth,
	maxNodes: stats.maxNodes,
	allowLarge: stats.allowLarge,
	truncated: stats.truncated,
	returnedNodeCount: stats.returnedNodeCount,
	omittedNodeCount: stats.omittedNodeCount,
});

type RecipeAttachmentSummary = {
	recipeId: string;
	instanceId: string;
	rootElementId: string | null;
	path: string;
	slotName: string | null;
	state: RecipeInstanceValidationReport["status"];
	currentVersion: string | null;
	matchedTemplateVersion: string | null;
};

export const getRecipeAttachmentSummaries = (design: TrickroomDesign) => {
	const summaryByInstanceId = new Map<
		string,
		{
			rootElementId: string | null;
			state: RecipeAttachmentSummary["state"];
			currentVersion: string | null;
			matchedTemplateVersion: string | null;
		}
	>();
	for (const instance of validateRecipeInstances(design.boards).instances) {
		summaryByInstanceId.set(instance.instanceId, {
			rootElementId: instance.rootElementId,
			state: instance.status,
			currentVersion: instance.currentVersion,
			matchedTemplateVersion: instance.matchedTemplateVersion,
		});
	}

	const summariesByElementId = new Map<string, RecipeAttachmentSummary>();

	const visit = (node: DesignNode) => {
		const metadata = getElementRecipeMetadata(node);
		if (metadata !== null) {
			const instanceSummary = summaryByInstanceId.get(metadata.instanceId);
			if (instanceSummary) {
				summariesByElementId.set(node.id, {
					recipeId: metadata.recipeId,
					instanceId: metadata.instanceId,
					rootElementId: instanceSummary.rootElementId,
					path: metadata.path,
					slotName: metadata.slotName,
					state: instanceSummary.state,
					currentVersion: instanceSummary.currentVersion,
					matchedTemplateVersion: instanceSummary.matchedTemplateVersion,
				});
			}
		}

		if (Array.isArray(node.children)) {
			for (const child of node.children) {
				visit(child);
			}
		}
	};

	for (const root of design.boards) {
		visit(root);
	}

	return summariesByElementId;
};

// Compact trees carry the user-authored className so agents can see styling
// without a detailed read; omitted when empty to keep payloads lean.
const getCompactClassName = (node: DesignNode) =>
	typeof node.props.className === "string" &&
	node.props.className.trim().length > 0
		? { className: node.props.className }
		: {};

export const compactElementTree = (
	node: DesignNode,
): Record<string, unknown> => {
	const isText = typeof node.children === "string";

	return {
		id: node.id,
		name: getNodeName(node),
		library: node.props["data-trickroom-library"],
		component: node.props["data-trickroom-component"],
		role: normalizeRole(node.props["data-trickroom-role"]),
		...getCompactClassName(node),
		...(isText
			? {
					textLength: node.children.length,
					textPreview: getTextPreview(node.children),
				}
			: {
					childIds: getChildIds(node),
					children: node.children.map(compactElementTree),
				}),
	};
};

export const compactElementTreeBounded = (
	node: DesignNode,
	stats: TreeReadStats,
	currentDepth = 0,
): Record<string, unknown> => {
	stats.returnedNodeCount += 1;
	const isText = typeof node.children === "string";

	if (isText) {
		return {
			id: node.id,
			name: getNodeName(node),
			library: node.props["data-trickroom-library"],
			component: node.props["data-trickroom-component"],
			role: normalizeRole(node.props["data-trickroom-role"]),
			...getCompactClassName(node),
			textLength: node.children.length,
			textPreview: getTextPreview(node.children),
			truncated: false,
		};
	}

	const childIds = getChildIds(node);
	const depthTruncated =
		stats.maxDepth !== null && currentDepth >= stats.maxDepth;
	const children: Record<string, unknown>[] = [];
	const omittedBefore = stats.omittedNodeCount;

	if (depthTruncated) {
		for (const child of node.children) {
			omitElementSubtree(stats, child);
		}
	} else {
		for (const child of node.children) {
			if (!hasTreeNodeBudget(stats)) {
				omitElementSubtree(stats, child);
				continue;
			}
			children.push(compactElementTreeBounded(child, stats, currentDepth + 1));
		}
	}

	return {
		id: node.id,
		name: getNodeName(node),
		library: node.props["data-trickroom-library"],
		component: node.props["data-trickroom-component"],
		role: normalizeRole(node.props["data-trickroom-role"]),
		...getCompactClassName(node),
		childIds,
		children,
		truncated: stats.omittedNodeCount > omittedBefore,
	};
};

export const compactElementForestBounded = (
	nodes: DesignNode[],
	bounds: TreeReadBounds,
) => {
	const stats = createTreeReadStats(bounds);
	const elementTree: Record<string, unknown>[] = [];

	for (const node of nodes) {
		if (!hasTreeNodeBudget(stats)) {
			omitElementSubtree(stats, node);
			continue;
		}
		elementTree.push(compactElementTreeBounded(node, stats));
	}

	return {
		elementTree,
		read: getTreeReadMetadata(stats),
	};
};

export const summarizeBoard = (board: DesignNode) => {
	const childIds = getChildIds(board);
	return {
		id: board.id,
		name: getNodeName(board),
		library: board.props["data-trickroom-library"],
		component: board.props["data-trickroom-component"],
		role: normalizeRole(board.props["data-trickroom-role"]),
		childIds,
		childCount: childIds.length,
		descendantCount: countElementNodes(board) - 1,
	};
};

export const detailedElement = (node: DesignNode) => ({
	id: node.id,
	props: node.props,
	text: typeof node.children === "string" ? node.children : null,
	childIds: getChildIds(node),
});

export const detailedSubtree = (
	node: DesignNode,
	stats: TreeReadStats,
	currentDepth = 0,
	recipeSummariesByElementId?: ReadonlyMap<string, RecipeAttachmentSummary>,
): Record<string, unknown> => {
	stats.returnedNodeCount += 1;
	const recipe = recipeSummariesByElementId?.get(node.id);

	if (typeof node.children === "string") {
		return {
			...detailedElement(node),
			...(recipe ? { recipe } : {}),
			children: node.children,
			truncated: false,
		};
	}

	const depthTruncated =
		stats.maxDepth !== null && currentDepth >= stats.maxDepth;
	const children: Record<string, unknown>[] = [];
	const omittedBefore = stats.omittedNodeCount;

	if (depthTruncated) {
		for (const child of node.children) {
			omitElementSubtree(stats, child);
		}
	} else {
		for (const child of node.children) {
			if (!hasTreeNodeBudget(stats)) {
				omitElementSubtree(stats, child);
				continue;
			}
			children.push(
				detailedSubtree(
					child,
					stats,
					currentDepth + 1,
					recipeSummariesByElementId,
				),
			);
		}
	}

	return {
		...detailedElement(node),
		...(recipe ? { recipe } : {}),
		children,
		truncated: stats.omittedNodeCount > omittedBefore,
	};
};

export const findElementContext = (
	design: TrickroomDesign,
	elementId: string,
): ElementContext | null => {
	const visit = (
		node: DesignNode,
		parent: DesignNode | null,
		index: number | null,
		rootIndex: number | null,
		siblingIds: string[],
	): ElementContext | null => {
		if (node.id === elementId) {
			return {
				element: node,
				parent,
				index,
				rootIndex,
				siblingIds,
			};
		}

		if (typeof node.children === "string") {
			return null;
		}

		const childSiblingIds = node.children.map((child) => child.id);
		for (const [childIndex, child] of node.children.entries()) {
			const found = visit(child, node, childIndex, null, childSiblingIds);
			if (found) {
				return found;
			}
		}

		return null;
	};

	const rootSiblingIds = design.boards.map((board) => board.id);
	for (const [rootIndex, root] of design.boards.entries()) {
		const found = visit(root, null, null, rootIndex, rootSiblingIds);
		if (found) {
			return found;
		}
	}

	return null;
};

export const getSiblingContext = (context: ElementContext) => {
	const currentIndex = context.index ?? context.rootIndex ?? null;

	return {
		parentId: context.parent?.id ?? null,
		root: context.parent === null,
		index: currentIndex,
		rootIndex: context.rootIndex,
		siblingIds: context.siblingIds,
		previousSiblingId:
			currentIndex === null || currentIndex <= 0
				? null
				: context.siblingIds[currentIndex - 1],
		nextSiblingId:
			currentIndex === null || currentIndex >= context.siblingIds.length - 1
				? null
				: context.siblingIds[currentIndex + 1],
	};
};

export const getElementContextOrThrow = (
	design: TrickroomDesign,
	elementId: string,
) => {
	const context = findElementContext(design, elementId);
	if (!context) {
		throw createElementNotFoundError(design, elementId);
	}

	return context;
};

export const getCompactElementSummary = (
	design: TrickroomDesign,
	elementId: string,
) => {
	const ctx = findElementContext(design, elementId);
	if (!ctx) return null;
	const node = ctx.element;
	const isText = typeof node.children === "string";
	return {
		id: node.id,
		name: node.props["data-trickroom-name"],
		library: node.props["data-trickroom-library"],
		component: node.props["data-trickroom-component"],
		role: normalizeRole(node.props["data-trickroom-role"]),
		...(isText
			? {
					textLength: node.children.length,
					textPreview: getTextPreview(node.children),
				}
			: {
					childIds: getChildIds(node),
				}),
	};
};

export const getMutationContext = (
	design: TrickroomDesign,
	elementId: string,
) => {
	const ctx = findElementContext(design, elementId);
	if (!ctx) return null;
	return getSiblingContext(ctx);
};

export const readDesignFileForTool = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	const service = createDesignFileService(context.projectRoot);
	return service.readDesignFile(service.getFileForUuid(designFileId));
};
