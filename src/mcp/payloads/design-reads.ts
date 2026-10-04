import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { DesignTransformError } from "../../services/design-transform-service";
import type { TrickroomDesign } from "../../types";
import { findDesignSystem } from "../../utils/design-system-store";
import { readMemoryManifest } from "../../utils/memory-manifest-service";
import type { MemoryScope } from "../../utils/memory-manifest-service.types";
import { readDomainTokensReadonly } from "../../utils/tailwind-token-store";
import { buildDesignGraph } from "../design-graph";
import { assertCanReadDesignFile, getMcpPolicy } from "../governance";
import { buildDesignResourceUri, slugifyDesignTitle } from "../resources";
import type { TrickroomMcpServerContext } from "../server-types";
import { TOOL } from "../tool-names";
import { summarizeDesignSystemReference } from "./design-system";
import {
	countElementNodes,
	createTreeReadBounds,
	describeNode,
	describeTreeRead,
	findElementContext,
	getDesignHeader,
	getDesignSystemHandle,
	getElementContextOrThrow,
	getElementReadContext,
	getNodeName,
	getRecipeAttachmentSummaries,
	listVisibleDesignSummaries,
	type NodeReadDetail,
	readBoundedTree,
	readDesignFileForTool,
	type TreeReadInput,
} from "./design-tree";
import {
	getDesignResourceLocationId,
	getGovernanceSummary,
	getProjectDetails,
	getProjectReference,
} from "./project";

// Default bounds per design_read shape; maxNodes is taken breadth first.
export const readDesignFileDefaults = { depth: 2, maxNodes: 50 };
export const readSubtreeDefaults = { depth: 3, maxNodes: 100 };
export const readDesignGraphDefaults = { depth: null, maxNodes: 100 };

/**
 * Lists design files with ids, names and revisions only: the shape resources
 * and policy checks need. design_list adds boards, systems and memory counts.
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

const countMemoryNotes = async (
	context: TrickroomMcpServerContext,
	scope: MemoryScope,
) => {
	try {
		const read = await readMemoryManifest(context.projectRoot, scope);
		return Object.keys(read.manifest.notes).length;
	} catch {
		return 0;
	}
};

/**
 * A design system as design_list reports it: name, CSS entry, whether a
 * token snapshot is stored (and needs review), and its memory note count.
 */
const describeListedSystem = async (
	context: TrickroomMcpServerContext,
	systemHandle: string,
) => {
	const system = await findDesignSystem(context.projectRoot, systemHandle);
	if (!system) {
		return { name: systemHandle, configured: false };
	}
	const { systemId } = system.manifest;
	const [tokens, memoryNotes] = await Promise.all([
		readDomainTokensReadonly(context.projectRoot, systemId).catch(() => null),
		countMemoryNotes(context, { kind: "system", systemHandle: systemId }),
	]);
	return {
		name: system.manifest.systemName,
		...(system.manifest.cssPath ? { cssPath: system.manifest.cssPath } : {}),
		tokens: tokens
			? {
					syncedAt: tokens.metadata.syncedAt,
					...(tokens.metadata.reviewRequired ? { reviewRequired: true } : {}),
				}
			: null,
		...(memoryNotes > 0 ? { memoryNotes } : {}),
	};
};

export const listDesignFilesToolPayload = async (
	context: TrickroomMcpServerContext,
) => {
	const policy = getMcpPolicy(context.config);
	const { designFiles } = await listDesignFilesPayload(context);
	const defaultSystemId = context.config.defaultSystemId ?? null;
	const systemHandles = new Map<string, string>();
	const entries = await Promise.all(
		designFiles.map(async ({ systemHandle, ...designFile }) => {
			let systemId: string | null = null;
			if (systemHandle !== null) {
				const system = await findDesignSystem(
					context.projectRoot,
					systemHandle,
				);
				systemId = system?.manifest.systemId ?? systemHandle;
				systemHandles.set(systemId, systemHandle);
			}
			const [boards, memoryNotes] = await Promise.all([
				designFile.diagnostic === undefined
					? getBoardIndex(context, designFile.id, designFile.revision)
					: null,
				countMemoryNotes(context, { kind: "design", designId: designFile.id }),
			]);
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
				...(memoryNotes > 0 ? { memoryNotes } : {}),
				...(designFile.diagnostic !== undefined
					? { diagnostic: designFile.diagnostic }
					: {}),
			};
		}),
	);
	if (defaultSystemId !== null && !systemHandles.has(defaultSystemId)) {
		systemHandles.set(defaultSystemId, defaultSystemId);
	}
	const systems = Object.fromEntries(
		await Promise.all(
			[...systemHandles].map(
				async ([systemId, handle]) =>
					[systemId, await describeListedSystem(context, handle)] as const,
			),
		),
	);
	const governance = getGovernanceSummary(policy);

	const projectMemoryNotes = await countMemoryNotes(context, {
		kind: "project",
	});
	return {
		project: getProjectReference(context),
		...(projectMemoryNotes > 0 ? { memoryNotes: projectMemoryNotes } : {}),
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
		"BOARD_NOT_FOUND",
		`Board "${boardId}" was not found in design "${designFileId}".${
			nested
				? ` "${boardId}" is a nested element, not a board; read it with ${TOOL.designRead} elementId.`
				: ""
		}`,
		{
			availableBoardIds: availableBoards.map((board) => board.id),
			availableBoards,
		},
	);
};

