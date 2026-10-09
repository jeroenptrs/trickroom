# Agents And MCP

Trickroom includes a stdio MCP server so agents can read and change design files through structured tools instead of raw file edits. Coding agents are its main users, so there are only 23 tools in a few families, one write tool for design content, a guide the agent reads once per session, and a way for agents to report friction with the tools themselves (`feedback_submit`).

## Start MCP

```sh
trickroom mcp
```

Start it from the project root. When that folder has an MCP-enabled `.trickroom/config.json`, the session starts on that project; otherwise it starts without one and the agent selects a project with `project_select`. The command takes no positional arguments.

The project must enable MCP:

```json
{
  "name": "Example App",
  "mcp": {
    "enabled": true
  }
}
```

The server sends instructions at initialize: what Trickroom is, the tool families, the session-start recipe and the edit loop (under 2,048 characters, the limit clients keep).

## Session Flow

1. `project_list` shows the session's project (or `project_select` switches to another one).
2. `memory_read({ designFileId })` indexes the notes on the project, the design's linked design system and the design; read the relevant ones with `noteIds`.
3. `guide({ designFileId })` returns the core: model, rules, workflow, an example batch, and this design's revision, boards and design system. Fetch topics when the task needs them.
4. Loop: `design_read` the area you change, `design_apply` one batch with `expectedRevision` (checked per board: see [Revisions](#revisions)), fix the warnings it returns, `design_screenshot` the changed boards at several viewports in one call, `design_validate` before handing off, and `editor_focus` to show the human what changed. When the human says "this", call `editor_context`.
5. When the change touches a design system or the code that uses it, `lint({ check: true })` before handing off: `fail` names every number that got worse than the committed baseline. Run `lint` without `check` only when asked to record a new baseline.

## Tools

R = read-only, W = writes. Reads and writes are separate tools because client permission rules key on the tool name. `tools/list` returns the tools in this order.

| Tool | R/W | Purpose | Key parameters |
| --- | --- | --- | --- |
| `project_list` | R | The session's project with governance, systems and a project memory summary, and every registered project whose folder still exists (`selected`, `appActive`). Locations of deleted worktrees and folders are left out; selecting one by `locationId` fails with `MISSING_PROJECT_LOCATION`. | `project` to describe another registered project |
| `project_select` | W | Make a project the session's project; a path registers it first. | `locationId` \| `projectId` \| `path` |
| `guide` | R | The authoring guide: a core, or topics. Replaces the authoring contracts and the registry tools. | `topic`, `designFileId`, `systemName`, `library`, `name` |
| `design_list` | R | Design files with revision, boards (with their revisions), layer count, memory note count and storage warnings, and the linked design systems. | |
| `design_read` | R | A design or one board (bounded tree; a board read reads only that board's file), one element's subtree, or a flat outline. | `designFileId`, `boardId` \| `elementId`, `view`, `depth`, `maxNodes`, `allowLarge`, `detail` |
| `design_apply` | W | The one write tool for design content: ordered operations, validated together, one write. | `designFileId`, `expectedRevision`, `operations`, `response` |
| `design_validate` | R | Validate a whole design, or dry-run operations against a revision. | `designFileId`, `operations`, `expectedRevision`, `response` |
| `lint` | W | Lint a design system against its code and designs, ratchet against the committed report, and write the report. | `check`, `system`, `response` |
| `design_create` | W | Create a design, empty or from a copy of an existing element. | `name`, `systemName`, `designFileId`, `from` |
| `design_screenshot` | R | Render boards, elements or a system component and return PNG images. | `boardId`, `elementId`, `component`, `viewport`, `theme`, `scale`, `maxHeight` |
| `design_export` | W | Write boards to disk as HTML or PNG, or write or check the project's component variants files. | `format`, `designFileId`, `destinationDir`, `boardIds`; variants: `check`, `source` |
| `editor_context` | R | What the human has open and selected in the Trickroom editor. | |
| `editor_focus` | W | Point the human's editor at a design, board or layer. | `designFileId`, `boardId`, `elementId` |
| `memory_read` | R | Memory note index, note bodies, or reference targets. | `scope` \| `designFileId`, `noteIds`, `referenceType` |
| `memory_write` | W | Add, update or delete one memory note. | `action`, `scope`, `noteId`, `expectedRevision`, `edits` |
| `system_read` | R | Tokens, assets, icons and resource usage of a design system. | `view`, `systemName` \| `designFileId`, `id`, `domain`, `query`, `limit`, `offset` |
| `system_update` | W | Register or remove assets and icon folders. | `action`, `systemName`, `assetId`, `name`, `sourcePath`, `folderPath` |
| `component_read` | R | System component index, one component's interface, or stale instances. | `view`, `componentId`, `include`, `source` |
| `component_draft_create` | W | Create a component draft, or extract one from a design layer (optionally publishing it and replacing the layer with an instance). | `systemName`, `expectedRevision`, `slug`, `name`, `draft` \| `from` |
| `component_draft_update` | W | Replace parts of a component draft, or change its name, group or description (applies at once). | `componentId`, `expectedRevision`, `name`, `group`, `description`, `root`, `slots`, `variants`, `overrideTargets` |
| `component_publish` | W | Publish a draft as the component's current version. | `componentId`, `expectedRevision` |
| `component_delete` | W | Delete a component (kept apart from publish: it is destructive). | `componentId`, `expectedRevision` |
| `component_migrate` | W | Move stale instances to the current version, one or in bulk. | `rootElementId` + `designFileId` + `expectedRevision`, or bulk filters |
| `feedback_submit` | W | Report friction with the tools to the Trickroom developers; stored locally with the session's recent calls. See [Feedback](#feedback). | `summary`, `category`, `severity`, `tools`, `details`, `expected`, `suggestion` |

Every project-scoped tool (all but `feedback_submit`) also takes an optional `project: { locationId }` (or `{ projectId }`) to work in another registered project without switching the session.

### Annotations And Client Hints

| Tool | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |
| --- | --- | --- | --- | --- |
| reads (`project_list`, `guide`, `design_list`, `design_read`, `design_validate`, `editor_context`, `memory_read`, `system_read`, `component_read`) | true | | | false |
| `design_screenshot` | true | | | true (renders may load remote fonts) |
| `project_select`, `editor_focus`, `lint` | false | false | true | false |
| `design_apply`, `memory_write`, `system_update`, `component_delete` | false | true | false | false |
| `design_create`, `component_draft_create`, `component_draft_update`, `component_publish`, `component_migrate`, `feedback_submit` | false | false | false | false |
| `design_export` | false | true (overwrites files of the same name; variants replace only files with a Trickroom header) | false | true (HTML loads React and Base UI from esm.sh) |

`_meta` hints for clients that defer tool schemas:

- `anthropic/alwaysLoad`: `project_list`, `guide`, `design_read`, `design_apply` (about 10k characters together).
- `anthropic/searchHint`: keywords on tools whose names miss what an agent searches for (for example "screenshot image png render" on `design_screenshot`, "selection selected layer" on `editor_context`, "feedback report bug issue" on `feedback_submit`).
- `anthropic/maxResultSizeChars`: `guide` (60,000; topics are requested on purpose) and `design_read` (150,000; reads past the default bounds need `allowLarge`).

Descriptions stay under 2,048 characters (the longest, `component_draft_create`, is 1,100); a test checks every tool. `tools/list` is about 58,300 characters (the always-loaded four, about 10,300; `feedback_submit`, about 1,850).

### Tool Groups

The app's MCP settings switch tools on and off by group. The eight group ids are persisted in user settings and unchanged:

| Group | Tools |
| --- | --- |
| `projects` | `project_list`, `project_select`, `editor_context`, `editor_focus`, `feedback_submit` |
| `designRead` | `design_list`, `design_read`, `design_screenshot`, `design_export` |
| `designWrite` | `design_apply`, `design_create` |
| `designValidation` | `design_validate`, `lint` |
| `registry` | `guide` |
| `designSystems` | `system_read`, `system_update` |
| `systemComponents` | `component_read`, `component_draft_create`, `component_draft_update`, `component_publish`, `component_delete`, `component_migrate` |
| `memory` | `memory_read`, `memory_write` |

`feedback_submit` is in `projects`, the group a session cannot work without (it holds `project_list` and `project_select`), so feedback stays available whenever Trickroom tools are. Switching `projects` off hides it too.

## Migrating From The Previous Tools

This release replaced the 74 previous tools with 22 (`feedback_submit`, added later, is the 23rd). There are no aliases: calls to old names fail with "Tool not found". Batch operations kept their names (`addElement`, `copySubtree`, ...): they are now operations of `design_apply`.

| Old tool | New tool |
| --- | --- |
| `listProjects`, `getSelectedProject`, `trickroom_project_info` | `project_list` |
| `getActiveProject` (deprecated) | removed; use `project_list` |
| `resolveProject` | `project_list({ project: { locationId } })` |
| `selectProject` | `project_select({ locationId \| projectId })` |
| `registerProject`, `openProject` (deprecated) | `project_select({ path })`, which registers and selects |
| `listDesignFiles` | `design_list` |
| `getDesignSystemForDesignFile` | `design_list` (`systems`), or `system_read({ designFileId })` |
| `readDesignFile` | `design_read({ designFileId, boardId? })` |
| `readSubtree` | `design_read({ designFileId, elementId })` |
| `readElement` | `design_read({ designFileId, elementId, depth: 0 })` |
| `readDesignGraph` | `design_read({ designFileId, view: "outline" })` |
| `validateDesignFile` | `design_validate({ designFileId })` |
| `validateOperation`, `validateOperationPlan` | `design_validate({ designFileId, expectedRevision, operations })` |
| `validateSubtree` | `design_validate` with an `addSubtree` operation |
| `validateCopySubtree` | `design_validate` with a `copySubtree` operation |
| `applyDesignOperations` | `design_apply` |
| `addElement`, `addRecipe`, `addSubtree`, `addSystemComponent`, `updateSystemComponentInstance`, `detachSystemComponent`, `updateRecipeControl`, `updateRecipeInstance`, `updateElementProps`, `updateElementText`, `moveElement`, `deleteElement`, `copySubtree`, `detachRecipeInstance`, `renameDesignFile` | `design_apply` with one operation of that name |
| `createDesignFile` | `design_create({ name })` |
| `extractSubtree` | `design_create({ from: { designFileId, elementId } })` |
| `exportDesignHtml` | `design_export` (`format: "html"`, the default) |
| `screenshotBoard` | `design_screenshot({ boardId \| component })` |
| `screenshotNode` | `design_screenshot({ elementId })` |
| `screenshotBoard` with `outputPath` | `design_export({ format: "png" })` |
| `getDesignAuthoringContract` | `guide` |
| `getSystemComponentAuthoringContract` | `guide({ topic: "component-authoring" })`; its topics are `component-template`, `component-slots`, `component-variants`, `component-overrides`, `component-examples` |
| `listRegistries`, `listRegistryComponents`, `describeRegistryComponent` | `guide({ topic: "registry", library?, name? })` |
| `listRegistryRecipes`, `describeRegistryRecipe` | `guide({ topic: "recipes", library?, name? })` |
| `listDesignTokens` | `system_read({ view: "tokens" })` |
| `listSystemAssets`, `describeAsset` | `system_read({ view: "assets", id? })` |
| `listSystemIcons`, `describeIcon` | `system_read({ view: "icons", id? })` |
| `findAssetUsage`, `findIconUsage` | `system_read({ view: "asset_usage" \| "icon_usage", id? })` |
| `addSystemAsset`, `removeSystemAsset`, `refreshSystemAssetMetadata` | `system_update({ action: "add_asset" \| "remove_asset" \| "refresh_asset" })` |
| `addSystemIconFolder`, `removeSystemIconFolder` | `system_update({ action: "add_icon_folder" \| "remove_icon_folder" })` |
| `listSystemComponents` | `component_read` (view `index`) |
| `describeSystemComponent` | `component_read({ componentId })` (view `describe`) |
| `listStaleSystemComponentUsages` | `component_read({ view: "stale" })` |
| `createSystemComponentDraft` | `component_draft_create` |
| `updateSystemComponentDraft` | `component_draft_update` |
| `publishSystemComponent` | `component_publish` |
| `deleteSystemComponent` | `component_delete` |
| `migrateSystemComponentInstance` | `component_migrate({ designFileId, expectedRevision, rootElementId })` |
| `bulkMigrateSystemComponentUsages` | `component_migrate` without `rootElementId` |
| `listMemoryNotes` | `memory_read({ scope? \| designFileId? })` |
| `getMemoryNote` | `memory_read({ scope, noteIds })` |
| `listReferenceTargets` | `memory_read({ scope, referenceType })` |
| `addMemoryNote`, `updateMemoryNote`, `deleteMemoryNote` | `memory_write({ action: "add" \| "update" \| "delete" })` |
| (new) | `editor_context`, `editor_focus` |

Behaviour that changed with the fold:

- Single edits share the batch's checks and response. A write is refused only for errors it adds (`PLAN_LEAVES_ERRORS`); errors the design already had are counted in `preExistingErrorCount` and do not block it.
- `copySubtree` takes the batch step's parameters: the edited design is the target (`designFileId`), `sourceDesignFileId` defaults to it, and `includeIdMap: true` returns the id map.
- `updateRecipeControl` takes any element id in the recipe instance (`$step:N` works) or the instance id as `instanceId`; `path` defaults to that element's template path. `elementId` is accepted as an alias.
- `design_create` returns an `{ id, name, revision, updatedAt }` header and its boards as compact nodes, not a full element tree; extracting an element sends `resources/list_changed` like an empty create.
- `design_read` outlines no longer carry JSON Pointer addresses; `detail: "full"` replaces `includeProps`.
- Saving PNGs moved from the screenshot tool to `design_export`, so screenshots are read-only.
- Results are one minified JSON text block; `structuredContent` is no longer repeated (no tool declares an `outputSchema`).
- Audit entries written from now on carry the new tool names; existing entries keep the old ones.

## Governance

MCP policy comes from `.trickroom/config.json`:

```ts
type McpPolicy = {
  mode: "read-only" | "read-write";
  allowedDesignFileIds: ReadonlySet<string> | null;
  allowedComponents: ReadonlySet<string> | null;
  auditLog: boolean;
};
```

Defaults: `read-write`, every design file, every component, no audit log.

```json
{
  "name": "Example App",
  "mcp": {
    "enabled": true,
    "mode": "read-only",
    "allowedDesignFileIds": ["00000000-0000-4000-8000-000000000001"],
    "allowedComponents": ["trickroom/container", "trickroom/text"],
    "auditLog": true
  }
}
```

- Reads enforce `allowedDesignFileIds`. The guide's registry and recipes topics list only allowed components.
- Writes enforce `mode`, `allowedDesignFileIds` and `allowedComponents` (every component a step inserts, moves, copies or expands). `design_create` needs a `designFileId` from the allowlist when one is configured.
- `design_screenshot` works in read-only mode; `design_export` does not.
- With `auditLog`, design writes, creates, migrations, memory writes, screenshots and exports append to `.trickroom/audit-log.jsonl` (see [Audit Logging](#audit-logging)).

## What MCP Cannot Do

Through MCP, agents cannot edit `.trickroom/config.json`, add or remove design systems, sync Tailwind token snapshots, edit source CSS or application code, or change built-in registry definitions.

## Responses

### One JSON Text Block

Every result except screenshots is one minified JSON text block. Screenshots return a short text block and the images.

The full project block (`projectId`, `locationId`, `projectRoot`, `name`) comes back from `project_list` and `project_select`; every other result carries `project: { projectId, locationId }`.

### Compact Nodes

Reads, `design_create`, `component_migrate` and `editor_context` describe elements as compact nodes:

- `id`, `name` (left out when it equals the component's default label), `component` (`"<library>/<component>"`, with the `trickroom/` prefix dropped), `className` when set, `text` (cut at 160 characters, with `textLength` when cut), and `props` that are neither Trickroom markers nor registry defaults.
- Instances collapse into short summaries: `systemComponent` (id, variants, overrides) on a component root, `recipe` (`id`, `instanceId`, and `state` when not valid) on a recipe root, `recipe: { instanceId, path }` on other recipe-owned nodes, and `slot` on slot hosts.
- `detail: "full"` returns `id`, every stored prop (markers included) and the full text instead.

Bounded reads take elements breadth first, so a node budget never spends itself on the first branch. A node whose descendants were cut carries `more` (the number of unread elements), and the `read` block says what was returned (`depth`, `maxNodes`, `returnedNodeCount`, `omittedNodeCount`, `truncated`) and, when cut, `next`: the exact follow-up call (`{ tool: "design_read", args }`).

### Writes: `design_apply`

```json
{
  "status": "success",
  "valid": true,
  "project": { "projectId": "proj_…", "locationId": "loc_…" },
  "designFileId": "…",
  "operationCount": 3,
  "newRevision": "r2.…",
  "created": [
    { "step": 0, "id": "…", "slots": { "trigger": "…", "content": "…" } },
    { "step": 1, "id": "…", "idMap": { "body": "…", "heading": "…" } }
  ],
  "issues": [],
  "warningCount": 2,
  "warnings": [
    { "code": "UNKNOWN_COLOR_TOKEN", "message": "Class \"bg-white\" references unavailable color token \"white\".", "elementIds": ["…"] }
  ]
}
```

- `created`: one entry per inserting step with the ids the caller could not know: the root `id`, the `idMap` of `addSubtree` tempIds, recipe `slots` (or `recipes` when a step inserted several), `nodeCount` for copies, and the copy's `idMap` when the step set `includeIdMap`. Updates, moves and deletes add nothing.
- `deletedCount`: elements removed by the plan.
- `issues`: error issues the plan introduced (empty on success). `preExistingErrorCount`: errors the touched boards already had, which do not block writes.
- Only the boards the plan touched are diagnosed: the boards whose content changed and the boards holding elements it touched without changing them. Issues on other boards are what they were before the batch; `design_validate` checks the whole design.
- `warningCount` counts warnings on the elements the plan touched plus file-level warnings. `warnings` lists only likely typos (`UNKNOWN_TAILWIND_UTILITY`, `UNKNOWN_*_TOKEN`) and `MISSING_RENDERER` on touched elements, grouped by code and offending class. Fix them: the first are almost always class typos, and a missing renderer means screenshots show a placeholder.
- `response: "full"` returns every warning on touched elements ungrouped, `tokenDiagnostics`, and `steps` (each step's summary, ids and recipe expansions) instead of `created`.

A failing step stops the plan and nothing is written. A step that fails while a board changed since `expectedRevision` (for example an element another writer removed) reports `REVISION_MISMATCH` naming those boards instead of the lookup error; a batch that changes a board another writer changed is refused the same way before it is diagnosed. The result has `isError: true`, `status: "INVALID_OPERATION"`, `failedStepIndex`, `failedOperation`, `code`, `message` and the error's hints; `INVALID_OPERATION_PARAMETERS` adds the operation's `expectedParameters` signature and any `unknownParameters`. A plan whose result would have new error issues is refused with `code: "PLAN_LEAVES_ERRORS"` and those `issues`.

A batch that renames the design sends `resources/list_changed`.

### Validation: `design_validate`

All validation results share one shape:

```json
{
  "status": "success",
  "valid": true,
  "designFileId": "…",
  "revision": "r2.…",
  "summary": { "errors": 1, "warnings": 3, "codes": { "design.unknown-class-token": 3, "design.unknown-variant-value": 1 } },
  "issues": [],
  "warnings": [{ "code": "…", "message": "…", "elementIds": ["…"], "count": 9 }]
}
```

`issues` lists every error; `warnings` are grouped by code and class with at most five element ids per group (`count` gives the total). `response: "full"` lists warnings ungrouped and adds `tokenDiagnostics` (the custom-utility catalog), and for a file the root ids, design system and registry component usage.

- Without `operations`: the whole file, including payload integrity (a design with an unsupported version reports `UNSUPPORTED_DESIGN_VERSION`), duplicate ids, registry and design-system references, asset and icon ids, recipe instances, and class tokens.
- With `operations` and `expectedRevision`: a dry run of the same steps `design_apply` takes, with the same executor. It adds `operationCount`, `predicted` (what each step would do: insertions report where and `nodeCount`, without generated ids) and `deletedCount`, and scopes warnings to the touched elements. A failing step reports `status: "INVALID_OPERATION"`, `failedStepIndex` and `failedOperation` as a normal result. Only the boards the steps touch are diagnosed. The revision check is the write's: a dry-run based on an older revision passes when the boards it changes did not change since; otherwise it reports `status: "REVISION_MISMATCH"` with `currentRevision`, `staleBoards` and `next`, like the write.

Both modes run the linked system's design-side lint rules ([Design System Lint](lint.md#design-validation)) with its `lint.json`, so a kind it disables is skipped, its severity applies and its options (such as an allow-list of classes) are honoured. A lint finding is an issue whose `code` is the rule kind id:

- `design.unknown-class-token` (warning by default): the class and token checks. The specific check is in `check`: `UNKNOWN_TAILWIND_UTILITY` (Tailwind cannot emit the class; checked when the system CSS loads), `UNKNOWN_COLOR_TOKEN`, `UNKNOWN_SPACING_TOKEN`, `UNKNOWN_FONT_TOKEN`, `UNKNOWN_TEXT_TOKEN`, `UNKNOWN_RADIUS_TOKEN`, `UNKNOWN_SHADOW_TOKEN`, `UNKNOWN_TAILWIND_TOKEN`, and `OUT_OF_SYSTEM_*` for arbitrary values that bypass the system. With `className`, `classToken`, `token`, `domain` and, for likely typos, `suggestions` with the nearest valid class, keeping variants, `!` and `/opacity` (`md:itmes-center` → `md:items-center`).
- `design.non-canonical-class` (warning by default): a class Tailwind writes differently (`bg-[#FFF]`, `[&:has(.x)]:p-2`); with `className`, `classToken`, `canonical` and `suggestions` holding the canonical class (`bg-white`, `has-[.x]:p-2`), a drop-in replacement.
- `design.unknown-variant-value` (error by default): an instance records a variant value or axis its component version does not have; with `component`, `axis`, `value`, `version` (and `currentVersion` when the instance is pinned to an older one).
- `design.design-only-class-target` (error by default): a component the checked boards place has variant classes on a design-only node; a file-level issue with `component`.

A finding at severity `info` is not an issue. When `lint.json` is invalid or cannot be read the defaults apply and an `INVALID_LINT_CONFIG` warning says why. `design_apply` and `design_create` still report the class checks under their own codes (`UNKNOWN_COLOR_TOKEN`, …), without `lint.json`.

### Errors

Tool errors are JSON with `isError: true`:

- `REVISION_MISMATCH`: `designFileId`, `currentRevision`, `expectedRevision`, `staleBoards` (id and name of each board your call changes that changed since your revision, or, when a step failed on a stale view, every board that changed; `deleted: true` when another writer removed it), `manifest: true` / `order: true` when your call changes the design's name or settings or reorders boards and those changed too, a `message`, and `next`: the reads that recover (one `design_read` with `boardId` per stale board, or the whole design when the manifest or order is stale). See [Revisions](#revisions).
- `SOURCE_REVISION_MISMATCH` (a `copySubtree` step from another design): `currentSourceRevision`, `sourceExpectedRevision`, `staleSourceBoard` (the board copied from) and `next` (a `design_read` of that board).
- `POLICY_DENIED`: `code` (`MCP_READ_ONLY`, `MCP_DESIGN_FILE_NOT_ALLOWED`, `MCP_COMPONENT_NOT_ALLOWED`) and the `governance` summary.
- `INVALID_OPERATION`: `code`, `message` and hints next to them:
  - `DESIGN_NOT_FOUND`: `availableDesigns` (id, name) in small projects, otherwise the closest ids in `suggestions`.
  - `BOARD_NOT_FOUND` and `NO_MATCHING_BOARDS`: `availableBoards` (id, name) and `availableBoardIds`. A nested element passed as a board says to use `elementId`.
  - `ELEMENT_NOT_FOUND`, `PARENT_NOT_FOUND`, `NODE_NOT_FOUND`: `missingElementId`, `truncatedIdMatches` (full ids starting with the given value), `nameMatches` (elements whose layer name equals it), and `availableBoardIds` when nothing matched. In a batch, a bare tempId gets `suggestedStepReferences`.
  - Unknown registry library, component or recipe: `suggestions`, the available names in small registries, `recipeSuggestions` when a recipe name was used as a component.
  - `UNKNOWN_SYSTEM_COMPONENT`, `UNKNOWN_DESIGN_SYSTEM`, `UNKNOWN_TOKEN_DOMAIN`: `suggestions` and the available ids, systems or domains.
  - `DESIGN_SYSTEM_REQUIRED`: a system tool needs `systemName` because the project has several systems and no default (`availableSystems`). `DESIGN_NOT_LINKED_TO_SYSTEM`: the design passed as `designFileId` has no system.
  - `UNKNOWN_TOPIC`: `availableTopics`.
- Invalid arguments fail before the tool runs with one line per problem: `designFileId: required string, missing.`, `boardID: unknown parameter. Did you mean "boardId"?`, enum values with the nearest one, union shapes.

The second consecutive failure of the same tool in a session (an error result or invalid arguments) also carries `feedbackHint`, pointing at `feedback_submit`: a field of the JSON payload, or a last line of an invalid-arguments message. It is added once per tool per session.

Statuses of `editor_context` and `editor_focus` other than `ok` are not errors (see [Editor Tools](#editor-tools)).

## Projects

`project_list` returns `selected` (the session's project, or `null` with a hint to call `project_select`), its `governance` mode, `defaultSystemId`, `configuredSystems` (id, name, CSS entry), a project `memory` summary with a hint when notes exist, and `projects`: every registered location with `projectId`, `locationId`, `projectRoot`, `name`, `lastOpenedAt`, and `selected` / `appActive` flags. `appActive` is the project the browser app last opened; it does not move MCP sessions. Pass `project: { locationId }` to describe another registered project without selecting it.

`project_select` takes a `locationId` (preferred) or `projectId` from `project_list`, or the `path` of a local project root, which it registers first. Passing both or neither is an `INVALID_OPERATION_PARAMETERS` error; a folder without MCP enabled returns `MCP_DISABLED`. It returns the project with the same information as `project_list` and sends `resources/list_changed`.

## Designs

`design_list` lists design files: `id`, `name`, `revision`, `systemId` (left out when it is the project's `defaultSystemId`), `layersCount`, `modifiedAt` (when the design last changed: its recorded `updatedAt`, or the newest file time for designs that have none), `boards` (id, name, revision), `memoryNotes` when the design has notes, a `diagnostic` for unreadable files and `warnings` for storage problems that do not stop a design from opening (`LEGACY_DESIGN_FILE_PRESENT`: an older single-file copy sits next to the design's folder; see [Files And Safety](./project-files.md#design-file-versions)). It reads the design file service's summaries, which are cached on the fingerprint of each design's files, so a repeat listing only stats files that did not change. `systems` describes each linked design system: `name`, `cssPath`, `tokens` (`syncedAt`, `reviewRequired` when set) or `null` when no snapshot is stored, and `memoryNotes`. A top-level `memoryNotes` counts the project's own notes.

`design_read`:

| Call | Returns | Default bounds |
| --- | --- | --- |
| `{ designFileId }` | header (`id`, `name`, `revision`, `updatedAt`, system), board index (id, name, revision, elementCount), and a tree of every board | depth 2, 50 nodes |
| `{ designFileId, boardId }` | header, `board` (id, name, revision, elementCount) and that board's tree; no board index | depth 2, 50 nodes |
| `{ designFileId, elementId }` | the element's subtree and its placement (`parentId`, `boardId`, `index`, `siblingCount`) | depth 3, 100 nodes |
| `{ designFileId, elementId, depth: 0 }` | the element alone with its `childIds` and placement | |
| `{ designFileId, view: "outline" }` | a flat index keyed by id with `parentId`, `childCount`, `more` and the compact fields minus `className`; scope with `boardId` or `elementId` | 100 elements, no depth limit |

A board read reads only that board's file while the design's cached summary is current (its files unchanged since the summary was taken), and checks that the board's revision matches the summary, so the design revision it returns is consistent with the board; otherwise it reads the whole design once. Depth above 4 or `maxNodes` above 500 need `allowLarge: true`. Passing both `boardId` and `elementId` is an error. Design and board reads add a `memory` summary and a hint when the design has notes.

`design_create` creates a design with exclusive-create semantics (an existing id fails with `DESIGN_FILE_ALREADY_EXISTS`). With `name` it starts with no boards: add boards with `design_apply` operations at `parentId: null`. With `from: { designFileId, elementId }` the new design's board is a copy of that element and its subtree with new ids; the source is not changed and `name` defaults to the element's layer name. `systemName` links a design system: omitted, the design inherits the project default (or the source's); `null` creates an unlinked design. It returns `newRevision`, `designFile: { id, name, revision, updatedAt }`, `system`, `boards` as compact nodes, the copy's `idMap` with `response: "full"`, and diagnostics on the new content.

Boards: a board is one responsive screen or one interaction state (a page, the page with a dialog or sheet open, alternatives the user asked to compare), never one board per breakpoint. Build it once with responsive variants and review it at several widths with `design_screenshot`.

## Operations

`design_apply` and `design_validate` take `operations: [{ operation, parameters }]`. The `operations` parameter of `design_apply` lists every operation with its required parameters; `guide({ topic: "operations" })` documents every parameter with an example.

| Operation | Purpose |
| --- | --- |
| `addSubtree` | Insert a tree of elements and recipe nodes; `tempId` names nodes for later steps. |
| `addElement` | Insert one element. |
| `addRecipe` | Insert an attached recipe instance; its slots come back in `created`. |
| `addSystemComponent` | Place an instance of a published system component (`systemId`, `componentId`, `variantValues`, `overrides`). |
| `updateSystemComponentInstance` | Change an instance's variant values (merge), clear axes, replace overrides. |
| `detachSystemComponent` | Turn an instance into plain elements. |
| `updateElementProps` | Change layer name, `className` or declared control props. |
| `updateElementText` | Replace a text element's text. |
| `updateRecipeControl` | Set a declared recipe control; `instanceId` is any element of the instance or the instance id. |
| `updateRecipeInstance` | Migrate a stale recipe instance to the current template. |
| `detachRecipeInstance` | Turn a recipe instance into plain elements. |
| `moveElement` | Move an element to another parent or position (`targetParentId`; `parentId` is accepted). |
| `copySubtree` | Copy an element and its descendants, from this design or another (`sourceDesignFileId` + `sourceExpectedRevision`). |
| `deleteElement` | Delete an element and its descendants. |
| `renameDesignFile` | Rename the design. |

Insertions take `parentId` (or `targetParentId`) and `index` (`0..childCount`); `parentId: null` inserts a board. Recipe and component structure is locked: insert only into declared slots, and change instances through controls, variants and overrides.

### Step References

Element id parameters (`elementId`, `parentId`, `targetParentId`, `sourceElementId`, `instanceId`, `rootElementId`) can point at elements created by earlier steps:

| Reference | Resolves to |
| --- | --- |
| `$step:N` | The element step `N` changed or inserted (its root). |
| `$step:N:rootElementId` | The root element step `N` inserted. |
| `$step:N:tempId:<tempId>` | The node with that `tempId` in step `N`'s `addSubtree`; for `copySubtree`, the copy of that source id. |
| `$step:N:slot:<slotName>` | The slot host of the recipe step `N` inserted. |
| `$step:N:tempId:<recipeTempId>:slot:<slotName>` | The slot host of one recipe when step `N` inserted several. |

A reference that does not resolve fails the step with `INVALID_OPERATION_PARAMETERS`, the accepted forms and the step's `availableTempIds` or `availableSlots`.

```json
[
  { "operation": "addRecipe", "parameters": { "parentId": "board", "index": 0, "library": "base-ui", "recipe": "dialog.default" } },
  { "operation": "addSubtree", "parameters": { "parentId": "$step:0:slot:content", "index": 0, "subtree": { "tempId": "heading", "library": "trickroom", "component": "text", "text": "Delete project?" } } },
  { "operation": "updateRecipeControl", "parameters": { "instanceId": "$step:0", "prop": "defaultOpen", "value": true } }
]
```

## Revisions

Design revisions are opaque tokens (`r2.` followed by base64url): compare them and pass them back, never parse them. A design's revision combines the revision of its manifest (name, system and other top-level fields) and of every board, in board order; each board also has its own revision, which `design_list`, whole-design reads (board index) and board reads (`board.revision`) return. Component manifest and memory revisions are `sha256:` content hashes; component writes take the manifest revision from `component_read`, memory writes the note's revision.

Every write to an existing design takes `expectedRevision`: the `revision` from your last read or the `newRevision` of your last write. It is checked per board (see [Design revisions](./project-files.md#design-revisions)):

- Boards your call does not change may have changed since your revision: the write succeeds and keeps the other writers' changes. You do not need the latest revision to write to a board nobody else touched.
- A board your call changes must be unchanged since your revision; so must the design's name and settings when your call changes them (`renameDesignFile`), and the board order when your call reorders boards. Otherwise nothing is written and the result is `REVISION_MISMATCH` with `staleBoards`, `manifest` or `order`.
- A step that fails while a board changed since your revision (an element another writer removed or moved) is reported as `REVISION_MISMATCH` naming the changed boards, not as the lookup error.

Recovery: call the reads in `next` (a `design_read` with `boardId` for each stale board, which reads only that board's file), redo your steps on what changed, and retry with `currentRevision` (or the revision those reads return). Boards you did not change need no re-read.

```json
{
  "status": "REVISION_MISMATCH",
  "designFileId": "…",
  "currentRevision": "r2.…",
  "expectedRevision": "r2.…",
  "staleBoards": [{ "id": "…", "name": "Checkout" }],
  "message": "Since your revision another writer changed board \"Checkout\" (…). Re-read only that board (next), redo your steps there, and retry with currentRevision. Boards you did not change need no re-read.",
  "next": [{ "tool": "design_read", "args": { "designFileId": "…", "boardId": "…" } }]
}
```

`design_validate` dry-runs apply the same check. Cross-design copies check `sourceExpectedRevision` the same way, on the source board the element is copied from only. A revision that is not an `r2.` token (an older `sha256:` revision) is compared with the whole design.

## Guide

`guide` without `topic` returns the core (about 6k characters): the design model, rules, workflow, an example batch, governance, and project facts: the design (with `designFileId`: revision and boards), its design system (token counts per domain, published component slugs, asset and icon counts) and memory note counts. With `topic` (one or several) it returns only those sections, in request order.

| Topic | When |
| --- | --- |
| `operations` | Every `design_apply` operation with parameters and an example. |
| `step-references` | Targeting elements created earlier in the same batch. |
| `boards` | Adding boards or deciding what gets its own board. |
| `recipes` | Composed UI (dialog, sheet, menu, select, tabs, fields): an index, or with `name` one recipe's template, slots (allowed and default children) and controls. |
| `components` | Placing or changing system component instances; with `name`, variant axes, override targets and slots. |
| `registry` | Raw registry elements: roles, controls (options, defaults, deprecations), `baseClassName`. Filter with `library` and `name`. |
| `tokens` | Choosing classes or fixing class warnings. |
| `resources` | Images and icons from the design system. |
| `overlays` | Boards with an open dialog, sheet, popover or select. |
| `validation` | Warnings, dry-runs and error hints. |
| `memory` | Reading and writing memory notes, and the `{{type:id}}` references they embed (boards and layers included). |
| `examples` | Worked calls: new screen, dialog-open board, component instance, icons. |
| `component-authoring` | Creating, changing, publishing or extracting (from a design layer) system components: model, rules, workflow; `systemName` adds the system's component counts. |
| `component-template`, `component-slots`, `component-variants`, `component-overrides`, `component-examples` | The parts of a component draft; `component-examples` also extracts a layer and replaces it with an instance. |

`library` and `name` filter `registry`, `recipes` and `components` (`name` matches a family first: `"dialog"` matches `dialog.*` but not `alert-dialog.*`). An unknown topic returns `UNKNOWN_TOPIC` with every topic and when to use it.

## Screenshots

`design_screenshot` renders through Trickroom's capture route and returns one short text block (what each image is, warnings) and one PNG image block per capture; several captures each get a label before their image.

- `boardId`: one board, an array, or `"all"`. `elementId`: one element or an array, cropped to the element with its board inferred. `component`: a system component without a design (`componentId` or slug, `systemName`, `variants`, `matrix` with one axis or `[rowAxis, columnAxis]` rendering every combination as one labelled grid, at most 64 cells; `source: "draft"`).
- `viewport`: `mobile` (390x844), `tablet` (768x1024), `desktop` (1440x900, the default), a width in CSS px (height 900) or `{ width, height }`; an array (up to 6) captures each in one call. Breakpoint variants resolve against each viewport.
- `theme`: `"light"` (default), `"dark"`, or both.
- `scale`: output pixels per CSS pixel, 0.25 to 2. Boards default to 0.5 (a quarter of the image tokens; layout, spacing and body text stay readable); elements and components to 1.
- `maxHeight`: targets taller than this many CSS px are cropped to the top (default two viewport heights, at most 8,000).
- At most 12 images per call (targets × viewports × themes); more fails with `TOO_MANY_SCREENSHOTS`.
- Warnings: `MISSING_RENDERER` (an element renders as a "No renderer" placeholder) and `OVERLAY_CLIPPED` (an open overlay extends past the captured area).

Screenshots need the optional `playwright-core` peer dependency and a Chrome or Chromium. `npx trickroom install-browser` downloads Playwright's Chromium; `npx trickroom install-browser --executable-path <path>` saves an installed browser as `screenshot.executablePath` in the Trickroom settings file. The browser is found in this order: the call's `executablePath`, `TRICKROOM_CHROME_PATH`, the `screenshot.executablePath` setting, the Chromium build this `playwright-core` expects, other cached Playwright builds, system installs, then the `chrome` and `msedge` channels.

## Export

`design_export` writes boards to `destinationDir` (absolute paths as-is; relative paths resolve inside the project and must stay in it); omit `boardIds` for every board. Files of the same name are overwritten. `html` and `png` need `designFileId` and `destinationDir`; leaving one out, or passing `check` or `source`, fails with `INVALID_EXPORT_ARGUMENTS`.

- `format: "html"` (default): self-contained interactive HTML, as the in-app export: one board writes one `.html`, several write one `.zip` with one `.html` per board. Each document inlines the design system's compiled Tailwind and loads React and Base UI from esm.sh, so it needs network access to render. Returns `artifacts` (path, bytes, board names).
- `format: "png"`: one PNG per board, viewport and theme, at scale 1 (or `scale`) and full height up to 8,000 CSS px, named `<design>-<board>.png` with `-<viewport>-<theme>` when there are several. Returns `files` (board, viewport, theme, size, path). Needs a browser like `design_screenshot`.

- `format: "variants"`: one tailwind-variants file per published component of the system in the project's `codegen` config block, written to its `outDir`, as `trickroom codegen` does (see [Component Codegen](codegen.md)). Destination and system come from the config, so `designFileId`, `destinationDir`, `boardIds` and the png options are rejected with `INVALID_EXPORT_ARGUMENTS`. `check: true` compares without writing; `source: "draft"` generates from drafts. The configured formatter command runs for writes and checks. Returns `{ status: "success", project, codegen }`, where `codegen` is the [JSON result](codegen.md#json-result) (`status` `ok` or `drift`). Errors: `CODEGEN_NOT_CONFIGURED` (the message shows a minimal block), `REFUSED_OVERWRITE` (a target file has no Trickroom header; there is no `force` over MCP, so a human reviews the files and runs `trickroom codegen --force`) and `CODEGEN_FAILED` (generation, formatter or path errors); the last two carry `codegen` as well. When the project has a `codegen` block, `component_publish` returns a `codegenHint` pointing here.

Unknown boards fail with `NO_MATCHING_BOARDS` (HTML) or `BOARD_NOT_FOUND` (PNG) and the available boards. Export needs read-write mode, including variants checks.

## Lint

`lint` runs the design system lint engine ([Design System Lint](lint.md)): the code side checks the generated variants files of published components and how the app uses the system's components, variants and tokens; the design side checks how Designs use the system. Rule instances, source globs and thresholds come from the system's `lint.json`; without it every rule kind runs at its default severity.

- Without `check`, a passing run writes `.trickroom/systems/<id>/lint-report.json` as the new ratchet baseline; a failing run writes nothing. `check: true` never writes.
- `system` selects a system by id, name or storage key; the default is the `codegen` block's system, else the project's default system, else the only system.
- `response: "summary"` (default) returns `lint` with `status` (`pass` or `fail`), `mode`, `system`, `ratchet` (numbers that got worse, thresholds broken), `baseline`, `reportPath`, `written`, `diagnostics`, `generatedAt` and the per-side `summary`; `"full"` adds the whole `report`.
- A run that cannot complete (no or ambiguous system, invalid `lint.json`, a crashed rule) is a tool error `LINT_FAILED` carrying the diagnostics.

It needs read-write mode in every case, like `design_export`: the codegen check runs the project's formatter command, and a non-check run writes the report.

## Editor Tools

The editor tools talk to the browser tab where the human has the project open, through the running Trickroom server. They never fail because no browser is open.

`editor_context` returns what the human sees: `design` (`id`, `name`, `revision`, `updatedAt`), `board` (id, name), `selected` (the selected layer as a compact node with `parentId`, `boardId`, `index`, `siblingCount`, so "this layer" is actionable in one call), `stageMode` (`canvas` or `responsive`, with `responsiveWidth`), `visible`, `ageMs` (how old the tab's report is) and `otherTabs`. A selection or board the design no longer has comes back as `{ id, missing: true }`.

`editor_focus` points the editor at a design, a board, or a layer (selected and scrolled into view; its board is inferred). Unknown elements and boards fail before reaching the browser. On success `outcome` says whether the tab revealed it in the open design, navigated to another design, or queued it until the hidden tab is shown.

When the editor cannot answer, both return a normal result with `status` and a one-line `message` saying what the human needs to do:

| Status | Meaning |
| --- | --- |
| `no_server` | No Trickroom server runs for this project. |
| `no_browser` | The server runs, but no browser tab has the project open. |
| `browser_on_other_project` | The browser shows another project (`otherProjects`); it is not switched. |
| `stale` | The server did not answer in time. |
| `blocked_dirty` | (`editor_focus`) The open design has unsaved changes, so the view was not moved. |

Use `editor_focus` after a write the human should look at, and `editor_context` when the human says "this" or "the selected layer".

## Memory

Memory notes are durable steering notes on the project, a design system or a design: `intent`, `usage`, `conventions`, `constraints`, `decision`, `todo`. They are never added to an agent's context on their own.

Scopes: `{ kind: "project" }`, `{ kind: "system", systemName }` and `{ kind: "design", designFileId }`. Shorthands are accepted too: `"project"`, `"system:<name or id>"`, `"design:<uuid>"`; `systemId`/`name` for `systemName` and `designId`/`id` for `designFileId`; `kind` may be left out when the id says it; and a system scope without a name uses the project's only system. Unresolvable scopes fail with `INVALID_OPERATION_PARAMETERS` and `acceptedScopeShapes`. Notes live in the scope's `memory.json` (see [Project Files](./project-files.md)).

`memory_read`:

- Without `noteIds`: an index without bodies (`noteId`, `title`, `category`, `tags`, `pinned`, `updatedAt`, `size`, per-note `revision` and a one-line `summary`) with the scope's `revision`, `noteCount` and `categories`. `designFileId` indexes the project, the design's linked system and the design in one call (`scopes`); `scope` indexes one scope (the project by default). `includeBodies` returns full notes instead.
- With `scope` and `noteIds` (one id or up to 20): those notes in full with their revisions. Missing ids are listed in `missingNoteIds`; when none exist the result is `NOTE_NOT_FOUND`.
- With `scope` and `referenceType` (`design`, `board`, `layer`, `component`, `token`, `asset`, `icon`): candidate `{{type:id}}` targets, filtered by `query`. `board` lists the boards of every design (the scope's design first); `layer` lists the layers of the design scope's design, or of the design a query of the form `<designId>/…` names. Designs outside `allowedDesignFileIds` are left out.
- `resolveReferences: true` attaches resolution of embedded `{{type:id}}` tokens (`valid`, `broken`, `unresolvable_scope`, and a `deepLink` for valid targets).

Reference syntax: `{{design:<designId>}}`, `{{board:<designId>/<boardId>}}`, `{{layer:<designId>/<elementId>}}`, `{{component:<id or slug>}}`, `{{token:<domain>/<name>}}`, `{{asset:<id>}}`, `{{icon:<id>}}`. Board and layer references name their design, so they resolve the same in every scope: a board resolves to its name (`label`) and design name (`detail`) with the link `/design/<designId>?board=<boardId>`; a layer to its layer name, `"<design> / <board>"` and `/design/<designId>?board=<boardId>&layer=<elementId>`, which opens the design with the layer selected. The memory editor suggests them after `{{board:` and `{{layer:` and renders them as links.

`memory_write`:

- `action: "add"`: `category` and a markdown `body`, ideally a `title`; `tags`, `pinned`, `order`, `authorLabel` are optional. No revision needed.
- `action: "update"`: `noteId`, `expectedRevision`, and `edits` (applied in order: `{ op: "append", text }`, `{ op: "prepend", text }`, `{ op: "replace", oldText, newText, all? }`) or a whole new `body`, plus any field to replace (`null` clears `title` and `tags`). A replace whose `oldText` is missing or ambiguous fails without writing.
- `action: "delete"`: `noteId` and `expectedRevision`.

`expectedRevision` is the note's revision from the index (the scope revision also works), so edits to other notes in the scope do not conflict; a stale one returns `STALE_WRITE` with the current revisions. Writes return `noteId`, the note's `newRevision`, the `scopeRevision` and `size`, plus non-blocking `referenceWarnings` for unresolved tokens (a board or layer reference without its design id gets a warning that shows the expected form).

## Design Systems

`system_read` addresses one design system by `systemName` (a name or id) or `designFileId` (the design's linked system), defaulting to the project's default system or its only one. `view` is required:

| View | Returns | Page size |
| --- | --- | --- |
| `tokens` | `tokens: { <domain>: { <name>: value } }`, `domains` (count per domain), `storageStatus`, `syncedAt`, `reviewRequired`; `domain` and `query` filter | 100 |
| `assets` | raster assets (`id`, `name`, `sourcePath`, size, `alt`); with `id`, one asset in full | 50 |
| `icons` | icon ids (with `name` when it differs from the id's last segment), `iconFolderPaths` and catalog `diagnostics`; with `id`, one icon in full | 50 |
| `asset_usage`, `icon_usage` | design elements using the system's assets or icons, grouped by design, `usageCount` and `designCount`; `id` narrows to one | 100 |

Lists page with `query` (every term must match the id, name, or path or value), `limit` and `offset`, and always report `totalCount`, `matchedCount` and `returnedCount`, with `next: { offset }` and a hint while entries remain. MCP never returns image bytes or SVG source.

`system_update` changes the catalogs: `add_asset` (`name`, `sourcePath`, optional `assetId` and `alt`) registers an image in the system's asset manifest; `remove_asset` (`assetId`) removes an asset no design uses (`ASSET_IN_USE` otherwise); `refresh_asset` re-reads an asset file's image metadata; `add_icon_folder` and `remove_icon_folder` (`folderPath`, project-relative) change the system's icon folders and rebuild the icon catalog. Missing parameters for an action fail with `INVALID_OPERATION_PARAMETERS` and `missingParameters`.

## System Components

`component_read` reads a system's component manifest (`systemName` as for `system_read`):

- `view: "index"` (the default without `componentId`): one row per component (`componentId`, slug, name, group, published version, draft state `"unpublished"` or `"changed"`, variant axes, a one-line description) and the manifest `revision` that writes pass as `expectedRevision`. `query` and `group` filter.
- `view: "describe"` (the default with `componentId`): one component's interface for placing and varying instances (variant axes with values and defaults, slots, override targets, props) from the current published version, or the draft when unpublished; the revision, draft hashes, version history and diagnostics. `include` adds `"template"` (root tree, raw slots and override targets), `"classes"` (variant schema with `classesByPath` and compound variants) or `"record"` (the stored record; `versions: "all"` keeps every published template). `source: "draft"` describes the draft.
- `view: "stale"`: instances that use an older published version, with counts per status, component and design and the first rows (`limit`).

`component_draft_create` and `component_draft_update` write drafts (see [Extracting A Component From A Design](#extracting-a-component-from-a-design) for `from`); `component_publish` makes the draft the current version (instances already placed stay on their version until migrated); `component_delete` removes a component, leaving placed instances as instances of a missing component. These writes acknowledge rather than echo: the component id, the new manifest `revision`, draft hashes, this component's diagnostics and a summary of what changed (`created`, `replaced` parts, or the published version and what changed since the previous one). Malformed draft input returns `VALIDATION_FAILED` with `INVALID_SYSTEM_COMPONENT_DRAFT_INPUT` diagnostics, each with a path. `component_draft_update` also takes `expectedDraftTemplateHash` and `expectedDraftVariantSchemaHash` to guard against concurrent draft edits. Read `guide({ topic: "component-authoring" })` before authoring.

### Renaming And Regrouping A Component

`component_draft_update` also takes `name`, `group` and `description`, each optional and usable without any draft part. They live on the component record, outside the draft and the published versions: they feed neither `templateHash` nor `variantSchemaHash`, and instances in designs do not copy them (layer names come from the template's node names). So the change applies at once: no publish, no new version, no stale instances, and `component_read` shows it in the index and describe views on the next read. A call with only these fields leaves the draft and `draftState` as they were and creates no draft. `slug` and `componentId` never change on this path (the slug is derived from the name only when a component is created).

- `name`: non-empty, at most 80 characters, one line.
- `group`: folder names separated by single slashes, like `organisms/sidebar`, at most 120 characters: no empty segments, no leading or trailing slash, no backslash, no spaces around a slash. `null` clears it.
- `description`: at most 4,000 characters. `null` clears it.

Only changes are checked: a value equal to the stored one passes whatever its length or format, so a component written before these rules (or by hand) stays saveable, from MCP and from the app, as long as that field is left as it is. `component_draft_create` checks the same rules for the name, group and description it is given. Invalid values return `VALIDATION_FAILED` with `INVALID_SYSTEM_COMPONENT_METADATA` diagnostics (`path` is the field) before anything is written. The write goes through the component manifest service with `expectedRevision` like every component write, and can be combined with draft parts in the same call (one write, one new revision).

```json
{ "systemName": "Core", "componentId": "cmp_…", "expectedRevision": "sha256:…", "name": "Nav Item", "group": "organisms/sidebar", "description": null }
```

The acknowledgement's `changes.metadata` names what changed: `name` and `group` as `{ from, to }`, `description` as `"set"`, `"changed"` or `"cleared"`. With draft parts it also has `replaced` and the shape diff; a call that changed nothing reports `changes: { unchanged: true }`. The app's system editor saves these fields through the same service function (`updateSystemComponentMetadata`), so it shows the change after its live-sync reload.

### Extracting A Component From A Design

`component_draft_create` with `from: { designFileId, elementId }` instead of `draft` promotes a designed layer to a component: the layer and its subtree become the draft's template (recipe and component instances inside become plain elements, reported in `extracted.strippedInstances`). `name` defaults to the layer name, `slug` to the name, and the system to the design's linked system. The result is the usual draft acknowledgement plus `extracted` (`designFileId`, `elementId`, `nodeCount`).

By default only the draft is created and the design is not changed: a draft is unpublished, and only published versions can be placed. Review it (`design_screenshot` with `component` and `source: "draft"`), add variants, slots and override targets, publish it, then place it with `design_apply`.

With `from.replace: true` and `from.expectedRevision` (the design's revision), the same call also publishes the draft and replaces the layer with an instance of the published version:

```json
{
  "systemName": "Core",
  "expectedRevision": "sha256:…",
  "name": "Plan Card",
  "from": { "designFileId": "…", "elementId": "…", "replace": true, "expectedRevision": "r2.…" }
}
```

It returns the published component (`publishedVersion`) and `replaced`: the instance root (`instanceRootId`), the design's `newRevision` and the write's diagnostics.

The call writes three times: the component manifest (create the draft), the manifest again (publish), then the design, through the `design_apply` path (`addSystemComponent` where the layer sits, then `deleteElement`; audited as `component_draft_create` / `extract`). Before the first write it checks what it can: read-write mode and the design allowlist, the components in the subtree against `allowedComponents`, that the layer's board did not change since `from.expectedRevision` (`REVISION_MISMATCH` otherwise), that the subtree is a valid template (`VALIDATION_FAILED` with `errors`), and, with a dry-run, that the layer can be replaced where it sits (a layer locked inside a recipe or component instance cannot). A failure after the first write can only come from another writer in between. Nothing is rolled back, since a draft or a published component is valid on its own; the result is the failing step's error with:

- `partial`: `componentId`, `slug`, `created`, `published` (with `publishedVersion` and `manifestRevision` once published) and `replaced: false`;
- `next`: the call that finishes the job: `component_publish` with the current manifest revision when publishing failed, or the `design_apply` batch that replaces the layer (with the current design revision when the write lost a race; re-read the board first).

`component_migrate` moves stale instances to the current version with the app's safe / review-required / blocked rules. One instance: `designFileId`, `expectedRevision` and `rootElementId`; it returns `outcome`, the migration report, the instance root as a compact node and `newRevision`, or `REVIEW_REQUIRED` / `DRY_RUN` without writing. Bulk (no `rootElementId`): every stale instance in the system, narrowed by `componentId` and `designFileId`, design by design; it returns counts, a per-design rollup with new revisions, review-required instances and failures (`includeInstances` adds instance rows and previews). `onlySafe` (default true) leaves review-required instances unwritten; `dryRun` previews.

## Resources

Design files are also MCP resources, so agents can attach a design and get notified when the list changes.

```text
trickroom://proj/<locationId>/design/<slug>--<designId>
trickroom://proj/<locationId>/design/<designId>
```

Reading a design resource returns `payloadKind: "design-summary"`: the design header, board index with element counts, and suggested reads; never the raw design JSON. The resource list covers every registered MCP-enabled project; prefer `locationId` in URIs. The server sends `resources/list_changed` on project selection, design creation, renames, and outside changes to the design directory or registry.

## Prompts

| Prompt | Purpose |
| --- | --- |
| `edit_design_file` | Safe edits: project, memory and guide, outline reads, batched writes, dry-runs, revision chaining, screenshots and validation. |
| `add_component_to_design` | Add a system component, recipe, subtree, copy or element under a parent or as a board. |
| `refactor_design_structure` | Outline-first multi-step refactors committed as one batch. |
| `explain_design_file` | Read-only technical summary: structure, vocabulary, tokens and resources, diagnostics, visual review. |
| `validate_design_changes` | Post-edit validation grouped by category, deliberate fixes, visual review. |
| `create_design_file_from_brief` | A new design from a brief: create, guide, build responsive boards, review. |
| `add_media_or_icon` | Find or register assets and icons and wire their ids into elements. |
| `reuse_design_subtree` | Copy a subtree within or across designs, or into a new design. |

Prompt arguments are validated when the prompt is requested.

## Feedback

Agents are Trickroom's main users, so they can say where the tools get in their way. `feedback_submit` takes one required field, `summary` (one line), and optional `category` (`error`, `confusing`, `missing_capability`, `output_too_large`, `slow`, `wrong_result`, `docs`, `idea`), `severity` (`blocker`, `friction`, `minor`), `tools` (a name or a list), `details`, `expected` and `suggestion`. The server instructions and the guide core say when to use it: a tool blocked or misled the agent, returned something unusable, or lacked a capability it needed; not for questions about design content. A tool's second consecutive failure in a session carries a `feedbackHint` (see [Errors](#errors)).

The result is a short acknowledgement: `status: "recorded"`, the entry `id`, `storedIn` (the file) and `attachedCalls`, plus `truncated` when fields were cut. When the file cannot be written the result is `status: "not_recorded"` with a one-line reason, not an error. Only invalid arguments (no `summary`, an unknown `category`) fail.

Nothing leaves the machine. Entries are appended to `<TRICKROOM_HOME>/feedback/feedback-YYYY-MM.jsonl` (UTC month; the folder is created `0700`, files `0600`), one JSON object per line, each written with a single append so several MCP processes can share a file:

```json
{"v":1,"id":"1726dfce-…","t":"2026-10-04T11:24:48.759Z","trickroomVersion":"0.1.0","sessionId":"b4594c6a-…","client":{"name":"claude-code","version":"2.1.0"},"project":{"projectId":"proj_…","locationId":"loc_…"},"summary":"design_apply said the design does not exist; unclear how to start","category":"confusing","severity":"friction","tools":["design_apply"],"details":"…","expected":"…","suggestion":"…","recentCalls":[{"t":"2026-10-04T11:24:48.752Z","tool":"design_apply","outcome":"invalid_input","ms":1,"inChars":45,"outChars":291},{"t":"…","tool":"design_apply","outcome":"error","code":"DESIGN_NOT_FOUND","ms":2,"inChars":157,"outChars":295}]}
```

- The agent supplies `summary` through `suggestion`. `summary` is folded to one line and capped at 200 characters, `details` at 4,000, `expected` and `suggestion` at 1,000, `tools` at 10 names; the whole line stays under 12,000 characters. Cut fields are listed in `truncated`.
- The server adds `v` (schema version, 1), `id`, `t`, `trickroomVersion`, `sessionId` (one per MCP server, so per process for `trickroom mcp`), `client` (name and version from the initialize handshake), `project` (the selected project's `projectId` and `locationId`, as in `projects.json`; no paths) and `recentCalls`.
- `recentCalls` is the session's last 10 tool calls before the report, oldest first. The server records every `tools/call`, including calls rejected before a tool runs, in a per-session ring buffer of 20: `tool`, `outcome` (`ok`, `error` with the result's `code` or `status`, or `invalid_input` when the arguments failed the schema; `unknown_tool`, `tool_disabled` and `exception` cover the rest), `ms`, and `inChars` / `outChars` (characters of the arguments' JSON and of the result's text and image data). Arguments and results themselves are never kept.

### Call Log

Off by default. With `"callLog": true` under `mcp` in `<TRICKROOM_HOME>/settings.json`, every MCP session appends each call record to `<TRICKROOM_HOME>/feedback/calls-YYYY-MM.jsonl`, with `v`, `sessionId` and the client name, which gives usage numbers (which tools, how often, error rates, sizes, durations) without relying on agents to report. `TRICKROOM_MCP_CALL_LOG=1` (or `0`) overrides the setting for one session. The setting is read when the MCP server starts.

```json
{"version":1,"mcp":{"toolGroups":{…},"callLog":true}}
```

### Reviewing Feedback

```sh
trickroom feedback                      # last 30 days: counts, then reports newest first
trickroom feedback --since 2w --tool design_apply
trickroom feedback --category output_too_large
trickroom feedback --calls              # add a per-tool table from the call log
trickroom feedback --json               # raw entries
```

The command only reads. `--since` takes `30d`, `2w`, `12h` or a date (`2026-09-01`); `--tool` keeps reports that name the tool or whose attached calls failed in it; `--calls` adds calls, errors, invalid input, median and p95 duration, and median and max output size per tool. The output is Markdown, meant to be pasted into an agent conversation:

```text
# Trickroom MCP feedback since 2026-09-04 (30d)

1 report from 1 session. Source: /home/me/.trickroom/feedback.

- By category: confusing 1
- By severity: friction 1
- By tool: design_apply 1, design_list 1
- By client: claude-code 1

## 2026-10-04 11:24Z · confusing · friction · design_apply, design_list

design_apply said the design does not exist but design_list showed none either; unclear how to start

- expected: An error naming design_create when the project has no designs.
- client: claude-code 2.1.0 · project: Shop (loc_8d77…) · trickroom 0.1.0 · session b4594c6a
- recent calls: project_list ok 2ms 2→508 › design_list ok 1ms 2→180 › design_apply invalid_input 1ms 45→291 › design_apply DESIGN_NOT_FOUND 2ms 157→295
- id: 1726dfce-1fae-4230-9511-8820c95b91ae
```

## Audit Logging

With `mcp.auditLog: true`, MCP appends JSON Lines to `.trickroom/audit-log.jsonl` for `design_apply`, `design_create`, `component_migrate`, the design write of `component_draft_create` with `from.replace`, `memory_write`, `design_screenshot` and PNG exports. Each entry has the tool name (`toolName`), the operation (for `design_apply` the operation name or `"batch"`, with `operationCount` and `operations` in `details`; `create` / `extract` (also `component_draft_create`'s replacing write); `instance` / `bulk`; `add` / `update` / `delete`; `capture` / `png`), project root, design id, expected and resulting revision, status, success, and error code and message when it failed. Entries written before this release carry the old tool names. PNG bytes are never logged.

## Source Layout

`src/mcp/server.ts` is the composition root: it creates the `McpServer`, builds the shared tool context, and calls each family's register function in `TOOL_NAMES` order, which is the order of `tools/list`.

- `src/mcp/tool-names.ts`: every tool name as a constant (`TOOL`), in list order. Strings that name a tool are built from these constants; a test scans descriptions, schemas, instructions, prompts, the guide and the string literals of `src/mcp` for retired or unknown tool names.
- `src/mcp/tool-groups.ts`: the eight persisted tool groups.
- `src/mcp/tools/`: tool registrations by family: `projects.ts`, `guide.ts`, `design-read.ts` (`design_list`, `design_read`, `design_export`), `design-write-batch.ts` (`design_apply`, `design_create`), `design-validation.ts`, `lint.ts` (`lint`, over `src/lint/run-lint.ts`), `screenshots.ts`, `editor.ts`, `memory.ts`, `design-systems.ts` (`system_read`, `system_update`), `system-components.ts`, `feedback.ts`.
- `src/mcp/tools/context.ts`: per-session state (selected project, project resolver, screenshot capture, editor channel, session id and call history) and the `withProjectContext` / `withPolicyErrorHandling` wrappers.
- `src/mcp/call-history.ts`: records every `tools/call` (outcome, duration, sizes) in the session's ring buffer and the optional call log, and adds `feedbackHint` to a tool's second consecutive failure. `src/mcp/tools/feedback.ts` registers `feedback_submit`; `src/app-state/feedback.ts` holds the entry format and the JSON Lines storage, shared with `src/cli/feedback.ts` (`trickroom feedback`).
- `src/mcp/tools/results.ts` (including the `REVISION_MISMATCH` result with stale boards and recovery reads), `schemas.ts`, `operation-schemas.ts`, `annotations.ts` (annotation presets and the `_meta` keys), `mutation-support.ts` (the read, revision check and write shared by every design write, and auditing), `input-validation.ts` (one line per invalid argument).
- `src/mcp/design-operations.ts` and `src/mcp/operation-plan.ts`: the operation catalogue (`DESIGN_OPERATION_PARAMETERS`), parameter validation and the executor behind `design_apply` and `design_validate`.
- `src/mcp/payloads/`: payload builders the tools call (reads, validation and apply, guide, systems, system components, projects). `design-revisions.ts` holds the board-level revision helpers (which boards changed since a revision, whether one board is current, which boards a plan touched); `component-extraction.ts` the extract-to-component flow.
- `src/mcp/guide/`: the guide's core and topics.
- `src/mcp/prompts.ts`, `src/mcp/server-instructions.ts`, `src/mcp/resource-handlers.ts`: prompts, server instructions and `trickroom://` resources.
- `src/mcp/test-support.ts`: fixtures and helpers for tests (`toolPayload` parses a result's JSON text; `applyOperation` calls `design_apply` with one operation).
