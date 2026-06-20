# Agents And MCP

Trickroom includes a stdio MCP server so agents can inspect and edit design files through structured tools instead of raw filesystem edits.

The MCP server has one explicit session-selected project at a time. It starts from project-root CWD inference when launched from a project root that contains MCP-enabled `.trickroom` config, and agents switch session scope explicitly with `selectProject`.

## Start MCP

```sh
trickroom-mcp
```

On startup, MCP does not accept positional launch-path arguments. Start with `trickroom-mcp` from the desired project folder, and MCP will infer the local project when it is in its root.
If no project is inferred from the current working directory, MCP starts without a selected project.
To target another local project in the same session, register it with `registerProject`, then switch scope with `selectProject`.
The per-user project registry still powers `listProjects`, but it no longer retargets existing MCP sessions when desktop UI project switches happen.

The target project must have MCP enabled:

```json
{
  "name": "Example App",
  "mcp": {
    "enabled": true
  }
}
```

Packaged macOS desktop builds also include a headless helper:

```sh
out/Trickroom-darwin-arm64/Trickroom.app/Contents/Resources/mcp-helper/mcp
```

The helper runs under `ELECTRON_RUN_AS_NODE=1`, does not open a BrowserWindow, and keeps stdout reserved for MCP JSON-RPC. Diagnostics go to stderr.

## MCP Migration Notes

This release keeps one MCP session-selection path:

- `listProjects` exposes catalog location metadata and app-owned `activeProjectId`/`activeLocationId` values.
- MCP session selection is stored separately and managed with `selectProject`.
- `getSelectedProject` returns the current MCP session project.

`openProject` and `getActiveProject` remain as compatibility aliases, but they are deprecated:

- Prefer `registerProject` + `selectProject({ projectId | locationId })`.
- Use `getSelectedProject` instead of `getActiveProject`.

Important note for existing integrations:

- `projects.json` `lastActiveProjectId` and `lastActiveLocationId` are app-level metadata for the desktop app's active project history. They do not automatically re-target MCP sessions.

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

Defaults:

- `mode`: `read-write`
- `allowedDesignFileIds`: all design files
- `allowedComponents`: all components
- `auditLog`: false

Restricted example:

```json
{
  "name": "Example App",
  "mcp": {
    "enabled": true,
    "mode": "read-only",
    "allowedDesignFileIds": [
      "00000000-0000-4000-8000-000000000001"
    ],
    "allowedComponents": [
      "trickroom/container",
      "trickroom/text"
    ],
    "auditLog": true
  }
}
```

Policy effects:

- Read tools enforce `allowedDesignFileIds`.
- Creation and mutation tools enforce `mode`, `allowedDesignFileIds`, and component permissions.
- Registry discovery filters or denies components based on `allowedComponents`.
- Creation and mutation attempts append `.trickroom/audit-log.jsonl` when `auditLog` is true.

## What Agents Can Ask MCP To Do

Project and workspace:

- List registered projects.
- Register another local MCP-enabled project path in app state with `registerProject`.
- Return the currently selected MCP session project with `getSelectedProject` (legacy alias: `getActiveProject`).
- Switch the MCP session project explicitly with `selectProject`, using `locationId` where possible.
- Resolve a stable project ID or registered `locationId` to a local path.
- Report current project metadata and configured systems.
- Resolve and attach multi-project resources by `project.locationId` in MCP URIs.

Design inspection:

- List design files.
- Read a compact design tree.
- Read a flat graph with parent/child maps and JSON Pointer-style addresses.
- Read one element with sibling and parent context.
- Read a subtree with optional depth.
- Validate a design file.
- Dry-run one mutation without writing.

Registry and authoring:

- List component registries.
- List registry components and composable recipes.
- Describe a component's role, children rules, default props, and writable props.
- Describe a recipe's structure, slots, defaults, and system-owned marker guidance.
- Get the full design authoring contract for a model.

