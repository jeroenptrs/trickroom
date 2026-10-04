import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BOARD_GUIDANCE } from "./guidance";
import { designFileIdSchema } from "./tools/schemas";

// Steps every prompt shares. Prompts describe the flow; the authoring
// contract (core plus topics) carries the rules, so they are not repeated here.
const PROJECT_STEP =
	"Call 'getSelectedProject'. If no project is selected, call 'listProjects', then 'selectProject' with an entry's 'locationId'.";

const contractStep = (designFileId: string) =>
	`Call 'getDesignAuthoringContract' with designFileId "${designFileId}". The core has the design's revision and boards, its design system, the rules, and the topics to fetch when you need them (e.g. 'recipes', 'components', 'operations'). If its memoryNotes counts are non-zero, read those notes with 'listMemoryNotes' and 'getMemoryNote' and follow them.`;

const WRITE_STEP =
	"Use 'applyDesignOperations' for all steps of a change in one batch, with the core's revision as 'expectedRevision'. Dry-run a risky batch with 'validateOperationPlan', or one operation with 'validateOperation'. Pass each write's 'newRevision' to the next (revision chaining). On 'REVISION_MISMATCH', re-read the revision with 'listDesignFiles' and retry; never guess.";

const CHECK_STEP =
	"Fix the warnings each write returns. Call 'screenshotBoard' for each changed board at viewport mobile, tablet and desktop and inspect the returned PNG image blocks, then call 'validateDesignFile'.";

