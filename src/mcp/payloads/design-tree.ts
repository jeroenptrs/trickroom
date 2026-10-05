import {
	CORE_PROP_KEYS,
	getControlProps,
	normalizeRole,
	resolveRegistryComponent,
	SYSTEM_PROP_KEYS,
} from "../../libraries/registry";
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
import type {
	Node as DesignNode,
	JsonPrimitive,
	RegistryComponentDefinition,
	TrickroomDesign,
} from "../../types";
import { formatDidYouMean, suggestClosest } from "../../utils/suggestions";
import { getSystemComponentStructuralMetadata } from "../../utils/system-component-markers";
import { getMcpPolicy } from "../governance";
import type { TrickroomMcpServerContext } from "../server-types";
import { TOOL } from "../tool-names";

type ElementContext = {
	element: DesignNode;
	parent: DesignNode | null;
	index: number | null;
	rootIndex: number | null;
	siblingIds: string[];
	board: DesignNode;
};

export const getDesignSystemHandle = (
	design: Pick<TrickroomDesign, "systemId" | "systemName">,
) => {
	if (design.systemId !== undefined) {
		return design.systemId;
	}

	return design.systemName ?? null;
};

/** The compact design header every read and write returns. */
export const getDesignHeader = (
	designFileId: string,
	read: Pick<DesignFileRead, "design" | "revision">,
) => ({
	id: designFileId,
	name: read.design.name,
	revision: read.revision,
});

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

export type TreeReadBounds = {
	maxDepth: number | null;
	maxNodes: number | null;
	allowLarge: boolean;
};

export type TreeReadInput = {
	depth?: number;
	maxNodes?: number;
	allowLarge?: boolean;
};

type TreeReadDefaults = {
	depth: number | null;
	maxNodes: number;
};

const defaultTreeReadBounds: TreeReadDefaults = { depth: 2, maxNodes: 100 };
const safeTreeReadMaxDepth = 4;
const safeTreeReadMaxNodes = 500;

export const createTreeReadBounds = (
	input: TreeReadInput = {},
	defaults: TreeReadDefaults = defaultTreeReadBounds,
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
			: (input.depth ?? defaults.depth),
		maxNodes: allowLarge
			? (input.maxNodes ?? null)
			: (input.maxNodes ?? defaults.maxNodes),
		allowLarge,
	};
};

export const countElementNodes = (node: DesignNode): number =>
	Array.isArray(node.children)
		? 1 +
			node.children.reduce(
				(count, child) => count + countElementNodes(child),
				0,
			)
		: 1;

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

// Read node shapes. "compact" keeps what an agent needs to target a write:
// id, a non-default layer name, `component` as "<library>/<component>" (the
// `trickroom/` prefix is dropped), className, text, and props that are neither
// Trickroom markers nor registry defaults. Instance markers collapse into a
// short `systemComponent`/`recipe` summary plus `slot` on slot hosts. "full"
// adds every stored prop, markers included.
export type NodeReadDetail = "compact" | "full";

const compactTextLimit = 160;

const getComponentRef = (node: DesignNode) => {
	const library = node.props["data-trickroom-library"];
	const component = node.props["data-trickroom-component"];
	return library === "trickroom" ? component : `${library}/${component}`;
};

const registryDefinitionCache = new Map<
	string,
	{
		definition: RegistryComponentDefinition;
		defaults: Record<string, JsonPrimitive | undefined>;
	} | null
>();

const getRegistryEntry = (node: DesignNode) => {
	const library = node.props["data-trickroom-library"];
	const component = node.props["data-trickroom-component"];
	const key = `${library}/${component}`;
	let entry = registryDefinitionCache.get(key);
	if (entry === undefined) {
		const resolution = resolveRegistryComponent(library, component);
		entry =
			resolution.status === "known"
				? {
						definition: resolution.definition,
						defaults: getControlProps(resolution.definition),
					}
				: null;
		registryDefinitionCache.set(key, entry);
	}
	return entry;
};

const getCompactText = (text: string) =>
	text.length <= compactTextLimit
		? { text }
		: {
				text: `${text.slice(0, compactTextLimit - 1)}\u2026`,
				textLength: text.length,
			};

const getCompactProps = (
	node: DesignNode,
	defaults: Record<string, JsonPrimitive | undefined> | undefined,
) => {
	const props: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(node.props)) {
		if (
			value === undefined ||
			CORE_PROP_KEYS.has(key) ||
			SYSTEM_PROP_KEYS.has(key) ||
			(defaults !== undefined && defaults[key] === value)
		) {
			continue;
		}
		props[key] = value;
	}
	return props;
};