Design systems:

- Resolve the design system linked to a design file.
- List stored design tokens for that linked system (all synced token domains, not color-only).
- List, describe, and find usage of system-scoped raster assets and SVG icons.
- Register or remove system assets and icon folders, and refresh asset metadata when policy allows.
- List, describe, author, and publish system component drafts.
- Scan stale attached system component usages and migrate safe stale usages.

Design mutation:

- Create a blank design file.
- Extract a subtree into a new design file without modifying the source.
- Rename a design file.
- Add an element or attached recipe instance.
- Add an attached system component instance from a published component.
- Validate a candidate subtree insertion.
- Validate copying an existing subtree from one design file into another.
- Add an element or recipe subtree.
- Copy a source subtree into another insertion point.
- Update layer name, Tailwind class name, or registry-backed control props.
- Update declared recipe controls on attached instances.
- Update system component instance variants and override class names.
- Migrate a stale attached recipe instance to the current registry template.
- Migrate a stale attached system component instance to the current published version.
- Detach an attached recipe instance so structural nodes become normal elements.
- Detach an attached system component instance so structural nodes become normal elements.
- Update text content.
- Move an element.
- Delete an element and descendants.

## What MCP Cannot Do

Through the current MCP tools, agents cannot:

- Edit `.trickroom/config.json`.
- Add or remove Tailwind systems.
- Sync Tailwind token snapshots or confirm overrides.
- Edit your source CSS files.
- Edit your application source code.
- Change built-in registry definitions.

## Tool Safety Map

Read-only tools:

| Tool | Purpose |
| --- | --- |
| `listProjects` | List registered projects from app state. |
| `getSelectedProject` | Return the selected project used by this MCP session. |
| `getActiveProject` | Compatibility alias for `getSelectedProject` (**deprecated**). |
| `resolveProject` | Resolve `projectId` or `locationId` to a local project location. |
| `trickroom_project_info` | Return project root, config path, and systems. |
| `listDesignFiles` | List visible design files with revisions, counts, and modified timestamps. |
| `readDesignFile` | Read design metadata, board summaries, counts, and a bounded compact design tree. Defaults to depth 2 and 100 nodes. |
| `readDesignGraph` | Read a flat graph and element addresses. |
| `readElement` | Read one element with context. |
| `readSubtree` | Read one bounded element subtree. Defaults to depth 2 and 100 nodes. |
| `validateDesignFile` | Validate an existing design without writing. |
| `validateOperation` | Dry-run one supported operation without writing. |
| `validateOperationPlan` | Dry-run an ordered list of design operations against one starting revision without writing. |
| `validateSubtree` | Dry-run one subtree insertion payload without writing. |
| `validateCopySubtree` | Dry-run copying a source subtree into a target design without writing. |
| `listRegistries` | List built-in component registries. |
| `listRegistryComponents` | List allowed components and composition metadata. |
| `describeRegistryComponent` | Describe one allowed component. |
| `listRegistryRecipes` | List composable recipes and compact slot/structure metadata. |
| `describeRegistryRecipe` | Describe one recipe's structure, slots, defaults, and controls. |
| `getDesignAuthoringContract` | **Recommended first planning call.** Return compact grammar, registry component/recipe vocabulary, props, composition/mutation rules, authoring guidance, examples, and optional token/resource summaries for a linked design. |
| `getDesignSystemForDesignFile` | Report linked system and token storage metadata. |
| `listDesignTokens` | List stored tokens for the linked system. |
| `listSystemAssets` | List system asset metadata without file bytes. |
| `describeAsset` | Describe one system asset by stable ID. |
| `listSystemIcons` | List generated icon metadata and diagnostics without raw SVG. |
| `describeIcon` | Describe one system icon by stable ID. |
| `findAssetUsage` | Find design elements referencing system assets. |
| `findIconUsage` | Find design elements referencing system icons. |
| `listSystemComponents` | List authored components in a configured system with manifest revision metadata. |
| `describeSystemComponent` | Describe one component record, draft hashes, validation diagnostics, and published versions. |
| `listStaleSystemComponentUsages` | Read-only scan returning attached instances with stale referenced versions in `usages`. Hash-review signals appear in status counts and diagnostics, not in `usages` rows. |

