export const MCP_TOOL_GROUP_IDS = [
	"projects",
	"designRead",
	"designWrite",
	"designValidation",
	"registry",
	"designSystems",
	"systemComponents",
	"memory",
] as const;

export type McpToolGroupId = (typeof MCP_TOOL_GROUP_IDS)[number];

export type McpToolGroupDefinition = {
	id: McpToolGroupId;
	label: string;
	description: string;
	tools: readonly string[];
};

export const MCP_TOOL_GROUPS = [
	{
		id: "projects",
		label: "Project & session",
		description:
			"List, register, and select Trickroom projects for this MCP session.",
		tools: [
			"listProjects",
			"registerProject",
			"selectProject",
			"getSelectedProject",
			"getActiveProject",
			"resolveProject",
			"openProject",
			"trickroom_project_info",
		],
	},
	{
		id: "designRead",
		label: "Design inspection",
		description:
			"List design files and read boards, elements, graphs, subtrees, and export HTML to disk.",
		tools: [
			"listDesignFiles",
			"readDesignFile",
			"readDesignGraph",
			"readElement",
			"readSubtree",
			"exportDesignHtml",
			"screenshotBoard",
			"screenshotNode",
		],
	},
	{
		id: "designWrite",
		label: "Design mutation",
		description:
			"Create, rename, insert, update, move, copy, extract, and delete design content.",
		tools: [
			"createDesignFile",
			"extractSubtree",
			"addSubtree",
			"copySubtree",
			"renameDesignFile",
			"applyDesignOperations",
			"addElement",
			"addRecipe",
			"addSystemComponent",
			"updateSystemComponentInstance",
			"detachSystemComponent",
			"updateElementProps",
			"updateRecipeControl",
			"updateRecipeInstance",
			"updateElementText",
			"moveElement",
			"deleteElement",
			"detachRecipeInstance",
		],
	},
	{
		id: "designValidation",
		label: "Validation & dry-run",
		description:
			"Validate designs and dry-run single operations, plans, subtrees, and copies.",
		tools: [
			"validateDesignFile",
			"validateOperation",
			"validateOperationPlan",
			"validateSubtree",
			"validateCopySubtree",
		],
	},
	{
		id: "registry",
		label: "Registry & contracts",
		description:
			"Discover registry components/recipes and read authoring contracts for agents.",
		tools: [
			"listRegistries",
			"listRegistryComponents",
			"describeRegistryComponent",
			"listRegistryRecipes",
			"describeRegistryRecipe",
			"getDesignAuthoringContract",
			"getSystemComponentAuthoringContract",
		],
	},
	{
		id: "designSystems",
		label: "Design systems & resources",
		description:
			"Inspect linked systems, tokens, assets, icons, and manage system resource manifests.",
		tools: [
			"getDesignSystemForDesignFile",
			"listDesignTokens",
			"listSystemAssets",
			"describeAsset",
			"listSystemIcons",
			"describeIcon",
			"findAssetUsage",
			"findIconUsage",
			"addSystemAsset",
			"removeSystemAsset",
			"addSystemIconFolder",
			"removeSystemIconFolder",
			"refreshSystemAssetMetadata",
		],
	},
	{
		id: "systemComponents",
		label: "System components",
		description:
			"Author, publish, migrate, and inspect project-owned system components.",
		tools: [
			"listSystemComponents",
			"describeSystemComponent",
			"listStaleSystemComponentUsages",
			"createSystemComponentDraft",
			"updateSystemComponentDraft",
			"publishSystemComponent",
			"deleteSystemComponent",
			"migrateSystemComponentInstance",
			"bulkMigrateSystemComponentUsages",
		],
	},
	{
		id: "memory",
		label: "Memory & notes",
		description:
			"Read and write durable steering/alignment notes scoped to a system, design, or the project.",
		tools: [
			"listMemoryNotes",
			"getMemoryNote",
			"addMemoryNote",
			"updateMemoryNote",
			"deleteMemoryNote",
			"listReferenceTargets",
		],
	},
] as const satisfies readonly McpToolGroupDefinition[];

const toolToGroup = new Map<string, McpToolGroupId>();
for (const group of MCP_TOOL_GROUPS) {
	for (const tool of group.tools) {
		toolToGroup.set(tool, group.id);
	}
}

export const getMcpToolGroupId = (toolName: string): McpToolGroupId | null =>
	toolToGroup.get(toolName) ?? null;

export const MCP_TOOL_NAMES = [...toolToGroup.keys()] as const;

export type McpToolGroupSettings = Record<McpToolGroupId, boolean>;

export const createDefaultMcpToolGroupSettings = (): McpToolGroupSettings =>
	Object.fromEntries(
		MCP_TOOL_GROUP_IDS.map((groupId) => [groupId, true]),
	) as McpToolGroupSettings;

export const normalizeMcpToolGroupSettings = (
	value: Partial<Record<McpToolGroupId, boolean>> | undefined,
): McpToolGroupSettings => {
	const defaults = createDefaultMcpToolGroupSettings();
	if (!value) {
		return defaults;
	}

	return Object.fromEntries(
		MCP_TOOL_GROUP_IDS.map((groupId) => [
			groupId,
			value[groupId] ?? defaults[groupId],
		]),
	) as McpToolGroupSettings;
};

export const isMcpToolGroupId = (value: string): value is McpToolGroupId =>
	(MCP_TOOL_GROUP_IDS as readonly string[]).includes(value);
