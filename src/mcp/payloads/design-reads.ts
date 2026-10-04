import type { Resource } from "@modelcontextprotocol/sdk/types.js";
import { createDesignFileService } from "../../services/design-file-service";
import { findDesignSystem } from "../../utils/design-system-store";
import { buildDesignGraph } from "../design-graph";
import { assertCanReadDesignFile, getMcpPolicy } from "../governance";
import { buildDesignResourceUri, slugifyDesignTitle } from "../resources";
import type { TrickroomMcpServerContext } from "../server-types";
import { summarizeDesignSystemReference } from "./design-system";
import {
	compactElementForestBounded,
	compactElementTreeBounded,
	createTreeReadBounds,
	createTreeReadStats,
	detailedElement,
	detailedSubtree,
	getDesignCounts,
	getDesignMetadata,
	getDesignSystemHandle,
	getElementContextOrThrow,
	getRecipeAttachmentSummaries,
	getSiblingContext,
	getTreeReadMetadata,
	readDesignFileForTool,
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
			"readDesignFile with depth/maxNodes for a bounded hierarchy",
			"readElement for one exact element",
			"readSubtree with elementId and depth for scoped inspection",
			"readDesignGraph with rootElementId for address lookup",
		],
	};
};

export const listDesignFilesPayload = async (
	context: TrickroomMcpServerContext,
) => {
	const service = createDesignFileService(context.projectRoot);
	const policy = getMcpPolicy(context.config);
	const designFiles = await service.listDesignSummaries();
	const allowedDesignFiles = designFiles.filter(
		(designFile) =>
			policy.allowedDesignFileIds === null ||
			policy.allowedDesignFileIds.has(designFile.uuid),
	);
	const decoratedDesignFiles = await Promise.all(
		allowedDesignFiles.map(async (designFile) => {
			const systemHandle = getDesignSystemHandle(designFile);
			const system = systemHandle
				? await findDesignSystem(context.projectRoot, systemHandle)
				: null;
			return {
				id: designFile.uuid,
				file: designFile.file,
				name: designFile.name,
				systemId:
					designFile.systemId !== undefined
						? designFile.systemId
						: (system?.manifest.systemId ?? null),
				systemName:
					systemHandle === null
						? null
						: (designFile.systemName ??
							system?.manifest.systemName ??
							systemHandle),
				boardsCount: designFile.boardsCount,
				layersCount: designFile.layersCount,
				modifiedAt: designFile.modifiedAt,
				revision: designFile.revision,
				...(designFile.diagnostic !== undefined
					? { diagnostic: designFile.diagnostic }
					: {}),
			};
		}),
	);

	return {
		project: getProjectDetails(context),
		governance: getGovernanceSummary(policy),
		designFiles: decoratedDesignFiles,
	};
};

export const toDesignFileResources = (
	context: TrickroomMcpServerContext,
	payload: Awaited<ReturnType<typeof listDesignFilesPayload>>,
): Resource[] => {
	const locationId =
		getDesignResourceLocationId(context) ?? payload.project.locationId;
	if (!locationId) {
		return [];
	}

	return payload.designFiles.map((designFile) => {
		const slug = slugifyDesignTitle(designFile.name) || "design";
		const projectLabel = `${payload.project.name} (${locationId})`;

		return {
			uri: buildDesignResourceUri(locationId, designFile.id, slug),
			name: `design:${locationId}:${slug}--${designFile.id}`,
			title: `${designFile.name} - ${projectLabel}`,
			description: `Design file in ${projectLabel}`,
			mimeType: "application/json",
		};
	});
};

export const readDesignFilePayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	options: TreeReadInput = {},
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	const bounds = createTreeReadBounds(options);
	const tree = compactElementForestBounded(read.design.boards, bounds);

	return {
		project: getProjectReference(context),
		designFile: getDesignMetadata(designFileId, read),
		designSystem: await summarizeDesignSystemReference(
			context,
			getDesignSystemHandle(read.design),
		),
		rootElementIds: read.design.boards.map((board) => board.id),
		boards: read.design.boards.map(summarizeBoard),
		counts: getDesignCounts(read.design),
		read: tree.read,
		elementTree: tree.elementTree,
	};
};

