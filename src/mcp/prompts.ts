import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BOARD_GUIDANCE } from "./guidance";

export const registerTrickroomPrompts = (server: McpServer) => {
	server.registerPrompt(
		"edit_design_file",
		{
			argsSchema: {
				designFileId: z.string().uuid().describe("Design file UUID to edit."),
			},
		},
		({ designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `I need to edit the Trickroom design file "${designFileId}". Please guide me through a safe edit workflow:

1. **Select MCP Project Scope**: Call 'getSelectedProject'. If no project is selected, call 'listProjects' and then 'selectProject' with a known 'locationId' from each listProjects entry (not just 'projectId') before any writes.
2. **Read Current State**: Call 'listDesignFiles' to get the current 'revision', counts, and design metadata. Also call 'listMemoryNotes' with 'scope { kind: "design", designFileId }' (and the linked system + project scopes) to load steering notes, intent, and constraints before changing anything.
3. **Load Authoring Contract**: Call 'getDesignAuthoringContract' with 'designFileId' once before planning mutations.
4. **Understand Structure**: Call 'readDesignGraph' for parent/child relationships, element IDs, and addresses. Use 'readElement' or bounded 'readSubtree' only for local detail where the graph is insufficient.
5. **Plan Registry Content**: If adding UI, use 'listRegistryComponents', 'listRegistryRecipes', 'describeRegistryComponent', and 'describeRegistryRecipe'. Prefer 'addRecipe' or 'addSubtree' for structured UI instead of hand-assembling many nodes with repeated 'addElement' calls. ${BOARD_GUIDANCE}
6. **Inspect Resources**: If touching assets or icons, call 'listSystemAssets' and/or 'listSystemIcons' (and 'describeAsset' / 'describeIcon' as needed) before referencing resource-backed elements.
7. **Dry-Run Uncertain Writes**: Use 'validateOperation' before risky single mutations. For larger multi-step refactors, use 'validateOperationPlan'; for larger inserted structures, use 'validateSubtree' or 'validateCopySubtree' before committing.
8. **Execute Safely**:
   - For multi-step edits in one revision, use 'validateOperationPlan' then 'applyDesignOperations' with the same operation list and starting revision.
   - For single mutations, use the 'revision' from step 2 as 'expectedRevision'.
   - For every SUBSEQUENT mutation, you MUST use the 'newRevision' returned by the previous successful tool call (revision chaining).
   - If a tool returns 'REVISION_MISMATCH', do NOT guess. Call 'listDesignFiles' again to get the current revision, then retry with the updated 'expectedRevision'.
9. **Validate & Verify**: Write responses are compact by default — error-severity issues, a 'warningCount', and likely-typo warnings (unknown Tailwind utilities or tokens) on the elements the write touched. Fix typo warnings immediately. When 'warningCount' is non-zero and you need the rest, pass 'response: { includeWarnings: true }' (add 'warningScope: "file"' and/or 'includeTokenDiagnostics: true' to widen) on any write tool, or call 'validateDesignFile' (supports 'includeTokenDiagnostics'). Confirm only the edited area with 'readElement' or bounded 'readSubtree' unless a broader read-back is explicitly necessary.`,
					},
				},
			],
		}),
	);

	server.registerPrompt(
		"add_component_to_design",
		{
			argsSchema: {
				designFileId: z.string().uuid().describe("Design file UUID."),
				parentId: z
					.string()
					.optional()
					.describe("Target parent element ID. Omit to add at root."),
			},
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
5. **Parent Check**: ${parentId ? `Call 'readElement' for "${parentId}" (or confirm via 'readDesignGraph')` : "If 'parentId' is provided, call 'readElement' or 'readDesignGraph'"} to verify the target parent is a 'branch' role element. If adding at the root, use 'parentId': null; a root insert creates a new board. ${BOARD_GUIDANCE}
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

	server.registerPrompt(
		"refactor_design_structure",
		{
			argsSchema: {
				designFileId: z
					.string()
					.uuid()
					.describe("Design file UUID to refactor."),
			},
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

	server.registerPrompt(
		"explain_design_file",
		{
			argsSchema: {
				designFileId: z
					.string()
					.uuid()
					.describe("Design file UUID to explain."),
			},
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
2. **Metadata, Memory & Graph**: Call 'listDesignFiles' for revision and counts, and 'listMemoryNotes' with 'scope { kind: "design", designFileId }' (plus linked system + project scopes) to ground the explanation in recorded intent and rationale. Then call 'readDesignGraph' for structure, parent/child relationships, and element IDs. Use bounded 'readSubtree' only where local detail is needed.
3. **Authoring Contract**: Call 'getDesignAuthoringContract' to summarize writable vs system-owned props, composition rules, and mutation constraints.
4. **Registry & Recipes**: Use 'listRegistries', registry component/recipe lists, and describe tools to explain which libraries, components, and attached recipes are in use.
5. **Assets & Icons**: Call 'getDesignSystemForDesignFile', then 'listSystemAssets', 'listSystemIcons', and 'findAssetUsage' / 'findIconUsage' when resource references matter.
6. **Tokens**: Call 'listDesignTokens' and summarize token domains (not only color) available to the linked design system.
7. **Validation & Diagnostics**: Call 'validateDesignFile' and report structural, registry, recipe, token, asset, and icon issues separately—including stale attached recipes or missing resources.
8. **Visual Review**: Call 'screenshotBoard' for relevant boards or 'screenshotNode' for focused regions, inspect the returned PNG image blocks, and distinguish visual observations from structural diagnostics.
9. **Synthesis**: Explain the design's purpose, expansion points, broken references, and any visual findings. Raw catalog asset/image/SVG bytes are still not returned by resource discovery tools.`,
					},
				},
			],
		}),
	);

	server.registerPrompt(
		"validate_design_changes",
		{
			argsSchema: {
				designFileId: z
					.string()
					.uuid()
					.describe("Design file UUID to validate."),
			},
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
2. **Technical Validation**: Call 'validateDesignFile' (write responses are minimal by default, so this is where the full issue set lives; add 'includeTokenDiagnostics: true' only when you need the custom-utility catalog).
3. **Analyze Issues by Category**: If 'valid' is false, group issues into structural, registry, recipe, token, asset, and icon diagnostics. If the design is already clean, do not perform any unnecessary mutations.
4. **Targeted Re-Reads**: Use 'readDesignGraph' or bounded 'readSubtree' only where reported issues point to specific elements or subtrees.
5. **Execute Fixes Deliberately**:
   - Start with 'listDesignFiles' for the current 'revision' when mutations are required.
   - Dry-run fixes with 'validateOperation' (or subtree/copy validators) where possible before committing.
   - Pass the current revision as 'expectedRevision' to mutation tools and chain 'newRevision' across multiple fixes.
   - If a fix returns 'REVISION_MISMATCH', re-read metadata and retry with the new revision.
6. **Final State Sync**: Call 'validateDesignFile' again after fixes, then confirm affected areas with scoped reads.
7. **Visual Review**: Call 'screenshotBoard' or 'screenshotNode' for the changed regions and inspect the returned PNG image blocks.
8. **Final Report**: Separate structural diagnostics from visual observations and only claim visual or layout readiness for regions actually inspected.`,
					},
				},
			],
		}),
	);

	server.registerPrompt(
		"create_design_file_from_brief",
		{
			argsSchema: {
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
3. **Resolve Linked System**: Call 'getDesignSystemForDesignFile' on the new design. Only when a configured system is linked should you call system-scoped tools such as 'listDesignTokens', 'listSystemAssets', or 'listSystemIcons'. When a system is linked, call 'listMemoryNotes' with 'scope { kind: "system", systemName }' (and the project scope) to honor recorded usage conventions and constraints; record new design intent with 'addMemoryNote' under 'scope { kind: "design", designFileId }' once the design takes shape.
4. **Load Authoring Contract**: Call 'getDesignAuthoringContract' for the new design file before planning content.
5. **Build with Structure**: Create boards at the design root by passing 'parentId: null'; never wrap them in a shared top-level layer. ${BOARD_GUIDANCE} Prefer 'addRecipe' and 'addSubtree' over many piecemeal 'addElement' calls. Use 'listRegistryRecipes' and describe tools to pick appropriate recipes.
6. **Dry-Run Inserts**: Call 'validateSubtree' (or 'validateOperation' for single inserts) before committing larger structures.
7. **Execute with Revision Chaining**: Use 'expectedRevision' from creation (or the latest 'newRevision') for each write.
8. **Validate & Review**: Call 'validateDesignFile' on the finished design, then call 'screenshotBoard' for each relevant board (at 'mobile', 'tablet', and 'desktop' viewports when the screen should be responsive) and inspect the returned PNG image blocks before reporting visual readiness.`,
					},
				},
			],
		}),
	);

	server.registerPrompt(
		"add_media_or_icon",
		{
			argsSchema: {
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

	server.registerPrompt(
		"reuse_design_subtree",
		{
			argsSchema: {
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
   - Use 'copySubtree' with the same revision fields as the dry-run (target 'expectedRevision'; include 'sourceExpectedRevision' for cross-file copies). The response always returns the 'idMap' of old->new IDs; it is minimal otherwise — pass 'response: { includeWarnings: true }' (and 'includeTokenDiagnostics: true') only if you need diagnostics on the inserted subtree.
   - Use 'extractSubtree' instead when the goal is a new standalone design file cloned from the source subtree.
7. **Revision Chaining**: Pass 'expectedRevision' on the target; chain 'newRevision' for any follow-up edits.
8. **Validate & Verify**: Call 'validateDesignFile' on the target design and confirm the inserted region with bounded 'readSubtree'.`,
					},
				},
			],
		}),
	);
};