Project/session writes:

| Tool | Writes | Notes |
| --- | --- | --- |
| `registerProject` | `~/.trickroom/projects.json` | Registers a local path in app state without selecting MCP session scope. |
| `selectProject` | MCP session context | Sets the active project used by project-scoped MCP tools. |
| `openProject` | `~/.trickroom/projects.json` and MCP session state | **Deprecated alias**. Use `registerProject` + `selectProject` instead. |

Design-system resource writes:

| Tool | Writes | Destructive risk |
| --- | --- | --- |
| `addSystemAsset` | Registers one raster asset in a system's `assets.json` manifest | Low; adds catalog metadata, not design elements. |
| `removeSystemAsset` | Removes one asset from the manifest when unused | Medium; breaks future references if designs still point at the ID. |
| `addSystemIconFolder` | Adds a project-relative icon folder and refreshes the icon manifest | Low; extends icon discovery paths. |
| `removeSystemIconFolder` | Removes one icon folder path from the system config | Medium; may shrink the generated icon catalog. |
| `refreshSystemAssetMetadata` | Re-reads one asset file's image metadata | Low; updates stored dimensions/metadata only. |
| `createSystemComponentDraft` | Adds one component draft record to `components.json` | Low; requires the current component manifest revision. |
| `updateSystemComponentDraft` | Updates a component draft template, slots, variants, and/or override targets in `components.json` | Medium; changes future publishes but does not rewrite existing published versions. |
| `publishSystemComponent` | Appends an immutable published component version in `components.json` | Medium; changes the current version used by new insertions and stale scans. |
| `deleteSystemComponent` | Removes one component record from `components.json` | High; does not remove attached design instances, which may become stale or missing-component. |

Design-file writes:

| Tool | Writes | Destructive risk |
| --- | --- | --- |
| `createDesignFile` | Creates a new blank design file with one root container | Low; writes a new JSON file and refuses to overwrite an existing file. |
| `extractSubtree` | Creates a new design file cloned from a source subtree | Low; does not modify the source design. |
| `renameDesignFile` | Design file `name` | Low; writes JSON. |
| `addElement` | Adds one node | Low; grows the design tree. |
| `addRecipe` | Expands and inserts one registry recipe instance | Medium; generates a multi-node attached structure. |
| `addSystemComponent` | Expands and inserts one published system component instance | Medium; generates a multi-node attached structure with marker props. |
| `addSubtree` | Inserts a candidate subtree, including optional recipes | Medium; generates fresh IDs and normalizes candidate insertion rules. |
| `updateElementProps` | Updates `data-trickroom-name`, `className`, and/or registry-backed control props | Medium; can replace styling or component settings. |
| `updateRecipeControl` | Updates a declared recipe control by instance/path/prop | Medium; can replace attached recipe component settings. |
| `updateSystemComponentInstance` | Updates declared variant values and override target class names on an attached component root | Medium; re-expands the instance without generic marker edits. |
| `updateRecipeInstance` | Migrates one stale attached recipe instance to the current template | Medium; can reshape recipe-owned structure while preserving mapped content. |
| `migrateSystemComponentInstance` | Migrates one stale attached component instance to the current published version | Medium; safe migrations write by default, review-required migrations are reported unless `onlySafe` is false. |
| `bulkMigrateSystemComponentUsages` | Migrates stale attached component usages for a system, optional component, or optional design file | Medium; `dryRun` previews without writes and `onlySafe` defaults to true. |
| `detachRecipeInstance` | Removes recipe marker props from one attached instance | Medium; unlocks formerly recipe-owned nodes for normal mutation. |
| `detachSystemComponent` | Removes component marker props from one attached instance | Medium; unlocks formerly component-owned nodes for normal mutation. |
| `updateElementText` | Updates text role `children` | Medium; replaces text content. |
| `moveElement` | Reorders or reparents one node | Medium; can significantly change hierarchy. |
| `copySubtree` | Copies a subtree from a source design into a target design | Medium; copies structural data and validates cross-file revision/design-system constraints. |
| `applyDesignOperations` | Applies an ordered operation list atomically with one persisted write | Medium; validates the full plan in memory before committing one revision. |
| `deleteElement` | Removes one node and all descendants | High; cannot be undone by Trickroom itself. |