export const readElementPayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	elementId: string,
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	const elementContext = getElementContextOrThrow(read.design, elementId);

	return {
		project: getProjectReference(context),
		designFile: getDesignMetadata(designFileId, read),
		element: detailedElement(elementContext.element),
		context: getSiblingContext(elementContext),
	};
};

export const readSubtreePayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	elementId: string,
	options: TreeReadInput & { detail?: "full" | "compact" } = {},
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	const elementContext = getElementContextOrThrow(read.design, elementId);
	const bounds = createTreeReadBounds(options);
	const stats = createTreeReadStats(bounds);
	const subtree =
		options.detail === "compact"
			? compactElementTreeBounded(elementContext.element, stats)
			: detailedSubtree(
					elementContext.element,
					stats,
					0,
					getRecipeAttachmentSummaries(read.design),
				);

	return {
		project: getProjectReference(context),
		designFile: getDesignMetadata(designFileId, read),
		elementId,
		depth: bounds.maxDepth,
		read: getTreeReadMetadata(stats),
		context: getSiblingContext(elementContext),
		subtree,
	};
};

export const readDesignGraphPayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	options: {
		rootElementId?: string;
		includeProps?: boolean;
		includeText?: boolean;
	},
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	const recipeSummariesByElementId = getRecipeAttachmentSummaries(read.design);
	const graph = buildDesignGraph(read.design, options);

	return {
		project: getProjectReference(context),
		designFile: getDesignMetadata(designFileId, read),
		designSystem: await summarizeDesignSystemReference(
			context,
			getDesignSystemHandle(read.design),
		),
		graph: {
			...graph,
			elementsById: Object.fromEntries(
				Object.entries(graph.elementsById).map(([elementId, node]) => {
					const recipe = recipeSummariesByElementId.get(elementId);
					return [
						elementId,
						recipe === undefined
							? node
							: {
									...node,
									recipe,
								},
					];
				}),
			),
		},
	};
};

export const summarizeDesignFileReadText = (
	payload: Record<string, unknown>,
) => {
	const designFile = payload.designFile as {
		id: string;
		name: string;
		revision: string;
	};
	const read = payload.read as {
		returnedNodeCount: number;
		omittedNodeCount: number;
		truncated: boolean;
		depth: number | null;
		maxNodes: number | null;
	};
	const counts = payload.counts as {
		boardsCount: number;
		elementCount: number;
	};

	return `Design "${designFile.name}" (${designFile.id}) revision ${designFile.revision}: ${counts.boardsCount} boards, ${counts.elementCount} elements. Returned ${read.returnedNodeCount} nodes (depth=${read.depth ?? "unbounded"}, maxNodes=${read.maxNodes ?? "unbounded"}, truncated=${read.truncated}, omitted=${read.omittedNodeCount}).`;
};

export const summarizeSubtreeReadText = (payload: Record<string, unknown>) => {
	const designFile = payload.designFile as {
		id: string;
		name: string;
		revision: string;
	};
	const read = payload.read as {
		returnedNodeCount: number;
		omittedNodeCount: number;
		truncated: boolean;
		depth: number | null;
		maxNodes: number | null;
	};

	return `Subtree "${payload.elementId}" in design "${designFile.name}" (${designFile.id}) revision ${designFile.revision}: returned ${read.returnedNodeCount} nodes (depth=${read.depth ?? "unbounded"}, maxNodes=${read.maxNodes ?? "unbounded"}, truncated=${read.truncated}, omitted=${read.omittedNodeCount}).`;
};

export const summarizeDesignGraphReadText = (
	payload: Record<string, unknown>,
) => {
	const designFile = payload.designFile as {
		id: string;
		name: string;
		revision: string;
	};
	const graph = payload.graph as {
		rootElementIds: string[];
		elementsById: Record<string, unknown>;
	};

	return `Design graph for "${designFile.name}" (${designFile.id}) revision ${designFile.revision}: ${graph.rootElementIds.length} roots, ${Object.keys(graph.elementsById).length} elements.`;
};
