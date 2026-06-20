import { createHash, randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
	type CallToolResult,
	ErrorCode,
	ListResourcesRequestSchema,
	McpError,
	ReadResourceRequestSchema,
	type ReadResourceResult,
	type Resource,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
	readProjectRegistry,
	upsertProjectLocation,
} from "../app-state/project-registry";
import {
	availableRegistries,
	CORE_PROP_KEYS,
	getControlDefinitions,
	getControlProps,
	getDefaultProps,
	getRegistry,
	getComponentIds as getRegistryComponentIds,
	getRegistryRecipes,
	isRegistryId,
	isValidControlValue,
	normalizeRole,
	type RegistryId,
	resolveRegistryComponent,
	resolveRegistryRecipe,
	SYSTEM_PROP_KEYS,
} from "../libraries/registry";
import {
	isMcpEnabled,
	readMcpEnabledProjectContext,
	TrickroomProjectConfigError,
	type TrickroomProjectContext,
} from "../project";
import { RECIPE_MARKER_PROP_KEYS } from "../recipes/markers";
import { getElementRecipeMetadata } from "../recipes/ownership";
import { describeRecipeSlotChildRef } from "../recipes/slot-allowlist";
import {
	type RecipeInstanceValidationReport,
	validateRecipeInstances,
} from "../recipes/validation";
import { isTrickroomDesign } from "../server-utils";
import {
	createDesignFileService,
	type DesignFileRead,
	DesignFileServiceError,
} from "../services/design-file-service";
import {
	applyAddElement,
	applyAddRecipe,
	applyAddSubtree,
	applyAddSystemComponent,
	applyCopySubtree,
	applyDeleteElement,
	applyDetachRecipeInstance,
	applyDetachSystemComponent,
	applyExtractSubtree,
	applyMigrateSystemComponentInstance,
	applyMoveElement,
	applyUpdateElementProps,
	applyUpdateElementText,
	applyUpdateRecipeControl,
	applyUpdateRecipeInstance,
	applyUpdateSystemComponentInstance,
	DesignTransformError,
	normalizeDesignForMutation,
	type ProposedElementNode,
	type ProposedRecipeNode,
	type ProposedSubtreeNode,
	type SubtreeDiagnostic,
	type ValidateSubtreeOptions,
	validateProposedSubtreeForInsertion,
} from "../services/design-transform-service";
import type {
	Node as DesignNode,
	RecipeDefinition,
	RecipeTemplateNode,
	RegistryComponentDefinition,
	Role,
	TrickroomDesign,
} from "../types";
import {
	AssetManifestError,
	deleteAsset,
	normalizeAssetId,
	readAsset,
	readAssetManifest,
	refreshAssetMetadata,
	registerAsset,
} from "../utils/asset-manifest-service";
import {
	assetIdProp,
	componentAllowsBlankResourceId,
	findProjectResourceUsage,
	getResourceIdProp,
	getResourceKindForComponent,
	iconIdProp,
} from "../utils/design-resource-references";
import {
	addIconFolderPath,
	findDesignSystem,
	listDesignSystems,
	removeIconFolderPath,
} from "../utils/design-system-store";
import {
	IconManifestError,
	normalizeIconId,
	readIcon,
	readIconManifest,
	syncIconManifest,
} from "../utils/icon-manifest-service";
import {
	bulkMigrateProjectSystemComponentInstances,
	type SystemComponentBulkMigrationReport,
} from "../utils/system-component-bulk-migration";
import {
	mcpPartialSystemComponentDraftPayloadInputSchema,
	mcpRecipeTemplateNodeInputSchema,
	mcpSystemComponentOverrideTargetsInputSchema,
	mcpSystemComponentSlotsInputSchema,
	mcpSystemComponentVariantSchemaInputSchema,
	partialSystemComponentDraftPayloadSchema,
	systemComponentDraftInputDiagnosticsFromZodError,
	systemComponentDraftPatchSchema,
} from "../utils/system-component-draft-schemas";
import {
	createSystemComponentDraft,
	deleteSystemComponent,
	describeSystemComponent,
	listSystemComponentSummaries,
	publishSystemComponentDraft,
	SystemComponentOperationsError,
	updateSystemComponentDraft,
} from "../utils/system-component-operations";
import {
	type SystemComponentInstanceUsage,
	type SystemComponentUsageScanDiagnostic,
	type SystemComponentUsageScanResult,
	scanProjectSystemComponentUsage,
} from "../utils/system-component-usage-scan";
import {
	readDomainTokensReadonly,
	type TailwindTokenStorage,
} from "../utils/tailwind-token-store";
import { buildDesignGraph } from "./design-graph";
import {
	applyDryRunOperation,
	assertCanUseSystemComponentInstanceSubtree,
	assertOperationAllowedByPolicy,
	type DesignOperationName,
	getElementComponentReference,
	normalizeUpdateElementPropsParameters,
	validateDryRunOperationParameters,
} from "./design-operations";
import { getDesignDiagnostics, type McpDesignIssue } from "./diagnostics";
import {
	appendMcpAuditLog,
	assertCanReadDesignFile,
	assertCanUseComponent,
	assertCanWriteDesignFile,
	assertCanWriteProject,
	getComponentRef,
	getMcpPolicy,
	isComponentAllowed,
	type McpAuditEntry,
	type McpPolicy,
	McpPolicyError,
} from "./governance";
import {
	applyOperationPlan,
	createOperationPlanDependencies,
	executeOperationPlanDryRun,
	type operationPlanInputSchema,
} from "./operation-plan";
import {
	createTrickroomMcpProjectResolver,
	listMcpEnabledProjectContexts,
	type TrickroomMcpProjectRef,
	type TrickroomMcpProjectResolver,
	TrickroomMcpProjectResolverError,
} from "./project-resolver";
import {
	buildDesignResourceUri,
	parseDesignResourceUri,
	slugifyDesignTitle,
} from "./resources";
import { systemComponentInstanceOverrideSchema } from "./system-component-schemas";

export type TrickroomMcpServerContext = TrickroomProjectContext & {
	trickroomHome?: string;
	locationId?: string;
};

export type TrickroomMcpServerOptions = {
	trickroomHome?: string;
	projectResolver?: TrickroomMcpProjectResolver;
};

export type TrickroomMcpServer = McpServer & {
	getActiveContextSnapshot: () => TrickroomMcpServerContext | null;
};

const readOnlyClosedWorldAnnotations = {
	readOnlyHint: true,
	openWorldHint: false,
} as const;

const jsonPrimitiveSchema = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.null(),
]);

const rejectedPersistentIdSchema = z
	.never()
	.optional()
	.describe(
		"Persistent element IDs are generated by the server and must not be supplied.",
	);

const systemComponentManifestRevisionSchema = z
	.string()
	.startsWith("sha256:")
	.describe("Current system component manifest revision from list/describe.");

export const projectRefSchema: z.ZodType<TrickroomMcpProjectRef | undefined> = z
	.object({
		locationId: z
			.string()
			.min(1)
			.optional()
			.describe("Registered local Trickroom project location ID."),
		projectId: z
			.string()
			.min(1)
			.optional()
			.describe(
				"Stable Trickroom project ID. Ambiguous registered IDs require locationId.",
			),
	})
	.strict()
	.optional()
	.describe(
		"Optional explicit project selector. Prefer locationId for automation; omit to use the MCP session default.",
	);

const projectScopedInputSchema = {
	project: projectRefSchema,
} as const;

const withProjectScopedInput = <Shape extends z.ZodRawShape>(shape: Shape) => ({
	...shape,
	...projectScopedInputSchema,
});

export const proposedRecipeNodeSchema: z.ZodType<ProposedRecipeNode> = z
	.object({
		id: rejectedPersistentIdSchema,
		kind: z.literal("recipe"),
		tempId: z.string().min(1).optional(),
		library: z.string().min(1),
		recipe: z.string().min(1),
		children: z.never().optional(),
		props: z.never().optional(),
		name: z.never().optional(),
		className: z.never().optional(),
		text: z.never().optional(),
	})
	.strict();

export const proposedSubtreeNodeSchema: z.ZodType<ProposedSubtreeNode> = z.lazy(
	() =>
		z.union([
			proposedRecipeNodeSchema,
			proposedElementNodeSchema,
		]) as z.ZodType<ProposedSubtreeNode>,
);

export const proposedElementNodeSchema: z.ZodType<ProposedElementNode> = z
	.object({
		id: rejectedPersistentIdSchema,
		kind: z.literal("element").optional(),
		tempId: z.string().min(1).optional(),
		library: z.string().min(1),
		component: z.string().min(1),
		name: z.string().optional(),
		className: z.string().optional(),
		props: z.record(z.string(), jsonPrimitiveSchema).optional(),
		text: z.string().optional(),
		children: z.array(proposedSubtreeNodeSchema).optional(),
	})
	.strict();

export const validateSubtreeOptionsSchema: z.ZodType<ValidateSubtreeOptions> = z
	.object({
		maxNodes: z.number().int().min(1).optional(),
		maxDepth: z.number().int().min(1).optional(),
		includeNormalizedTree: z.boolean().optional(),
		allowRecipes: z.boolean().optional(),
	})
	.strict();

export const addSubtreeOptionsSchema: z.ZodType<
	Omit<ValidateSubtreeOptions, "includeNormalizedTree">
> = z
	.object({
		maxNodes: z.number().int().min(1).optional(),
		maxDepth: z.number().int().min(1).optional(),
		allowRecipes: z.boolean().optional(),
	})
	.strict();

export const validateSubtreePayloadSchema = z
	.object({
		designFileId: z.string().uuid().describe("Design file UUID."),
		expectedRevision: z
			.string()
			.startsWith("sha256:")
			.describe("Current revision from a prior read."),
		parentId: z
			.string()
			.min(1)
			.nullable()
			.describe("Parent element ID, or null to validate root insertion."),
		index: z
			.number()
			.int()
			.min(0)
			.describe(
				"Strict insertion index within the parent's children or the root. Valid range is 0..childCount.",
			),
		subtree: proposedSubtreeNodeSchema,
		options: validateSubtreeOptionsSchema.optional(),
	})
	.strict();

export const addSubtreePayloadSchema = validateSubtreePayloadSchema.extend({
	options: addSubtreeOptionsSchema.optional(),
});

export const validateCopySubtreeOptionsSchema = z
	.object({
		maxNodes: z.number().int().min(1).optional(),
		maxDepth: z.number().int().min(1).optional(),
	})
	.strict();

export const validateCopySubtreePayloadSchema = z
	.object({
		sourceDesignFileId: z.string().uuid().describe("Source design file UUID."),
		sourceElementId: z
			.string()
			.min(1)
			.describe("Source subtree root element ID."),
		sourceExpectedRevision: z
			.string()
			.startsWith("sha256:")
			.optional()
			.describe(
				"Required for cross-file copies. Optional for same-file copies, where expectedRevision covers both source and target.",
			),
		targetDesignFileId: z.string().uuid().describe("Target design file UUID."),
		expectedRevision: z
			.string()
			.startsWith("sha256:")
			.describe("Current target revision from a prior read."),
		parentId: z
			.string()
			.min(1)
			.nullable()
			.describe("Target parent element ID, or null to insert at root."),
		index: z
			.number()
			.int()
			.min(0)
			.describe(
				"Strict insertion index within the target parent's children or the root.",
			),
		options: validateCopySubtreeOptionsSchema.optional(),
	})
	.strict();

const addRecipeOperationParameterSchema = {
	parentId: z
		.string()
		.min(1)
		.nullable()
		.describe("Parent element ID, or null to add at the design root."),
	index: z
		.number()
		.int()
		.min(0)
		.describe("Insertion index within the parent's children or the root."),
	library: z.string().min(1).describe("Registry library id, e.g. 'base-ui'."),
	recipe: z
		.string()
		.min(1)
		.describe(
			"Registry recipe id, e.g. 'avatar.default' or 'base-ui/avatar.default'.",
		),
} as const;

const _addRecipeOperationParametersSchema = z.object(
	addRecipeOperationParameterSchema,
);

const detachRecipeInstanceOperationParameterSchema = {
	elementId: z
		.string()
		.min(1)
		.describe("Any element ID inside the attached recipe structure to detach."),
} as const;

const _detachRecipeInstanceOperationParametersSchema = z.object(
	detachRecipeInstanceOperationParameterSchema,
);

const addSystemComponentOperationParameterSchema = {
	parentId: z
		.string()
		.min(1)
		.nullable()
		.describe("Parent element ID, or null to add at the design root."),
	index: z
		.number()
		.int()
		.min(0)
		.describe("Insertion index within the parent's children or the root."),
	systemId: z
		.string()
		.min(1)
		.describe("Design system id from the component manifest."),
	componentId: z.string().min(1).describe("Published system component id."),
	version: z
		.string()
		.min(1)
		.nullable()
		.optional()
		.describe(
			"Published component version. Omit or pass null to use the manifest currentVersion.",
		),
	variantValues: z
		.record(z.string(), z.string())
		.optional()
		.describe(
			"Initial variant axis values for the instance. Omitted axes remain unset unless the component schema defines defaults.",
		),
	unsetVariantAxes: z
		.array(z.string())
		.optional()
		.describe(
			"Variant axes to clear from initial variantValues before resolving schema defaults.",
		),
	overrides: z
		.record(z.string(), systemComponentInstanceOverrideSchema)
		.optional()
		.describe(
			"Initial instance overrides keyed by declared override target id.",
		),
} as const;

const updateSystemComponentInstanceOperationParameterSchema = {
	rootElementId: z
		.string()
		.min(1)
		.describe("Attached system component root element ID."),
	variantValues: z
		.record(z.string(), z.string())
		.optional()
		.describe(
			"Variant axis values to merge into the instance. Missing keys leave existing values unchanged.",
		),
	unsetVariantAxes: z
		.array(z.string())
		.optional()
		.describe("Variant axes to clear from the instance."),
	overrides: z
		.record(z.string(), systemComponentInstanceOverrideSchema)
		.optional()
		.describe(
			"Instance overrides keyed by declared override target id. Replaces the full override map when provided.",
		),
} as const;

const detachSystemComponentOperationParameterSchema = {
	elementId: z
		.string()
		.min(1)
		.describe(
			"Any element ID inside the attached system component instance to detach.",
		),
} as const;

const updateRecipeInstanceOperationParameterSchema = {
	elementId: z
		.string()
		.min(1)
		.describe("Any element ID inside the stale attached recipe instance."),
} as const;

const _updateRecipeInstanceOperationParametersSchema = z.object(
	updateRecipeInstanceOperationParameterSchema,
);

const updateRecipeControlOperationParameterSchema = {
	instanceId: z.string().min(1).describe("Attached recipe instance ID."),
	path: z
		.string()
		.min(1)
		.describe("Declared recipe template path for the control target."),
	prop: z.string().min(1).describe("Declared recipe control prop."),
	value: jsonPrimitiveSchema.describe("New recipe control value."),
} as const;

const _updateRecipeControlOperationParametersSchema = z.object(
	updateRecipeControlOperationParameterSchema,
);

const addSubtreeOperationParametersSchema = z.object({
	parentId: z
		.string()
		.min(1)
		.nullable()
		.describe("Target parent element ID, or null to validate root insertion."),
	index: z
		.number()
		.int()
		.min(0)
		.describe(
			"Strict insertion index within the target parent's children or the root. Valid range is 0..childCount.",
		),
	subtree: proposedSubtreeNodeSchema,
	options: addSubtreeOptionsSchema.optional(),
});

const copySubtreeOperationParametersSchema = z.object({
	sourceDesignFileId: z.string().uuid().describe("Source design file UUID."),
	sourceElementId: z
		.string()
		.min(1)
		.describe("Source subtree root element ID."),
	sourceExpectedRevision: z
		.string()
		.startsWith("sha256:")
		.optional()
		.describe(
			"Required for cross-file copies. Optional for same-file copies, where expectedRevision covers both source and target.",
		),
	parentId: z
		.string()
		.min(1)
		.nullable()
		.describe("Target parent element ID, or null to insert at root."),
	index: z
		.number()
		.int()
		.min(0)
		.describe(
			"Strict insertion index within the target parent's children or the root.",
		),
	options: validateCopySubtreeOptionsSchema.optional(),
});

type AddSubtreeOperationParameters = z.infer<
	typeof addSubtreeOperationParametersSchema
>;
type CopySubtreeOperationParameters = z.infer<
	typeof copySubtreeOperationParametersSchema
>;

type ElementContext = {
	element: DesignNode;
	parent: DesignNode | null;
	index: number | null;
	rootIndex: number | null;
	siblingIds: string[];
};

type ValidationIssue = McpDesignIssue;

const createJsonResult = (
	payload: Record<string, unknown>,
	options: { text?: string } = {},
): CallToolResult => ({
	content: [
		{
			type: "text",
			text: options.text ?? JSON.stringify(payload, null, 2),
		},
	],
	structuredContent: payload,
});

const createSummaryTextResult = (
	payload: Record<string, unknown>,
	text: string,
): CallToolResult => createJsonResult(payload, { text });

const createProjectInfoResult = async (context: TrickroomMcpServerContext) => {
	const systems = await listDesignSystems(context.projectRoot);
	const payload = {
		projectName: context.config.name,
		projectId: context.config.projectId ?? null,
		locationId: context.locationId ?? null,
		projectRoot: context.projectRoot,
		configPath: context.configPath,
		mcpEnabled: true,
		configuredSystems: systems.map((system) => ({
			systemId: system.manifest.systemId,
			systemName: system.manifest.systemName,
			...(system.manifest.cssPath ? { cssPath: system.manifest.cssPath } : {}),
		})),
	};

	return createJsonResult(payload);
};

const getProjectReference = (context: TrickroomMcpServerContext) => ({
	projectId: context.config.projectId ?? null,
	locationId: context.locationId ?? null,
	projectRoot: context.projectRoot,
	name: context.config.name,
});

const getDesignResourceLocationId = (context: TrickroomMcpServerContext) =>
	context.locationId ?? context.config.projectId ?? null;

const getGovernanceSummary = (policy: McpPolicy) => ({
	mode: policy.mode,
	allowedDesignFileIds:
		policy.allowedDesignFileIds === null
			? null
			: [...policy.allowedDesignFileIds].sort(),
	allowedComponents:
		policy.allowedComponents === null
			? null
			: [...policy.allowedComponents].sort(),
	auditLog: policy.auditLog,
});

const getRegistryIds = () => [...availableRegistries].sort() as RegistryId[];

const getRegistryOrThrow = (library: string) => {
	if (!isRegistryId(library)) {
		throw new Error(`Unknown registry library "${library}"`);
	}

	return getRegistry(library);
};

const getComponentIds = (library: RegistryId) =>
	getRegistryComponentIds(library);

const getCategoryForTokenName = (name: string) => {
	const separatorIndex = name.indexOf("-");
	return separatorIndex === -1 ? name : name.slice(0, separatorIndex);
};

/**
 * Domain overrides are stored as CSS property selectors (`--spacing`,
 * `--spacing-4`, `--spacing-*`), whereas token names are bare (`DEFAULT`,
 * `4`). Map the token name to its selector forms before matching so a
 * confirmed namespace override is not reported as unconfirmed.
 */
const isTokenOverrideConfirmed = (
	domain: string,
	tokenName: string,
	overrides: readonly string[],
): boolean => {
	const namespace = domain.startsWith("--") ? domain : `--${domain}`;
	const namespaced =
		tokenName === "DEFAULT" ? namespace : `${namespace}-${tokenName}`;
	const separatorIndex = tokenName.indexOf("-");
	const familyWildcard =
		separatorIndex === -1
			? null
			: `${namespace}-${tokenName.slice(0, separatorIndex)}-*`;
	return (
		overrides.includes(tokenName) ||
		overrides.includes(namespaced) ||
		(familyWildcard !== null && overrides.includes(familyWildcard)) ||
		overrides.includes(`${namespace}-*`)
	);
};

const getAllowedChildrenMetadata = (role: Role) => {
	if (role === "text") {
		return {
			kind: "none",
			serializedChildren: "string",
			reason:
				"Text role elements store text in children and cannot contain child elements.",
		};
	}

	if (role === "leaf") {
		return {
			kind: "none",
			serializedChildren: "empty-array",
			reason:
				"Leaf role elements terminate the tree and cannot contain authored child elements or text.",
		};
	}

	return {
		kind: "nodes",
		serializedChildren: "array",
		reason: "Branch role elements can contain child element nodes.",
	};
};

const getCompositionMetadata = (role: Role) => {
	if (role === "text") {
		return {
			kind: "none",
			enforcedBy: "role",
			acceptsElementChildren: false,
			reason:
				"Text role elements serialize children as text content and cannot contain element children.",
		};
	}

	if (role === "leaf") {
		return {
			kind: "none",
			enforcedBy: "role",
			acceptsElementChildren: false,
			reason:
				"Leaf role elements serialize children as an empty array and cannot contain element children.",
		};
	}

	return {
		kind: "freeform",
		enforcedBy: "role",
		acceptsElementChildren: true,
		acceptedRoles: ["branch", "text", "leaf"],
		reason: "Branch role elements can contain any valid child element node.",
	};
};

const getDefaultMetadata = (
	library: RegistryId,
	component: string,
	role: Role,
	definition: RegistryComponentDefinition,
) => {
	return {
		...(definition.baseClassName === undefined
			? {}
			: { baseClassName: definition.baseClassName }),
		props: getDefaultProps(library, component, definition),
		controlProps: getControlProps(definition),
		children: role === "text" ? "Text" : [],
	};
};

const getDesignSystemHandle = (
	design: Pick<TrickroomDesign, "systemId" | "systemName">,
) => {
	if (design.systemId !== undefined) {
		return design.systemId;
	}

	return design.systemName ?? null;
};