Existing design-file writes require `expectedRevision`. `createDesignFile` and `extractSubtree` have no prior revision on the file they create; they use exclusive create semantics and fail if the chosen UUID already exists. Cross-file `copySubtree` also requires `sourceExpectedRevision` on the source design. System component manifest writes require the `revision` returned by `listSystemComponents` or `describeSystemComponent`.

MCP annotations mark `renameDesignFile`, `updateElementProps`, `updateRecipeControl`, `updateRecipeInstance`, `detachRecipeInstance`, `detachSystemComponent`, `updateElementText`, `moveElement`, and `deleteElement` as destructive write tools. `createDesignFile`, `extractSubtree`, `addElement`, `addRecipe`, `addSystemComponent`, `updateSystemComponentInstance`, `migrateSystemComponentInstance`, `bulkMigrateSystemComponentUsages`, `addSubtree`, and `copySubtree` are write tools but are annotated as non-destructive. `registerProject`, `selectProject`, and `openProject` are project/session-state writes and do not mutate design files. System resource write tools mutate design-system manifests under `.trickroom/systems/`, not design JSON files.

## Revision Workflow

Design revisions are hashes of the exact file contents:

```text
sha256:<hex digest>
```

Safe mutation sequence:

1. For a new exploration, call `createDesignFile`, then use the returned `newRevision` for follow-up mutations.
2. For an existing design, call `listDesignFiles` to get the current revision. Use bounded `readDesignFile`, `readElement`, or `readSubtree` only for the area you need to inspect.
3. Use the returned `revision` as `expectedRevision`.
4. Optionally call `validateOperation` for one risky step, or `validateOperationPlan` for multi-step refactors.
5. Call one mutation tool, or `applyDesignOperations` for an atomic multi-step commit.
6. Use the returned `newRevision` for the next mutation.
7. If a tool returns `REVISION_MISMATCH`, stop and re-read the revision with `listDesignFiles` or bounded `readDesignFile` before retrying.
8. After a multi-step edit, call `validateDesignFile`.
9. Verify the final edited area with `readElement` or bounded `readSubtree` before reporting completion.

This revision discipline prevents agents from overwriting newer app or user edits.

## Mutation Details

`createDesignFile`:

- Creates a new blank design file under `.trickroom/designs/<uuid>.json`.
- Accepts `name`, optional `systemName` compatibility input, and optional `designFileId`.
- Stores linked systems as `systemId` in the design file.
- Generates a UUID when `designFileId` is omitted.
- Requires a caller-supplied `designFileId` when `allowedDesignFileIds` restricts MCP to explicit IDs.
- Requires `trickroom/container` to be allowed because the new design starts with one root container board.
- Rejects unknown configured design systems.
- Refuses to overwrite an existing file ID.
- Returns the new design revision for immediate use with `addElement` and other mutation tools.

`renameDesignFile`:

- Updates the top-level design `name`.
- Requires a non-empty `name`.
- Does not change the filename or UUID.

`addElement`:

