/**
 * Every MCP tool name, in tools/list order. Strings shown to agents (hints,
 * guide topics, prompts, error payloads) build tool references from these
 * constants so a rename touches one place; a test checks that no string
 * names a tool outside this list.
 *
 * Leaf module: src/services imports it, so keep imports out.
 */
export const TOOL = {
	projectList: "project_list",
	projectSelect: "project_select",
	guide: "guide",
	designList: "design_list",
	designRead: "design_read",
	designApply: "design_apply",
	designValidate: "design_validate",
	lint: "lint",
	designCreate: "design_create",
	designScreenshot: "design_screenshot",
	designExport: "design_export",
	editorContext: "editor_context",
	editorFocus: "editor_focus",
	memoryRead: "memory_read",
	memoryWrite: "memory_write",
	systemRead: "system_read",
	systemUpdate: "system_update",
	componentRead: "component_read",
	componentDraftCreate: "component_draft_create",
	componentDraftUpdate: "component_draft_update",
	componentPublish: "component_publish",
	componentDelete: "component_delete",
	componentMigrate: "component_migrate",
	feedbackSubmit: "feedback_submit",
} as const;

export type ToolName = (typeof TOOL)[keyof typeof TOOL];

export const TOOL_NAMES = Object.values(TOOL) as ToolName[];