export const registerTrickroomPrompts = (server: McpServer) => {
	server.registerPrompt(
		"edit_design_file",
		{
			argsSchema: {
				designFileId: designFileIdSchema.describe("Design file UUID to edit."),
			},
		},
		({ designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Edit the Trickroom design file "${designFileId}".

1. **Project**: ${PROJECT_STEP}
2. **Contract**: ${contractStep(designFileId)}
3. **Structure**: Call 'readDesignGraph' for ids and parent/child relationships. Use bounded 'readSubtree' or 'readElement' only where you need detail.
4. **Plan**: Prefer a design system component ('components' topic), then a recipe ('addRecipe', 'recipes' topic), then 'addSubtree', over many 'addElement' calls. ${BOARD_GUIDANCE} For images or icons, find ids with 'listSystemAssets' or 'listSystemIcons' first. Dry-run a large inserted structure with 'validateSubtree'.
5. **Write**: ${WRITE_STEP}
6. **Check**: ${CHECK_STEP} Read back only the edited area unless more is needed.`,
					},
				},
			],
		}),
	);

	server.registerPrompt(
		"add_component_to_design",
		{
			argsSchema: {
				designFileId: designFileIdSchema,
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
						text: `Add registry content to design file "${designFileId}"${parentId ? ` under parent "${parentId}"` : " at the root"}.

1. **Project**: ${PROJECT_STEP}
2. **Contract**: ${contractStep(designFileId)} Fetch the 'components' or 'recipes' topic with name for the UI you are adding, or 'registry' for raw elements.
3. **Parent**: ${parentId ? `Call 'readElement' for "${parentId}" (or 'readDesignGraph') and confirm it is a branch element outside locked recipe or component structure, or a slot host.` : `Use 'parentId': null; a root insert creates a new board. ${BOARD_GUIDANCE}`}
4. **Insert** with the smallest fit: 'addSystemComponent' for a design system component, 'addRecipe' for recipe-backed UI, 'addSubtree' for a composed tree, 'copySubtree' to reuse an existing subtree, 'addElement' for one element. For image or icon elements, find ids with 'listSystemAssets' or 'listSystemIcons'. Dry-run uncertain inserts with 'validateOperation' or 'validateSubtree'.
5. **Write**: ${WRITE_STEP}
6. **Check**: Confirm the inserted region with 'readSubtree'. ${CHECK_STEP}`,
					},
				},
			],
		}),
	);

	server.registerPrompt(
		"refactor_design_structure",
		{
			argsSchema: {
				designFileId: designFileIdSchema.describe(
					"Design file UUID to refactor.",
				),
			},
		},
		({ designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Refactor the structure of design file "${designFileId}": several moves, additions, deletions or recipe changes.

1. **Project**: ${PROJECT_STEP}
2. **Contract**: ${contractStep(designFileId)}
3. **Graph first**: Call 'readDesignGraph' for structure and ids, then bounded 'readSubtree' only for affected regions.
4. **Use the specific operation** ('operations' topic): 'copySubtree', 'moveElement', 'deleteElement', 'detachRecipeInstance', 'updateRecipeInstance' for a stale recipe, 'updateRecipeControl' or 'updateElementProps' for recipe controls, and 'extractSubtree' to move a subtree into a new design file. Avoid deleting and rebuilding what a move or copy can do.
5. **Plan atomically**: Dry-run the whole plan with 'validateOperationPlan', then commit the same steps with 'applyDesignOperations' and the core's revision as 'expectedRevision': one write, one 'newRevision'. Chain it into any follow-up write; on 'REVISION_MISMATCH', re-read the revision with 'listDesignFiles' and resume the plan.
6. **Check**: ${CHECK_STEP}`,
					},
				},
			],
		}),
	);

	server.registerPrompt(
		"explain_design_file",
		{
			argsSchema: {
				designFileId: designFileIdSchema.describe(
					"Design file UUID to explain.",
				),
			},
		},
		({ designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Explain design file "${designFileId}" technically. Read only: do not write.

1. **Project**: ${PROJECT_STEP}
2. **Contract**: ${contractStep(designFileId)} Recorded intent and rationale in memory notes ground the explanation.
3. **Structure**: Call 'readDesignGraph', and bounded 'readSubtree' where you need detail.
4. **Vocabulary**: Use the 'recipes', 'components' and 'registry' topics (or 'listRegistries' and the registry component/recipe lists and describe tools) to explain the libraries, recipes and system components in use.
5. **Tokens and resources**: Call 'listDesignTokens' by domain, and 'findAssetUsage' / 'findIconUsage' when resource references matter. MCP never returns image or SVG bytes.
6. **Diagnostics**: Call 'validateDesignFile' and report structural, registry, recipe, component, token, asset and icon issues separately, including stale instances and missing resources.
7. **Visual review**: Call 'screenshotBoard' for relevant boards or 'screenshotNode' for focused regions, inspect the returned PNG image blocks, and keep visual observations apart from diagnostics.
8. **Synthesis**: Explain the design's purpose, structure, expansion points, broken references and visual findings.`,
					},
				},
			],
		}),
	);

	server.registerPrompt(
		"validate_design_changes",
		{
			argsSchema: {
				designFileId: designFileIdSchema.describe(
					"Design file UUID to validate.",
				),
			},
		},
		({ designFileId }) => ({
			messages: [
				{
					role: "user",
					content: {
						type: "text",
						text: `Validate design file "${designFileId}" after edits.

1. **Project**: ${PROJECT_STEP}
2. **Technical Validation**: Call 'validateDesignFile'. Write responses list only likely typos, so this is where the full issue set lives; add 'includeTokenDiagnostics: true' only when you need the custom-utility catalog.
3. **Analyze Issues by Category**: If 'valid' is false, group issues into structural, registry, recipe, component, token, asset and icon diagnostics. If the design is already clean, do not perform any unnecessary mutations.
4. **Targeted Re-Reads**: Use 'readDesignGraph' or bounded 'readSubtree' only where issues point to specific elements. The 'validation' and 'tokens' topics of 'getDesignAuthoringContract' explain the codes.
5. **Fix Deliberately**: Get the current revision from 'listDesignFiles', dry-run fixes with 'validateOperation' or 'validateOperationPlan', and commit them with 'applyDesignOperations'. Chain 'newRevision'; on 'REVISION_MISMATCH', re-read and retry.
6. **Final State**: Call 'validateDesignFile' again after fixes and confirm affected areas with scoped reads.
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
				designFileId: designFileIdSchema
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

1. **Project**: ${PROJECT_STEP}
2. **Create**: Call 'createDesignFile' with a clear name${systemName ? ` and systemName "${systemName}"` : " (omit systemName only when an unlinked design is intentional: a system cannot be linked via MCP afterwards)"}${designFileId ? ` and designFileId "${designFileId}"` : ""}. Keep the returned design id and 'newRevision'. The design starts with no boards.
3. **Contract**: Call 'getDesignAuthoringContract' with the new designFileId. Its core shows the linked design system (or 'getDesignSystemForDesignFile'). Only when a configured system is linked are 'listDesignTokens', 'listSystemIcons' and the 'components' topic useful. Read system and project memory notes when their counts are non-zero, and record the design's intent with 'addMemoryNote' once it takes shape.
4. **Build**: Create boards at the design root with 'parentId: null'; never wrap them in a shared layer. ${BOARD_GUIDANCE} Prefer system components and recipes ('addRecipe') to hand-built structures, and 'addSubtree' to many 'addElement' calls. Dry-run large structures with 'validateSubtree' or 'validateOperationPlan'.
5. **Write**: ${WRITE_STEP}
6. **Review**: ${CHECK_STEP} Report visual readiness only for what you inspected.`,
					},
				},
			],
		}),
	);

	server.registerPrompt(
		"add_media_or_icon",
		{
			argsSchema: {
				designFileId: designFileIdSchema.describe(
					"Design file UUID that will reference the resource.",
				),
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
						text: `Add or wire up images or icons for design file "${designFileId}"${systemName ? ` using design system "${systemName}"` : ""}.

1. **Project**: ${PROJECT_STEP}
2. **Contract**: ${contractStep(designFileId)} The 'resources' topic explains trickroom/asset and trickroom/icon elements.
3. **Design System**: ${systemName ? `Use systemName "${systemName}".` : "Use the design system from the contract core, or call 'getDesignSystemForDesignFile'."}
4. **Catalogs**: Call 'listSystemAssets' and 'listSystemIcons' with a query; 'describeAsset' / 'describeIcon' for details. MCP does not return raw image or SVG bytes.
5. **Register (if needed)**: When new files are required and policy allows, use 'addSystemAsset' or 'addSystemIconFolder', then list the catalog again.
6. **Insert or Update**: Use 'addElement', 'addSubtree' or 'updateElementProps' (batched with 'applyDesignOperations') with the catalog ids. ${WRITE_STEP}
7. **Check**: Call 'findAssetUsage' / 'findIconUsage' and 'validateDesignFile', and screenshot the affected board.`,
					},
				},
			],
		}),
	);

	server.registerPrompt(
		"reuse_design_subtree",
		{
			argsSchema: {
				sourceDesignFileId: designFileIdSchema.describe(
					"Source design file UUID containing the subtree to reuse.",
				),
				sourceElementId: z
					.string()
					.min(1)
					.describe("Root element ID of the subtree to copy or extract."),
				targetDesignFileId: designFileIdSchema.describe(
					"Target design file UUID for insertion.",
				),
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
						text: `Reuse subtree "${sourceElementId}" from design "${sourceDesignFileId}" in design "${targetDesignFileId}"${targetParentId ? ` under parent "${targetParentId}"` : " at the root"}.

1. **Project**: ${PROJECT_STEP}
2. **Locate**: Call 'readDesignGraph' on both designs to confirm ids, parents and insertion indices. Use bounded 'readSubtree' on "${sourceElementId}" only if the graph is not enough.
3. **Revisions**: Call 'listDesignFiles' for the target revision. For a cross-design copy, also keep the source design's revision as 'sourceExpectedRevision'.
4. **Dry-Run**: Call 'validateCopySubtree' with the source and target ids, "${sourceElementId}", target parent ${targetParentId ? `"${targetParentId}"` : "null"}, the index, 'expectedRevision' for the target and, for a cross-design copy, 'sourceExpectedRevision'.
5. **Execute**: Call 'copySubtree' with the same fields; it returns the 'idMap' of old to new ids. Use 'extractSubtree' instead when the goal is a new design file. Chain 'newRevision' into follow-up edits.
6. **Check**: Call 'validateDesignFile' on the target design, confirm the inserted region with 'readSubtree', and screenshot it.`,
					},
				},
			],
		}),
	);
};
