import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import type { DesignFileRead } from "../../services/design-file-service";
import { DesignTransformError } from "../../services/design-transform-service";
import type { Node as DesignNode, TrickroomDesign } from "../../types";
import { findDesignSystem } from "../../utils/design-system-store";
import { buildDesignGraph } from "../design-graph";
import { assertCanReadDesignFile, getMcpPolicy } from "../governance";
import { buildDesignResourceUri, slugifyDesignTitle } from "../resources";
import type { TrickroomMcpServerContext } from "../server-types";
import { summarizeDesignSystemReference } from "./design-system";
import {
	createTreeReadBounds,
	describeNode,
	describeTreeRead,
	findElementContext,
	getDesignCounts,
	getDesignMetadata,
	getDesignSystemHandle,
	getElementContextOrThrow,
	getElementReadContext,
	getNodeName,
	getRecipeAttachmentSummaries,
	listVisibleDesignSummaries,
	type NodeReadDetail,
	readBoundedTree,
	readDesignFileForTool,
	readErrorCode,
	summarizeBoard,
	type TreeReadInput,
} from "./design-tree";
import {
	getDesignResourceLocationId,
	getGovernanceSummary,
	getProjectDetails,
	getProjectReference,
} from "./project";

export const readDesignSummaryPayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);

	return {
		payloadKind: "design-summary",
		project: getProjectReference(context),
		designFile: getDesignMetadata(designFileId, read),
		designSystem: await summarizeDesignSystemReference(
			context,
			getDesignSystemHandle(read.design),
		),
		rootElementIds: read.design.boards.map((board) => board.id),
		boards: read.design.boards.map(summarizeBoard),
		counts: getDesignCounts(read.design),
		nextSuggestedReads: [
			"readDesignFile with boardId for one board's bounded compact tree",
			"readSubtree with elementId for one area",
			"readElement for one exact element",
		],
	};
};

const countElements = (node: DesignNode): number =>
	Array.isArray(node.children)
		? node.children.reduce((count, child) => count + countElements(child), 1)
		: 1;

// Default bounds per read tool; maxNodes is taken breadth first.
export const readDesignFileDefaults = { depth: 2, maxNodes: 50 };
export const readSubtreeDefaults = { depth: 3, maxNodes: 100 };
export const readDesignGraphDefaults = { depth: null, maxNodes: 100 };

/** The compact design header every read returns. */
const getDesignReadHeader = (designFileId: string, read: DesignFileRead) => ({
	id: designFileId,
	name: read.design.name,
	revision: read.revision,
});

/**
 * Lists design files with ids, names and revisions only: the shape resources
 * and policy checks need. The listDesignFiles tool adds board ids and names.
 */
export const listDesignFilesPayload = async (
	context: TrickroomMcpServerContext,
) => {
	const designFiles = await listVisibleDesignSummaries(context);
	return {
		project: getProjectReference(context),
		designFiles: designFiles.map((designFile) => ({
			id: designFile.uuid,
			name: designFile.name,
			systemHandle: getDesignSystemHandle(designFile),
			layersCount: designFile.layersCount,
			modifiedAt: designFile.modifiedAt,
			revision: designFile.revision,
			...(designFile.diagnostic !== undefined
				? { diagnostic: designFile.diagnostic }
				: {}),
		})),
	};
};

type BoardIndexEntry = { id: string; name: string | null };

// Board ids and names per design file, keyed by path and revision so repeat
// listings only re-read designs that changed.
const boardIndexCache = new Map<
	string,
	{ revision: string; boards: BoardIndexEntry[] }
>();

const getBoardIndex = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	revision: string,
): Promise<BoardIndexEntry[] | null> => {
	const cacheKey = `${context.projectRoot}\0${designFileId}`;
	const cached = boardIndexCache.get(cacheKey);
	if (cached?.revision === revision) {
		return cached.boards;
	}
	try {
		const read = await readDesignFileForTool(context, designFileId);
		const boards = read.design.boards.map((board) => ({
			id: board.id,
			name: getNodeName(board) ?? null,
		}));
		boardIndexCache.set(cacheKey, { revision: read.revision, boards });
		return boards;
	} catch {
		return null;
	}
};