const getDesignMetadata = (designFileId: string, read: DesignFileRead) => {
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

const createBlankDesign = (
	name: string,
	systemId: string | null | undefined,
): TrickroomDesign => ({
	name,
	...(systemId !== undefined ? { systemId } : {}),
	boards: [],
});

const getNodeName = (node: DesignNode) => node.props["data-trickroom-name"];

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

type TreeReadInput = {
	depth?: number;
	maxNodes?: number;
	allowLarge?: boolean;
};

const defaultTreeReadDepth = 2;
const defaultTreeReadMaxNodes = 100;
const safeTreeReadMaxDepth = 4;
const safeTreeReadMaxNodes = 500;

const createTreeReadBounds = (input: TreeReadInput = {}): TreeReadBounds => {
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

const createTreeReadStats = (bounds: TreeReadBounds): TreeReadStats => ({
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

const getDesignCounts = (design: TrickroomDesign) => {
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

const getTreeReadMetadata = (stats: TreeReadStats) => ({
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

const getRecipeAttachmentSummaries = (design: TrickroomDesign) => {
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

const getDesignSystemDisplayName = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
) =>
	(await summarizeDesignSystemReference(context, getDesignSystemHandle(design)))
		?.systemName ?? null;

const compactElementTree = (node: DesignNode): Record<string, unknown> => {
	const isText = typeof node.children === "string";

	return {
		id: node.id,
		name: getNodeName(node),
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
					children: node.children.map(compactElementTree),
				}),
	};
};

const compactElementTreeBounded = (
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
		childIds,
		children,
		truncated: stats.omittedNodeCount > omittedBefore,
	};
};

const compactElementForestBounded = (
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

const summarizeBoard = (board: DesignNode) => {
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

const detailedElement = (node: DesignNode) => ({
	id: node.id,
	props: node.props,
	text: typeof node.children === "string" ? node.children : null,
	childIds: getChildIds(node),
});

const detailedSubtree = (
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

const findElementContext = (
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

const getSiblingContext = (context: ElementContext) => {
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

const getElementContextOrThrow = (
	design: TrickroomDesign,
	elementId: string,
) => {
	const context = findElementContext(design, elementId);
	if (!context) {
		throw new Error(`Unknown element "${elementId}"`);
	}

	return context;
};

const getCompactElementSummary = (
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

const getMutationContext = (design: TrickroomDesign, elementId: string) => {
	const ctx = findElementContext(design, elementId);
	if (!ctx) return null;
	return getSiblingContext(ctx);
};

const summarizeDesignSystemReference = async (
	context: TrickroomMcpServerContext,
	systemHandle: string | null | undefined,
) => {
	const normalizedSystemHandle = systemHandle ?? null;
	const system = normalizedSystemHandle
		? await findDesignSystem(context.projectRoot, normalizedSystemHandle)
		: null;

	return normalizedSystemHandle === null
		? null
		: {
				systemId: system?.manifest.systemId ?? null,
				systemName: system?.manifest.systemName ?? normalizedSystemHandle,
				configured: system !== null,
				...(system?.manifest.cssPath
					? { cssPath: system.manifest.cssPath }
					: {}),
			};
};

const assertConfiguredSystem = async (
	context: TrickroomMcpServerContext,
	systemHandle: string,
) => {
	const system = await findDesignSystem(context.projectRoot, systemHandle);
	if (!system) {
		throw new DesignTransformError(
			"UNKNOWN_DESIGN_SYSTEM",
			`Design system "${systemHandle}" is not configured for this project.`,
		);
	}

	return system;
};

const canonicalizeDesignSystemReferenceForStorage = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
): Promise<TrickroomDesign> => {
	const systemHandle = getDesignSystemHandle(design);
	const { systemName: _legacySystemName, ...withoutLegacyName } = design;

	if (systemHandle === null) {
		if (design.systemId !== undefined || design.systemName !== undefined) {
			return { ...withoutLegacyName, systemId: null };
		}
		return withoutLegacyName;
	}

	const system = await assertConfiguredSystem(context, systemHandle);
	return {
		...withoutLegacyName,
		systemId: system.manifest.systemId,
	};
};

const getElementResourceReference = (element: DesignNode) => {
	const library = element.props["data-trickroom-library"];
	const component = element.props["data-trickroom-component"];
	const kind = getResourceKindForComponent(library, component);
	if (!kind) {
		return null;
	}

	const idProp = getResourceIdProp(kind);
	const resourceId = element.props[idProp];
	return {
		kind,
		idProp,
		allowsBlank: componentAllowsBlankResourceId(library, component, kind),
		resourceId:
			typeof resourceId === "string" && resourceId.trim().length > 0
				? resourceId.trim()
				: null,
	};
};

const assertResourceElementReferenceExists = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
	elementId: string | undefined,
) => {
	if (elementId === undefined) {
		return;
	}

	const elementContext = findElementContext(design, elementId);
	if (!elementContext) {
		return;
	}

	const reference = getElementResourceReference(elementContext.element);
	if (!reference) {
		return;
	}

	const systemHandle = getDesignSystemHandle(design);
	if (!systemHandle) {
		if (reference.resourceId === null && reference.allowsBlank) {
			return;
		}

		throw new DesignTransformError(
			"DESIGN_SYSTEM_REQUIRED",
			`${reference.kind === "asset" ? "Asset" : "Icon"} elements require the design to be linked to a system.`,
		);
	}
	const system = await assertConfiguredSystem(context, systemHandle);
	const systemId = system.manifest.systemId;
	const systemName = system.manifest.systemName;

	if (!reference.resourceId) {
		if (reference.allowsBlank) {
			return;
		}

		throw new DesignTransformError(
			reference.kind === "asset" ? "MISSING_ASSET_ID" : "MISSING_ICON_ID",
			`${reference.kind === "asset" ? "Asset" : "Icon"} elements require ${reference.idProp}.`,
		);
	}
	const normalizedResourceId = normalizeResourceIdForMutation(
		reference.kind,
		reference.resourceId,
	);

	if (reference.kind === "asset") {
		const asset = await readAsset(
			context.projectRoot,
			systemId,
			normalizedResourceId,
		);
		if (!asset) {
			throw new DesignTransformError(
				"UNKNOWN_ASSET_ID",
				`Asset id "${reference.resourceId}" does not exist in system "${systemName}".`,
			);
		}
		return;
	}

	const icon = await readIcon(
		context.projectRoot,
		systemId,
		normalizedResourceId,
	);
	if (!icon) {
		throw new DesignTransformError(
			"UNKNOWN_ICON_ID",
			`Icon id "${reference.resourceId}" does not exist in system "${systemName}".`,
		);
	}
};

const normalizeResourceIdForMutation = (
	kind: "asset" | "icon",
	resourceId: string,
) => {
	let normalizedResourceId: string;
	try {
		normalizedResourceId =
			kind === "asset"
				? normalizeAssetId(resourceId)
				: normalizeIconId(resourceId);
	} catch {
		throw new DesignTransformError(
			kind === "asset" ? "INVALID_ASSET_ID" : "INVALID_ICON_ID",
			`${kind === "asset" ? "Asset" : "Icon"} id "${resourceId}" is not valid.`,
		);
	}

	if (normalizedResourceId !== resourceId) {
		throw new DesignTransformError(
			kind === "asset" ? "INVALID_ASSET_ID" : "INVALID_ICON_ID",
			`${kind === "asset" ? "Asset" : "Icon"} id "${resourceId}" must be written as canonical id "${normalizedResourceId}".`,
		);
	}

	return normalizedResourceId;
};

const walkElementTree = (
	node: DesignNode,
	visit: (element: DesignNode) => void,
) => {
	visit(node);
	if (typeof node.children === "string") {
		return;
	}

	for (const child of node.children) {
		walkElementTree(child, visit);
	}
};

const assertCanUseSubtreeComponents = (
	policy: McpPolicy,
	subtree: DesignNode,
) => {
	walkElementTree(subtree, (element) => {
		assertCanUseComponent(
			policy,
			element.props["data-trickroom-library"],
			element.props["data-trickroom-component"],
		);
	});
};

const assertResourceReferencesExist = async (
	context: TrickroomMcpServerContext,
	design: TrickroomDesign,
) => {
	for (const board of design.boards) {
		const elementIds: string[] = [];
		walkElementTree(board, (element) => elementIds.push(element.id));
		for (const elementId of elementIds) {
			await assertResourceElementReferenceExists(context, design, elementId);
		}
	}
};

const validateElementReferences = (
	node: DesignNode,
	path: string,
	seenElementIds: Map<string, string>,
	issues: ValidationIssue[],
	componentUsage: Map<string, number>,
) => {
	const library = node.props["data-trickroom-library"];
	const component = node.props["data-trickroom-component"];
	const role = node.props["data-trickroom-role"];
	const normalizedRole = normalizeRole(role);
	const componentKey = `${library}/${component}`;
	componentUsage.set(componentKey, (componentUsage.get(componentKey) ?? 0) + 1);

	const firstPath = seenElementIds.get(node.id);
	if (firstPath) {
		issues.push({
			severity: "error",
			code: "DUPLICATE_ELEMENT_ID",
			message: `Element id "${node.id}" is already used at ${firstPath}.`,
			path,
			elementId: node.id,
		});
	} else {
		seenElementIds.set(node.id, path);
	}

	const resolution = resolveRegistryComponent(library, component);
	if (resolution.status === "unknown-library") {
		issues.push({
			severity: "error",
			code: "UNKNOWN_REGISTRY_LIBRARY",
			message: `Element references unknown registry "${library}".`,
			path,
			elementId: node.id,
		});
	} else if (resolution.status === "unknown-component") {
		issues.push({
			severity: "error",
			code: "UNKNOWN_REGISTRY_COMPONENT",
			message: `Element references unknown component "${component}" in registry "${library}".`,
			path,
			elementId: node.id,
		});
	} else {
		const expectedRole = resolution.definition.role;
		if (normalizedRole !== expectedRole) {
			issues.push({
				severity: "error",
				code: "REGISTRY_ROLE_MISMATCH",
				message: `Element role does not match registry metadata for "${componentKey}".`,
				path,
				elementId: node.id,
			});
		}

		const controlProps = new Map(
			getControlDefinitions(resolution.definition).map((control) => [
				control.prop,
				control,
			]),
		);
		for (const [propName, propValue] of Object.entries(node.props)) {
			if (CORE_PROP_KEYS.has(propName) || SYSTEM_PROP_KEYS.has(propName)) {
				continue;
			}

			const control = controlProps.get(propName);
			if (!control) {
				issues.push({
					severity: "error",
					code: "UNSUPPORTED_PROP",
					message: `Prop "${propName}" is not supported by "${componentKey}".`,
					path: `${path}.props.${propName}`,
					elementId: node.id,
				});
				continue;
			}

			if (!isValidControlValue(control, propValue)) {
				issues.push({
					severity: "error",
					code: "INVALID_PROP_VALUE",
					message: `Prop "${propName}" does not match the registry control contract for "${componentKey}".`,
					path: `${path}.props.${propName}`,
					elementId: node.id,
				});
			}
		}
	}

	if (normalizedRole === "text" && typeof node.children !== "string") {
		issues.push({
			severity: "error",
			code: "INVALID_CHILDREN_SHAPE",
			message: "Text role elements must serialize children as a string.",
			path: `${path}.children`,
			elementId: node.id,
		});
	}

	if (normalizedRole === "branch" && !Array.isArray(node.children)) {
		issues.push({
			severity: "error",
			code: "INVALID_CHILDREN_SHAPE",
			message: "Branch role elements must serialize children as an array.",
			path: `${path}.children`,
			elementId: node.id,
		});
	}

	if (
		normalizedRole === "leaf" &&
		(!Array.isArray(node.children) || node.children.length > 0)
	) {
		issues.push({
			severity: "error",
			code: "INVALID_CHILDREN_SHAPE",
			message: "Leaf role elements must serialize children as an empty array.",
			path: `${path}.children`,
			elementId: node.id,
		});
	}

	if (Array.isArray(node.children)) {
		for (const [childIndex, child] of node.children.entries()) {
			validateElementReferences(
				child,
				`${path}.children[${childIndex}]`,
				seenElementIds,
				issues,
				componentUsage,
			);
		}
	}
};

const describeComponent = (library: RegistryId, component: string) => {
	const registry = getRegistryOrThrow(library);
	if (!Object.hasOwn(registry, component)) {
		throw new Error(
			`Unknown component "${component}" in registry "${library}"`,
		);
	}

	const definition = registry[component as keyof typeof registry];
	const role = definition.role;
	const controls = getControlDefinitions(definition);
	const describedControls = controls.map((control) => ({
		...control,
		visibility: control.visibility ?? null,
		deprecationReason: control.deprecationReason ?? null,
	}));
	const controlProps = controls.map((control) => ({
		name: control.prop,
		label: control.label,
		type: control.valueType,
		input: control.input,
		required: false,
		source: "registry-control",
		description: control.description ?? null,
		defaultValue: control.defaultValue ?? null,
		options: control.options ?? null,
		visibility: control.visibility ?? null,
		deprecationReason: control.deprecationReason ?? null,
	}));

	return {
		library,
		component,
		label: definition.label,
		role,
		builtIn: true,
		readOnly: true,
		description: definition.description ?? null,
		allowedChildren: getAllowedChildrenMetadata(role),
		composition: getCompositionMetadata(role),
		controls: describedControls,
		defaults: getDefaultMetadata(library, component, role, definition),
		writableInstanceProps: [
			{
				name: "className",
				type: "string",
				required: false,
				description: "Tailwind class string applied to this element instance.",
			},
			{
				name: "data-trickroom-name",
				modelFacingName: "name",
				type: "string",
				required: true,
				description:
					"Human-readable layer name. Mutation tools expose this as name.",
			},
			...controlProps,
		],
		fixedSystemProps: [
			{
				name: "data-trickroom-library",
				type: "string",
				fixedValue: library,
			},
			{
				name: "data-trickroom-component",
				type: "string",
				fixedValue: component,
			},
			{
				name: "data-trickroom-role",
				type: "string",
				fixedValue: role,
			},
		],
		content:
			role === "text"
				? {
						kind: "text",
						storage: "children",
						updateTool: "updateElementText",
					}
				: role === "leaf"
					? {
							kind: "none",
							storage: "children",
							serializedChildren: [],
						}
					: {
							kind: "children",
							storage: "children",
						},
		supportedProps: [
			{
				name: "className",
				type: "string",
				required: false,
				source: "instance",
				description: "Tailwind class string applied to this element instance.",
			},
			{
				name: "data-trickroom-name",
				type: "string",
				required: true,
				source: "instance",
				description: "Human-readable layer name.",
			},
			{
				name: "data-trickroom-library",
				type: "string",
				required: true,
				source: "registry-reference",
				fixedValue: library,
			},
			{
				name: "data-trickroom-component",
				type: "string",
				required: true,
				source: "registry-reference",
				fixedValue: component,
			},
			{
				name: "data-trickroom-role",
				type: "string",
				required: true,
				source: "registry-reference",
				fixedValue: role,
			},
			...controlProps,
		],
	};
};

const summarizeComponentForAuthoringContract = (
	library: RegistryId,
	component: string,
) => {
	const registry = getRegistryOrThrow(library);
	if (!Object.hasOwn(registry, component)) {
		throw new Error(
			`Unknown component "${component}" in registry "${library}"`,
		);
	}

	const definition = registry[component as keyof typeof registry];
	const role = definition.role;
	const controls = getControlDefinitions(definition);

	const componentSummary = {
		library,
		component,
		label: definition.label,
		role,
		writableProps: [
			"className",
			"data-trickroom-name",
			...controls.map((control) => control.prop),
		],
		controls: controls.map((control) => ({
			name: control.prop,
			valueType: control.valueType,
			input: control.input,
		})),
		inspectTool: "describeRegistryComponent",
	};

	if (library !== "trickroom") {
		return componentSummary;
	}

	return {
		...componentSummary,
		allowedChildren: getAllowedChildrenMetadata(role),
		composition: getCompositionMetadata(role),
		content:
			role === "text"
				? {
						kind: "text",
						storage: "children",
						updateTool: "updateElementText",
					}
				: role === "leaf"
					? {
							kind: "none",
							storage: "children",
							serializedChildren: [],
						}
					: {
							kind: "children",
							storage: "children",
						},
	};
};

const getRecipeTemplateNodes = (
	template: RecipeTemplateNode,
): RecipeTemplateNode[] => [
	template,
	...(template.children ?? []).flatMap((child) =>
		getRecipeTemplateNodes(child),
	),
];

const getRecipeTemplateSlotName = (
	recipe: RecipeDefinition,
	template: RecipeTemplateNode,
) =>
	template.slot ??
	Object.values(recipe.slots ?? {}).find(
		(slot) => slot.hostPath === template.path,
	)?.name ??
	null;

const describeRecipeComponentRef = ({
	library,
	component,
}: {
	library: string;
	component: string;
}) => ({
	library,
	component,
	ref: `${library}/${component}`,
});

const describeRecipeSlots = (recipe: RecipeDefinition) =>
	Object.values(recipe.slots ?? {})
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((slot) => ({
			name: slot.name,
			label: slot.label,
			description: slot.description ?? null,
			hostPath: slot.hostPath,
			allowedChildren: slot.allowedChildren
				? slot.allowedChildren.map(describeRecipeSlotChildRef)
				: {
						kind: "any-valid-node",
						reason:
							"No slot-specific component allowlist is declared for this recipe.",
					},
			defaultChildren: slot.defaultChildren
				? slot.defaultChildren.map((defaultChild) => ({
						path: defaultChild.path,
						library: defaultChild.library,
						component: defaultChild.component,
					}))
				: null,
			history: slot.history ?? null,
		}));

const describeRecipeControls = (recipe: RecipeDefinition) =>
	Object.entries(recipe.controls ?? {})
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, control]) => ({
			name,
			label: control.label,
			description: control.description ?? null,
			path: control.path,
			prop: control.prop,
			input: control.input,
			valueType: control.valueType,
			options: control.options ?? null,
			defaultValue: control.defaultValue ?? null,
			visibility: control.visibility ?? null,
			deprecationReason: control.deprecationReason ?? null,
		}));

const describeRecipeTemplateHistory = (recipe: RecipeDefinition) =>
	(recipe.previousTemplates ?? []).map((entry) => ({
		version: entry.version,
		description: entry.description ?? null,
		root: {
			path: entry.root.path,
			library: entry.root.library,
			component: entry.root.component,
			componentRef: `${entry.root.library}/${entry.root.component}`,
		},
		structure: {
			nodeCount: getRecipeTemplateNodes(entry.root).length,
			paths: getRecipeTemplateNodes(entry.root).map((node) => node.path),
		},
		slots: Object.values(entry.slots ?? {})
			.sort((a, b) => a.name.localeCompare(b.name))
			.map((slot) => ({
				name: slot.name,
				hostPath: slot.hostPath,
			})),
		controls: Object.keys(entry.controls ?? {}).sort(),
	}));

const getRecipeTemplateDefaults = (
	template: RecipeTemplateNode,
	definition: RegistryComponentDefinition,
) => {
	const role = definition.role;
	const name = template.name ?? definition.label;
	const props = {
		...getDefaultProps(
			template.library as RegistryId,
			template.component,
			definition,
			name,
		),
		...(template.props ?? {}),
		...(template.className !== undefined
			? { className: template.className }
			: {}),
		"data-trickroom-name": name,
		"data-trickroom-library": template.library,
		"data-trickroom-component": template.component,
		"data-trickroom-role": role,
	};

	return {
		props,
		content:
			role === "text"
				? {
						kind: "text",
						children: template.text ?? "Text",
					}
				: role === "leaf"
					? {
							kind: "none",
							children: [],
						}
					: {
							kind: "children",
							childPaths: (template.children ?? []).map((child) => child.path),
						},
	};
};

const describeRecipeTemplateNode = (
	recipe: RecipeDefinition,
	template: RecipeTemplateNode,
): Record<string, unknown> => {
	const resolution = resolveRegistryComponent(
		template.library,
		template.component,
	);
	if (resolution.status !== "known") {
		return {
			path: template.path,
			library: template.library,
			component: template.component,
			componentRef: `${template.library}/${template.component}`,
			status: resolution.status,
		};
	}

	const slotName = getRecipeTemplateSlotName(recipe, template);

	return {
		path: template.path,
		library: resolution.library,
		component: resolution.component,
		componentRef: `${resolution.library}/${resolution.component}`,
		label: resolution.definition.label,
		role: resolution.definition.role,
		slot: slotName,
		defaults: getRecipeTemplateDefaults(template, resolution.definition),
		contract: {
			structuralNode: true,
			lockedByRecipe: true,
			slotHost: slotName !== null,
			authoredChildrenAllowed: slotName !== null,
		},
		children: (template.children ?? []).map((child) =>
			describeRecipeTemplateNode(recipe, child),
		),
	};
};

const summarizeRecipe = (library: RegistryId, recipe: RecipeDefinition) => {
	const nodes = getRecipeTemplateNodes(recipe.root);

	return {
		library,
		recipe: recipe.id,
		label: recipe.label,
		description: recipe.description ?? null,
		version: recipe.version,
		previousTemplates: describeRecipeTemplateHistory(recipe),
		root: describeRecipeComponentRef(recipe.root),
		structure: {
			nodeCount: nodes.length,
			paths: nodes.map((node) => node.path),
		},
		slots: describeRecipeSlots(recipe).map((slot) => ({
			name: slot.name,
			label: slot.label,
			hostPath: slot.hostPath,
		})),
	};
};

const getRecipeOrThrow = (library: string, recipe: string) => {
	const resolution = resolveRegistryRecipe(library, recipe);
	if (resolution.status !== "known") {
		throw new Error(
			resolution.status === "unknown-library"
				? `Unknown registry library "${library}".`
				: `Unknown recipe "${recipe}" in registry "${library}".`,
		);
	}

	return resolution;
};

const isRecipeAllowed = (policy: McpPolicy, recipe: RecipeDefinition) =>
	getRecipeTemplateNodes(recipe.root).every((template) =>
		isComponentAllowed(policy, template.library, template.component),
	);

const assertCanUseRecipe = (policy: McpPolicy, recipe: RecipeDefinition) => {
	for (const template of getRecipeTemplateNodes(recipe.root)) {
		assertCanUseComponent(policy, template.library, template.component);
	}
};

const describeRecipe = (library: RegistryId, recipe: RecipeDefinition) => {
	const localRecipe = recipe.id.startsWith(`${library}/`)
		? recipe.id.slice(library.length + 1)
		: recipe.id;

	return {
		library,
		recipe: recipe.id,
		localRecipe,
		aliases: [...new Set([recipe.id, localRecipe])],
		label: recipe.label,
		description: recipe.description ?? null,
		version: recipe.version,
		builtIn: true,
		readOnly: true,
		previousTemplates: describeRecipeTemplateHistory(recipe),
		slots: describeRecipeSlots(recipe),
		controls: describeRecipeControls(recipe),
		structure: {
			nodeCount: getRecipeTemplateNodes(recipe.root).length,
			root: describeRecipeTemplateNode(recipe, recipe.root),
		},
		markerGuidance: {
			systemOwned: true,
			markerProps: [...RECIPE_MARKER_PROP_KEYS],
			defaultsOmitMarkers:
				"Recipe marker props are applied by recipe expansion and are intentionally omitted from node defaults.",
			mutationRules: [
				"Do not pass recipe marker props to generic element mutation tools.",
				"Do not manually create recipe instances by copying marker props.",
				"Treat recipe root and structural nodes as locked by the recipe contract; authored content belongs in declared slots.",
			],
			writableSurface: {
				slots: Object.keys(recipe.slots ?? {}).sort(),
				controls: Object.keys(recipe.controls ?? {}).sort(),
			},
		},
	};
};

const createCatalogHash = (value: unknown) =>
	`sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;

type AuthoringContractRecipeMode = "summary" | "none";

type AuthoringContractOptions = {
	designFileId?: string;
	includeExamples?: boolean;
	includeRecipes?: AuthoringContractRecipeMode;
	includeResources?: boolean;
};

const AUTHORING_CONTRACT_PLACEHOLDER_DESIGN_FILE_ID =
	"00000000-0000-4000-8000-000000000001";
const AUTHORING_CONTRACT_PLACEHOLDER_REVISION =
	"sha256:0000000000000000000000000000000000000000000000000000000000000000";

const authoringContractWriteContext = {
	designFileId: AUTHORING_CONTRACT_PLACEHOLDER_DESIGN_FILE_ID,
	expectedRevision: AUTHORING_CONTRACT_PLACEHOLDER_REVISION,
} as const;

const AUTHORING_CONTRACT_EXAMPLES = [
	{
		tool: "addElement",
		description: "Add one text node under a branch parent.",
		arguments: {
			...authoringContractWriteContext,
			parentId: "board",
			index: 0,
			library: "trickroom",
			component: "text",
			name: "Caption",
			text: "Hello",
			className: "text-sm text-slate-700",
		},
	},
	{
		tool: "addRecipe",
		description: "Insert a supported composed recipe instance.",
		arguments: {
			...authoringContractWriteContext,
			parentId: "board",
			index: 0,
			library: "base-ui",
			recipe: "avatar.default",
		},
	},
	{
		tool: "addSubtree",
		description: "Insert a small generated subtree with tempIds.",
		arguments: {
			...authoringContractWriteContext,
			parentId: "board",
			index: 0,
			subtree: {
				library: "trickroom",
				component: "container",
				name: "Card",
				className: "rounded-lg border p-4",
				children: [
					{
						tempId: "title",
						library: "trickroom",
						component: "text",
						name: "Title",
						text: "Card title",
					},
				],
			},
		},
	},
	{
		tool: "updateElementProps",
		description: "Reference a canonical system asset on trickroom/asset.",
		arguments: {
			...authoringContractWriteContext,
			elementId: "hero-image",
			props: {
				[assetIdProp]: "ast_hero-shot",
				alt: "Product interface",
			},
		},
	},
	{
		tool: "updateElementProps",
		description: "Reference a canonical system icon on trickroom/icon.",
		arguments: {
			...authoringContractWriteContext,
			elementId: "menu-trigger-icon",
			props: {
				[iconIdProp]: "lucide-static/search",
			},
		},
	},
	{
		tool: "updateRecipeControl",
		description: "Update a declared recipe control by instance/path/prop.",
		arguments: {
			...authoringContractWriteContext,
			instanceId: "recipe-instance-id",
			path: "positioner",
			prop: "align",
			value: "end",
		},
	},
] as const;

const summarizeRecipeForContract = (
	library: RegistryId,
	recipe: RecipeDefinition,
) => {
	const localRecipe = recipe.id.startsWith(`${library}/`)
		? recipe.id.slice(library.length + 1)
		: recipe.id;
	const rootResolution = resolveRegistryComponent(
		recipe.root.library,
		recipe.root.component,
	);

	return {
		library,
		recipe: recipe.id,
		localRecipe,
		aliases: [...new Set([recipe.id, localRecipe])],
		label: recipe.label,
		description: recipe.description ?? null,
		version: recipe.version,
		root: {
			...describeRecipeComponentRef(recipe.root),
			role:
				rootResolution.status === "known"
					? rootResolution.definition.role
					: null,
		},
		slots: Object.keys(recipe.slots ?? {}).sort(),
		controls: describeRecipeControls(recipe).map((control) => ({
			name: control.name,
			prop: control.prop,
			valueType: control.valueType,
		})),
		markerGuidance: {
			inspectTool: "describeRegistryRecipe",
		},
	};
};

const buildRegistryCatalogForContract = (
	policy: McpPolicy,
	includeRecipes: AuthoringContractRecipeMode,
) => {
	const componentsByLibrary = getRegistryIds().map((library) =>
		getComponentIds(library)
			.filter((component) => isComponentAllowed(policy, library, component))
			.map((component) =>
				summarizeComponentForAuthoringContract(library, component),
			),
	);
	const recipesByLibrary =
		includeRecipes === "summary"
			? getRegistryIds().map((library) =>
					getRegistryRecipes(library)
						.filter((recipe) => isRecipeAllowed(policy, recipe))
						.map((recipe) => summarizeRecipeForContract(library, recipe)),
				)
			: getRegistryIds().map(
					() => [] as ReturnType<typeof summarizeRecipeForContract>,
				);

	return getRegistryIds().map((library, index) => ({
		library,
		builtIn: true,
		readOnly: true,
		components: componentsByLibrary[index],
		...(includeRecipes === "summary"
			? { recipes: recipesByLibrary[index] }
			: {}),
	}));
};

const summarizeTokenPlanningContext = (
	designSystemPayload: Awaited<ReturnType<typeof getDesignSystemPayload>>,
	storedTokens: TailwindTokenStorage | null,
) => {
	if (designSystemPayload.designSystem === null) {
		return {
			storageStatus: "not_linked" as const,
			listTool: "listDesignTokens",
			guidance:
				"Link the design to a configured system or pass designFileId after linking to inspect token storage.",
		};
	}

	const systemName = designSystemPayload.designSystem.systemName;
	if (!storedTokens) {
		return {
			storageStatus: "not_stored" as const,
			systemName,
			listTool: "listDesignTokens",
			guidance:
				"Token storage is not available yet for this system. Use listDesignTokens after tokens are synced.",
		};
	}

	const domains = Object.entries(storedTokens.domains).map(
		([domain, storage]) => {
			const customCount = storage.baselineDiff.added.length;
			const overriddenCount = storage.baselineDiff.overridden.length;
			const removedCount = storage.baselineDiff.removed.length;

			return {
				domain,
				tokenCount: Object.keys(storage.tokens).length,
				customCount,
				overriddenCount,
				removedCount,
				hasChanges: customCount + overriddenCount + removedCount > 0,
			};
		},
	);

	return {
		storageStatus: "stored" as const,
		systemName,
		listTool: "listDesignTokens",
		tokenSnapshotVersion: storedTokens.version,
		tokenSnapshotSyncedAt: storedTokens.metadata.syncedAt,
		tailwindBaselineVersion: storedTokens.metadata.tailwindBaselineVersion,
		reviewRequired: storedTokens.metadata.reviewRequired,
		domains,
		changedDomains: domains
			.filter((domainSummary) => domainSummary.hasChanges)
			.map((domainSummary) => domainSummary.domain),
		guidance:
			"Use listDesignTokens for the full per-domain token name/value list.",
	};
};

const buildResourcePlanningContext = async (
	context: TrickroomMcpServerContext,
	systemName: string | null,
) => {
	const fonts = {
		available: false,
		usageTool: null,
		listTool: null,
		note: "Font MCP discovery is not available yet. Use Tailwind font utilities via className.",
	};

	const unavailableAssets = {
		available: false,
		count: 0,
		usageTool: "findAssetUsage",
		listTool: "listSystemAssets",
		describeTool: "describeAsset",
		referenceProps: [assetIdProp, "alt"],
		elementComponents: ["trickroom/asset"],
		manifestUpdatedAt: null,
	};
	const unavailableIcons = {
		available: false,
		count: 0,
		usageTool: "findIconUsage",
		listTool: "listSystemIcons",
		describeTool: "describeIcon",
		referenceProps: [iconIdProp, "aria-label"],
		elementComponents: ["trickroom/icon"],
		manifestUpdatedAt: null,
	};

	if (systemName === null) {
		return {
			assets: unavailableAssets,
			icons: unavailableIcons,
			fonts,
			guidance:
				"Link the design to a configured system to discover assets and icons.",
		};
	}

	const system = await findDesignSystem(context.projectRoot, systemName);
	if (!system) {
		return {
			assets: unavailableAssets,
			icons: unavailableIcons,
			fonts,
			guidance: `System "${systemName}" is referenced but not configured.`,
		};
	}

	const [assetManifest, iconManifest] = await Promise.all([
		readAssetManifest(context.projectRoot, system.manifest.systemId).catch(
			() => null,
		),
		readIconManifest(context.projectRoot, system.manifest.systemId).catch(
			() => null,
		),
	]);

	return {
		assets: {
			available: assetManifest !== null,
			count: assetManifest ? Object.keys(assetManifest.assets).length : 0,
			usageTool: "findAssetUsage",
			listTool: "listSystemAssets",
			describeTool: "describeAsset",
			referenceProps: [assetIdProp, "alt"],
			elementComponents: ["trickroom/asset"],
			manifestUpdatedAt: assetManifest?.metadata.updatedAt ?? null,
		},
		icons: {
			available: iconManifest !== null,
			count: iconManifest ? Object.keys(iconManifest.icons).length : 0,
			usageTool: "findIconUsage",
			listTool: "listSystemIcons",
			describeTool: "describeIcon",
			referenceProps: [iconIdProp, "aria-label"],
			elementComponents: ["trickroom/icon"],
			manifestUpdatedAt: iconManifest?.metadata.indexedAt ?? null,
		},
		fonts,
		guidance:
			"Inspect listSystemAssets and listSystemIcons before assigning canonical resource IDs. Raw bytes and SVG are not returned by MCP.",
	};
};

const buildAuthoringGuidance = () => ({
	recommendedFirstCall:
		"Call getDesignAuthoringContract with designFileId once before planning design-file mutations. For system component draft authoring, call getSystemComponentAuthoringContract.",
	mutationStrategy: [
		{
			prefer: "addRecipe",
			when: "The UI maps to a supported registry recipe.",
		},
		{
			prefer: "addSubtree",
			when: "You need a generated multi-node structure not covered by a recipe.",
		},
		{
			prefer: "addElement",
			when: "You need one simple registry node.",
		},
		{
			prefer: "copySubtree",
			when: "You can reuse an existing subtree from this or another design.",
		},
		{
			prefer: "validateOperation",
			when: "A single operation target or parameters are uncertain.",
		},
		{
			prefer: "validateSubtree",
			when: "A candidate subtree is large or structurally complex.",
		},
		{
			prefer: "validateCopySubtree",
			when: "Copying an existing subtree into a new parent is uncertain.",
		},
	],
	rules: [
		"Do not write registry-reference props or recipe marker props manually.",
		"Inspect system assets and icons before setting canonical resource IDs.",
		"Use listDesignTokens for full token lists; the contract only summarizes storage.",
		"Use describeRegistryRecipe for full recipe templates and slot defaults.",
		"Use getSystemComponentAuthoringContract before creating or updating system component drafts.",
	],
});

const SYSTEM_COMPONENT_AUTHORING_PLACEHOLDER_REVISION =
	"sha256:0000000000000000000000000000000000000000000000000000000000000000";
const SYSTEM_COMPONENT_AUTHORING_PLACEHOLDER_TEMPLATE_HASH =
	"sha256:1111111111111111111111111111111111111111111111111111111111111111";

const SYSTEM_COMPONENT_AUTHORING_CONTRACT_EXAMPLES = [
	{
		tool: "createSystemComponentDraft",
		description: "Create a component draft with a root template and variants.",
		arguments: {
			systemName: "Core",
			expectedRevision: SYSTEM_COMPONENT_AUTHORING_PLACEHOLDER_REVISION,
			slug: "status-pill",
			name: "Status Pill",
			draft: {
				root: {
					path: "root",
					library: "trickroom",
					component: "container",
					className: "inline-flex items-center gap-2 rounded-full px-3 py-1",
					children: [
						{
							path: "label",
							library: "trickroom",
							component: "text",
							text: "Status",
						},
					],
				},
				variants: {
					axes: {
						tone: {
							label: "Tone",
							defaultValue: "neutral",
							values: {
								neutral: {
									label: "Neutral",
									classesByPath: { root: "bg-zinc-100 text-zinc-800" },
								},
								success: {
									label: "Success",
									classesByPath: { root: "bg-emerald-100 text-emerald-800" },
								},
							},
						},
					},
					defaultValues: { tone: "neutral" },
				},
				overrideTargets: {
					label: {
						targetId: "label",
						label: "Label",
						path: "label",
						capabilities: ["text", "className"],
					},
				},
			},
		},
	},
	{
		tool: "updateSystemComponentDraft",
		description: "Update draft override targets with optimistic hashes.",
		arguments: {
			systemName: "Core",
			componentId: "cmp_00000000-0000-4000-8000-000000000001",
			expectedRevision: SYSTEM_COMPONENT_AUTHORING_PLACEHOLDER_REVISION,
			expectedDraftTemplateHash:
				SYSTEM_COMPONENT_AUTHORING_PLACEHOLDER_TEMPLATE_HASH,
			overrideTargets: {
				root: {
					targetId: "root",
					label: "Root",
					path: "root",
					capabilities: ["className"],
				},
			},
		},
	},
] as const;

const getSystemComponentAuthoringContractPayload = async (
	context: TrickroomMcpServerContext,
	options: { systemName?: string; includeExamples?: boolean } = {},
) => {
	const systems = await listDesignSystems(context.projectRoot);
	const selectedSystem =
		options.systemName === undefined
			? null
			: (systems.find(
					(system) =>
						system.manifest.systemName === options.systemName ||
						system.manifest.systemId === options.systemName,
				) ?? null);

	return {
		project: getProjectReference(context),
		schemaVersion: 1,
		contract: "system-component-authoring",
		system:
			options.systemName === undefined
				? null
				: {
						requested: options.systemName,
						configured: selectedSystem !== null,
						systemId: selectedSystem?.manifest.systemId ?? null,
						systemName: selectedSystem?.manifest.systemName ?? null,
					},
		configuredSystems: systems.map((system) => ({
			systemId: system.manifest.systemId,
			systemName: system.manifest.systemName,
		})),
		recommendedFirstCall:
			"Call getSystemComponentAuthoringContract before createSystemComponentDraft or updateSystemComponentDraft. Use listSystemComponents or describeSystemComponent for the current revision and draft hashes.",
		tools: {
			read: ["listSystemComponents", "describeSystemComponent"],
			write: [
				"createSystemComponentDraft",
				"updateSystemComponentDraft",
				"publishSystemComponent",
				"deleteSystemComponent",
			],
		},
		shapes: {
			root: {
				type: "RecipeTemplateNode",
				required: ["path", "library", "component"],
				optional: ["name", "className", "props", "text", "slot", "children"],
				pathRules: [
					'Use "root" for the root node path.',
					"Every template path must be unique, non-empty, stable, and slashless.",
					"slots, variants.classesByPath, and overrideTargets.path reference these paths.",
				],
				children:
					"Recursive array of RecipeTemplateNode for branch-role nodes.",
				props: "JSON-primitive registry control props only.",
			},
			slots: {
				type: "Record<string, SystemComponentSlotDefinition>",
				requiredPerSlot: ["name", "hostPath"],
				optionalPerSlot: ["label", "defaultChildren", "history"],
				rules: [
					"Map key must match slot.name.",
					"hostPath must reference a template path.",
					"defaultChildren uses the same RecipeTemplateNode shape.",
				],
			},
			variants: {
				type: "SystemComponentVariantSchema",
				required: ["axes"],
				axisShape: {
					required: ["label", "values"],
					optional: ["defaultValue"],
				},
				valueShape: {
					optional: ["label", "classesByPath"],
				},
				classesByPath:
					"Record from template path to non-empty Tailwind class string. Paths must exist in root.",
				compoundVariants:
					"Array of { when: Record<axis, value | value[]>, classesByPath }. Normal authoring uses single string values for at least two valid axis/value conditions.",
				defaultValues:
					"Record from axis id to value id. Both schema defaultValues and axis.defaultValue must reference real value ids.",
				rules: [
					"Omit defaultValues and axis.defaultValue for optional axes. Omitted default-less axes are genuinely unset; Trickroom does not fabricate the first value.",
					"Compound variants are matched by their normalized when signature. Do not author duplicate signatures; validation reports duplicates and persisted order remains CSS precedence.",
					"Compounds with empty classesByPath are treated as empty and may be garbage-collected by authoring flows; omit them instead of persisting empty entries.",
					"Array-valued when entries remain accepted for compatibility and are preserved as advanced shapes, but normal UI authoring should not collapse or expand them silently.",
				],
				instanceUpdates:
					"Use variantValues to set axes and unsetVariantAxes to clear axes. Missing variantValues keys leave existing instance values unchanged. On addSystemComponent, unsetVariantAxes clears matching initial variantValues before schema defaults resolve.",
			},
			overrideTargets: {
				type: "Record<string, SystemComponentOverrideTarget>",
				requiredPerTarget: ["targetId", "label", "path"],
				optionalPerTarget: ["capabilities", "props", "history"],
				capabilities: ["className", "text", "icon", "asset"],
				props:
					"Visible registry control prop names on the target template node, for example placeholder or disabled.",
				rules: [
					"Map key must match target.targetId.",
					"path must reference a template path.",
					"capabilities defaults to className when omitted.",
					"props must reference visible, non-deprecated registry controls on the target node.",
				],
			},
		},
		validation: {
			errorCode: "VALIDATION_FAILED",
			diagnosticCode: "INVALID_SYSTEM_COMPONENT_DRAFT_INPUT",
			note: "Malformed draft inputs return structured diagnostics with path and message fields.",
		},
		...((options.includeExamples ?? true)
			? { examples: SYSTEM_COMPONENT_AUTHORING_CONTRACT_EXAMPLES }
			: {}),
	};
};

const getAuthoringContractPayload = async (
	context: TrickroomMcpServerContext,
	options: AuthoringContractOptions = {},
) => {
	const {
		designFileId,
		includeExamples = true,
		includeRecipes = "summary",
		includeResources = true,
	} = options;
	const policy = getMcpPolicy(context.config);
	if (designFileId !== undefined) {
		assertCanReadDesignFile(policy, designFileId);
	}

	const registriesPayload = buildRegistryCatalogForContract(
		policy,
		includeRecipes,
	);
	const componentCatalog = registriesPayload.map((registry) => ({
		library: registry.library,
		components: registry.components,
	}));
	const recipeCatalog =
		includeRecipes === "summary"
			? registriesPayload.map((registry) => ({
					library: registry.library,
					recipes: registry.recipes ?? [],
				}))
			: [];

	const catalogHash = createCatalogHash(componentCatalog);
	const registryHash = catalogHash;
	const recipeCatalogHash =
		includeRecipes === "summary" ? createCatalogHash(recipeCatalog) : null;

	const designSystemPayload =
		designFileId === undefined
			? null
			: await getDesignSystemPayload(context, designFileId);

	const storedTokens =
		designSystemPayload?.designSystem?.systemId === undefined ||
		designSystemPayload?.designSystem?.systemId === null
			? null
			: await readDomainTokensReadonly(
					context.projectRoot,
					designSystemPayload.designSystem.systemId,
				);

	const tokens =
		designSystemPayload === null
			? null
			: summarizeTokenPlanningContext(designSystemPayload, storedTokens);

	const resources =
		designSystemPayload === null || !includeResources
			? null
			: await buildResourcePlanningContext(
					context,
					designSystemPayload.designSystem?.systemName ?? null,
				);

	const resourceManifestUpdatedAt =
		resources === null
			? null
			: ([resources.assets.manifestUpdatedAt, resources.icons.manifestUpdatedAt]
					.filter((value): value is string => typeof value === "string")
					.sort()
					.at(-1) ?? null);

	return {
		project: getProjectReference(context),
		governance: getGovernanceSummary(policy),
		schemaVersion: 1,
		contract: "design-authoring",
		designSchemaVersion: 1,
		relatedContracts: {
			systemComponentAuthoring: {
				tool: "getSystemComponentAuthoringContract",
				when: "Use for createSystemComponentDraft and updateSystemComponentDraft root, slot, variant, and override target payloads.",
			},
		},
		catalogVersion: "builtin:trickroom:1",
		catalogHash,
		registryHash,
		recipeCatalogHash,
		tokenSnapshotVersion: tokens?.tokenSnapshotVersion ?? null,
		tokenSnapshotSyncedAt: tokens?.tokenSnapshotSyncedAt ?? null,
		resourceManifestUpdatedAt,
		registries: registriesPayload,
		props: {
			writableInstanceProps: ["className", "data-trickroom-name"],
			modelFacingAliases: {
				name: "data-trickroom-name",
			},
			systemOwnedProps: [...SYSTEM_PROP_KEYS].sort(),
			fixedSystemProps: [
				"data-trickroom-library",
				"data-trickroom-component",
				"data-trickroom-role",
			],
		},
		compositionRules: {
			roleInvariants: [
				{
					role: "text",
					children: "string",
					acceptsElementChildren: false,
				},
				{
					role: "leaf",
					children: "empty-array",
					acceptsElementChildren: false,
				},
				{
					role: "branch",
					children: "array",
					acceptsElementChildren: true,
				},
			],
			futureSlotModel:
				"Slot metadata can narrow freeform composition later, but it must not override role invariants.",
		},
		mutationRules: [
			"Use element IDs as primary handles.",
			"Use listDesignFiles for the current expectedRevision; use bounded readDesignFile, readElement, or readSubtree only for needed structure.",
			"Use validateOperation to dry-run a single operation before writing when the target context is uncertain.",
			"Registry-reference and recipe marker props are system-owned and must not be written through instance props.",
			"Use updateElementText for text role content; text is stored in children, not props.",
			"Only branch role elements accept child elements; text and leaf role elements reject child insertion and moves into them.",
		],
		authoringGuidance: buildAuthoringGuidance(),
		...(includeExamples ? { examples: AUTHORING_CONTRACT_EXAMPLES } : {}),
		...(tokens === null ? {} : { tokens }),
		...(resources === null ? {} : { resources }),
		designSystem: designSystemPayload,
	};
};

const readDesignFileForTool = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	const service = createDesignFileService(context.projectRoot);
	return service.readDesignFile(service.getFileForUuid(designFileId));
};

const getDesignSystemPayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	const systemHandle = getDesignSystemHandle(read.design);
	const system = systemHandle
		? await findDesignSystem(context.projectRoot, systemHandle)
		: null;
	const storedTokens = system
		? await readDomainTokensReadonly(
				context.projectRoot,
				system.manifest.systemId,
			)
		: null;

	return {
		designFile: {
			id: designFileId,
			file: read.file,
			name: read.design.name,
			revision: read.revision,
			systemId:
				read.design.systemId !== undefined
					? read.design.systemId
					: (system?.manifest.systemId ?? null),
			systemName:
				systemHandle === null
					? null
					: (read.design.systemName ??
						system?.manifest.systemName ??
						systemHandle),
		},
		designSystem: systemHandle
			? {
					systemId: system?.manifest.systemId ?? null,
					systemName: system?.manifest.systemName ?? systemHandle,
					configured: system !== null,
					...(system?.manifest.cssPath
						? { cssPath: system.manifest.cssPath }
						: {}),
					tokenStorage: storedTokens
						? {
								available: true,
								version: storedTokens.version,
								cssPath: storedTokens.metadata.cssPath,
								syncedAt: storedTokens.metadata.syncedAt,
								tailwindBaselineVersion:
									storedTokens.metadata.tailwindBaselineVersion,
								reviewRequired: storedTokens.metadata.reviewRequired,
							}
						: {
								available: false,
							},
				}
			: null,
	};
};

const readDesignSummaryPayload = async (
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

const listDesignFilesPayload = async (context: TrickroomMcpServerContext) => {
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
			};
		}),
	);

	return {
		project: getProjectReference(context),
		projectName: context.config.name,
		projectRoot: context.projectRoot,
		governance: getGovernanceSummary(policy),
		designFiles: decoratedDesignFiles,
	};
};

const toDesignFileResources = (
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
		const projectLabel = `${payload.projectName} (${locationId})`;

		return {
			uri: buildDesignResourceUri(locationId, designFile.id, slug),
			name: `design:${locationId}:${slug}--${designFile.id}`,
			title: `${designFile.name} - ${projectLabel}`,
			description: `Design file in ${projectLabel}`,
			mimeType: "application/json",
		};
	});
};

const listSystemAssetsPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const manifest = await readAssetManifest(
		context.projectRoot,
		system.manifest.systemId,
	);
	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		updatedAt: manifest.metadata.updatedAt,
		assets: Object.entries(manifest.assets).map(([id, asset]) => ({
			id,
			...asset,
		})),
	};
};

const describeAssetPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	assetId: string,
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const asset = await readAsset(
		context.projectRoot,
		system.manifest.systemId,
		assetId,
	);
	if (!asset) {
		throw new DesignTransformError(
			"UNKNOWN_ASSET_ID",
			`Asset id "${assetId}" does not exist in system "${system.manifest.systemName}".`,
		);
	}

	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		asset: {
			id: assetId,
			...asset,
		},
	};
};

const listSystemIconsPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const manifest = await readIconManifest(
		context.projectRoot,
		system.manifest.systemId,
	);
	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		indexedAt: manifest.metadata.indexedAt,
		iconFolderPaths: manifest.iconFolderPaths,
		icons: Object.entries(manifest.icons).map(([id, icon]) => ({
			id,
			...icon,
		})),
		diagnostics: manifest.diagnostics,
	};
};

const listSystemComponentsPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const result = await listSystemComponentSummaries(
		context.projectRoot,
		system.manifest.systemId,
	);
	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		revision: result.revision,
		updatedAt: result.updatedAt,
		settings: {
			autoMigrateComponents:
				result.manifest.settings?.autoMigrateComponents ?? false,
		},
		components: result.components,
	};
};

const describeSystemComponentPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	componentId: string,
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const result = await describeSystemComponent(
		context.projectRoot,
		system.manifest.systemId,
		componentId,
	);
	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		revision: result.revision,
		updatedAt: result.updatedAt,
		componentId: result.componentId,
		record: result.record,
		draftTemplateHash: result.draftTemplateHash,
		draftVariantSchemaHash: result.draftVariantSchemaHash,
		diagnostics: result.diagnostics,
		valid: result.valid,
	};
};

const emptySystemComponentUsageStatusCounts =
	(): SystemComponentUsageScanResult["statusCounts"] => ({
		current: 0,
		stale: 0,
		"missing-component": 0,
		"missing-version": 0,
		"hash-mismatch": 0,
	});

const createEmptySystemComponentUsageScanResult = (options: {
	systemId?: string;
	systemName?: string;
	componentId?: string;
}): SystemComponentUsageScanResult => ({
	systemId: options.systemId,
	systemName: options.systemName,
	componentId: options.componentId,
	instances: [],
	diagnostics: [],
	usedByCount: 0,
	scannedDesignCount: 0,
	statusCounts: emptySystemComponentUsageStatusCounts(),
});

const mergeSystemComponentUsageScanResults = (
	results: readonly SystemComponentUsageScanResult[],
	defaults: Pick<
		SystemComponentUsageScanResult,
		"systemId" | "systemName" | "componentId"
	> = {},
): SystemComponentUsageScanResult => {
	if (results.length === 0) {
		return createEmptySystemComponentUsageScanResult(defaults);
	}

	const merged: SystemComponentUsageScanResult = {
		instances: [],
		diagnostics: [],
		usedByCount: 0,
		scannedDesignCount: 0,
		statusCounts: emptySystemComponentUsageStatusCounts(),
	};

	for (const result of results) {
		merged.systemId ??= result.systemId;
		merged.systemName ??= result.systemName;
		merged.componentId ??= result.componentId;
		merged.instances.push(...result.instances);
		merged.diagnostics.push(...result.diagnostics);
		merged.usedByCount += result.usedByCount;
		merged.scannedDesignCount += result.scannedDesignCount;
		for (const [status, count] of Object.entries(result.statusCounts)) {
			merged.statusCounts[
				status as keyof SystemComponentUsageScanResult["statusCounts"]
			] += count;
		}
	}

	return merged;
};

const scanPolicyAllowedSystemComponentUsage = async (
	context: TrickroomMcpServerContext,
	options: {
		systemName: string;
		componentId?: string;
		designFileId?: string;
	},
) => {
	const policy = getMcpPolicy(context.config);
	const system = await assertConfiguredSystem(context, options.systemName);

	if (options.designFileId) {
		assertCanReadDesignFile(policy, options.designFileId);
		return scanProjectSystemComponentUsage(context.projectRoot, {
			systemHandle: system.manifest.systemId,
			componentId: options.componentId,
			designFileId: options.designFileId,
		});
	}

	if (policy.allowedDesignFileIds !== null) {
		const emptyScanDefaults = {
			systemId: system.manifest.systemId,
			systemName: system.manifest.systemName,
			componentId: options.componentId,
		};
		if (policy.allowedDesignFileIds.size === 0) {
			return createEmptySystemComponentUsageScanResult(emptyScanDefaults);
		}

		const results = await Promise.all(
			Array.from(policy.allowedDesignFileIds).map((designFileId) =>
				scanProjectSystemComponentUsage(context.projectRoot, {
					systemHandle: system.manifest.systemId,
					componentId: options.componentId,
					designFileId,
				}),
			),
		);
		return mergeSystemComponentUsageScanResults(results, emptyScanDefaults);
	}

	return scanProjectSystemComponentUsage(context.projectRoot, {
		systemHandle: system.manifest.systemId,
		componentId: options.componentId,
	});
};

const createEmptySystemComponentBulkMigrationReport = (options: {
	dryRun?: boolean;
	systemId?: string;
	systemName?: string;
	componentId?: string;
}): SystemComponentBulkMigrationReport => ({
	systemId: options.systemId,
	systemName: options.systemName,
	componentId: options.componentId,
	dryRun: options.dryRun ?? false,
	designs: [],
	changed: [],
	skipped: [],
	reviewRequired: [],
	failures: [],
	scannedDesignCount: 0,
	changedCount: 0,
	skippedCount: 0,
	reviewRequiredCount: 0,
	failureCount: 0,
});

const mergeSystemComponentBulkMigrationReports = (
	reports: readonly SystemComponentBulkMigrationReport[],
	defaults: Pick<
		SystemComponentBulkMigrationReport,
		"dryRun" | "systemId" | "systemName" | "componentId"
	> = { dryRun: false },
): SystemComponentBulkMigrationReport => {
	if (reports.length === 0) {
		return createEmptySystemComponentBulkMigrationReport(defaults);
	}

	const merged: SystemComponentBulkMigrationReport = {
		...reports[0],
		designs: [],
		changed: [],
		skipped: [],
		reviewRequired: [],
		failures: [],
		scannedDesignCount: 0,
	};

	for (const report of reports) {
		merged.designs.push(...report.designs);
		merged.changed.push(...report.changed);
		merged.skipped.push(...report.skipped);
		merged.reviewRequired.push(...report.reviewRequired);
		merged.failures.push(...report.failures);
		merged.scannedDesignCount += report.scannedDesignCount;
	}

	merged.changedCount = merged.changed.length;
	merged.skippedCount = merged.skipped.length;
	merged.reviewRequiredCount = merged.reviewRequired.length;
	merged.failureCount = merged.failures.length;
	return merged;
};

const bulkMigratePolicyAllowedSystemComponentUsages = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	options: {
		componentId?: string;
		designFileId?: string;
		dryRun?: boolean;
		onlySafe?: boolean;
	},
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const policy = getMcpPolicy(context.config);
	const bulkOptions = {
		systemHandle: system.manifest.systemId,
		componentId: options.componentId,
		dryRun: options.dryRun,
		onlySafe: options.onlySafe,
		persist: !options.dryRun,
		assertInstanceSubtreeAllowed: (design, elementId) => {
			assertCanUseSystemComponentInstanceSubtree(policy, design, elementId);
		},
	};

	if (options.designFileId) {
		assertCanReadDesignFile(policy, options.designFileId);
		if (!options.dryRun) {
			assertCanWriteDesignFile(policy, options.designFileId);
		}
		return bulkMigrateProjectSystemComponentInstances(context.projectRoot, {
			...bulkOptions,
			designFileId: options.designFileId,
		});
	}

	if (policy.allowedDesignFileIds !== null) {
		const emptyReportDefaults = {
			dryRun: options.dryRun ?? false,
			systemId: system.manifest.systemId,
			systemName: system.manifest.systemName,
			componentId: options.componentId,
		};
		if (policy.allowedDesignFileIds.size === 0) {
			return createEmptySystemComponentBulkMigrationReport(emptyReportDefaults);
		}

		const reports = await Promise.all(
			Array.from(policy.allowedDesignFileIds).map((designFileId) => {
				assertCanReadDesignFile(policy, designFileId);
				if (!options.dryRun) {
					assertCanWriteDesignFile(policy, designFileId);
				}
				return bulkMigrateProjectSystemComponentInstances(context.projectRoot, {
					...bulkOptions,
					designFileId,
				});
			}),
		);
		return mergeSystemComponentBulkMigrationReports(
			reports,
			emptyReportDefaults,
		);
	}

	if (!options.dryRun) {
		assertCanWriteProject(policy);
	}

	return bulkMigrateProjectSystemComponentInstances(
		context.projectRoot,
		bulkOptions,
	);
};

const bulkMigrateSystemComponentUsagesPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	options: {
		componentId?: string;
		designFileId?: string;
		dryRun?: boolean;
		onlySafe?: boolean;
	} = {},
) => {
	const report = await bulkMigratePolicyAllowedSystemComponentUsages(
		context,
		systemName,
		options,
	);

	return {
		project: getProjectReference(context),
		systemId: report.systemId,
		systemName: report.systemName ?? systemName,
		componentId: options.componentId,
		designFileId: options.designFileId,
		dryRun: report.dryRun,
		onlySafe: options.onlySafe !== false,
		scannedDesignCount: report.scannedDesignCount,
		changedCount: report.changedCount,
		skippedCount: report.skippedCount,
		reviewRequiredCount: report.reviewRequiredCount,
		failureCount: report.failureCount,
		designs: report.designs,
		changed: report.changed,
		skipped: report.skipped,
		reviewRequired: report.reviewRequired,
		failures: report.failures,
	};
};

const listStaleSystemComponentUsagesPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	options: {
		componentId?: string;
		designFileId?: string;
	} = {},
) => {
	const result = await scanPolicyAllowedSystemComponentUsage(context, {
		systemName,
		...options,
	});
	const staleInstances = result.instances.filter(
		(instance) => instance.versionStatus?.status === "stale",
	);
	const diagnosticMatchesUsage = (
		diagnostic: SystemComponentUsageScanDiagnostic,
		usage: SystemComponentInstanceUsage,
	) =>
		diagnostic.designFileId === usage.designFileId &&
		diagnostic.elementId === usage.elementId &&
		diagnostic.componentId === usage.componentId &&
		diagnostic.version === usage.version;

	return {
		project: getProjectReference(context),
		systemId: result.systemId,
		systemName: result.systemName ?? systemName,
		componentId: options.componentId,
		designFileId: options.designFileId,
		staleCount: staleInstances.length,
		scannedDesignCount: result.scannedDesignCount,
		statusCounts: result.statusCounts,
		usages: staleInstances.map((usage) => ({
			designFileId: usage.designFileId,
			designFile: usage.designFile,
			designName: usage.designName,
			nodeId: usage.elementId,
			nodePath: usage.path,
			componentId: usage.componentId,
			systemId: usage.systemId,
			instanceId: usage.instanceId,
			referencedVersion: usage.version,
			attachedVersion: usage.version,
			currentVersion: usage.versionStatus?.currentVersion,
			publishedVersion: usage.versionStatus?.publishedVersion,
			diagnostics: result.diagnostics.filter((diagnostic) =>
				diagnosticMatchesUsage(diagnostic, usage),
			),
		})),
		diagnostics: result.diagnostics,
	};
};

const systemComponentMutationPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	componentId: string,
	extra: Record<string, unknown> = {},
) => ({
	status: "success",
	...(await describeSystemComponentPayload(context, systemName, componentId)),
	...extra,
});

const describeIconPayload = async (
	context: TrickroomMcpServerContext,
	systemName: string,
	iconId: string,
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const icon = await readIcon(
		context.projectRoot,
		system.manifest.systemId,
		iconId,
	);
	if (!icon) {
		throw new DesignTransformError(
			"UNKNOWN_ICON_ID",
			`Icon id "${iconId}" does not exist in system "${system.manifest.systemName}".`,
		);
	}

	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		icon: {
			id: iconId,
			...icon,
		},
	};
};

const findResourceUsagePayload = async (
	context: TrickroomMcpServerContext,
	kind: "asset" | "icon",
	systemName: string,
	resourceId: string | undefined,
) => {
	const system = await assertConfiguredSystem(context, systemName);
	const policy = getMcpPolicy(context.config);
	const usages = await findProjectResourceUsage(
		context.projectRoot,
		kind,
		system.manifest.systemId,
		resourceId,
		{ allowedDesignFileIds: policy.allowedDesignFileIds },
	);

	return {
		project: getProjectReference(context),
		systemId: system.manifest.systemId,
		systemName: system.manifest.systemName,
		kind,
		resourceId: resourceId ?? null,
		usages,
	};
};

const readDesignFilePayload = async (
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

const readElementPayload = async (
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

const readSubtreePayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	elementId: string,
	options: TreeReadInput = {},
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const read = await readDesignFileForTool(context, designFileId);
	const elementContext = getElementContextOrThrow(read.design, elementId);
	const recipeSummariesByElementId = getRecipeAttachmentSummaries(read.design);
	const bounds = createTreeReadBounds(options);
	const stats = createTreeReadStats(bounds);
	const subtree = detailedSubtree(
		elementContext.element,
		stats,
		0,
		recipeSummariesByElementId,
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

const validateDesignFilePayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
) => {
	assertCanReadDesignFile(getMcpPolicy(context.config), designFileId);
	const service = createDesignFileService(context.projectRoot);
	const read = await service.readJsonFile(service.getFileForUuid(designFileId));
	const issues: ValidationIssue[] = [];

	if (!isTrickroomDesign(read.value)) {
		return {
			project: getProjectReference(context),
			designFile: {
				id: designFileId,
				file: read.file,
				revision: read.revision,
			},
			valid: false,
			issues: [
				{
					severity: "error",
					code: "INVALID_DESIGN_PAYLOAD",
					message: "File does not contain a valid Trickroom design payload.",
				},
			] satisfies ValidationIssue[],
		};
	}

	const design = read.value;
	const diagnostics = await getDesignDiagnostics(context, design);
	issues.push(...diagnostics.issues);
	const systemHandle = getDesignSystemHandle(design);
	if (systemHandle !== null) {
		const system = await findDesignSystem(context.projectRoot, systemHandle);
		if (!system) {
			issues.push({
				severity: "error",
				code: "UNKNOWN_DESIGN_SYSTEM",
				message: `Design references unconfigured design system "${systemHandle}".`,
				path: design.systemId !== undefined ? "systemId" : "systemName",
			});
		}
	}

	const seenElementIds = new Map<string, string>();
	const componentUsage = new Map<string, number>();
	for (const [rootIndex, board] of design.boards.entries()) {
		validateElementReferences(
			board,
			`boards[${rootIndex}]`,
			seenElementIds,
			issues,
			componentUsage,
		);
	}

	const registryReferences = [...componentUsage.entries()]
		.map(([componentRef, count]) => {
			const [library, component] = componentRef.split("/");
			return { library, component, count };
		})
		.sort((a, b) =>
			a.library === b.library
				? a.component.localeCompare(b.component)
				: a.library.localeCompare(b.library),
		);

	return {
		project: getProjectReference(context),
		designFile: {
			id: designFileId,
			file: read.file,
			name: design.name,
			systemId: design.systemId ?? null,
			systemName: systemHandle === null ? null : (design.systemName ?? null),
			revision: read.revision,
		},
		valid: issues.every((issue) => issue.severity !== "error"),
		issues,
		designSystem: await summarizeDesignSystemReference(context, systemHandle),
		tokenDiagnostics: diagnostics.tokenSnapshot,
		registryReferences,
		elementCount: seenElementIds.size,
		rootElementIds: design.boards.map((board) => board.id),
	};
};

const readDesignGraphPayload = async (
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

const summarizeDesignFileReadText = (payload: Record<string, unknown>) => {
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

const summarizeSubtreeReadText = (payload: Record<string, unknown>) => {
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

const summarizeDesignGraphReadText = (payload: Record<string, unknown>) => {
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

const validateOperationPayload = async (
	context: TrickroomMcpServerContext,
	designFileId: string,
	expectedRevision: string,
	operation: DesignOperationName,
	parameters: unknown,
) => {
	const policy = getMcpPolicy(context.config);
	assertCanReadDesignFile(policy, designFileId);
	const params = validateDryRunOperationParameters(operation, parameters);
	const read = await readDesignFileForTool(context, designFileId);

	if (read.revision !== expectedRevision) {
		return {
			status: "REVISION_MISMATCH",
			valid: false,
			project: getProjectReference(context),
			designFile: getDesignMetadata(designFileId, read),
			currentRevision: read.revision,
			expectedRevision,
			message:
				"The design file was modified since your last read. Re-read before applying or validating the operation.",
			suggestedReads: ["readDesignFile", "readDesignGraph"],
			issues: [
				{
					severity: "error",
					code: "REVISION_MISMATCH",
					message: "Expected revision does not match current revision.",
				},
			] satisfies ValidationIssue[],
		};
	}

	if (operation === "addSubtree") {
		const addSubtreeParameters = params as AddSubtreeOperationParameters;
		const validation = await validateSubtreePayload(context, {
			designFileId,
			expectedRevision,
			...addSubtreeParameters,
		});

		return {
			status: validation.status,
			valid: validation.valid,
			project: validation.project,
			designFile: validation.designFile,
			operation,
			predicted: {
				parentId: addSubtreeParameters.parentId,
				index: addSubtreeParameters.index,
				stats: validation.stats,
				...(validation.normalizedSubtree !== undefined
					? { normalizedSubtree: validation.normalizedSubtree }
					: {}),
				...(validation.recipeExpansions.length > 0
					? { recipeExpansions: validation.recipeExpansions }
					: {}),
			},
			issues: validation.diagnostics as ValidationIssue[],
			warnings: validation.warnings as ValidationIssue[],
			...(validation.tokenDiagnostics !== null
				? { tokenDiagnostics: validation.tokenDiagnostics }
				: {}),
			suggestedReads: validation.suggestedReads,
		};
	}

	if (operation === "copySubtree") {
		const copySubtreeParameters = params as CopySubtreeOperationParameters;
		const validation = await validateCopySubtreePayload(context, {
			...copySubtreeParameters,
			targetDesignFileId: designFileId,
			expectedRevision,
		});

		return {
			status: validation.status,
			valid: validation.valid,
			project: validation.project,
			designFile:
				validation.targetDesignFile ?? getDesignMetadata(designFileId, read),
			operation,
			predicted: {
				sourceDesignFileId: copySubtreeParameters.sourceDesignFileId,
				sourceElementId: copySubtreeParameters.sourceElementId,
				parentId: copySubtreeParameters.parentId,
				index: copySubtreeParameters.index,
				sameDesign: validation.sameDesign,
				stats: validation.stats,
			},
			issues: validation.diagnostics as ValidationIssue[],
			warnings: validation.warnings as ValidationIssue[],
			...(validation.tokenDiagnostics !== null
				? { tokenDiagnostics: validation.tokenDiagnostics }
				: {}),
			suggestedReads: validation.suggestedReads,
		};
	}

	assertOperationAllowedByPolicy(policy, read.design, operation, params);
	const result = await applyDryRunOperation(read.design, operation, params, {
		designFileId,
		projectRoot: context.projectRoot,
		sourceDesigns: new Map(),
	});
	if (operation === "addSystemComponent" && result.changedElementId) {
		const insertedRoot = findElementContext(
			result.design,
			result.changedElementId,
		);
		if (!insertedRoot) {
			throw new DesignTransformError(
				"INVALID_OPERATION",
				"Failed to validate inserted system component root after dry-run.",
			);
		}
		assertCanUseSubtreeComponents(policy, insertedRoot.element);
	}
	await assertResourceElementReferenceExists(
		context,
		result.design,
		result.changedElementId,
	);
	const diagnostics = await getDesignDiagnostics(context, result.design);
	const changedElement =
		result.changedElementId === undefined
			? null
			: getCompactElementSummary(result.design, result.changedElementId);
	const changedContext =
		result.changedElementId === undefined
			? null
			: getMutationContext(result.design, result.changedElementId);

	return {
		status: "success",
		valid: diagnostics.issues.every((issue) => issue.severity !== "error"),
		project: getProjectReference(context),
		designFile: getDesignMetadata(designFileId, read),
		operation,
		predicted: {
			...result.summary,
			changedElement,
			context: changedContext,
			deletedIds: result.deletedIds ?? [],
		},
		issues: diagnostics.issues,
		warnings: diagnostics.issues.filter(
			(issue) => issue.severity === "warning",
		),
		tokenDiagnostics: diagnostics.tokenSnapshot,
		suggestedReads: ["readDesignGraph", "readElement", "validateDesignFile"],
	};
};

const createOperationPlanHooks = (context: TrickroomMcpServerContext) => {
	const policy = getMcpPolicy(context.config);
	return createOperationPlanDependencies(context, policy, {
		readDesignFileForTool: (designFileId) =>
			readDesignFileForTool(context, designFileId),
		getProjectReference: () => getProjectReference(context),
		getDesignMetadata,
		getDesignDiagnostics: (design) => getDesignDiagnostics(context, design),
		assertResourceReferencesExist: (design) =>
			assertResourceReferencesExist(context, design),
		assertCanUseSubtreeComponents: (subtree) =>
			assertCanUseSubtreeComponents(policy, subtree),
		canonicalizeDesignForStorage: (design) =>
			canonicalizeDesignSystemReferenceForStorage(context, design),
	});
};

export const validateOperationPlanPayload = async (
	context: TrickroomMcpServerContext,
	input: z.infer<typeof operationPlanInputSchema>,
) => {
	const policy = getMcpPolicy(context.config);
	assertCanReadDesignFile(policy, input.designFileId);
	const { finalDesign: _finalDesign, ...result } =
		await executeOperationPlanDryRun(createOperationPlanHooks(context), input);
	return result;
};

export const applyDesignOperationsPayload = async (
	context: TrickroomMcpServerContext,
	input: z.infer<typeof operationPlanInputSchema>,
) => {
	return applyOperationPlan(createOperationPlanHooks(context), input);
};

type ValidateSubtreePayload = z.infer<typeof validateSubtreePayloadSchema>;
type ValidateCopySubtreePayload = z.infer<
	typeof validateCopySubtreePayloadSchema
>;

const createSubtreeDiagnosticFromTransformError = (
	error: DesignTransformError,
	path: string,
): SubtreeDiagnostic => ({
	severity: "error",
	code: error.code,
	message: error.message,
	path,
});

const createSubtreeDiagnosticFromDesignIssue = (
	issue: McpDesignIssue,
	index: number,
): SubtreeDiagnostic => ({
	severity: issue.severity,
	code: issue.code,
	message: issue.message,
	path: "/subtree",
	details: {
		source: "candidateDesign",
		index,
		issuePath: issue.path,
		...(issue.elementId !== undefined ? { elementId: issue.elementId } : {}),
	},
});

export const validateSubtreePayload = async (
	context: TrickroomMcpServerContext,
	input: ValidateSubtreePayload,
) => {
	const policy = getMcpPolicy(context.config);
	assertCanReadDesignFile(policy, input.designFileId);
	const read = await readDesignFileForTool(context, input.designFileId);

	if (read.revision !== input.expectedRevision) {
		return {
			status: "REVISION_MISMATCH",
			valid: false,
			project: getProjectReference(context),
			designFile: getDesignMetadata(input.designFileId, read),
			currentRevision: read.revision,
			expectedRevision: input.expectedRevision,
			diagnostics: [
				{
					severity: "error",
					code: "REVISION_MISMATCH",
					message: "Expected revision does not match current revision.",
					path: "/expectedRevision",
				},
			] satisfies SubtreeDiagnostic[],
			stats: { nodeCount: 0, maxDepth: 0, recipeCount: 0 },
			warnings: [] satisfies SubtreeDiagnostic[],
			suggestedReads: ["readDesignFile", "readDesignGraph"],
		};
	}

	const validation = validateProposedSubtreeForInsertion(read.design, {
		parentId: input.parentId,
		index: input.index,
		subtree: input.subtree,
		options: input.options,
	});
	const diagnostics = [...validation.diagnostics];
	let tokenDiagnostics: Awaited<
		ReturnType<typeof getDesignDiagnostics>
	>["tokenSnapshot"] = null;

	if (validation.candidateDesign && validation.candidateRootId) {
		const candidateRoot = findElementContext(
			validation.candidateDesign,
			validation.candidateRootId,
		);
		if (candidateRoot) {
			assertCanUseSubtreeComponents(policy, candidateRoot.element);
		}

		try {
			await assertResourceReferencesExist(context, validation.candidateDesign);
		} catch (error) {
			if (error instanceof DesignTransformError) {
				diagnostics.push(
					createSubtreeDiagnosticFromTransformError(error, "/subtree"),
				);
			} else {
				throw error;
			}
		}

		const candidateDiagnostics = await getDesignDiagnostics(
			context,
			validation.candidateDesign,
		);
		tokenDiagnostics = candidateDiagnostics.tokenSnapshot;
		diagnostics.push(
			...candidateDiagnostics.issues.map((issue, index) =>
				createSubtreeDiagnosticFromDesignIssue(issue, index),
			),
		);
	}

	const valid = diagnostics.every(
		(diagnostic) => diagnostic.severity !== "error",
	);

	return {
		status: "success",
		valid,
		project: getProjectReference(context),
		designFile: getDesignMetadata(input.designFileId, read),
		expectedRevision: input.expectedRevision,
		diagnostics,
		stats: validation.stats,
		...(validation.normalizedSubtree !== undefined
			? { normalizedSubtree: validation.normalizedSubtree }
			: {}),
		recipeExpansions: validation.recipeExpansions,
		warnings: diagnostics.filter(
			(diagnostic) => diagnostic.severity === "warning",
		),
		tokenDiagnostics,
		suggestedReads: ["readDesignGraph", "validateDesignFile"],
	};
};

const getSubtreeStats = (root: DesignNode) => {
	let nodeCount = 0;
	let maxDepth = 0;
	const visit = (node: DesignNode, depth: number) => {
		nodeCount += 1;
		maxDepth = Math.max(maxDepth, depth);
		if (typeof node.children === "string") {
			return;
		}
		for (const child of node.children) {
			visit(child, depth + 1);
		}
	};
	visit(root, 1);
	return { nodeCount, maxDepth };
};

const createCopySubtreeDiagnosticFromTransformError = (
	error: DesignTransformError,
	path: string,
): SubtreeDiagnostic => ({
	severity: "error",
	code: error.code,
	message: error.message,
	path,
});

export const validateCopySubtreePayload = async (
	context: TrickroomMcpServerContext,
	input: ValidateCopySubtreePayload,
) => {
	const policy = getMcpPolicy(context.config);
	const sameDesign = input.sourceDesignFileId === input.targetDesignFileId;
	assertCanReadDesignFile(policy, input.sourceDesignFileId);
	assertCanWriteDesignFile(policy, input.targetDesignFileId);

	if (!sameDesign && input.sourceExpectedRevision === undefined) {
		return {
			status: "success",
			valid: false,
			project: getProjectReference(context),
			sourceDesignFile: null,
			targetDesignFile: null,
			expectedRevision: input.expectedRevision,
			sourceExpectedRevision: null,
			diagnostics: [
				{
					severity: "error",
					code: "SOURCE_REVISION_REQUIRED",
					message:
						"sourceExpectedRevision is required for cross-file copySubtree validation.",
					path: "/sourceExpectedRevision",
				},
			] satisfies SubtreeDiagnostic[],
			stats: { nodeCount: 0, maxDepth: 0 },
			warnings: [] satisfies SubtreeDiagnostic[],
			suggestedReads: ["readDesignFile", "readDesignGraph"],
		};
	}

	const service = createDesignFileService(context.projectRoot);
	const targetFile = service.getFileForUuid(input.targetDesignFileId);
	const targetRead = await service.readDesignFile(targetFile);
	const sourceRead = sameDesign
		? targetRead
		: await service.readDesignFile(
				service.getFileForUuid(input.sourceDesignFileId),
			);

	if (targetRead.revision !== input.expectedRevision) {
		return {
			status: "REVISION_MISMATCH",
			valid: false,
			project: getProjectReference(context),
			sourceDesignFile: getDesignMetadata(input.sourceDesignFileId, sourceRead),
			targetDesignFile: getDesignMetadata(input.targetDesignFileId, targetRead),
			currentRevision: targetRead.revision,
			expectedRevision: input.expectedRevision,
			diagnostics: [
				{
					severity: "error",
					code: "REVISION_MISMATCH",
					message: "Expected target revision does not match current revision.",
					path: "/expectedRevision",
				},
			] satisfies SubtreeDiagnostic[],
			stats: { nodeCount: 0, maxDepth: 0 },
			warnings: [] satisfies SubtreeDiagnostic[],
			suggestedReads: ["readDesignFile", "readDesignGraph"],
		};
	}

	if (
		input.sourceExpectedRevision !== undefined &&
		sourceRead.revision !== input.sourceExpectedRevision
	) {
		return {
			status: "SOURCE_REVISION_MISMATCH",
			valid: false,
			project: getProjectReference(context),
			sourceDesignFile: getDesignMetadata(input.sourceDesignFileId, sourceRead),
			targetDesignFile: getDesignMetadata(input.targetDesignFileId, targetRead),
			currentSourceRevision: sourceRead.revision,
			sourceExpectedRevision: input.sourceExpectedRevision,
			expectedRevision: input.expectedRevision,
			diagnostics: [
				{
					severity: "error",
					code: "SOURCE_REVISION_MISMATCH",
					message: "Expected source revision does not match current revision.",
					path: "/sourceExpectedRevision",
				},
			] satisfies SubtreeDiagnostic[],
			stats: { nodeCount: 0, maxDepth: 0 },
			warnings: [] satisfies SubtreeDiagnostic[],
			suggestedReads: ["readDesignFile", "readDesignGraph"],
		};
	}

	const diagnostics: SubtreeDiagnostic[] = [];
	let stats = { nodeCount: 0, maxDepth: 0 };
	let result: Awaited<ReturnType<typeof applyCopySubtree>> | null = null;
	let tokenDiagnostics: Awaited<
		ReturnType<typeof getDesignDiagnostics>
	>["tokenSnapshot"] = null;

	try {
		normalizeDesignForMutation(sourceRead.design);
		const sourceElementContext = findElementContext(
			sourceRead.design,
			input.sourceElementId,
		);
		if (!sourceElementContext) {
			throw new DesignTransformError(
				"ELEMENT_NOT_FOUND",
				`Element "${input.sourceElementId}" not found.`,
			);
		}
		assertCanUseSubtreeComponents(policy, sourceElementContext.element);
		stats = getSubtreeStats(sourceElementContext.element);
		if (
			input.options?.maxNodes !== undefined &&
			stats.nodeCount > input.options.maxNodes
		) {
			throw new DesignTransformError(
				"SUBTREE_TOO_LARGE",
				`Source subtree has ${stats.nodeCount} nodes, exceeding maxNodes ${input.options.maxNodes}.`,
			);
		}
		if (
			input.options?.maxDepth !== undefined &&
			stats.maxDepth > input.options.maxDepth
		) {
			throw new DesignTransformError(
				"SUBTREE_TOO_DEEP",
				`Source subtree depth ${stats.maxDepth} exceeds maxDepth ${input.options.maxDepth}.`,
			);
		}

		result = await applyCopySubtree(sourceRead.design, targetRead.design, {
			sourceElementId: input.sourceElementId,
			parentId: input.parentId,
			index: input.index,
			sameDesign,
			projectRoot: context.projectRoot,
		});
		await assertResourceReferencesExist(context, result.design);
		const candidateDiagnostics = await getDesignDiagnostics(
			context,
			result.design,
		);
		tokenDiagnostics = candidateDiagnostics.tokenSnapshot;
		diagnostics.push(
			...candidateDiagnostics.issues.map((issue, index) =>
				createSubtreeDiagnosticFromDesignIssue(issue, index),
			),
		);
	} catch (error) {
		if (error instanceof DesignTransformError) {
			diagnostics.push(
				createCopySubtreeDiagnosticFromTransformError(error, "/copySubtree"),
			);
		} else {
			throw error;
		}
	}

	const valid = diagnostics.every(
		(diagnostic) => diagnostic.severity !== "error",
	);

	return {
		status: "success",
		valid,
		project: getProjectReference(context),
		sourceDesignFile: getDesignMetadata(input.sourceDesignFileId, sourceRead),
		targetDesignFile: getDesignMetadata(input.targetDesignFileId, targetRead),
		sourceElementId: input.sourceElementId,
		expectedRevision: input.expectedRevision,
		sourceExpectedRevision: input.sourceExpectedRevision ?? null,
		sameDesign,
		diagnostics,
		stats,
		warnings: diagnostics.filter(
			(diagnostic) => diagnostic.severity === "warning",
		),
		tokenDiagnostics,
		suggestedReads: ["readDesignGraph", "validateDesignFile"],
	};
};

export const createTrickroomMcpServer = (
	initialContext: TrickroomMcpServerContext | null,
	options: TrickroomMcpServerOptions = {},
): TrickroomMcpServer => {
	if (initialContext && !isMcpEnabled(initialContext.config)) {
		throw new TrickroomProjectConfigError(
			"MCP_DISABLED",
			`MCP is disabled for project ${initialContext.config.name}.`,
		);
	}

	let selectedContext = initialContext;
	const trickroomHome = initialContext?.trickroomHome ?? options.trickroomHome;
	const projectResolver =
		options.projectResolver ??
		createTrickroomMcpProjectResolver({
			trickroomHome,
			defaultContext: initialContext?.locationId
				? {
						...initialContext,
						locationId: initialContext.locationId,
					}
				: null,
		});

	const notifyResourceListChanged = async () => {
		try {
			await server.sendResourceListChanged();
		} catch {
			// Notification delivery is best-effort in-band behavior and must not block mutations.
		}
	};

	const getActiveContext = async (project?: TrickroomMcpProjectRef) => {
		if (project?.locationId || project?.projectId) {
			return projectResolver.resolveProject(project);
		}

		const context = selectedContext;
		if (!context) {
			throw new TrickroomProjectConfigError(
				"CONFIG_NOT_FOUND",
				"No Trickroom MCP project is selected. Call selectProject with a projectId or locationId, or start MCP from a folder with a direct .trickroom/config.json.",
			);
		}

		return context;
	};

	const server = new McpServer(
		{
			name: "trickroom",
			version: "0.1.0",
		},
		{
			capabilities: {
				tools: {},
				prompts: {},
				resources: { listChanged: true },
			},
			instructions:
				"Trickroom MCP exposes selected-project design workspace metadata, registry discovery, design-system token discovery, and high-level design mutation tools. Use listProjects and getSelectedProject to confirm context, then selectProject({ locationId }) for explicit project targeting (projectId is allowed but locationId is preferred), and registerProject only to add paths to the catalog. Creation uses exclusive create semantics. Existing-file mutation tools require an expectedRevision obtained from a prior read. On revision mismatch, re-read the design to get the current revision before retrying. Multi-project resources are addressed with trickroom://proj/<locationId>/design/<designId>.",
		},
	) as TrickroomMcpServer;

	server.getActiveContextSnapshot = () => selectedContext;

	server.server.setRequestHandler(ListResourcesRequestSchema, async () => {
		const contexts = await listMcpEnabledProjectContexts({
			trickroomHome,
			includeContext: selectedContext,
		});
		const resourceGroups = await Promise.all(
			contexts.map(async (context) => {
				try {
					const payload = await listDesignFilesPayload(context);
					return toDesignFileResources(context, payload);
				} catch {
					return [];
				}
			}),
		);
		return { resources: resourceGroups.flat() };
	});

	server.server.setRequestHandler(
		ReadResourceRequestSchema,
		async (request): Promise<ReadResourceResult> => {
			const uri = request.params.uri;
			let parsedUri: ReturnType<typeof parseDesignResourceUri>;
			try {
				parsedUri = parseDesignResourceUri(uri);
			} catch (error) {
				throw new McpError(ErrorCode.InvalidParams, "Invalid resource URI.", {
					code: "INVALID_RESOURCE_URI",
					message: error instanceof Error ? error.message : String(error),
					uri,
				});
			}

			let context: TrickroomMcpServerContext;
			try {
				const selectedResourceLocationId = selectedContext
					? getDesignResourceLocationId(selectedContext)
					: null;
				context =
					selectedContext && selectedResourceLocationId === parsedUri.locationId
						? selectedContext
						: await projectResolver.resolveProject({
								locationId: parsedUri.locationId,
							});
			} catch (error) {
				if (error instanceof TrickroomMcpProjectResolverError) {
					throw new McpError(ErrorCode.InvalidParams, error.message, {
						...error.details,
						uri,
					});
				}

				throw error;
			}

			try {
				const payload = await readDesignSummaryPayload(
					context,
					parsedUri.designId,
				);
				return {
					contents: [
						{
							uri,
							mimeType: "application/json",
							text: JSON.stringify(payload, null, 2),
						},
					],
				};
			} catch (error) {
				if (error instanceof McpPolicyError) {
					throw new McpError(ErrorCode.InvalidRequest, error.message, {
						code: error.code,
						uri,
						designFileId: parsedUri.designId,
						project: getProjectReference(context),
					});
				}
				if (error instanceof DesignFileServiceError) {
					throw new McpError(ErrorCode.InvalidParams, error.message, {
						code: error.code,
						uri,
						designFileId: parsedUri.designId,
						project: getProjectReference(context),
					});
				}
				throw error;
			}
		},
	);

	const createPolicyDeniedResult = (
		context: TrickroomMcpServerContext,
		error: McpPolicyError,
	): CallToolResult => {
		const policy = getMcpPolicy(context.config);
		const payload = {
			status: "POLICY_DENIED",
			code: error.code,
			message: error.message,
			project: getProjectReference(context),
			governance: getGovernanceSummary(policy),
		};
		return {
			content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
			structuredContent: payload,
			isError: true,
		};
	};

	const createToolErrorResult = (
		context: TrickroomMcpServerContext,
		code: string,
		message: string,
		details: Record<string, unknown> = {},
	): CallToolResult => {
		const payload = {
			status: "INVALID_OPERATION",
			code,
			message,
			project: getProjectReference(context),
			...details,
		};
		return {
			content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
			structuredContent: payload,
			isError: true,
		};
	};

	const createSystemComponentDraftInputErrorResult = (
		context: TrickroomMcpServerContext,
		error: z.ZodError,
	): CallToolResult =>
		createToolErrorResult(
			context,
			"VALIDATION_FAILED",
			"System component draft input validation failed.",
			{
				diagnostics: systemComponentDraftInputDiagnosticsFromZodError(error),
			},
		);

	const createProjectResolverErrorResult = (
		error: TrickroomMcpProjectResolverError,
	): CallToolResult => {
		const payload = {
			status: error.code,
			...error.details,
		};
		return {
			content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
			structuredContent: payload,
			isError: true,
		};
	};

	const registerProjectFromPath = async (projectPath: string) => {
		const opened = await readMcpEnabledProjectContext(projectPath);
		const projectId = opened.config.projectId;
		if (!projectId) {
			throw new Error("Project configuration is missing a projectId.");
		}

		const { location, registry } = await upsertProjectLocation({
			trickroomHome,
			projectId,
			root: opened.projectRoot,
			name: opened.config.name,
			markActive: false,
		});
		const context: TrickroomMcpServerContext = {
			...opened,
			trickroomHome,
			locationId: location.locationId,
		};
		const isRegistryActive =
			registry.lastActiveLocationId === location.locationId;

		return { context, isRegistryActive };
	};

	const selectProjectFromRef = async (ref: {
		locationId?: string;
		projectId?: string;
	}) => {
		const context = await projectResolver.resolveProject({
			...(ref.locationId ? { locationId: ref.locationId } : {}),
			...(ref.projectId ? { projectId: ref.projectId } : {}),
		});
		selectedContext = context;
		projectResolver.setDefaultContext(context);
		await notifyResourceListChanged();
		return createJsonResult({
			project: getProjectReference(context),
			selected: true,
		});
	};

	const createGetSelectedProjectResult = () =>
		createJsonResult({
			project: selectedContext ? getProjectReference(selectedContext) : null,
		});

	const withProjectContext = async (
		project: TrickroomMcpProjectRef | undefined,
		fn: (context: TrickroomMcpServerContext) => Promise<CallToolResult>,
	): Promise<CallToolResult> => {
		try {
			return await fn(await getActiveContext(project));
		} catch (error) {
			if (error instanceof TrickroomMcpProjectResolverError) {
				return createProjectResolverErrorResult(error);
			}
			throw error;
		}
	};

	const withPolicyErrorHandling = async (
		projectOrFn:
			| TrickroomMcpProjectRef
			| undefined
			| ((context: TrickroomMcpServerContext) => Promise<CallToolResult>),
		maybeFn?: (context: TrickroomMcpServerContext) => Promise<CallToolResult>,
	): Promise<CallToolResult> => {
		const project = typeof projectOrFn === "function" ? undefined : projectOrFn;
		const fn = typeof projectOrFn === "function" ? projectOrFn : maybeFn;
		if (!fn) {
			throw new Error("Missing project-scoped tool handler.");
		}

		let context: TrickroomMcpServerContext;
		try {
			context = await getActiveContext(project);
		} catch (error) {
			if (error instanceof TrickroomMcpProjectResolverError) {
				return createProjectResolverErrorResult(error);
			}
			throw error;
		}

		try {
			return await fn(context);
		} catch (error) {
			if (error instanceof McpPolicyError) {
				return createPolicyDeniedResult(context, error);
			}
			if (error instanceof DesignTransformError) {
				return createToolErrorResult(context, error.code, error.message);
			}
			if (
				error instanceof AssetManifestError ||
				error instanceof IconManifestError
			) {
				return createToolErrorResult(context, error.code, error.message);
			}
			if (error instanceof SystemComponentOperationsError) {
				return createToolErrorResult(context, error.code, error.message);
			}
			throw error;
		}
	};

	server.prompt(
		"edit_design_file",
		{
			designFileId: z.string().uuid().describe("Design file UUID to edit."),
		},
		({ designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `I need to edit the Trickroom design file "${designFileId}". Please guide me through a safe edit workflow:

1. **Select MCP Project Scope**: Call 'getSelectedProject'. If no project is selected, call 'listProjects' and then 'selectProject' with a known 'locationId' from each listProjects entry (not just 'projectId') before any writes.
2. **Read Current State**: Call 'listDesignFiles' to get the current 'revision', counts, and design metadata.
3. **Load Authoring Contract**: Call 'getDesignAuthoringContract' with 'designFileId' once before planning mutations.
4. **Understand Structure**: Call 'readDesignGraph' for parent/child relationships, element IDs, and addresses. Use 'readElement' or bounded 'readSubtree' only for local detail where the graph is insufficient.
5. **Plan Registry Content**: If adding UI, use 'listRegistryComponents', 'listRegistryRecipes', 'describeRegistryComponent', and 'describeRegistryRecipe'. Prefer 'addRecipe' or 'addSubtree' for structured UI instead of hand-assembling many nodes with repeated 'addElement' calls.
6. **Inspect Resources**: If touching assets or icons, call 'listSystemAssets' and/or 'listSystemIcons' (and 'describeAsset' / 'describeIcon' as needed) before referencing resource-backed elements.
7. **Dry-Run Uncertain Writes**: Use 'validateOperation' before risky single mutations. For larger multi-step refactors, use 'validateOperationPlan'; for larger inserted structures, use 'validateSubtree' or 'validateCopySubtree' before committing.
8. **Execute Safely**:
   - For multi-step edits in one revision, use 'validateOperationPlan' then 'applyDesignOperations' with the same operation list and starting revision.
   - For single mutations, use the 'revision' from step 2 as 'expectedRevision'.
   - For every SUBSEQUENT mutation, you MUST use the 'newRevision' returned by the previous successful tool call (revision chaining).
   - If a tool returns 'REVISION_MISMATCH', do NOT guess. Call 'listDesignFiles' again to get the current revision, then retry with the updated 'expectedRevision'.
9. **Validate & Verify**: Call 'validateDesignFile' after edits. Confirm only the edited area with 'readElement' or bounded 'readSubtree' unless a broader read-back is explicitly necessary.`,
					},
				},
			],
		}),
	);

	server.prompt(
		"add_component_to_design",
		{
			designFileId: z.string().uuid().describe("Design file UUID."),
			parentId: z
				.string()
				.optional()
				.describe("Target parent element ID. Omit to add at root."),
		},
		({ designFileId, parentId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `I want to add registry content to design file "${designFileId}"${parentId ? ` under parent "${parentId}"` : " at the root"}.

Workflow:
1. **Select MCP Project Scope**: Call 'getSelectedProject'. If no project is selected, call 'listProjects' and then 'selectProject' with a known 'locationId' from each listProjects entry (not just 'projectId') before any writes.
2. **Load Authoring Contract**: Call 'getDesignAuthoringContract' with 'designFileId' before choosing an insertion strategy.
3. **Choose Insertion Tool** (pick the smallest fit):
   - 'addElement' for one simple component.
   - 'addRecipe' for known recipe-backed UI.
   - 'addSubtree' for composed element or recipe trees.
   - 'copySubtree' when reusing an existing subtree from this or another design location.
4. **Discovery**: Use 'listRegistryComponents', 'listRegistryRecipes', 'describeRegistryComponent', and 'describeRegistryRecipe' to confirm roles, allowed children, slots, and supported props.
5. **Parent Check**: ${parentId ? `Call 'readElement' for "${parentId}" (or confirm via 'readDesignGraph')` : "If 'parentId' is provided, call 'readElement' or 'readDesignGraph'"} to verify the target parent is a 'branch' role element. If adding at the root, use 'parentId': null.
6. **Resource Catalogs**: When adding asset- or icon-backed elements, call 'listSystemAssets' / 'listSystemIcons' (and describe tools as needed) and use canonical system resource IDs.
7. **Get Revision**: Call 'listDesignFiles' for the current 'revision'. Use 'readDesignGraph' for insertion index context when needed.
8. **Dry-Run**: Call 'validateOperation', 'validateSubtree', or 'validateCopySubtree' before committing uncertain inserts.
9. **Execute**: Perform the chosen write with 'expectedRevision' from step 7. Chain 'newRevision' across follow-up writes.
10. **Verify**: Call 'readElement' or bounded 'readSubtree' on the inserted region to confirm placement and props.`,
					},
				},
			],
		}),
	);

	server.prompt(
		"refactor_design_structure",
		{
			designFileId: z.string().uuid().describe("Design file UUID to refactor."),
		},
		({ designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `I need to refactor the structure of design file "${designFileId}". This involves multiple moves, additions, deletions, or recipe changes.

Workflow for Multi-Step Refactoring:
1. **Select MCP Project Scope**: Call 'getSelectedProject'. If no project is selected, call 'listProjects' and then 'selectProject' with a known 'locationId' from each listProjects entry (not just 'projectId') before any writes.
2. **Graph-First Planning**: Call 'listDesignFiles' for the initial 'revision', then 'readDesignGraph' for structure and IDs before any nested reads.
3. **Scoped Detail**: Use bounded 'readSubtree' only for affected regions. Avoid loading the full design unless explicitly necessary.
4. **Prefer Specialized Tools**: Use 'copySubtree', 'extractSubtree', 'detachRecipeInstance', 'updateRecipeInstance', and 'updateRecipeControl' when they match the intent instead of manual re-assembly.
5. **Dry-Run Risky Steps**: Call 'validateOperationPlan' for multi-step refactors, or 'validateOperation' / 'validateCopySubtree' for individual uncertain mutations.
6. **Atomic or Sequential Mutations**:
   - Prefer 'validateOperationPlan' followed by 'applyDesignOperations' when several dependent edits should land in one revision.
   - Otherwise execute changes one-by-one with revision chaining:
   - For the FIRST mutation, use the initial 'revision' as 'expectedRevision'.
   - For EVERY SUBSEQUENT mutation, you MUST use the 'newRevision' returned by the previous successful tool call.
7. **Concurrency Handling**: If ANY step returns 'REVISION_MISMATCH', call 'listDesignFiles' to resynchronize, then resume the refactor plan.
8. **Cleanup**: Use 'deleteElement' and 'moveElement' for redundant wrappers or repositioning when specialized tools do not apply.
9. **Final Validation**: Call 'validateDesignFile' when the refactor is complete.`,
					},
				},
			],
		}),
	);

	server.prompt(
		"explain_design_file",
		{
			designFileId: z.string().uuid().describe("Design file UUID to explain."),
		},
		({ designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Please provide a technical explanation of design file "${designFileId}".

Discovery Steps (Read-Only):
1. **Select MCP Project Scope**: Call 'getSelectedProject'. If no project is selected, call 'listProjects' and then 'selectProject' with a known 'locationId' from each listProjects entry (not just 'projectId') before discovery.
2. **Metadata & Graph**: Call 'listDesignFiles' for revision and counts, then 'readDesignGraph' for structure, parent/child relationships, and element IDs. Use bounded 'readSubtree' only where local detail is needed.
3. **Authoring Contract**: Call 'getDesignAuthoringContract' to summarize writable vs system-owned props, composition rules, and mutation constraints.
4. **Registry & Recipes**: Use 'listRegistries', registry component/recipe lists, and describe tools to explain which libraries, components, and attached recipes are in use.
5. **Assets & Icons**: Call 'getDesignSystemForDesignFile', then 'listSystemAssets', 'listSystemIcons', and 'findAssetUsage' / 'findIconUsage' when resource references matter.
6. **Tokens**: Call 'listDesignTokens' and summarize token domains (not only color) available to the linked design system.
7. **Validation & Diagnostics**: Call 'validateDesignFile' and report structural, registry, recipe, token, asset, and icon issues separately—including stale attached recipes or missing resources.
8. **Synthesis**: Explain the design's purpose, expansion points, and broken references. Explicitly note that MCP does not return rendered previews or raw image/SVG bytes; visual review requires the Trickroom app or another preview path outside MCP.`,
					},
				},
			],
		}),
	);

	server.prompt(
		"validate_design_changes",
		{
			designFileId: z.string().uuid().describe("Design file UUID to validate."),
		},
		({ designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Please perform a post-edit validation of design file "${designFileId}".

Workflow:
1. **Select MCP Project Scope**: Call 'getSelectedProject'. If no project is selected, call 'listProjects' and then 'selectProject' with a known 'locationId' from each listProjects entry (not just 'projectId') before any writes.
2. **Technical Validation**: Call 'validateDesignFile'.
3. **Analyze Issues by Category**: If 'valid' is false, group issues into structural, registry, recipe, token, asset, and icon diagnostics. If the design is already clean, do not perform any unnecessary mutations.
4. **Targeted Re-Reads**: Use 'readDesignGraph' or bounded 'readSubtree' only where reported issues point to specific elements or subtrees.
5. **Execute Fixes Deliberately**:
   - Start with 'listDesignFiles' for the current 'revision' when mutations are required.
   - Dry-run fixes with 'validateOperation' (or subtree/copy validators) where possible before committing.
   - Pass the current revision as 'expectedRevision' to mutation tools and chain 'newRevision' across multiple fixes.
   - If a fix returns 'REVISION_MISMATCH', re-read metadata and retry with the new revision.
6. **Final State Sync**: Call 'validateDesignFile' again after fixes, then confirm affected areas with scoped reads.
7. **Final Report**: Confirm technical soundness from MCP diagnostics only. Do not claim visual or layout readiness unless a separate visual preview was inspected outside MCP.`,
					},
				},
			],
		}),
	);

	server.prompt(
		"create_design_file_from_brief",
		{
			brief: z
				.string()
				.min(1)
				.describe("Short product or layout brief for the new design."),
			systemName: z
				.string()
				.optional()
				.describe(
					"Optional configured design system name. Omit to create an unlinked design or inherit project defaults.",
				),
			designFileId: z
				.string()
				.uuid()
				.optional()
				.describe(
					"Optional UUID when MCP policy requires an explicit allowed design file ID.",
				),
		},
		({ brief, systemName, designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Create a new Trickroom design from this brief:

${brief}

Workflow:
1. **Select MCP Project Scope**: Call 'getSelectedProject'. If no project is selected, call 'listProjects' and then 'selectProject' with a known 'locationId' from each listProjects entry (not just 'projectId') before any writes.
2. **Create Design File**: Call 'createDesignFile' with a clear name${systemName ? ` and systemName "${systemName}"` : " (omit systemName only when an unlinked design is intentional — a system cannot be linked via MCP afterwards)"}${designFileId ? ` and designFileId "${designFileId}"` : ""}. Capture the returned 'revision' and design file ID. The new design starts with no boards.
3. **Resolve Linked System**: Call 'getDesignSystemForDesignFile' on the new design. Only when a configured system is linked should you call system-scoped tools such as 'listDesignTokens', 'listSystemAssets', or 'listSystemIcons'.
4. **Load Authoring Contract**: Call 'getDesignAuthoringContract' for the new design file before planning content.
5. **Build with Structure**: Create boards at the design root by passing 'parentId: null'; never wrap them in a shared top-level layer. Prefer 'addRecipe' and 'addSubtree' over many piecemeal 'addElement' calls. Use 'listRegistryRecipes' and describe tools to pick appropriate recipes.
6. **Dry-Run Inserts**: Call 'validateSubtree' (or 'validateOperation' for single inserts) before committing larger structures.
7. **Execute with Revision Chaining**: Use 'expectedRevision' from creation (or the latest 'newRevision') for each write.
8. **Validate & Report**: Call 'validateDesignFile' on the finished design. Note that MCP does not return rendered previews; mention this limitation in the final summary.`,
					},
				},
			],
		}),
	);

	server.prompt(
		"add_media_or_icon",
		{
			designFileId: z
				.string()
				.uuid()
				.describe("Design file UUID that will reference the resource."),
			systemName: z
				.string()
				.optional()
				.describe(
					"Configured design system name. Omit to resolve from the design file's linked system.",
				),
		},
		({ designFileId, systemName }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `I need to add or wire up media or icons for design file "${designFileId}"${systemName ? ` using design system "${systemName}"` : ""}.

Workflow:
1. **Select MCP Project Scope**: Call 'getSelectedProject'. If no project is selected, call 'listProjects' and then 'selectProject' with a known 'locationId' from each listProjects entry (not just 'projectId') before any writes.
2. **Resolve Design System**: ${systemName ? `Use systemName "${systemName}".` : "Call 'getDesignSystemForDesignFile' to resolve the linked design system."}
3. **Catalog Discovery**: Call 'listSystemAssets' and 'listSystemIcons'. Use 'describeAsset' / 'describeIcon' for details. MCP does not return raw image or SVG bytes.
4. **Register Resources (if needed)**: When new files are required and policy allows, use 'addSystemAsset', 'addSystemIconFolder', or related system resource write tools, then refresh catalogs.
5. **Authoring Contract**: Call 'getDesignAuthoringContract' to confirm how asset and icon elements reference canonical resource IDs.
6. **Insert or Update Elements**: Use 'addElement', 'addSubtree', or 'updateElementProps' with canonical asset/icon IDs. Dry-run with 'validateOperation' or 'validateSubtree' when uncertain.
7. **Validate References**: Call 'findAssetUsage' / 'findIconUsage' and 'validateDesignFile', then read back affected elements with 'readElement'.`,
					},
				},
			],
		}),
	);

	server.prompt(
		"reuse_design_subtree",
		{
			sourceDesignFileId: z
				.string()
				.uuid()
				.describe("Source design file UUID containing the subtree to reuse."),
			sourceElementId: z
				.string()
				.min(1)
				.describe("Root element ID of the subtree to copy or extract."),
			targetDesignFileId: z
				.string()
				.uuid()
				.describe("Target design file UUID for insertion."),
			targetParentId: z
				.string()
				.optional()
				.describe("Target parent element ID. Omit to insert at root."),
		},
		({
			sourceDesignFileId,
			sourceElementId,
			targetDesignFileId,
			targetParentId,
		}) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Reuse subtree "${sourceElementId}" from design "${sourceDesignFileId}" into design "${targetDesignFileId}"${targetParentId ? ` under parent "${targetParentId}"` : " at the root"}.

Workflow:
1. **Select MCP Project Scope**: Call 'getSelectedProject'. If no project is selected, call 'listProjects' and then 'selectProject' with a known 'locationId' from each listProjects entry (not just 'projectId') before any writes.
2. **Locate Source & Destination**: Call 'readDesignGraph' on both designs to confirm element IDs, parents, and insertion indices.
3. **Inspect Source Detail**: Use bounded 'readSubtree' on "${sourceElementId}" only if graph data is insufficient.
4. **Get Revisions**: Call 'listDesignFiles' for the target 'revision'. When source and target design IDs differ, also capture the source design's current revision as 'sourceExpectedRevision'.
5. **Dry-Run Copy**: Call 'validateCopySubtree' with source/target file IDs, '${sourceElementId}', target parent ${targetParentId ? `"${targetParentId}"` : "null"}, the chosen index, 'expectedRevision' on the target, and 'sourceExpectedRevision' whenever this is a cross-file copy.
6. **Execute**:
   - Use 'copySubtree' with the same revision fields as the dry-run (target 'expectedRevision'; include 'sourceExpectedRevision' for cross-file copies).
   - Use 'extractSubtree' instead when the goal is a new standalone design file cloned from the source subtree.
7. **Revision Chaining**: Pass 'expectedRevision' on the target; chain 'newRevision' for any follow-up edits.
8. **Validate & Verify**: Call 'validateDesignFile' on the target design and confirm the inserted region with bounded 'readSubtree'.`,
					},
				},
			],
		}),
	);

	server.registerTool(
		"listProjects",
		{
			title: "List Projects",
			description:
				"List projects registered in Trickroom app state with stable project and local location references. `activeProjectId` and `activeLocationId` are registry app-state values (not the MCP session selection).",
			annotations: readOnlyClosedWorldAnnotations,
		},
		async () => {
			const registry = await readProjectRegistry(trickroomHome);
			return createJsonResult({
				activeProjectId: registry.lastActiveProjectId ?? null,
				activeLocationId: registry.lastActiveLocationId ?? null,
				projects: registry.locations.map((location) => ({
					projectId: location.projectId,
					locationId: location.locationId,
					projectRoot: location.root,
					name: location.name,
					lastOpenedAt: location.lastOpenedAt,
					active: location.locationId === registry.lastActiveLocationId,
				})),
			});
		},
	);

	server.registerTool(
		"registerProject",
		{
			title: "Register Project",
			description:
				"Register a local Trickroom project path in app state without changing session selection.",
			inputSchema: {
				path: z.string().min(1).describe("Local project root path to open."),
			},
			annotations: {
				readOnlyHint: false,
				openWorldHint: false,
				idempotentHint: true,
			},
		},
		async ({ path: projectPath }) => {
			const { context, isRegistryActive } =
				await registerProjectFromPath(projectPath);
			await notifyResourceListChanged();
			return createJsonResult({
				project: getProjectReference(context),
				selected: false,
				active: isRegistryActive,
				migration:
					"Use registerProject(path) and selectProject({ projectId | locationId }) to switch the MCP session project.",
			});
		},
	);

	server.registerTool(
		"selectProject",
		{
			title: "Select Project",
			description: "Select a registered project for MCP session-scoped tools.",
			inputSchema: {
				locationId: z
					.string()
					.min(1)
					.optional()
					.describe("Local Trickroom project location ID."),
				projectId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Stable Trickroom project ID. Ambiguous IDs require locationId.",
					),
			},
			annotations: {
				readOnlyHint: false,
				openWorldHint: false,
				idempotentHint: true,
			},
		},
		async ({ locationId, projectId }) => {
			try {
				return await selectProjectFromRef({
					...(locationId ? { locationId } : {}),
					...(projectId ? { projectId } : {}),
				});
			} catch (error) {
				if (error instanceof TrickroomMcpProjectResolverError) {
					return createProjectResolverErrorResult(error);
				}
				throw error;
			}
		},
	);

	server.registerTool(
		"getSelectedProject",
		{
			title: "Get Selected Project",
			description:
				"Return the project currently selected for MCP session-scoped tools.",
			annotations: readOnlyClosedWorldAnnotations,
		},
		createGetSelectedProjectResult,
	);

	server.registerTool(
		"getActiveProject",
		{
			title: "Get Active Project",
			description:
				"Compatibility alias for getSelectedProject. Prefer getSelectedProject for MCP session visibility.",
			annotations: readOnlyClosedWorldAnnotations,
		},
		createGetSelectedProjectResult,
	);

	server.registerTool(
		"resolveProject",
		{
			title: "Resolve Project",
			description:
				"Resolve a registered project reference to an MCP-enabled local project location.",
			inputSchema: {
				locationId: z
					.string()
					.min(1)
					.optional()
					.describe("Local Trickroom project location ID."),
				projectId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Stable Trickroom project ID. Ambiguous IDs require locationId.",
					),
			},
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ locationId, projectId }) => {
			try {
				const context = await projectResolver.resolveProject({
					...(locationId ? { locationId } : {}),
					...(projectId ? { projectId } : {}),
				});
				return createJsonResult({
					project: getProjectReference(context),
				});
			} catch (error) {
				if (error instanceof TrickroomMcpProjectResolverError) {
					return createProjectResolverErrorResult(error);
				}

				throw error;
			}
		},
	);

	server.registerTool(
		"openProject",
		{
			title: "Open Project",
			description:
				"Deprecated alias that registers and selects a local project for this MCP session. Use registerProject + selectProject instead.",
			inputSchema: {
				path: z.string().min(1).describe("Local project root path to open."),
			},
			annotations: {
				readOnlyHint: false,
				openWorldHint: false,
				idempotentHint: true,
			},
		},
		async ({ path: projectPath }) => {
			const { context } = await registerProjectFromPath(projectPath);
			await selectProjectFromRef({ locationId: context.locationId });
			return createJsonResult({
				project: getProjectReference(context),
				selected: true,
				active: true,
				migration:
					"Deprecated alias: use registerProject(path) then selectProject({ projectId | locationId }) for explicit project selection.",
			});
		},
	);

	server.registerTool(
		"trickroom_project_info",
		{
			title: "Project Info",
			description:
				"Return the current Trickroom project root, config path, and configured system names.",
			inputSchema: projectScopedInputSchema,
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ project }) =>
			withPolicyErrorHandling(project, createProjectInfoResult),
	);

	server.registerTool(
		"listDesignFiles",
		{
			title: "List Design Files",
			description:
				"List project-scoped Trickroom design files with UUID handles, file metadata, names, design-system references, and revisions.",
			inputSchema: projectScopedInputSchema,
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(await listDesignFilesPayload(context)),
			),
	);

	server.registerTool(
		"readDesignFile",
		{
			title: "Read Design File",
			description:
				"Read design metadata, board summaries, counts, and a bounded compact element tree for one design file. Defaults to depth 2 and 100 nodes; pass allowLarge to request deeper output.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				depth: z
					.number()
					.int()
					.min(0)
					.max(20)
					.optional()
					.describe("Maximum descendant depth to include. Defaults to 2."),
				maxNodes: z
					.number()
					.int()
					.min(1)
					.max(5000)
					.optional()
					.describe("Maximum elements to include. Defaults to 100."),
				allowLarge: z
					.boolean()
					.optional()
					.describe(
						"Set true to permit depth above 4, maxNodes above 500, or an unbounded read when depth/maxNodes are omitted.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, depth, maxNodes, allowLarge, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const payload = await readDesignFilePayload(context, designFileId, {
					depth,
					maxNodes,
					allowLarge,
				});
				return createSummaryTextResult(
					payload,
					summarizeDesignFileReadText(payload),
				);
			}),
	);

	server.registerTool(
		"readDesignGraph",
		{
			title: "Read Design Graph",
			description:
				"Read a flat graph representation of a design file with element IDs, parent/child maps, and canonical JSON Pointer-style addresses.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				rootElementId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional element ID to scope the graph to a subtree."),
				includeProps: z
					.boolean()
					.optional()
					.describe("Include full props for each element. Defaults to false."),
				includeText: z
					.boolean()
					.optional()
					.describe(
						"Include full text for text role elements. Defaults to true.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			designFileId,
			rootElementId,
			includeProps,
			includeText,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const payload = await readDesignGraphPayload(context, designFileId, {
					rootElementId,
					includeProps,
					includeText,
				});
				return createSummaryTextResult(
					payload,
					summarizeDesignGraphReadText(payload),
				);
			}),
	);

	server.registerTool(
		"readElement",
		{
			title: "Read Element",
			description:
				"Read one full design element with props, text or child IDs, and parent/sibling context.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				elementId: z.string().min(1).describe("Element ID inside the design."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, elementId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await readElementPayload(context, designFileId, elementId),
				),
			),
	);

	server.registerTool(
		"readSubtree",
		{
			title: "Read Subtree",
			description:
				"Read a bounded detailed element subtree rooted at the selected element. Defaults to depth 2 and 100 nodes; pass allowLarge to request deeper output.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				elementId: z.string().min(1).describe("Element ID inside the design."),
				depth: z
					.number()
					.int()
					.min(0)
					.max(20)
					.optional()
					.describe("Maximum descendant depth to include. Defaults to 2."),
				maxNodes: z
					.number()
					.int()
					.min(1)
					.max(5000)
					.optional()
					.describe("Maximum elements to include. Defaults to 100."),
				allowLarge: z
					.boolean()
					.optional()
					.describe(
						"Set true to permit depth above 4, maxNodes above 500, or an unbounded read when depth/maxNodes are omitted.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, elementId, depth, maxNodes, allowLarge, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const payload = await readSubtreePayload(
					context,
					designFileId,
					elementId,
					{
						depth,
						maxNodes,
						allowLarge,
					},
				);
				return createSummaryTextResult(
					payload,
					summarizeSubtreeReadText(payload),
				);
			}),
	);

	server.registerTool(
		"validateDesignFile",
		{
			title: "Validate Design File",
			description:
				"Validate an existing design file without mutation, including payload integrity, duplicate element IDs, registry references, and design-system references.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await validateDesignFilePayload(context, designFileId),
				),
			),
	);

	server.registerTool(
		"validateOperation",
		{
			title: "Validate Operation",
			description:
				"Dry-run one design operation against the current revision without writing, returning predicted changes and diagnostics.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current revision from a prior read."),
				operation: z
					.enum([
						"renameDesignFile",
						"addElement",
						"addRecipe",
						"addSystemComponent",
						"updateSystemComponentInstance",
						"detachSystemComponent",
						"addSubtree",
						"updateElementProps",
						"updateRecipeControl",
						"updateRecipeInstance",
						"updateElementText",
						"moveElement",
						"deleteElement",
						"copySubtree",
						"detachRecipeInstance",
					])
					.describe("Operation type to dry-run."),
				parameters: z
					.record(z.string(), z.unknown())
					.optional()
					.describe("Operation-specific parameters matching the write tool."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			operation,
			parameters,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				try {
					return createJsonResult(
						await validateOperationPayload(
							context,
							designFileId,
							expectedRevision,
							operation as DesignOperationName,
							parameters,
						),
					);
				} catch (error) {
					if (error instanceof DesignTransformError) {
						return createInvalidOperationResult(context, error);
					}
					throw error;
				}
			}),
	);

	server.registerTool(
		"validateOperationPlan",
		{
			title: "Validate Operation Plan",
			description:
				"Dry-run an ordered list of design operations against one starting revision without writing. Returns per-step summaries, aggregate change metadata, and final diagnostics. Later steps may reference earlier step outputs using $step:N or $step:N:rootElementId.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current revision from a prior read."),
				operations: z
					.array(
						z.object({
							operation: z.enum([
								"renameDesignFile",
								"addElement",
								"addRecipe",
								"addSystemComponent",
								"updateSystemComponentInstance",
								"detachSystemComponent",
								"addSubtree",
								"updateElementProps",
								"updateRecipeControl",
								"updateRecipeInstance",
								"updateElementText",
								"moveElement",
								"deleteElement",
								"copySubtree",
								"detachRecipeInstance",
							]),
							parameters: z.record(z.string(), z.unknown()).optional(),
						}),
					)
					.min(1)
					.describe("Ordered design operations to dry-run."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, expectedRevision, operations, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				try {
					return createJsonResult(
						await validateOperationPlanPayload(context, {
							designFileId,
							expectedRevision,
							operations,
						}),
					);
				} catch (error) {
					if (error instanceof DesignTransformError) {
						return createInvalidOperationResult(context, error);
					}
					throw error;
				}
			}),
	);

	server.registerTool(
		"validateSubtree",
		{
			title: "Validate Subtree",
			description:
				"Validate a candidate subtree insertion against expected revision without mutation.",
			inputSchema: validateSubtreePayloadSchema.extend(
				projectScopedInputSchema,
			),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			parentId,
			index,
			subtree,
			options,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await validateSubtreePayload(context, {
						designFileId,
						expectedRevision,
						parentId,
						index,
						subtree,
						options,
					}),
				),
			),
	);

	server.registerTool(
		"validateCopySubtree",
		{
			title: "Validate Copy Subtree",
			description:
				"Validate copying an existing source subtree into a target design insertion point without mutation.",
			inputSchema: validateCopySubtreePayloadSchema.extend(
				projectScopedInputSchema,
			),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async (input) =>
			withPolicyErrorHandling(input.project, async (context) =>
				createJsonResult(
					await validateCopySubtreePayload(
						context,
						input as ValidateCopySubtreePayload,
					),
				),
			),
	);

	server.registerTool(
		"listRegistries",
		{
			title: "List Registries",
			description:
				"List read-only component registries available to this Trickroom project.",
			annotations: readOnlyClosedWorldAnnotations,
		},
		async () =>
			createJsonResult({
				registries: getRegistryIds().map((library) => ({
					library,
					builtIn: true,
					readOnly: true,
					componentCount: getComponentIds(library).length,
					components: getComponentIds(library),
				})),
			}),
	);

	server.registerTool(
		"listRegistryComponents",
		{
			title: "List Registry Components",
			description:
				"List components in a registry, including compact role and child-behavior metadata.",
			inputSchema: withProjectScopedInput({
				library: z
					.string()
					.optional()
					.describe("Registry library id. Omit to list all registries."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ library, project }) =>
			withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const selectedLibraries =
					library === undefined ? getRegistryIds() : [library as RegistryId];

				return createJsonResult({
					registries: selectedLibraries.map((selectedLibrary) => {
						getRegistryOrThrow(selectedLibrary);
						return {
							library: selectedLibrary,
							components: getComponentIds(selectedLibrary)
								.filter((component) =>
									isComponentAllowed(policy, selectedLibrary, component),
								)
								.map((component) => {
									const summary = describeComponent(selectedLibrary, component);
									return {
										library: summary.library,
										component: summary.component,
										role: summary.role,
										allowedChildren: summary.allowedChildren,
										composition: summary.composition,
										defaults: summary.defaults,
									};
								}),
						};
					}),
				});
			}),
	);

	server.registerTool(
		"describeRegistryComponent",
		{
			title: "Describe Registry Component",
			description:
				"Describe one read-only registry component, including role, allowed children, defaults, and supported props.",
			inputSchema: withProjectScopedInput({
				library: z.string().min(1).describe("Registry library id."),
				component: z.string().min(1).describe("Registry component id."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ library, component, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanUseComponent(policy, library, component);
				return createJsonResult(
					describeComponent(library as RegistryId, component),
				);
			}),
	);

	server.registerTool(
		"listRegistryRecipes",
		{
			title: "List Registry Recipes",
			description:
				"List composable recipes in a registry, including compact structure and slot metadata.",
			inputSchema: withProjectScopedInput({
				library: z
					.string()
					.optional()
					.describe("Registry library id. Omit to list all registries."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ library, project }) =>
			withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const selectedLibraries =
					library === undefined ? getRegistryIds() : [library as RegistryId];

				return createJsonResult({
					registries: selectedLibraries.map((selectedLibrary) => {
						getRegistryOrThrow(selectedLibrary);
						return {
							library: selectedLibrary,
							recipes: getRegistryRecipes(selectedLibrary)
								.filter((recipe) => isRecipeAllowed(policy, recipe))
								.map((recipe) => summarizeRecipe(selectedLibrary, recipe)),
						};
					}),
				});
			}),
	);

	server.registerTool(
		"describeRegistryRecipe",
		{
			title: "Describe Registry Recipe",
			description:
				"Describe one read-only registry recipe, including structure, slots, defaults, and system-owned marker guidance.",
			inputSchema: withProjectScopedInput({
				library: z.string().min(1).describe("Registry library id."),
				recipe: z
					.string()
					.min(1)
					.describe(
						"Registry recipe id, either local to the library such as avatar.default or fully qualified such as base-ui/avatar.default.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ library, recipe, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const resolution = getRecipeOrThrow(library, recipe);
				assertCanUseRecipe(policy, resolution.definition);
				return createJsonResult(
					describeRecipe(resolution.library, resolution.definition),
				);
			}),
	);

	server.registerTool(
		"getSystemComponentAuthoringContract",
		{
			title: "Get System Component Authoring Contract",
			description:
				"Return the compact authoring contract for system component drafts: root template nodes, slot maps, variant axes/classesByPath, override targets, validation diagnostics, and examples. Prefer this before createSystemComponentDraft or updateSystemComponentDraft.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Optional configured design system name or id to echo availability context.",
					),
				includeExamples: z
					.boolean()
					.optional()
					.describe(
						"Include compact draft authoring examples. Defaults to true.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, includeExamples, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await getSystemComponentAuthoringContractPayload(context, {
						systemName,
						includeExamples,
					}),
				),
			),
	);

	server.registerTool(
		"getDesignAuthoringContract",
		{
			title: "Get Design Authoring Contract",
			description:
				"Return the primary compact planning contract for agents editing design files: design grammar, registry component and recipe vocabulary, writable/system-owned props, composition and mutation rules, optional token/resource summaries, authoring guidance, and examples. For system component draft authoring, use getSystemComponentAuthoringContract.",
			inputSchema: withProjectScopedInput({
				designFileId: z
					.string()
					.uuid()
					.optional()
					.describe(
						"Optional design file UUID used to include design-system, token, and resource planning context.",
					),
				includeExamples: z
					.boolean()
					.optional()
					.describe(
						"Include compact machine-readable mutation examples. Defaults to true.",
					),
				includeRecipes: z
					.enum(["summary", "none"])
					.optional()
					.describe(
						"Include compact recipe summaries per registry. Defaults to summary.",
					),
				includeResources: z
					.boolean()
					.optional()
					.describe(
						"Include asset/icon planning summaries when designFileId resolves to a linked system. Defaults to true.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({
			designFileId,
			includeExamples,
			includeRecipes,
			includeResources,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await getAuthoringContractPayload(context, {
						designFileId,
						includeExamples,
						includeRecipes,
						includeResources,
					}),
				),
			),
	);

	server.registerTool(
		"getDesignSystemForDesignFile",
		{
			title: "Get Design System For Design File",
			description:
				"Resolve the design system linked from a design file and report configured CSS path plus token storage metadata.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().min(1).describe("Design file UUID."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(await getDesignSystemPayload(context, designFileId)),
			),
	);

	server.registerTool(
		"listDesignTokens",
		{
			title: "List Design Tokens",
			description:
				"List stored design tokens for the design system linked to a design file.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().min(1).describe("Design file UUID."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ designFileId, project }) => {
			return withPolicyErrorHandling(project, async (context) => {
				const designSystemPayload = await getDesignSystemPayload(
					context,
					designFileId,
				);
				const systemName =
					designSystemPayload.designSystem === null
						? null
						: designSystemPayload.designSystem.systemName;
				const systemId =
					designSystemPayload.designSystem === null
						? null
						: designSystemPayload.designSystem.systemId;
				const storedTokens = systemId
					? await readDomainTokensReadonly(context.projectRoot, systemId)
					: null;
				const domains = storedTokens?.domains;

				return createJsonResult({
					...designSystemPayload,
					storageStatus:
						systemName === null
							? "not_linked"
							: storedTokens
								? "stored"
								: "not_stored",
					tokens: domains
						? Object.entries(domains).flatMap(([domain, domainStorage]) =>
								Object.entries(domainStorage.tokens).map(([name, value]) => ({
									domain,
									category: getCategoryForTokenName(name),
									name,
									value,
									overrideConfirmed: isTokenOverrideConfirmed(
										domain,
										name,
										domainStorage.overrides,
									),
									syncedAt: storedTokens.metadata.syncedAt,
									reviewRequired: storedTokens.metadata.reviewRequired,
								})),
							)
						: [],
					domains: domains
						? Object.fromEntries(
								Object.entries(domains).map(([domain, domainStorage]) => [
									domain,
									{
										tokenCount: Object.keys(domainStorage.tokens).length,
										overrides: domainStorage.overrides,
										baselineDiff: domainStorage.baselineDiff,
									},
								]),
							)
						: {},
				});
			});
		},
	);

	server.registerTool(
		"listSystemAssets",
		{
			title: "List System Assets",
			description:
				"List system-scoped referenced raster image assets without exposing file bytes.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(await listSystemAssetsPayload(context, systemName)),
			),
	);

	server.registerTool(
		"describeAsset",
		{
			title: "Describe Asset",
			description:
				"Describe one system-scoped raster asset by stable id. Does not expose file bytes.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				assetId: z.string().min(1).describe("Stable system asset id."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, assetId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await describeAssetPayload(context, systemName, assetId),
				),
			),
	);

	server.registerTool(
		"listSystemIcons",
		{
			title: "List System Icons",
			description:
				"List generated system-scoped SVG icon catalog metadata and diagnostics. Raw SVG is not returned.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(await listSystemIconsPayload(context, systemName)),
			),
	);

	server.registerTool(
		"describeIcon",
		{
			title: "Describe Icon",
			description:
				"Describe one generated system icon by stable id. Raw SVG is not returned.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				iconId: z.string().min(1).describe("Stable system icon id."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, iconId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await describeIconPayload(context, systemName, iconId),
				),
			),
	);

	server.registerTool(
		"listSystemComponents",
		{
			title: "List System Components",
			description:
				"List stable component definitions in a configured design system, including manifest revision metadata for later writes.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await listSystemComponentsPayload(context, systemName),
				),
			),
	);

	server.registerTool(
		"describeSystemComponent",
		{
			title: "Describe System Component",
			description:
				"Describe one stable component definition, including draft hashes, validation diagnostics, and current manifest revision.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				componentId: z.string().min(1).describe("Stable system component id."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, componentId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await describeSystemComponentPayload(
						context,
						systemName,
						componentId,
					),
				),
			),
	);

	server.registerTool(
		"listStaleSystemComponentUsages",
		{
			title: "List Stale System Component Usages",
			description:
				"Report attached system component instances that reference an older published version. Read-only; does not migrate or write designs.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				componentId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional stable system component id."),
				designFileId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Optional design file UUID filter. Must be readable by MCP policy.",
					),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, componentId, designFileId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await listStaleSystemComponentUsagesPayload(context, systemName, {
						componentId,
						designFileId,
					}),
				),
			),
	);

	server.registerTool(
		"findAssetUsage",
		{
			title: "Find Asset Usage",
			description:
				"Find design elements that reference assets in a system. Optionally filter to one asset id.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				assetId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional stable system asset id."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, assetId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await findResourceUsagePayload(context, "asset", systemName, assetId),
				),
			),
	);

	server.registerTool(
		"findIconUsage",
		{
			title: "Find Icon Usage",
			description:
				"Find design elements that reference icons in a system. Optionally filter to one icon id.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				iconId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional stable system icon id."),
			}),
			annotations: readOnlyClosedWorldAnnotations,
		},
		async ({ systemName, iconId, project }) =>
			withPolicyErrorHandling(project, async (context) =>
				createJsonResult(
					await findResourceUsagePayload(context, "icon", systemName, iconId),
				),
			),
	);

	const mutationAnnotations = {
		readOnlyHint: false,
		openWorldHint: false,
		idempotentHint: false,
		destructiveHint: false,
	} as const;

	const destructiveMutationAnnotations = {
		...mutationAnnotations,
		destructiveHint: true,
		idempotentHint: false,
	} as const;

	server.registerTool(
		"createSystemComponentDraft",
		{
			title: "Create System Component Draft",
			description:
				"Create a new draft component definition in a system component manifest using an expected manifest revision. Call getSystemComponentAuthoringContract before authoring draft payloads.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				expectedRevision: systemComponentManifestRevisionSchema,
				slug: z.string().min(1).describe("Unique component slug."),
				name: z.string().min(1).describe("Human-readable component name."),
				description: z.string().optional(),
				group: z.string().optional(),
				order: z.number().finite().optional(),
				draft: mcpPartialSystemComponentDraftPayloadInputSchema,
			}),
			annotations: mutationAnnotations,
		},
		async ({
			systemName,
			expectedRevision,
			slug,
			name,
			description,
			group,
			order,
			draft,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const parsedDraft =
					draft === undefined
						? undefined
						: partialSystemComponentDraftPayloadSchema.safeParse(draft);
				if (parsedDraft !== undefined && !parsedDraft.success) {
					return createSystemComponentDraftInputErrorResult(
						context,
						parsedDraft.error,
					);
				}
				const result = await createSystemComponentDraft(
					context.projectRoot,
					system.manifest.systemId,
					{
						slug,
						name,
						description,
						group,
						order,
						...(parsedDraft !== undefined ? { draft: parsedDraft.data } : {}),
					},
					{ expectedRevision },
				);
				return createJsonResult(
					await systemComponentMutationPayload(
						context,
						systemName,
						result.componentId,
					),
				);
			}),
	);

	server.registerTool(
		"updateSystemComponentDraft",
		{
			title: "Update System Component Draft",
			description:
				"Update a component draft template, slots, variants, or override targets using expected manifest revision and optional draft hashes. Call getSystemComponentAuthoringContract before authoring root, variants, slots, or overrideTargets.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				componentId: z.string().min(1).describe("Stable system component id."),
				expectedRevision: systemComponentManifestRevisionSchema,
				expectedDraftTemplateHash: z.string().optional(),
				expectedDraftVariantSchemaHash: z.string().optional(),
				root: mcpRecipeTemplateNodeInputSchema,
				slots: mcpSystemComponentSlotsInputSchema,
				variants: mcpSystemComponentVariantSchemaInputSchema,
				overrideTargets: mcpSystemComponentOverrideTargetsInputSchema,
			}),
			annotations: mutationAnnotations,
		},
		async ({
			systemName,
			componentId,
			expectedRevision,
			expectedDraftTemplateHash,
			expectedDraftVariantSchemaHash,
			root,
			slots,
			variants,
			overrideTargets,
			project,
		}) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const parsedDraftPatch = systemComponentDraftPatchSchema.safeParse({
					...(root !== undefined ? { root } : {}),
					...(slots !== undefined ? { slots } : {}),
					...(variants !== undefined ? { variants } : {}),
					...(overrideTargets !== undefined ? { overrideTargets } : {}),
				});
				if (!parsedDraftPatch.success) {
					return createSystemComponentDraftInputErrorResult(
						context,
						parsedDraftPatch.error,
					);
				}
				await updateSystemComponentDraft(
					context.projectRoot,
					system.manifest.systemId,
					componentId,
					parsedDraftPatch.data,
					{
						expectedRevision,
						expectedDraftTemplateHash,
						expectedDraftVariantSchemaHash,
					},
				);
				return createJsonResult(
					await systemComponentMutationPayload(
						context,
						systemName,
						componentId,
					),
				);
			}),
	);

	server.registerTool(
		"publishSystemComponent",
		{
			title: "Publish System Component",
			description:
				"Publish a component draft into the system component manifest using an expected manifest revision.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				componentId: z.string().min(1).describe("Stable system component id."),
				expectedRevision: systemComponentManifestRevisionSchema,
			}),
			annotations: mutationAnnotations,
		},
		async ({ systemName, componentId, expectedRevision, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const result = await publishSystemComponentDraft(
					context.projectRoot,
					system.manifest.systemId,
					componentId,
					{ expectedRevision },
				);
				return createJsonResult(
					await systemComponentMutationPayload(
						context,
						systemName,
						componentId,
						{
							publishedVersion: result.publishedVersion,
						},
					),
				);
			}),
	);

	server.registerTool(
		"deleteSystemComponent",
		{
			title: "Delete System Component",
			description:
				"Delete one component definition from the system component manifest using an expected manifest revision.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				componentId: z.string().min(1).describe("Stable system component id."),
				expectedRevision: systemComponentManifestRevisionSchema,
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ systemName, componentId, expectedRevision, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const result = await deleteSystemComponent(
					context.projectRoot,
					system.manifest.systemId,
					componentId,
					{ expectedRevision },
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					systemId: system.manifest.systemId,
					systemName: system.manifest.systemName,
					revision: result.revision,
					updatedAt: result.updatedAt,
					componentId: result.componentId,
					deleted: true,
				});
			}),
	);

	server.registerTool(
		"addSystemIconFolder",
		{
			title: "Add System Icon Folder",
			description:
				"Add one project-relative folder to a design system's iconFolderPaths and refresh the icon manifest.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				folderPath: z
					.string()
					.min(1)
					.describe("Project-relative folder path containing SVG icons."),
			}),
			annotations: mutationAnnotations,
		},
		async ({ systemName, folderPath, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const manifest = await addIconFolderPath(
					context.projectRoot,
					system.manifest.systemId,
					folderPath,
				);
				const icons = await syncIconManifest(
					context.projectRoot,
					system.manifest.systemId,
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					systemId: manifest.systemId,
					systemName: manifest.systemName,
					iconFolderPaths: manifest.iconFolderPaths ?? [],
					iconCount: Object.keys(icons.icons).length,
				});
			}),
	);

	server.registerTool(
		"removeSystemIconFolder",
		{
			title: "Remove System Icon Folder",
			description:
				"Remove one project-relative folder from a design system's iconFolderPaths.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				folderPath: z
					.string()
					.min(1)
					.describe("Project-relative icon folder path to remove."),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ systemName, folderPath, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const manifest = await removeIconFolderPath(
					context.projectRoot,
					system.manifest.systemId,
					folderPath,
				);
				const icons = await syncIconManifest(
					context.projectRoot,
					system.manifest.systemId,
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					systemId: manifest.systemId,
					systemName: manifest.systemName,
					iconFolderPaths: icons.iconFolderPaths,
					iconCount: Object.keys(icons.icons).length,
				});
			}),
	);

	server.registerTool(
		"addSystemAsset",
		{
			title: "Add System Asset",
			description:
				"Register one image asset in a configured design system asset manifest.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				assetId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional stable asset id."),
				name: z.string().min(1).describe("Human-readable asset name."),
				sourcePath: z
					.string()
					.min(1)
					.describe("Project-relative image file path."),
				alt: z.string().optional().describe("Optional default alt text."),
			}),
			annotations: mutationAnnotations,
		},
		async ({ systemName, assetId, name, sourcePath, alt, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const result = await registerAsset(
					context.projectRoot,
					system.manifest.systemId,
					{
						assetId,
						name,
						sourcePath,
						alt,
					},
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					systemId: system.manifest.systemId,
					systemName: system.manifest.systemName,
					asset: { id: result.assetId, ...result.asset },
				});
			}),
	);

	server.registerTool(
		"removeSystemAsset",
		{
			title: "Remove System Asset",
			description:
				"Remove one asset from a configured design system if it is not used by designs.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				assetId: z.string().min(1).describe("Asset id to remove."),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ systemName, assetId, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const usages = await findProjectResourceUsage(
					context.projectRoot,
					"asset",
					system.manifest.systemId,
					assetId,
				);
				if (usages.length > 0) {
					return createToolErrorResult(
						context,
						"ASSET_IN_USE",
						`Asset "${assetId}" is still used by designs.`,
					);
				}
				await deleteAsset(
					context.projectRoot,
					system.manifest.systemId,
					assetId,
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					systemId: system.manifest.systemId,
					systemName: system.manifest.systemName,
					assetId: normalizeAssetId(assetId),
				});
			}),
	);

	server.registerTool(
		"refreshSystemAssetMetadata",
		{
			title: "Refresh System Asset Metadata",
			description:
				"Re-read one asset file's image metadata and update the asset updatedAt timestamp.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				assetId: z.string().min(1).describe("Asset id to refresh."),
			}),
			annotations: mutationAnnotations,
		},
		async ({ systemName, assetId, project }) =>
			withPolicyErrorHandling(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				assertCanWriteProject(policy);
				const system = await assertConfiguredSystem(context, systemName);
				const result = await refreshAssetMetadata(
					context.projectRoot,
					system.manifest.systemId,
					assetId,
				);
				return createJsonResult({
					status: "success",
					project: getProjectReference(context),
					systemId: system.manifest.systemId,
					systemName: system.manifest.systemName,
					asset: { id: result.assetId, ...result.asset },
				});
			}),
	);

	const createRevisionMismatchResult = (
		context: TrickroomMcpServerContext,
		currentRevision: string,
		expectedRevision: string,
	): CallToolResult => {
		const payload = {
			status: "REVISION_MISMATCH",
			project: getProjectReference(context),
			currentRevision,
			expectedRevision,
			message:
				"The design file was modified since your last read. Re-read the design file to get the current revision, then retry.",
			suggestedReads: ["readDesignFile", "readElement"],
		};
		return {
			content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
			structuredContent: payload,
			isError: true,
		};
	};

	const createInvalidOperationResult = (
		context: TrickroomMcpServerContext,
		error: DesignTransformError,
	): CallToolResult => {
		const payload = {
			status: "INVALID_OPERATION",
			project: getProjectReference(context),
			code: error.code,
			message: error.message,
		};
		return {
			content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
			structuredContent: payload,
			isError: true,
		};
	};

	const getMutationWarnings = async (
		context: TrickroomMcpServerContext,
		design: TrickroomDesign,
	) => {
		const diagnostics = await getDesignDiagnostics(context, design);
		return diagnostics.issues.filter((issue) => issue.severity === "warning");
	};

	const auditToolResult = async (
		context: TrickroomMcpServerContext,
		base: Omit<McpAuditEntry, "success" | "status" | "projectRoot">,
		result: CallToolResult,
	) => {
		const payload = (result.structuredContent ?? {}) as Record<string, unknown>;
		const status =
			typeof payload.status === "string"
				? payload.status
				: result.isError
					? "error"
					: "success";
		const code = typeof payload.code === "string" ? payload.code : undefined;
		const message =
			typeof payload.message === "string" ? payload.message : undefined;
		const resultingRevision =
			typeof payload.newRevision === "string" ? payload.newRevision : null;

		await appendMcpAuditLog(context, {
			...base,
			projectRoot: context.projectRoot,
			resultingRevision,
			success: result.isError !== true && status === "success",
			status,
			...(code ? { code } : {}),
			...(message ? { message } : {}),
		});
	};

	const withMutationErrorHandling = async (
		context: TrickroomMcpServerContext,
		auditBase: Omit<McpAuditEntry, "success" | "status" | "projectRoot">,
		fn: () => Promise<CallToolResult>,
	): Promise<CallToolResult> => {
		try {
			const result = await fn();
			await auditToolResult(context, auditBase, result);
			return result;
		} catch (error) {
			if (error instanceof DesignTransformError) {
				const result = createInvalidOperationResult(context, error);
				await auditToolResult(context, auditBase, result);
				return result;
			}
			if (error instanceof McpPolicyError) {
				const result = createPolicyDeniedResult(context, error);
				await auditToolResult(context, auditBase, result);
				return result;
			}
			if (error instanceof DesignFileServiceError) {
				const result = createToolErrorResult(
					context,
					error.code,
					error.message,
				);
				await auditToolResult(context, auditBase, result);
				return result;
			}
			throw error;
		}
	};

	server.registerTool(
		"createDesignFile",
		{
			title: "Create Design File",
			description:
				"Create a new empty Trickroom design file with no boards. Add root boards afterwards with addElement/addRecipe/addSubtree using parentId: null — do not nest boards inside a wrapper layer. Pass systemName at creation when the design will use system components; a system cannot be linked via MCP afterwards. Uses exclusive create semantics instead of expectedRevision because the file must not already exist.",
			inputSchema: withProjectScopedInput({
				name: z.string().min(1).describe("Design file name."),
				systemName: z
					.string()
					.min(1)
					.nullable()
					.optional()
					.describe(
						"Optional configured design system name. Pass null to explicitly create an unlinked design.",
					),
				designFileId: z
					.string()
					.uuid()
					.optional()
					.describe(
						"Optional UUID to use for the new design file. Required when allowedDesignFileIds restricts MCP to explicit IDs.",
					),
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({ name, systemName, designFileId, project }) =>
			withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const newDesignFileId = designFileId ?? randomUUID();
				const requestedSystemName = systemName ?? null;
				const normalizedAuditSystemName =
					typeof systemName === "string"
						? systemName.trim()
						: requestedSystemName;

				return withMutationErrorHandling(
					context,
					{
						toolName: "createDesignFile",
						operation: "createDesignFile",
						projectId: context.config.projectId ?? null,
						designFileId: newDesignFileId,
						expectedRevision: null,
						details: {
							systemName: normalizedAuditSystemName,
							requestedSystemName,
							requestedDesignFileId: designFileId ?? null,
						},
					},
					async () => {
						if (policy.mode === "read-only") {
							throw new McpPolicyError(
								"MCP_READ_ONLY",
								"MCP is configured in read-only mode for this project.",
							);
						}
						if (
							policy.allowedDesignFileIds !== null &&
							designFileId === undefined
						) {
							throw new McpPolicyError(
								"MCP_DESIGN_FILE_NOT_ALLOWED",
								"MCP design file creation requires a designFileId listed in allowedDesignFileIds when project policy restricts design files.",
							);
						}

						assertCanWriteDesignFile(policy, newDesignFileId);

						const trimmedName = name.trim();
						if (trimmedName.length === 0) {
							throw new DesignTransformError(
								"INVALID_OPERATION_PARAMETERS",
								'Parameter "name" must not be blank.',
							);
						}

						const normalizedSystemName =
							systemName === undefined || systemName === null
								? systemName
								: systemName.trim();
						if (normalizedSystemName === "") {
							throw new DesignTransformError(
								"INVALID_OPERATION_PARAMETERS",
								'Parameter "systemName" must not be blank when provided.',
							);
						}
						if (normalizedSystemName) {
							await assertConfiguredSystem(context, normalizedSystemName);
						}

						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(newDesignFileId);
						const system =
							normalizedSystemName === undefined ||
							normalizedSystemName === null
								? null
								: await assertConfiguredSystem(context, normalizedSystemName);
						const design = createBlankDesign(
							trimmedName,
							normalizedSystemName === undefined
								? undefined
								: (system?.manifest.systemId ?? null),
						);
						const write = await service.createDesignFile(file, design);
						await notifyResourceListChanged();

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							designFile: {
								id: newDesignFileId,
								file: write.file,
								name: write.design.name,
								systemId: write.design.systemId ?? null,
								systemName: system?.manifest.systemName ?? null,
								revision: write.revision,
							},
							rootElementIds: write.design.boards.map((board) => board.id),
							elementTree: write.design.boards.map(compactElementTree),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			}),
	);

	server.registerTool(
		"extractSubtree",
		{
			title: "Extract Subtree",
			description:
				"Copy an element subtree into a new Trickroom design file with regenerated element IDs. The source design is not modified.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Source design file UUID."),
				elementId: z
					.string()
					.min(1)
					.describe("Root element ID of the subtree to extract."),
				name: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Optional new design file name. Defaults to the source layer name, then Untitled.",
					),
				systemName: z
					.string()
					.min(1)
					.nullable()
					.optional()
					.describe(
						"Optional design system override. Omit to inherit the source design system; pass null to explicitly create an unlinked design.",
					),
				newDesignFileId: z
					.string()
					.uuid()
					.optional()
					.describe(
						"Optional UUID to use for the new design file. Required when allowedDesignFileIds restricts MCP to explicit IDs.",
					),
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			elementId,
			name,
			systemName,
			newDesignFileId,
			project,
		}) =>
			withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const targetDesignFileId = newDesignFileId ?? randomUUID();
				const normalizedAuditSystemName =
					typeof systemName === "string" ? systemName.trim() : systemName;

				return withMutationErrorHandling(
					context,
					{
						toolName: "extractSubtree",
						operation: "extractSubtree",
						projectId: context.config.projectId ?? null,
						designFileId: targetDesignFileId,
						expectedRevision: null,
						details: {
							sourceDesignFileId: designFileId,
							sourceElementId: elementId,
							requestedName: name ?? null,
							requestedSystemName:
								systemName === undefined
									? "inherit"
									: normalizedAuditSystemName,
							requestedNewDesignFileId: newDesignFileId ?? null,
						},
					},
					async () => {
						if (policy.mode === "read-only") {
							throw new McpPolicyError(
								"MCP_READ_ONLY",
								"MCP is configured in read-only mode for this project.",
							);
						}
						if (
							policy.allowedDesignFileIds !== null &&
							newDesignFileId === undefined
						) {
							throw new McpPolicyError(
								"MCP_DESIGN_FILE_NOT_ALLOWED",
								"MCP design file creation requires a newDesignFileId listed in allowedDesignFileIds when project policy restricts design files.",
							);
						}

						assertCanReadDesignFile(policy, designFileId);
						assertCanWriteDesignFile(policy, targetDesignFileId);

						const normalizedName = name === undefined ? undefined : name.trim();
						if (normalizedName === "") {
							throw new DesignTransformError(
								"INVALID_OPERATION_PARAMETERS",
								'Parameter "name" must not be blank.',
							);
						}
						const normalizedSystemName =
							systemName === undefined || systemName === null
								? systemName
								: systemName.trim();
						if (normalizedSystemName === "") {
							throw new DesignTransformError(
								"INVALID_OPERATION_PARAMETERS",
								'Parameter "systemName" must not be blank when provided.',
							);
						}
						if (normalizedSystemName) {
							await assertConfiguredSystem(context, normalizedSystemName);
						}

						const service = createDesignFileService(context.projectRoot);
						const sourceFile = service.getFileForUuid(designFileId);
						const sourceRead = await service.readDesignFile(sourceFile);
						normalizeDesignForMutation(sourceRead.design);
						const sourceElementContext = findElementContext(
							sourceRead.design,
							elementId,
						);
						if (!sourceElementContext) {
							throw new DesignTransformError(
								"ELEMENT_NOT_FOUND",
								`Element "${elementId}" not found.`,
							);
						}
						assertCanUseSubtreeComponents(policy, sourceElementContext.element);
						const targetSystem =
							normalizedSystemName === undefined ||
							normalizedSystemName === null
								? null
								: await assertConfiguredSystem(context, normalizedSystemName);
						const designSystemOverride =
							normalizedSystemName === undefined
								? {}
								: { systemId: targetSystem?.manifest.systemId ?? null };

						const result = await applyExtractSubtree(sourceRead.design, {
							elementId,
							name: normalizedName,
							...designSystemOverride,
							projectRoot: context.projectRoot,
						});
						const newDesign = await canonicalizeDesignSystemReferenceForStorage(
							context,
							result.newDesign,
						);
						await assertResourceReferencesExist(context, newDesign);

						const targetFile = service.getFileForUuid(targetDesignFileId);
						const write = await service.createDesignFile(targetFile, newDesign);
						const writtenSystem =
							write.design.systemId === undefined ||
							write.design.systemId === null
								? null
								: await findDesignSystem(
										context.projectRoot,
										write.design.systemId,
									);

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							sourceDesignFile: getDesignMetadata(designFileId, sourceRead),
							newRevision: write.revision,
							designFile: {
								id: targetDesignFileId,
								file: write.file,
								name: write.design.name,
								systemId: write.design.systemId ?? null,
								systemName: writtenSystem?.manifest.systemName ?? null,
								revision: write.revision,
							},
							sourceElementId: elementId,
							rootElementIds: write.design.boards.map((board) => board.id),
							idMap: result.idMap,
							elementTree: write.design.boards.map(compactElementTree),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			}),
	);

	server.registerTool(
		"addSubtree",
		{
			title: "Add Subtree",
			description:
				"Insert a candidate element or recipe subtree. Requires expectedRevision from a prior read.",
			inputSchema: addSubtreePayloadSchema.extend(projectScopedInputSchema),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			expectedRevision,
			parentId,
			index,
			subtree,
			options,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "addSubtree",
						operation: "addSubtree",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: {
							parentId,
							index,
							options: options === undefined ? null : options,
						},
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}

						const result = applyAddSubtree(read.design, {
							parentId,
							index,
							subtree,
							options,
						});

						const insertedRootContext = findElementContext(
							result.design,
							result.rootElementId,
						);
						if (!insertedRootContext) {
							throw new DesignTransformError(
								"INVALID_OPERATION",
								"Failed to validate inserted subtree root after applying mutation.",
							);
						}
						assertCanUseSubtreeComponents(policy, insertedRootContext.element);
						await assertResourceReferencesExist(context, result.design);

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							rootElementId: result.rootElementId,
							idMap: result.idMap,
							inserted: result.inserted,
							recipeExpansions: result.recipeExpansions,
							changedElement: getCompactElementSummary(
								result.design,
								result.changedElementId,
							),
							context: getMutationContext(
								result.design,
								result.changedElementId,
							),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"copySubtree",
		{
			title: "Copy Subtree",
			description:
				"Copy an existing source subtree into a target design. Requires expectedRevision for the target and sourceExpectedRevision for cross-file copies.",
			inputSchema: validateCopySubtreePayloadSchema.extend(
				projectScopedInputSchema,
			),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async (input) => {
			return withProjectContext(input.project, async (context) => {
				const policy = getMcpPolicy(context.config);
				const payload = input as ValidateCopySubtreePayload;
				return withMutationErrorHandling(
					context,
					{
						toolName: "copySubtree",
						operation: "copySubtree",
						projectId: context.config.projectId ?? null,
						designFileId: payload.targetDesignFileId,
						expectedRevision: payload.expectedRevision,
						details: {
							sourceDesignFileId: payload.sourceDesignFileId,
							sourceElementId: payload.sourceElementId,
							sourceExpectedRevision: payload.sourceExpectedRevision ?? null,
							parentId: payload.parentId,
							index: payload.index,
							options: payload.options ?? null,
						},
					},
					async () => {
						const validation = await validateCopySubtreePayload(
							context,
							payload,
						);
						if (validation.status === "REVISION_MISMATCH") {
							return createRevisionMismatchResult(
								context,
								validation.currentRevision,
								payload.expectedRevision,
							);
						}
						if (validation.status === "SOURCE_REVISION_MISMATCH") {
							return createJsonResult(validation);
						}
						if (validation.status !== "success" || validation.valid !== true) {
							const firstError = validation.diagnostics.find(
								(diagnostic) => diagnostic.severity === "error",
							);
							const invalidPayload = {
								...validation,
								status: "INVALID_OPERATION",
								...(firstError
									? {
											code: firstError.code,
											message: firstError.message,
										}
									: {}),
							};
							return {
								content: [
									{
										type: "text",
										text: JSON.stringify(invalidPayload, null, 2),
									},
								],
								structuredContent: invalidPayload,
								isError: true,
							};
						}

						const sameDesign =
							payload.sourceDesignFileId === payload.targetDesignFileId;
						assertCanReadDesignFile(policy, payload.sourceDesignFileId);
						assertCanWriteDesignFile(policy, payload.targetDesignFileId);
						const service = createDesignFileService(context.projectRoot);
						const targetFile = service.getFileForUuid(
							payload.targetDesignFileId,
						);
						const targetRead = await service.readDesignFile(targetFile);
						const sourceRead = sameDesign
							? targetRead
							: await service.readDesignFile(
									service.getFileForUuid(payload.sourceDesignFileId),
								);

						if (targetRead.revision !== payload.expectedRevision) {
							return createRevisionMismatchResult(
								context,
								targetRead.revision,
								payload.expectedRevision,
							);
						}
						if (
							payload.sourceExpectedRevision !== undefined &&
							sourceRead.revision !== payload.sourceExpectedRevision
						) {
							return createJsonResult({
								status: "SOURCE_REVISION_MISMATCH",
								project: getProjectReference(context),
								sourceDesignFile: getDesignMetadata(
									payload.sourceDesignFileId,
									sourceRead,
								),
								targetDesignFile: getDesignMetadata(
									payload.targetDesignFileId,
									targetRead,
								),
								currentSourceRevision: sourceRead.revision,
								sourceExpectedRevision: payload.sourceExpectedRevision,
								expectedRevision: payload.expectedRevision,
								message:
									"Expected source revision does not match current revision.",
								suggestedReads: ["readDesignFile", "readDesignGraph"],
							});
						}

						const sourceElementContext = findElementContext(
							sourceRead.design,
							payload.sourceElementId,
						);
						if (!sourceElementContext) {
							throw new DesignTransformError(
								"ELEMENT_NOT_FOUND",
								`Element "${payload.sourceElementId}" not found.`,
							);
						}
						assertCanUseSubtreeComponents(policy, sourceElementContext.element);

						const result = await applyCopySubtree(
							sourceRead.design,
							targetRead.design,
							{
								sourceElementId: payload.sourceElementId,
								parentId: payload.parentId,
								index: payload.index,
								sameDesign,
								projectRoot: context.projectRoot,
							},
						);
						await assertResourceReferencesExist(context, result.design);

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(targetFile, nextDesign, {
								expectedRevision: payload.expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(targetFile);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									payload.expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							sourceDesignFile: getDesignMetadata(
								payload.sourceDesignFileId,
								sourceRead,
							),
							targetDesignFile: {
								id: payload.targetDesignFileId,
								file: write.file,
								name: write.design.name,
								systemId: write.design.systemId ?? null,
								systemName:
									(
										await summarizeDesignSystemReference(
											context,
											getDesignSystemHandle(write.design),
										)
									)?.systemName ?? null,
								revision: write.revision,
							},
							newRevision: write.revision,
							sourceElementId: payload.sourceElementId,
							rootElementId: result.rootElementId,
							idMap: result.idMap,
							inserted: result.inserted,
							changedElement: getCompactElementSummary(
								result.design,
								result.rootElementId,
							),
							context: getMutationContext(result.design, result.rootElementId),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"renameDesignFile",
		{
			title: "Rename Design File",
			description:
				"Rename a design file by updating its design-level name. Requires expectedRevision from a prior read.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				name: z.string().min(1).describe("New design file name."),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ designFileId, expectedRevision, name, project }) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "renameDesignFile",
						operation: "renameDesignFile",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(context, {
									...read.design,
									name,
								});
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}
						await notifyResourceListChanged();

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							designFile: {
								id: designFileId,
								file: write.file,
								name: write.design.name,
								systemId: write.design.systemId ?? null,
								systemName: await getDesignSystemDisplayName(
									context,
									write.design,
								),
								revision: write.revision,
							},
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"applyDesignOperations",
		{
			title: "Apply Design Operations",
			description:
				"Validate and commit an ordered list of design operations atomically against one expectedRevision. Performs exactly one persisted write when the full plan is valid and the starting revision still matches.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe("Current revision from a prior read."),
				operations: z
					.array(
						z.object({
							operation: z.enum([
								"renameDesignFile",
								"addElement",
								"addRecipe",
								"addSystemComponent",
								"updateSystemComponentInstance",
								"detachSystemComponent",
								"addSubtree",
								"updateElementProps",
								"updateRecipeControl",
								"updateRecipeInstance",
								"updateElementText",
								"moveElement",
								"deleteElement",
								"copySubtree",
								"detachRecipeInstance",
							]),
							parameters: z.record(z.string(), z.unknown()).optional(),
						}),
					)
					.min(1)
					.describe("Ordered design operations to commit."),
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: true,
				idempotentHint: false,
			},
		},
		async ({ designFileId, expectedRevision, operations, project }) =>
			withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "applyDesignOperations",
						operation: "applyDesignOperations",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: {
							operationCount: operations.length,
						},
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						try {
							const result = await applyDesignOperationsPayload(context, {
								designFileId,
								expectedRevision,
								operations,
							});
							if (
								result.status === "invalid" ||
								result.status === "REVISION_MISMATCH" ||
								result.status === "SOURCE_REVISION_MISMATCH" ||
								(result.status === "success" && result.valid === false)
							) {
								return {
									content: [
										{
											type: "text",
											text: JSON.stringify(result, null, 2),
										},
									],
									structuredContent: result,
									isError: true,
								};
							}
							return createJsonResult(result);
						} catch (error) {
							if (error instanceof DesignTransformError) {
								return createInvalidOperationResult(context, error);
							}
							throw error;
						}
					},
				);
			}),
	);

	server.registerTool(
		"addElement",
		{
			title: "Add Element",
			description:
				"Create a new registry element inside a design file. Requires expectedRevision from a prior read.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				parentId: z
					.string()
					.min(1)
					.nullable()
					.describe("Parent element ID, or null to add at the design root."),
				index: z
					.number()
					.int()
					.min(0)
					.describe(
						"Insertion index within the parent's children or the root.",
					),
				library: z
					.string()
					.min(1)
					.describe("Registry library id, e.g. 'trickroom'."),
				component: z
					.string()
					.min(1)
					.describe("Registry component id, e.g. 'container' or 'text'."),
				name: z
					.string()
					.min(1)
					.optional()
					.describe(
						'Layer name (data-trickroom-name). Shortcut — takes precedence over props["data-trickroom-name"] when both are supplied. Defaults to the component id.',
					),
				className: z
					.string()
					.optional()
					.describe(
						"Tailwind class string. Shortcut — takes precedence over props.className when both are supplied.",
					),
				text: z
					.string()
					.optional()
					.describe(
						"Initial text content for text role elements. Defaults to 'Text'.",
					),
				props: z
					.record(z.string(), jsonPrimitiveSchema)
					.optional()
					.describe(
						"Optional extra instance props. Allowed keys: className, data-trickroom-name, and registry-backed control props. Registry-reference keys (data-trickroom-library, data-trickroom-component, data-trickroom-role) and unknown keys are rejected with INVALID_PROP_KEY.",
					),
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			expectedRevision,
			parentId,
			index,
			library,
			component,
			name,
			className,
			text,
			props,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "addElement",
						operation: "addElement",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: {
							componentRef: getComponentRef(library, component),
							parentId,
						},
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						assertCanUseComponent(policy, library, component);
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}

						const result = applyAddElement(read.design, {
							parentId,
							index,
							library,
							component,
							name,
							className,
							text,
							props,
						});
						await assertResourceElementReferenceExists(
							context,
							result.design,
							result.changedElementId,
						);

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						const element = getCompactElementSummary(
							result.design,
							result.changedElementId,
						);
						const elementContext = getMutationContext(
							result.design,
							result.changedElementId,
						);

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							changedElement: element,
							context: elementContext,
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"addRecipe",
		{
			title: "Add Recipe",
			description:
				"Expand a built-in registry recipe into attached design elements. Requires expectedRevision from a prior read.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...addRecipeOperationParameterSchema,
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			expectedRevision,
			parentId,
			index,
			library,
			recipe,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "addRecipe",
						operation: "addRecipe",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: {
							recipeRef: `${library}/${recipe}`,
							parentId,
						},
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const resolution = getRecipeOrThrow(library, recipe);
						assertCanUseRecipe(policy, resolution.definition);

						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}

						const result = applyAddRecipe(read.design, {
							parentId,
							index,
							library,
							recipe,
						});
						await assertResourceReferencesExist(context, result.design);

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							recipe: {
								id: result.recipeId,
								instanceId: result.instanceId,
								elementIdsByPath: result.elementIdsByPath,
							},
							changedElement: getCompactElementSummary(
								result.design,
								result.changedElementId,
							),
							context: getMutationContext(
								result.design,
								result.changedElementId,
							),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"addSystemComponent",
		{
			title: "Add System Component",
			description:
				"Insert a published design-system component instance into a design file. Requires expectedRevision from a prior read.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...addSystemComponentOperationParameterSchema,
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			expectedRevision,
			parentId,
			index,
			systemId,
			componentId,
			version,
			variantValues,
			unsetVariantAxes,
			overrides,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "addSystemComponent",
						operation: "addSystemComponent",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: {
							systemId,
							componentId,
							parentId,
						},
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}

						const result = await applyAddSystemComponent(read.design, {
							projectRoot: context.projectRoot,
							parentId,
							index,
							systemId,
							componentId,
							version: version ?? null,
							variantValues,
							unsetVariantAxes,
							overrides,
						});
						const insertedRoot = findElementContext(
							result.design,
							result.changedElementId,
						);
						if (!insertedRoot) {
							throw new DesignTransformError(
								"INVALID_OPERATION",
								"Failed to validate inserted system component root after mutation.",
							);
						}
						assertCanUseSubtreeComponents(policy, insertedRoot.element);
						await assertResourceReferencesExist(context, result.design);

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							systemComponent: {
								systemId: result.systemId,
								componentId: result.componentId,
								version: result.version,
								instanceId: result.instanceId,
								elementIdsByPath: result.elementIdsByPath,
								variantValues: result.variantValues,
								overrides: result.overrides,
							},
							changedElement: getCompactElementSummary(
								result.design,
								result.changedElementId,
							),
							context: getMutationContext(
								result.design,
								result.changedElementId,
							),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"updateSystemComponentInstance",
		{
			title: "Update System Component Instance",
			description:
				"Update variant values, clear variant axes, and/or override classNames on an attached system component root. Component marker props cannot be edited through generic element tools.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...updateSystemComponentInstanceOperationParameterSchema,
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			expectedRevision,
			rootElementId,
			variantValues,
			unsetVariantAxes,
			overrides,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "updateSystemComponentInstance",
						operation: "updateSystemComponentInstance",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { rootElementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}

						assertOperationAllowedByPolicy(
							policy,
							read.design,
							"updateSystemComponentInstance",
							{ rootElementId, variantValues, unsetVariantAxes, overrides },
						);

						const result = await applyUpdateSystemComponentInstance(
							read.design,
							{
								projectRoot: context.projectRoot,
								rootElementId,
								variantValues,
								unsetVariantAxes,
								overrides,
							},
						);

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							systemComponent: {
								systemId: result.systemId,
								componentId: result.componentId,
								version: result.version,
								instanceId: result.instanceId,
								rootElementId: result.rootElementId,
								changedElementIds: result.changedElementIds,
								variantValues: result.variantValues,
								overrides: result.overrides,
							},
							changedElement: getCompactElementSummary(
								result.design,
								result.changedElementId,
							),
							context: getMutationContext(
								result.design,
								result.changedElementId,
							),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"migrateSystemComponentInstance",
		{
			title: "Migrate System Component Instance",
			description:
				"Migrate one stale attached system component instance to the current published version using the same guarded domain rules as the UI. Blocked unsafe migrations are rejected. Review-required migrations are not written unless onlySafe is false.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				rootElementId: z
					.string()
					.min(1)
					.describe("Attached system component root element ID."),
				onlySafe: z
					.boolean()
					.optional()
					.describe(
						"When true (default), skip review-required migrations and return them without writing.",
					),
				dryRun: z
					.boolean()
					.optional()
					.describe(
						"When true, preview migration diagnostics without writing the design file.",
					),
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			designFileId,
			expectedRevision,
			rootElementId,
			onlySafe,
			dryRun,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "migrateSystemComponentInstance",
						operation: "migrateSystemComponentInstance",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { rootElementId, onlySafe, dryRun },
					},
					async () => {
						assertCanReadDesignFile(policy, designFileId);
						if (!dryRun) {
							assertCanWriteDesignFile(policy, designFileId);
						}
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}

						assertCanUseSystemComponentInstanceSubtree(
							policy,
							read.design,
							rootElementId,
						);

						const result = await applyMigrateSystemComponentInstance(
							read.design,
							{
								projectRoot: context.projectRoot,
								rootElementId,
								onlySafe,
								dryRun,
							},
						);

						const targetDesign = result.prospectiveDesign ?? result.design;
						assertCanUseSystemComponentInstanceSubtree(
							policy,
							targetDesign,
							result.rootElementId,
						);

						if (!result.applied) {
							return createJsonResult({
								status:
									result.outcome === "review-required"
										? "REVIEW_REQUIRED"
										: "DRY_RUN",
								project: getProjectReference(context),
								applied: false,
								outcome: result.outcome,
								systemComponent: {
									systemId: result.systemId,
									componentId: result.componentId,
									instanceId: result.instanceId,
									rootElementId: result.rootElementId,
									fromVersion: result.fromVersion,
									toVersion: result.toVersion,
								},
								preview: result.preview,
								revision: read.revision,
							});
						}

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							applied: true,
							outcome: result.outcome,
							newRevision: write.revision,
							systemComponent: {
								systemId: result.systemId,
								componentId: result.componentId,
								instanceId: result.instanceId,
								rootElementId: result.rootElementId,
								fromVersion: result.fromVersion,
								toVersion: result.toVersion,
							},
							componentMigration: result.componentMigration,
							preview: result.preview,
							changedElement: getCompactElementSummary(
								result.design,
								result.changedElementId,
							),
							context: getMutationContext(
								result.design,
								result.changedElementId,
							),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"bulkMigrateSystemComponentUsages",
		{
			title: "Bulk Migrate System Component Usages",
			description:
				"Bulk migrate stale attached system component instances for a system, optionally filtered by component or design file. Uses the same safe/review-required/blocked diagnostics as the UI. onlySafe defaults to true so review-required instances are reported but not written.",
			inputSchema: withProjectScopedInput({
				systemName: z
					.string()
					.min(1)
					.describe("Configured design system name."),
				componentId: z
					.string()
					.min(1)
					.optional()
					.describe("Optional stable system component id."),
				designFileId: z
					.string()
					.min(1)
					.optional()
					.describe(
						"Optional design file UUID filter. Must be readable and writable by MCP policy.",
					),
				onlySafe: z
					.boolean()
					.optional()
					.describe(
						"When true (default), migrate only safe instances and report review-required separately.",
					),
				dryRun: z
					.boolean()
					.optional()
					.describe(
						"When true, report predicted changes without persisting design files.",
					),
			}),
			annotations: {
				...mutationAnnotations,
				destructiveHint: false,
				idempotentHint: false,
			},
		},
		async ({
			systemName,
			componentId,
			designFileId,
			onlySafe,
			dryRun,
			project,
		}) =>
			withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "bulkMigrateSystemComponentUsages",
						operation: "bulkMigrateSystemComponentUsages",
						projectId: context.config.projectId ?? null,
						details: {
							systemName,
							componentId,
							designFileId,
							onlySafe,
							dryRun,
						},
					},
					async () => {
						if (designFileId) {
							assertCanReadDesignFile(policy, designFileId);
							if (!dryRun) {
								assertCanWriteDesignFile(policy, designFileId);
							}
						} else if (!dryRun) {
							assertCanWriteProject(policy);
						}

						return createJsonResult(
							await bulkMigrateSystemComponentUsagesPayload(
								context,
								systemName,
								{
									componentId,
									designFileId,
									onlySafe,
									dryRun,
								},
							),
						);
					},
				);
			}),
	);

	server.registerTool(
		"detachSystemComponent",
		{
			title: "Detach System Component",
			description:
				"Detach the attached system component instance containing the target element. Removes component marker props from the whole instance so former structural nodes can be mutated normally.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...detachSystemComponentOperationParameterSchema,
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ designFileId, expectedRevision, elementId, project }) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "detachSystemComponent",
						operation: "detachSystemComponent",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}

						assertOperationAllowedByPolicy(
							policy,
							read.design,
							"detachSystemComponent",
							{
								elementId,
							},
						);

						const result = await applyDetachSystemComponent(read.design, {
							projectRoot: context.projectRoot,
							elementId,
						});

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							systemComponent: {
								systemId: result.systemId,
								componentId: result.componentId,
								instanceId: result.instanceId,
								rootElementId: result.rootElementId,
							},
							changedElement: getCompactElementSummary(
								result.design,
								result.changedElementId,
							),
							detachedElementIds: result.detachedElementIds,
							context: getMutationContext(
								result.design,
								result.changedElementId,
							),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"updateElementProps",
		{
			title: "Update Element Props",
			description:
				"Update allowed instance props on a design element: name, className, and/or registry-backed control props. Registry-reference props (library, component, role) cannot be changed.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				elementId: z.string().min(1).describe("Element ID to update."),
				name: z
					.string()
					.min(1)
					.optional()
					.describe("New layer name for this element."),
				className: z
					.string()
					.optional()
					.describe("New Tailwind class string. Pass empty string to clear."),
				props: z
					.record(z.string(), jsonPrimitiveSchema)
					.optional()
					.describe(
						'Registry-backed control props to update, for example { "orientation": "vertical" } for base-ui/separator.',
					),
				propUpdates: z
					.array(
						z.object({
							name: z
								.string()
								.min(1)
								.describe(
									'Prop name to update. Use "name" or "data-trickroom-name" for the layer name, "className" for classes, or a registry-backed control prop.',
								),
							value: jsonPrimitiveSchema,
						}),
					)
					.optional()
					.describe(
						"Compatibility batch update form. Prefer top-level name/className/props for new calls.",
					),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			elementId,
			name,
			className,
			props,
			propUpdates,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "updateElementProps",
						operation: "updateElementProps",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}
						const target = getElementComponentReference(read.design, elementId);
						assertCanUseComponent(policy, target.library, target.component);

						const normalizedProps = normalizeUpdateElementPropsParameters({
							name,
							className,
							props,
							propUpdates,
						});
						const result = applyUpdateElementProps(read.design, {
							elementId,
							...normalizedProps,
						});
						await assertResourceElementReferenceExists(
							context,
							result.design,
							result.changedElementId,
						);

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							changedElement: getCompactElementSummary(
								result.design,
								result.changedElementId,
							),
							context: getMutationContext(
								result.design,
								result.changedElementId,
							),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"updateRecipeControl",
		{
			title: "Update Recipe Control",
			description:
				"Update a declared recipe-level control by attached recipe instance ID and template path. This keeps the recipe attached and rejects undeclared structural props.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...updateRecipeControlOperationParameterSchema,
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			instanceId,
			path,
			prop,
			value,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "updateRecipeControl",
						operation: "updateRecipeControl",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { instanceId, path, prop },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}

						const result = applyUpdateRecipeControl(read.design, {
							instanceId,
							path,
							prop,
							value,
						});
						const target = getElementComponentReference(
							result.design,
							result.changedElementId,
						);
						assertCanUseComponent(policy, target.library, target.component);
						await assertResourceElementReferenceExists(
							context,
							result.design,
							result.changedElementId,
						);

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							recipeControl: { instanceId, path, prop, value },
							changedElement: getCompactElementSummary(
								result.design,
								result.changedElementId,
							),
							context: getMutationContext(
								result.design,
								result.changedElementId,
							),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"updateRecipeInstance",
		{
			title: "Update Recipe Instance",
			description:
				"Explicitly migrate a stale attached recipe instance to the current registry recipe template while preserving mutable settings and safely mapped authored slot contents.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...updateRecipeInstanceOperationParameterSchema,
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ designFileId, expectedRevision, elementId, project }) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "updateRecipeInstance",
						operation: "updateRecipeInstance",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}
						const target = getElementComponentReference(read.design, elementId);
						assertCanUseComponent(policy, target.library, target.component);

						const result = applyUpdateRecipeInstance(read.design, {
							elementId,
						});
						await assertResourceReferencesExist(context, result.design);

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							recipeMigration: result.recipeMigration,
							changedElement: getCompactElementSummary(
								result.design,
								result.changedElementId,
							),
							context: getMutationContext(
								result.design,
								result.changedElementId,
							),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"updateElementText",
		{
			title: "Update Element Text",
			description:
				"Update the text content of a text role element. Only valid for elements with role 'text'.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				elementId: z
					.string()
					.min(1)
					.describe("Text role element ID to update."),
				text: z.string().describe("New text content."),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ designFileId, expectedRevision, elementId, text, project }) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "updateElementText",
						operation: "updateElementText",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}
						const target = getElementComponentReference(read.design, elementId);
						assertCanUseComponent(policy, target.library, target.component);

						const result = applyUpdateElementText(read.design, {
							elementId,
							text,
						});

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							changedElement: getCompactElementSummary(
								result.design,
								result.changedElementId,
							),
							context: getMutationContext(
								result.design,
								result.changedElementId,
							),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"moveElement",
		{
			title: "Move Element",
			description:
				"Move a design element to a new parent or position. Rejects cycles, non-branch parents, and missing targets.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				elementId: z.string().min(1).describe("Element ID to move."),
				targetParentId: z
					.string()
					.min(1)
					.nullable()
					.describe(
						"New parent element ID, or null to move to the design root.",
					),
				index: z
					.number()
					.int()
					.min(0)
					.describe(
						"Insertion index within the target parent's children or the root.",
					),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({
			designFileId,
			expectedRevision,
			elementId,
			targetParentId,
			index,
			project,
		}) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "moveElement",
						operation: "moveElement",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId, targetParentId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}
						const target = getElementComponentReference(read.design, elementId);
						assertCanUseComponent(policy, target.library, target.component);
						if (targetParentId !== null) {
							const parent = getElementComponentReference(
								read.design,
								targetParentId,
								"PARENT_NOT_FOUND",
							);
							assertCanUseComponent(policy, parent.library, parent.component);
						}

						const result = applyMoveElement(read.design, {
							elementId,
							targetParentId,
							index,
						});

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							changedElement: getCompactElementSummary(
								result.design,
								result.changedElementId,
							),
							context: getMutationContext(
								result.design,
								result.changedElementId,
							),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"deleteElement",
		{
			title: "Delete Element",
			description:
				"Delete a design element and all its descendants. This operation cannot be undone.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				elementId: z.string().min(1).describe("Element ID to delete."),
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ designFileId, expectedRevision, elementId, project }) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "deleteElement",
						operation: "deleteElement",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}
						const target = getElementComponentReference(read.design, elementId);
						assertCanUseComponent(policy, target.library, target.component);

						const originalContext = getMutationContext(read.design, elementId);

						const result = applyDeleteElement(read.design, { elementId });

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						const parentSiblings =
							originalContext?.parentId !== null && originalContext?.parentId
								? getMutationContext(result.design, originalContext.parentId)
								: null;

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							deletedElementId: result.changedElementId,
							deletedCount: result.deletedIds.length,
							context: {
								wasRoot: originalContext?.root ?? false,
								parentId: originalContext?.parentId ?? null,
								parentContext: parentSiblings,
							},
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	server.registerTool(
		"detachRecipeInstance",
		{
			title: "Detach Recipe Instance",
			description:
				"Detach the attached recipe instance containing the target structural element. Removes recipe marker props from the whole instance so former structural nodes can be mutated normally.",
			inputSchema: withProjectScopedInput({
				designFileId: z.string().uuid().describe("Design file UUID."),
				expectedRevision: z
					.string()
					.startsWith("sha256:")
					.describe(
						"Current revision from a prior read. Required for safe writes.",
					),
				...detachRecipeInstanceOperationParameterSchema,
			}),
			annotations: destructiveMutationAnnotations,
		},
		async ({ designFileId, expectedRevision, elementId, project }) => {
			return withProjectContext(project, async (context) => {
				const policy = getMcpPolicy(context.config);
				return withMutationErrorHandling(
					context,
					{
						toolName: "detachRecipeInstance",
						operation: "detachRecipeInstance",
						projectId: context.config.projectId ?? null,
						designFileId,
						expectedRevision,
						details: { elementId },
					},
					async () => {
						assertCanWriteDesignFile(policy, designFileId);
						const service = createDesignFileService(context.projectRoot);
						const file = service.getFileForUuid(designFileId);
						const read = await service.readDesignFile(file);

						if (read.revision !== expectedRevision) {
							return createRevisionMismatchResult(
								context,
								read.revision,
								expectedRevision,
							);
						}
						const target = getElementComponentReference(read.design, elementId);
						assertCanUseComponent(policy, target.library, target.component);

						const result = applyDetachRecipeInstance(read.design, {
							elementId,
						});

						let write: Awaited<ReturnType<typeof service.writeDesignFile>>;
						try {
							const nextDesign =
								await canonicalizeDesignSystemReferenceForStorage(
									context,
									result.design,
								);
							write = await service.writeDesignFile(file, nextDesign, {
								expectedRevision,
							});
						} catch (error) {
							if (
								error instanceof DesignFileServiceError &&
								error.code === "REVISION_MISMATCH"
							) {
								const raceRead = await service.readJsonFile(file);
								return createRevisionMismatchResult(
									context,
									raceRead.revision,
									expectedRevision,
								);
							}
							throw error;
						}

						return createJsonResult({
							status: "success",
							project: getProjectReference(context),
							newRevision: write.revision,
							recipe: {
								id: result.recipeId,
								instanceId: result.instanceId,
								rootElementId: result.rootElementId,
							},
							changedElement: getCompactElementSummary(
								result.design,
								result.changedElementId,
							),
							detachedElementIds: result.detachedElementIds,
							context: getMutationContext(
								result.design,
								result.changedElementId,
							),
							warnings: await getMutationWarnings(context, write.design),
						});
					},
				);
			});
		},
	);

	return server;
};