const summarizeBoards = (design: TrickroomDesign) =>
	design.boards.map((board) => ({
		id: board.id,
		name: getNodeName(board) ?? null,
		elementCount: countElementNodes(board),
	}));

const getDesignReadSystem = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
) => {
	const system = await summarizeDesignSystemReference(
		context,
		getDesignSystemHandle(design),
	);
	return {
		systemId: system?.systemId ?? null,
		...(system ? { systemName: system.systemName } : {}),
		...(system && !system.configured ? { systemConfigured: false } : {}),
	};
};

/** The `trickroom://` design resource: header and board index, no tree. */
export const readDesignSummaryPayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	const boards = summarizeBoards(read.design);

	return {
		payloadKind: "design-summary",
		project: getProjectReference(context),
		designFile: {
			...getDesignHeader(designFileId, read),
			...(await getDesignReadSystem(context, read.design)),
		},
		elementCount: boards.reduce(
			(count, board) => count + board.elementCount,
			0,
		),
		boards,
		nextSuggestedReads: [
			`${TOOL.designRead} with boardId for one board's bounded compact tree`,
			`${TOOL.designRead} with elementId for one area, depth 0 for one element`,
		],
	};
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
	const boards = summarizeBoards(design);

	return {
		project: getProjectReference(context),
		designFile: {
			...getDesignHeader(designFileId, read),
			...(await getDesignReadSystem(context, design)),
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
						tool: TOOL.designRead,
						args: { designFileId, elementId: truncatedElementId },
					}
				: omittedBoard !== undefined
					? {
							tool: TOOL.designRead,
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
		designFile: getDesignHeader(designFileId, read),
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
	const { element } = elementContext;
	const [subtree] = tree;

	// depth 0 reads one element: its children's ids replace the read block.
	if (bounds.maxDepth === 0) {
		return {
			project: getProjectReference(context),
			designFile: getDesignHeader(designFileId, read),
			context: getElementReadContext(elementContext),
			subtree: Array.isArray(element.children)
				? { ...subtree, childIds: element.children.map((child) => child.id) }
				: subtree,
		};
	}

	return {
		project: getProjectReference(context),
		designFile: getDesignHeader(designFileId, read),
		read: describeTreeRead(bounds, treeRead, {
			tool: TOOL.designRead,
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
		subtree,
	};
};

export const readDesignGraphPayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	options: TreeReadInput & {
		/** Scope to one board; unknown ids fail with BOARD_NOT_FOUND. */
		boardId?: string;
		rootElementId?: string;
		includeProps?: boolean;
	},
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	if (
		options.boardId !== undefined &&
		!read.design.boards.some((board) => board.id === options.boardId)
	) {
		throwBoardNotFound(read.design, designFileId, options.boardId);
	}
	const bounds = createTreeReadBounds(options, readDesignGraphDefaults);
	const { returnedNodeCount, omittedNodeCount, truncatedElementIds, ...graph } =
		buildDesignGraph(read.design, bounds, {
			rootElementId: options.rootElementId ?? options.boardId,
			includeProps: options.includeProps,
		});
	const truncatedElementId = truncatedElementIds[0];

	return {
		project: getProjectReference(context),
		designFile: getDesignHeader(designFileId, read),
		read: describeTreeRead(
			bounds,
			{ returnedNodeCount, omittedNodeCount, truncatedElementIds },
			truncatedElementId !== undefined
				? {
						tool: TOOL.designRead,
						args: { designFileId, elementId: truncatedElementId },
					}
				: null,
		),
		graph,
	};
};