- Inserts a registry component at a root or parent position.
- Accepts `library`, `component`, `parentId`, `index`, optional `name`, optional `className`, optional `text`, and optional allowed instance/control props.
- Rejects unknown registries/components.
- Rejects adding children to non-branch parents.
- Automatically sets system-owned registry props.
- For `trickroom/asset` and `trickroom/icon`, requires the design to have a linked configured system and requires the referenced asset/icon ID to exist in that system catalog.

`validateSubtree`:

- Validates a candidate `subtree` insertion using `designFileId`, `expectedRevision`, `parentId`, `index`, and optional `options`.
- Enforces strict insertion semantics:
  - `index` must be an integer.
  - `index` must be within `0..childCount` for the target parent/root.
  - `parentId` must resolve to a parent that can accept child elements.
- Accepts candidate nodes of type `kind: "element"` and optional `kind: "recipe"` (if recipe nodes are enabled).
- Supports validation options:
  - `maxNodes` and `maxDepth` caps for input subtree shape.
  - `includeNormalizedTree` to include normalized output.
  - `allowRecipes` to disable recipe nodes.
- Reports `tempId` duplicate diagnostics (`DUPLICATE_TEMP_ID`) and maps valid `tempId` values to generated IDs in mutation output.
- Returns `valid`, `stats` (`nodeCount`, `maxDepth`, `recipeCount`), diagnostics, optional `normalizedSubtree`, stable recipe expansion summaries, and token diagnostics. Validation responses do not include generated element IDs, insertion IDs, `idMap`, `changedElement`, or mutation context.

`addSubtree`:

- Inserts a candidate subtree payload and returns changed metadata and new IDs.
- Uses generated IDs (random UUIDs) for all inserted candidate nodes.
- Supports a `tempId` on candidate nodes to make it easier to correlate client-side references; if duplicates are found, `DUPLICATE_TEMP_ID` is reported.
- Supports `maxNodes`, `maxDepth`, and `allowRecipes` options. `includeNormalizedTree` is only accepted by `validateSubtree`.
- Returns:
  - `newRevision`
  - `rootElementId`
  - `idMap` from submitted `tempId` to generated IDs
  - `inserted` summary (`nodeCount`, `rootElementId`, `elementIds`)
  - `recipeExpansions` with generated recipe instance roots and path maps when recipes were used
  - `changedElement` and mutation context.
- For recipe nodes, the candidate subtree is expanded before insert and recipe metadata is included in `recipeExpansions`.
- The post-insert candidate is validated against resource references and target-linked system rules.

`validateCopySubtree`:

- Validates cross-design or same-design subtree copy from `sourceDesignFileId` + `sourceElementId` into `targetDesignFileId`.
- Requires:
  - `expectedRevision` for target design always.
  - `sourceExpectedRevision` whenever source and target design IDs are different.
- Enforces `maxNodes`/`maxDepth` on the source subtree when provided.
- Validates cycle risks (copying a node into one of its descendants), parent role/index constraints, and recipe ownership restrictions for partial recipe structures.
- Returns source/target design metadata, same-file flag, stats, diagnostics, and warnings. Validation responses do not include generated clone IDs, insertion IDs, `idMap`, `changedElement`, or mutation context.

`copySubtree`:

- Clones a source subtree and writes it into the target insertion location.
- Uses generated IDs for all cloned nodes.
- Same-file copies optionally accept missing `sourceExpectedRevision` and append ` Copy` to the inserted root element name.
- Cross-file copies require both revision fields (`expectedRevision`, `sourceExpectedRevision`) for consistency.
- Recipe structural boundaries are enforced by design rules; partial recipe-owned subtree copies are rejected.
- After mutation, the target design is validated for resource references against the target design’s linked system.
- Target-system validation can emit `DESIGN_SYSTEM_REQUIRED`, `UNKNOWN_DESIGN_SYSTEM`, `MISSING_ASSET_ID`, `MISSING_ICON_ID`, `INVALID_ASSET_ID`, `INVALID_ICON_ID`, `UNKNOWN_ASSET_ID`, and `UNKNOWN_ICON_ID`.
- Returns source/target metadata, `newRevision`, `sourceElementId`, `rootElementId`, `idMap`, `inserted`, and `changedElement`.
`updateElementProps`:

