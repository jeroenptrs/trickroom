import { TOOL } from "./tool-names";

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
			"List and select Trickroom projects for this MCP session, follow the human's editor, and report friction with the tools.",
		tools: [
			TOOL.projectList,
			TOOL.projectSelect,
			TOOL.editorContext,
			TOOL.editorFocus,
			TOOL.feedbackSubmit,
		],
	},
	{
		id: "designRead",
		label: "Design inspection",
		description:
			"List and read design files, capture screenshots, and export boards to disk.",
		tools: [
			TOOL.designList,
			TOOL.designRead,
			TOOL.designScreenshot,
			TOOL.designExport,
		],
	},
	{
		id: "designWrite",
		label: "Design mutation",
		description:
			"Create design files and apply design operations: insert, update, move, copy, delete, rename.",
		tools: [TOOL.designApply, TOOL.designCreate],
	},
	{
		id: "designValidation",
		label: "Validation & dry-run",
		description: "Validate designs and dry-run design operations.",
		tools: [TOOL.designValidate],
	},
	{
		id: "registry",
		label: "Guide & registry",
		description:
			"The authoring guide: design rules, operations, registry elements, recipes, and component authoring.",
		tools: [TOOL.guide],
	},
	{
		id: "designSystems",
		label: "Design systems & resources",
		description:
			"Read design system tokens, assets and icons, and manage asset and icon catalogs.",
		tools: [TOOL.systemRead, TOOL.systemUpdate],
	},
	{
		id: "systemComponents",
		label: "System components",
		description:
			"Read, author, publish, delete and migrate project-owned system components.",
		tools: [
			TOOL.componentRead,
			TOOL.componentDraftCreate,
			TOOL.componentDraftUpdate,
			TOOL.componentPublish,
			TOOL.componentDelete,
			TOOL.componentMigrate,
		],
	},
	{
		id: "memory",
		label: "Memory & notes",
		description:
			"Read and write durable steering notes scoped to a system, design, or the project.",
		tools: [TOOL.memoryRead, TOOL.memoryWrite],
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