export const listDesignFilesToolPayload = async (
	context: TrickroomMcpServerContext,
) => {
	const policy = getMcpPolicy(context.config);
	const { designFiles } = await listDesignFilesPayload(context);
	const defaultSystemId = context.config.defaultSystemId ?? null;
	const systems: Record<string, string> = {};
	const entries = await Promise.all(
		designFiles.map(async ({ systemHandle, ...designFile }) => {
			let systemId: string | null = null;
			if (systemHandle !== null) {
				const system = await findDesignSystem(
					context.projectRoot,
					systemHandle,
				);
				systemId = system?.manifest.systemId ?? systemHandle;
				systems[systemId] = system?.manifest.systemName ?? systemHandle;
			}
			const boards =
				designFile.diagnostic === undefined
					? await getBoardIndex(context, designFile.id, designFile.revision)
					: null;
			return {
				id: designFile.id,
				name: designFile.name,
				revision: designFile.revision,
				// Designs on the project default system omit systemId.
				...(systemId !== null && systemId === defaultSystemId
					? {}
					: { systemId }),
				layersCount: designFile.layersCount,
				modifiedAt: designFile.modifiedAt,
				...(boards !== null ? { boards } : {}),
				...(designFile.diagnostic !== undefined
					? { diagnostic: designFile.diagnostic }
					: {}),
			};
		}),
	);
	const governance = getGovernanceSummary(policy);

	return {
		project: getProjectReference(context),
		governance: {
			mode: governance.mode,
			...(governance.allowedDesignFileIds !== null
				? { allowedDesignFileIds: governance.allowedDesignFileIds }
				: {}),
			...(governance.allowedComponents !== null
				? { allowedComponents: governance.allowedComponents }
				: {}),
		},
		defaultSystemId,
		systems,
		designFiles: entries,
	};
};

export const toDesignFileResources = (
	context: TrickroomMcpServerContext,
	payload: Awaited<ReturnType<typeof listDesignFilesPayload>>,
): Resource[] => {
	const project = getProjectDetails(context);
	const locationId = getDesignResourceLocationId(context) ?? project.locationId;
	if (!locationId) {
		return [];
	}

	return payload.designFiles.map((designFile) => {
		const slug = slugifyDesignTitle(designFile.name) || "design";
		const projectLabel = `${project.name} (${locationId})`;

		return {
			uri: buildDesignResourceUri(locationId, designFile.id, slug),
			name: `design:${locationId}:${slug}--${designFile.id}`,
			title: `${designFile.name} - ${projectLabel}`,
			description: `Design file in ${projectLabel}`,
			mimeType: "application/json",
		};
	});
};

const throwBoardNotFound = (
	design: TrickroomDesign,
	designFileId: string,
	boardId: string,
): never => {
	const availableBoards = design.boards.map((board) => ({
		id: board.id,
		name: getNodeName(board) ?? null,
	}));
	const nested = findElementContext(design, boardId);
	throw new DesignTransformError(
		readErrorCode("BOARD_NOT_FOUND"),
		`Board "${boardId}" was not found in design "${designFileId}".${
			nested
				? ` "${boardId}" is a nested element, not a board; use readSubtree to read it.`
				: ""
		}`,
		{
			availableBoardIds: availableBoards.map((board) => board.id),
			availableBoards,
		},
	);
};

export type DesignReadOptions = TreeReadInput & {
	detail?: NodeReadDetail;
};