- Updates `name`, `className`, and/or registry-backed control props.
- Preferred call shape uses top-level `name`, top-level `className`, and a `props` object for registry-backed control props.
- Also accepts a compatibility `propUpdates` array of `{ "name": string, "value": JSON primitive }` entries. Entries named `name` or `data-trickroom-name` update the layer name, entries named `className` update classes, and other names are treated as registry-backed control props.
- Does not allow changing registry library, component, or role.
- Passing an empty class string clears the class name value.
- Rejects updates that would leave `trickroom/asset` or `trickroom/icon` pointing at an unknown resource ID.

`updateRecipeControl`:

- Updates a declared recipe-level control on an attached recipe instance without detaching the recipe.
- Requires `instanceId`, template `path`, control `prop`, and JSON primitive `value`.
- Use this for nested recipe controls such as `base-ui/menu.default` root `modal` and positioner `align`, `side`, or `sideOffset`.
- Rejects undeclared recipe control props and invalid option/value types.

`updateRecipeInstance`:

- Explicitly migrates one stale known attached recipe instance to the current registry template.
- Requires `elementId` for any structural element in the stale instance.
- Preserves stable structural element IDs where paths still exist, remaps slot hosts by stable slot name/history metadata, and preserves mutable structural props plus authored slot contents when they can be mapped safely.
- Rejects current, invalid-known, and unknown recipe instances. Also rejects migrations that would drop authored slot contents.
- Returns `recipeMigration` metadata with old/new versions and template hashes, preserved/remapped/added/removed paths, and preserved slot mappings.

`updateElementText`:

- Works only on text role elements.
- Replaces the text stored in `children`.

`moveElement`:

- Moves an element to a new parent or root position.
- Rejects moving an element into itself.
- Rejects moving an element into a descendant.
- Rejects moving into a non-branch parent.

`deleteElement`:

- Deletes the target element and every descendant.
- Returns the deleted count and context for the previous parent.

## Validation

`validateDesignFile` checks:

- Payload shape.
- Duplicate element IDs.
- Unknown registry libraries.
- Unknown registry components.
- Registry role mismatches.
- Unknown linked design systems.
- Token/class diagnostics for linked systems, including spacing, typography, radius, shadow/blur tokens, and unknown Tailwind utilities when the linked CSS can be loaded.
- Unknown or missing `trickroom/asset` IDs for linked systems.
- Unknown or missing `trickroom/icon` IDs for linked systems.

Class/token warnings include `domain`, `property`, `classToken`, `token`, `className`, `elementId`, and `path` when available. Common codes:

- `UNKNOWN_COLOR_TOKEN`, `UNKNOWN_SPACING_TOKEN`, `UNKNOWN_FONT_TOKEN`, `UNKNOWN_TEXT_TOKEN`, `UNKNOWN_RADIUS_TOKEN`, `UNKNOWN_SHADOW_TOKEN`, `UNKNOWN_TAILWIND_TOKEN`
- `OUT_OF_SYSTEM_COLOR`, `OUT_OF_SYSTEM_FONT`, `OUT_OF_SYSTEM_RADIUS`, `OUT_OF_SYSTEM_TEXT`, `OUT_OF_SYSTEM_SHADOW`, `OUT_OF_SYSTEM_BLUR`
- `UNKNOWN_TAILWIND_UTILITY` when Tailwind cannot parse or emit CSS for a candidate (skipped when the design system CSS cannot be loaded)

`validateOperation` dry-runs:

- `renameDesignFile`
- `addElement`
- `addSubtree`
- `addRecipe`
- `updateElementProps`
- `updateRecipeControl`
- `updateRecipeInstance`
- `updateElementText`
- `moveElement`
- `copySubtree`
- `deleteElement`
- `detachRecipeInstance`

It returns predicted changed elements, context, deleted IDs, warnings, token diagnostics, and suggested follow-up reads.

`validateOperationPlan` dry-runs an ordered list of supported operations against one starting revision:

- Applies each step to an in-memory candidate design in order.
- Supports plan-local step references such as `$step:0` and `$step:0:rootElementId` for later steps that depend on earlier insertions.
- Returns `status`, `valid`, `operationCount`, per-step summaries, aggregate changed/deleted/inserted IDs, recipe expansion metadata, diagnostics, and suggested reads.
- On failure, returns `failedStepIndex`, `failedOperation`, and diagnostics without writing.

`applyDesignOperations` validates the same payload shape and performs exactly one persisted write when the full plan is valid and the starting revision still matches. It returns one `newRevision`, not per-step revisions.

`validateSubtree` and `validateCopySubtree` return predicted diagnostics and stats without writing:

- `validateSubtree` reports candidate insertion status, normalized preview (when requested), stats, and stable recipe-expansion details.
- `validateCopySubtree` reports both source and target design metadata, same-file/cross-file rules, stats, and revision mismatch states (`REVISION_MISMATCH`, `SOURCE_REVISION_MISMATCH`, `SOURCE_REVISION_REQUIRED`).
- Dry-run validation, including `validateOperation` for `addSubtree` and `copySubtree`, never returns generated element IDs, `idMap`, inserted ID lists, `changedElement`, or mutation context. Rich generated ID metadata is reserved for successful mutation tools.
- Neither validator commits any file writes.

## Registry Contract

The built-in registries currently include:

| Library | Component | Role | Children |
| --- | --- | --- | --- |
| `trickroom` | `container` | `branch` | Child nodes allowed. |
| `trickroom` | `text` | `text` | String content only. |
| `trickroom` | `asset` | `leaf` | Empty array only. |
| `trickroom` | `icon` | `leaf` | Empty array only. |
| `base-ui` | `separator` | `leaf` | Empty array only. |
| `base-ui` | `menu.separator` | `leaf` | Empty array only. |

Writable instance props:

- `className`
- `data-trickroom-name`, exposed as `name` by mutation tools
- Registry-backed control props declared by `describeRegistryComponent`, such as `orientation` for `base-ui/separator`
- `updateElementProps` also accepts these writable props through the legacy `propUpdates` batch form; new calls should prefer top-level `name`/`className` plus `props`.

System-owned props:

- `data-trickroom-library`
- `data-trickroom-component`
- `data-trickroom-role`

Registry-owned defaults are also surfaced in component descriptions, including
`defaults.baseClassName` for Base UI separators.

Base UI Separators share one component-specific control:

```json
{
  "library": "base-ui",
  "component": "separator",
  "role": "leaf",
  "props": {
    "orientation": "horizontal"
  },
  "baseClassName": "data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full",
  "children": []
}
```

Allowed `orientation` values are `horizontal` and `vertical`. Base UI separators also include `base-ui/menu.separator` with the same shape.

`defaults.baseClassName` is the registry-owned render styling, distinct from user-authored `className`. Project snapshots and mutation-facing `defaults.props` should use editable/writable props only; `className` in these contexts is the user-authored class surface, while base sizing classes are materialized at render time for the created instance.

`trickroom/asset` supports `data-trickroom-asset-id` and `alt` as active registry-backed controls. Legacy controls `objectFit`, `objectPosition`, `loading`, and `decoding` remain accepted for compatibility with existing designs, but new compositions should avoid writing those registry props and use Tailwind `object-*` utilities via `className` for image behavior.

`trickroom/icon` supports `data-trickroom-icon-id` and optional `aria-label` as registry-backed controls. MCP icon discovery returns metadata only; raw SVG is served to the renderer through the sanitized app route, not through MCP catalog tools.