const getInstanceSummary = (
	node: DesignNode,
	recipeSummaries: ReadonlyMap<string, RecipeAttachmentSummary> | undefined,
) => {
	const summary: Record<string, unknown> = {};
	const systemComponent = getSystemComponentStructuralMetadata(node.props);
	if (systemComponent?.isRoot) {
		summary.systemComponent = {
			id: systemComponent.componentId,
			...(Object.keys(systemComponent.variantValues).length > 0
				? { variants: systemComponent.variantValues }
				: {}),
			...(Object.keys(systemComponent.overrides).length > 0
				? { overrides: systemComponent.overrides }
				: {}),
		};
	}
	// Every recipe-owned node carries its instance id and template path, so a
	// read tells which instance and which control path an element is; the
	// root adds the recipe id and any non-valid state.
	const recipe = recipeSummaries?.get(node.id);
	if (recipe) {
		const isRoot =
			recipe.rootElementId === node.id ||
			(recipe.rootElementId === null && recipe.path === "root");
		summary.recipe = isRoot
			? {
					id: recipe.recipeId,
					instanceId: recipe.instanceId,
					...(recipe.state === "attached-valid" ? {} : { state: recipe.state }),
					...(recipe.state === "attached-stale"
						? {
								currentVersion: recipe.currentVersion,
								matchedTemplateVersion: recipe.matchedTemplateVersion,
							}
						: {}),
				}
			: { instanceId: recipe.instanceId, path: recipe.path };
	}
	const slot = systemComponent?.slotName ?? recipe?.slotName ?? null;
	if (slot !== null) {
		summary.slot = slot;
	}
	return summary;
};

export const describeNode = (
	node: DesignNode,
	detail: NodeReadDetail,
	recipeSummaries?: ReadonlyMap<string, RecipeAttachmentSummary>,
): Record<string, unknown> => {
	const isText = typeof node.children === "string";
	if (detail === "full") {
		const recipe = recipeSummaries?.get(node.id);
		return {
			id: node.id,
			props: node.props,
			...(recipe ? { recipe } : {}),
			...(isText ? { text: node.children } : {}),
		};
	}

	const entry = getRegistryEntry(node);
	const name = getNodeName(node);
	const storedRole = node.props["data-trickroom-role"];
	const props = getCompactProps(node, entry?.defaults);
	return {
		id: node.id,
		...(name && name !== entry?.definition.label ? { name } : {}),
		component: getComponentRef(node),
		// Role is derivable from the registry; listed only when it is not.
		...(entry === null
			? { role: normalizeRole(storedRole) }
			: storedRole !== undefined && storedRole !== entry.definition.role
				? { role: storedRole }
				: {}),
		...getCompactClassName(node),
		...(typeof node.children === "string" ? getCompactText(node.children) : {}),
		...(Object.keys(props).length > 0 ? { props } : {}),
		...getInstanceSummary(node, recipeSummaries),
	};
};

/**
 * Picks the nodes a bounded read returns, breadth first: every board/child at
 * a shallow level is listed before anything deeper, so a node budget never
 * spends itself on the first branch and hides its siblings.
 */
const selectNodesBreadthFirst = (
	roots: readonly DesignNode[],
	bounds: TreeReadBounds,
) => {
	const selected = new Set<DesignNode>();
	let level: DesignNode[] = [...roots];
	let depth = 0;
	while (level.length > 0) {
		const next: DesignNode[] = [];
		for (const node of level) {
			if (bounds.maxNodes !== null && selected.size >= bounds.maxNodes) {
				return selected;
			}
			selected.add(node);
			if (
				Array.isArray(node.children) &&
				(bounds.maxDepth === null || depth < bounds.maxDepth)
			) {
				next.push(...node.children);
			}
		}
		level = next;
		depth += 1;
	}
	return selected;
};

export type TreeRead = {
	returnedNodeCount: number;
	omittedNodeCount: number;
	/** Ids of returned nodes with unread descendants, in document order. */
	truncatedElementIds: string[];
};

/**
 * Bounded tree read. Returned nodes nest their returned children; a node
 * whose descendants were cut carries `more` (the omitted element count) so
 * the agent can continue with an elementId read on that id.
 */