export const readDesignFilePayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	options: DesignReadOptions & { boardId?: string } = {},
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	const { design } = read;
	const roots =
		options.boardId === undefined
			? design.boards
			: [
					design.boards.find((board) => board.id === options.boardId) ??
						throwBoardNotFound(design, designFileId, options.boardId),
				];
	const bounds = createTreeReadBounds(options, readDesignFileDefaults);
	const { tree, read: treeRead } = readBoundedTree(
		roots,
		bounds,
		options.detail ?? "compact",
		getRecipeAttachmentSummaries(design),
	);
	const omittedBoard = roots.find(
		(board) => !tree.some((node) => node.id === board.id),
	);
	const truncatedElementId = treeRead.truncatedElementIds[0];
	const system = await summarizeDesignSystemReference(
		context,
		getDesignSystemHandle(design),
	);
	const boards = design.boards.map((board) => ({
		id: board.id,
		name: getNodeName(board) ?? null,
		elementCount: countElements(board),
	}));

	return {
		project: getProjectReference(context),
		designFile: {
			...getDesignReadHeader(designFileId, read),
			systemId: system?.systemId ?? null,
			...(system ? { systemName: system.systemName } : {}),
			...(system && !system.configured ? { systemConfigured: false } : {}),
		},
		elementCount: boards.reduce(
			(count, board) => count + board.elementCount,
			0,
		),
		boards,
		read: describeTreeRead(
			bounds,
			treeRead,
			truncatedElementId !== undefined
				? {
						tool: "readSubtree",
						args: { designFileId, elementId: truncatedElementId },
					}
				: omittedBoard !== undefined
					? {
							tool: "readDesignFile",
							args: { designFileId, boardId: omittedBoard.id },
						}
					: null,
		),
		tree,
	};
};

export const readElementPayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	elementId: string,
	options: { detail?: NodeReadDetail } = {},
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	const elementContext = getElementContextOrThrow(read.design, elementId);
	const { element } = elementContext;

	return {
		project: getProjectReference(context),
		designFile: getDesignReadHeader(designFileId, read),
		element: {
			...describeNode(
				element,
				options.detail ?? "compact",
				getRecipeAttachmentSummaries(read.design),
			),
			...(Array.isArray(element.children)
				? { childIds: element.children.map((child) => child.id) }
				: {}),
		},
		context: getElementReadContext(elementContext),
	};
};

export const readSubtreePayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	elementId: string,
	options: DesignReadOptions = {},
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	const elementContext = getElementContextOrThrow(read.design, elementId);
	const bounds = createTreeReadBounds(options, readSubtreeDefaults);
	const { tree, read: treeRead } = readBoundedTree(
		[elementContext.element],
		bounds,
		options.detail ?? "compact",
		getRecipeAttachmentSummaries(read.design),
	);
	const truncatedElementId = treeRead.truncatedElementIds.find(
		(id) => id !== elementId,
	);

	return {
		project: getProjectReference(context),
		designFile: getDesignReadHeader(designFileId, read),
		read: describeTreeRead(bounds, treeRead, {
			tool: "readSubtree",
			args: {
				designFileId,
				elementId: truncatedElementId ?? elementId,
				...(truncatedElementId === undefined
					? {
							maxNodes: Math.min(
								(bounds.maxNodes ?? readSubtreeDefaults.maxNodes) * 2,
								500,
							),
						}
					: {}),
			},
		}),
		context: getElementReadContext(elementContext),
		subtree: tree[0],
	};
};

export const readDesignGraphPayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	options: TreeReadInput & {
		rootElementId?: string;
		includeProps?: boolean;
		includeText?: boolean;
		includeAddresses?: boolean;
	},
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	const bounds = createTreeReadBounds(options, readDesignGraphDefaults);
	const { returnedNodeCount, omittedNodeCount, truncatedElementIds, ...graph } =
		buildDesignGraph(read.design, bounds, options);
	const truncatedElementId = truncatedElementIds[0];

	return {
		project: getProjectReference(context),
		designFile: getDesignReadHeader(designFileId, read),
		read: describeTreeRead(
			bounds,
			{ returnedNodeCount, omittedNodeCount, truncatedElementIds },
			truncatedElementId !== undefined
				? {
						tool: "readSubtree",
						args: { designFileId, elementId: truncatedElementId },
					}
				: null,
		),
		graph,
	};
};