Agents should call `getDesignAuthoringContract({ designFileId })` once before planning mutations. It returns compact registry component and recipe summaries, writable vs system-owned props, composition rules, mutation strategy guidance, examples, and (for linked systems) token/resource planning context without raw asset bytes, SVG, or full token lists. Use `describeRegistryComponent`, `describeRegistryRecipe`, `listDesignTokens`, `listSystemAssets`, and `listSystemIcons` when you need full detail for one item. Only `branch` role elements accept children; `text` and `leaf` role elements reject child insertion and reparenting.

## Resources

Trickroom exposes design files as MCP resources. This allows agents to "attach" designs to their context and receive notifications when they change.

### Resource URIs

The primary URI scheme for design resources is:

```text
trickroom://proj/<locationId>/design/<slug>--<designId>
```

- `<locationId>`: The URI project segment. Prefer the registered `locationId` from `listProjects`. In project-root CWD-only contexts without a registered location, MCP may use the project ID as a fallback.
- `<slug>`: A URL-safe version of the design name for readability.
- `<designId>`: The UUID of the design file.

A "bare-id" form is also supported:

```text
trickroom://proj/<locationId>/design/<designId>
```

### Scope and Behavior

- **V1 Scope**: Only design files are exposed as resources in the current version.
- **Resource payload**: Reading a design resource returns `payloadKind: "design-summary"` with design metadata, revision, board IDs/names, child counts, descendant counts, total counts, and suggested follow-up reads. It does not return raw design JSON.
- **Multi-project catalog**: Resource listing includes all registered MCP-enabled projects.
- **Resource scope**: The resource list can include designs from multiple projects; `readResource` resolves URIs using the URI `locationId` segment.
- **Project preference**: Use `locationId` (not `projectId`) in multi-project resource references.
- **Notifications**: The server sends `list_changed` notifications on project switches, design creation/rename, and out-of-band changes to the design directory or registry.

## Prompts

The MCP server exposes guided workflow prompts. Each prompt returns a user-message template that encodes the recommended tool sequence for that task.

| Prompt | Purpose |
| --- | --- |
| `edit_design_file` | Safe edits: project scope, revision, authoring contract, graph reads, recipes/subtrees, resource catalogs, dry-runs, revision chaining, validation. |
| `add_component_to_design` | Add registry content via `addElement`, `addRecipe`, `addSubtree`, or `copySubtree` with contract and parent-role checks. |
| `refactor_design_structure` | Graph-first multi-step refactors using move/delete/copy/extract/recipe tools; prefers `validateOperationPlan` + `applyDesignOperations` for atomic commits. |
| `explain_design_file` | Read-only technical summary: graph, contract, registry/recipes, assets/icons, tokens, diagnostics; no rendered preview or raw bytes. |
| `validate_design_changes` | Post-edit validation grouped by diagnostic category; dry-run fixes; no visual-readiness claims from MCP alone. |
| `create_design_file_from_brief` | Create a design from a brief using `createDesignFile`, structured inserts, and final validation. |
| `add_media_or_icon` | Resolve design system catalogs, register assets/icons when needed, wire canonical resource IDs into elements. |
| `reuse_design_subtree` | Copy or extract subtrees with `validateCopySubtree`, `copySubtree`, or `extractSubtree`. |

Prompt arguments are validated at call time (for example `designFileId` UUIDs and required brief text for `create_design_file_from_brief`).

## Audit Logging

Enable audit logging:

```json
{
  "mcp": {
    "enabled": true,
    "auditLog": true
  }
}
```

When enabled, creation and mutation tools append JSON Lines to:

```text
.trickroom/audit-log.jsonl
```

Audit entries include the tool name, operation, project root, design file ID, expected revision, resulting revision when available, status, success flag, and error details when a policy or operation fails.