export const readBoundedTree = (
	roots: readonly DesignNode[],
	bounds: TreeReadBounds,
	detail: NodeReadDetail,
	recipeSummaries?: ReadonlyMap<string, RecipeAttachmentSummary>,
) => {
	const selected = selectNodesBreadthFirst(roots, bounds);
	const read: TreeRead = {
		returnedNodeCount: selected.size,
		omittedNodeCount: 0,
		truncatedElementIds: [],
	};

	const render = (node: DesignNode): Record<string, unknown> => {
		const described = describeNode(node, detail, recipeSummaries);
		if (!Array.isArray(node.children) || node.children.length === 0) {
			return described;
		}
		const children: Record<string, unknown>[] = [];
		let omitted = 0;
		for (const child of node.children) {
			if (selected.has(child)) {
				children.push(render(child));
			} else {
				omitted += countElementNodes(child);
			}
		}
		if (omitted > 0) {
			read.omittedNodeCount += omitted;
			read.truncatedElementIds.push(node.id);
		}
		return {
			...described,
			...(children.length > 0 ? { children } : {}),
			...(omitted > 0 ? { more: omitted } : {}),
		};
	};

	const tree: Record<string, unknown>[] = [];
	for (const root of roots) {
		if (selected.has(root)) {
			tree.push(render(root));
		} else {
			read.omittedNodeCount += countElementNodes(root);
		}
	}

	return { tree, read };
};

export const describeTreeRead = (
	bounds: TreeReadBounds,
	read: TreeRead,
	continueWith: Record<string, unknown> | null,
) => ({
	depth: bounds.maxDepth,
	maxNodes: bounds.maxNodes,
	returnedNodeCount: read.returnedNodeCount,
	omittedNodeCount: read.omittedNodeCount,
	truncated: read.omittedNodeCount > 0,
	...(read.omittedNodeCount > 0 && continueWith !== null
		? {
				next: continueWith,
				hint: `Elements with \`more\` have unread descendants: call ${TOOL.designRead} with their id as elementId (or raise depth/maxNodes).`,
			}
		: {}),
});

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
		board: DesignNode,
	): ElementContext | null => {
		if (node.id === elementId) {
			return {
				element: node,
				parent,
				index,
				rootIndex,
				siblingIds,
				board,
			};
		}

		if (typeof node.children === "string") {
			return null;
		}

		const childSiblingIds = node.children.map((child) => child.id);
		for (const [childIndex, child] of node.children.entries()) {
			const found = visit(
				child,
				node,
				childIndex,
				null,
				childSiblingIds,
				board,
			);
			if (found) {
				return found;
			}
		}

		return null;
	};

	const rootSiblingIds = design.boards.map((board) => board.id);
	for (const [rootIndex, root] of design.boards.entries()) {
		const found = visit(root, null, null, rootIndex, rootSiblingIds, root);
		if (found) {
			return found;
		}
	}

	return null;
};

/** Placement of one element, without listing every sibling id. */
export const getElementReadContext = (context: ElementContext) => {
	const index = context.index ?? context.rootIndex ?? null;
	return {
		parentId: context.parent?.id ?? null,
		...(context.parent === null ? {} : { boardId: context.board.id }),
		index,
		siblingCount: context.siblingIds.length,
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

/** Design summaries this session may read. */
export const listVisibleDesignSummaries = async (
	context: TrickroomMcpServerContext,
) => {
	const policy = getMcpPolicy(context.config);
	const summaries = await createDesignFileService(
		context.projectRoot,
	).listDesignSummaries();
	return summaries.filter(
		(summary) =>
			policy.allowedDesignFileIds === null ||
			policy.allowedDesignFileIds.has(summary.uuid),
	);
};

const maxListedDesignsInError = 25;

const createDesignNotFoundError = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	const designs = (await listVisibleDesignSummaries(context)).map(
		(summary) => ({ id: summary.uuid, name: summary.name }),
	);
	if (designs.length <= maxListedDesignsInError) {
		return new DesignTransformError(
			"DESIGN_NOT_FOUND",
			`Design file "${designFileId}" does not exist in this project. Use one of availableDesigns.`,
			{ availableDesigns: designs },
		);
	}
	const closestIds = new Set(
		suggestClosest(
			designFileId,
			designs.map((design) => design.id),
		),
	);
	const suggestions = designs.filter((design) => closestIds.has(design.id));
	return new DesignTransformError(
		"DESIGN_NOT_FOUND",
		`Design file "${designFileId}" does not exist in this project.${formatDidYouMean(suggestions.map((design) => design.id))} Call ${TOOL.designList} for every design id.`,
		{ suggestions, designCount: designs.length },
	);
};

export const readDesignFileForTool = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	try {
		return await createDesignFileService(context.projectRoot).readDesignFile(
			designFileId,
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw await createDesignNotFoundError(context, designFileId);
		}
		throw error;
	}
};
