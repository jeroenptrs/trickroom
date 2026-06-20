# Files And Safety

Trickroom is local-first. The important state is either project-owned under `.trickroom` or per-user app state under `~/.trickroom`.

## Ownership Model

Project-owned files belong to the selected project folder and can be committed:

```text
<projectRoot>/.trickroom/
```

Per-user app state belongs to the local machine:

```text
~/.trickroom/
```

You can override the per-user app-state location with `TRICKROOM_HOME`.

## Project Config

Path:

```text
<projectRoot>/.trickroom/config.json
```

Purpose:

- Stores the project name.
- Stores a stable `projectId`.
- Enables and governs MCP.

Shape:

```ts
type TrickroomConfig = {
  schemaVersion?: 1;
  projectId?: string;
  name: string;
  mcp?: {
    enabled: boolean;
    mode?: "read-only" | "read-write";
    allowedDesignFileIds?: string[];
    allowedComponents?: string[];
    auditLog?: boolean;
  };
};
```

Example:

```json
{
  "schemaVersion": 1,
  "projectId": "proj_00000000-0000-4000-8000-000000000000",
  "name": "Example App",
  "mcp": {
    "enabled": true,
    "mode": "read-only",
    "auditLog": true
  }
}
```

Write behavior:

- Opening a project creates `.trickroom/config.json` if neither the current config nor the legacy config exists.
- Opening a project adds a stable `projectId` when missing.
- Opening a project migrates legacy `systems` entries into `.trickroom/systems/*/system.json`.
- The create-project flow writes `.trickroom/config.json` and refuses to overwrite an existing current config.
- New writes target `.trickroom/config.json`.
- New writes omit `systems`; system names and CSS paths are owned by `system.json`.

Legacy behavior:

- Trickroom still reads `<projectRoot>/trickroom.config.json`.
- If the current config is missing and the legacy file exists, Trickroom migrates a normalized copy to `.trickroom/config.json`.
- Legacy `systems` entries are accepted as migration input only.
- It does not delete the legacy file.

Validation rules:

- `schemaVersion` may be omitted or must be `1`.
- `name` is required and must be non-empty after trimming.
- `projectId`, when present, must be non-empty after trimming.
- Legacy `systems` keys and values must be non-empty strings after trimming.
- `mcp.enabled` is required when `mcp` is present.
- `mcp.mode` must be `read-only` or `read-write` when present.
- MCP allowlists must contain non-empty strings.
- Deprecated `tailwindRoot` configs are rejected.

## Design Files

Directory:

```text
<projectRoot>/.trickroom/designs/
```

Files:

```text
<projectRoot>/.trickroom/designs/<uuid>.json
```

Purpose:

- Stores one Trickroom design per JSON file.
- Uses the UUID filename as the design handle in the app and MCP.
- Stores the design name, optional linked system, and root boards.

Design shape:

```ts
type TrickroomDesign = {
  name: string;
  systemId?: string | null;
  systemName?: string | null;
  boards: Node[];
};

type Node = {
  id: string;
  props: Props;
  children: string | Node[];
};
```

New designs created by the app start with one root container:

```json
{
  "name": "Untitled",
  "boards": [
    {
      "id": "00000000-0000-4000-8000-000000000001",
      "props": {
        "data-trickroom-name": "Root",
        "data-trickroom-library": "trickroom",
        "data-trickroom-component": "container",
        "data-trickroom-role": "branch"
      },
      "children": []
    }
  ]
}
```

Write behavior:

- The Electron/browser app creates design files from the project screen.
- The editor autosaves design files after dirty changes.
- MCP `createDesignFile` creates blank design files when policy allows and refuses to overwrite existing UUIDs.
- MCP mutation tools edit existing design files when policy and revisions allow.
- Writes are atomic: existing-file saves write a temporary JSON file and rename it into place; exclusive creation links a temporary file only when the target UUID does not already exist.

Path safety:

- Design UUIDs must be a single path segment.
- `.`, `..`, slashes, and backslashes are rejected.
- Resolved design paths must stay inside `.trickroom/designs`.

Validation rules:

- `name` must be a string.
- `systemId` may be omitted, `null`, or a stable system id.
- `systemName` is a legacy read/write compatibility field. New design writes store `systemId`; API responses may include `systemName` as display metadata.
- `boards` must be an array of valid nodes.
- Every node must have a string `id`.
- Deprecated node `type` fields are rejected.
- Deprecated `data-trickroom-type` props are rejected.
- Registry props must reference known registries and components.
- `branch` role nodes store `children` as an array of nodes.
- `text` role nodes store `children` as a string.
- `leaf` role nodes store `children` as an empty array.
- Missing roles in legacy container nodes are interpreted as `branch` when loaded; new writes use explicit roles.

Base UI Separator example:

```json
{
  "id": "00000000-0000-4000-8000-000000000002",
  "props": {
    "data-trickroom-name": "Separator",
    "data-trickroom-library": "base-ui",
    "data-trickroom-component": "separator",
    "data-trickroom-role": "leaf",
    "orientation": "horizontal",
    "className": "data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full bg-slate-200"
  },
  "children": []
}
```

This serialized node shows the materialized `className` value for author-visible class
state. The registry-owned base styling is exposed separately as
`defaults.baseClassName` in MCP registry descriptions.

## Designs Gitkeep

Path:

```text
<projectRoot>/.trickroom/designs/.gitkeep
```

Purpose:

- Keeps the designs directory present after project initialization.

Write behavior:

- Created or touched when the create-config route initializes a project.

## Design System Storage

Path:

```text
<projectRoot>/.trickroom/systems/<safe-system-name>/
  system.json
  tokens.json
  assets.json
  icons.json
```

Purpose:

- Groups system-owned metadata under one folder per configured system.
- Stores human-editable system metadata in `system.json`.
- Stores meaningful Tailwind color tokens in `tokens.json`.
- Stores project-relative raster image references in `assets.json`.
- Stores generated SVG icon catalog metadata in `icons.json`.
- Stores confirmed override patterns for removed default color tokens.
- Records whether token changes still need review.

Safe system names are generated by lowercasing, converting whitespace to `-`, removing unsupported characters, and trimming leading/trailing hyphens.
The folder name is based on the initial system name. Renaming a system updates `systemName` in `system.json` and does not require renaming the folder.
System names that produce an empty safe key, or legacy config entries that collide with another system's safe key, are rejected before storage is written.

`system.json` shape:

```json
{
  "version": 1,
  "systemId": "sys_00000000-0000-4000-8000-000000000000",
  "systemName": "Core",
  "cssPath": "src/index.css",
  "iconFolderPaths": ["src/design-system/icons"]
}
```

`systemId` is the authoritative stable system identifier. `systemName` is the human-readable display name. `cssPath` and `iconFolderPaths` are optional. Entries must be trimmed, non-empty, project-relative paths that stay inside the project root. Missing icon folders produce warnings for later icon indexing work, not config failure.

Snapshot shape:

```json
{
  "version": 2,
  "metadata": {
    "cssPath": "src/index.css",
    "syncedAt": "2026-01-01T00:00:00.000Z",
    "tailwindBaselineVersion": "4.2.4",
    "reviewRequired": true
  },
  "domains": {
    "color": {
      "tokens": {
        "brand-500": "#2563eb"
      },
      "overrides": [],
      "baselineDiff": {
        "added": [
          { "name": "brand-500", "value": "#2563eb", "domain": "color" }
        ],
        "overridden": [],
        "removed": []
      }
    }
  }
}
```

Write behavior:

- The app syncs tokens for systems when project metadata is loaded.
- Sync writes or updates `tokens.json` when canonical token data changes.
- Sync creates `system.json` if the system folder does not have one yet.
- The systems review dialog writes confirmed overrides and clears `reviewRequired`.
- Reads canonicalize older valid `tokens.json` snapshots when needed.
- There is no runtime read-through from the old `.trickroom/tailwind` location.

Manual repo update for this storage move:

- Move `test-projects/has-system/.trickroom/tailwind/system/tokens.json` to `test-projects/has-system/.trickroom/systems/system/tokens.json`.
- Move `test-projects/has-system-with-warning/.trickroom/tailwind/system/tokens.json` to `test-projects/has-system-with-warning/.trickroom/systems/system/tokens.json`.
- Move `test-projects/has-system-with-warning/.trickroom/tailwind/system3/tokens.json` to `test-projects/has-system-with-warning/.trickroom/systems/system3/tokens.json`.
- Move `test-projects/has-system-with-warning/.trickroom/tailwind/withwarning/tokens.json` to `test-projects/has-system-with-warning/.trickroom/systems/withwarning/tokens.json`.
- Add `system.json` beside each moved `tokens.json` with a generated `systemId`, matching `systemName`, and optional `cssPath`.

Trickroom stores only meaningful color tokens:

- Tokens added outside the Tailwind default baseline.
- Default tokens whose values were overridden.

Unchanged default tokens are not persisted.

`assets.json` shape:

```json
{
  "version": 1,
  "metadata": {
    "updatedAt": "2026-05-15T00:00:00.000Z"
  },
  "assets": {
    "ast_hero": {
      "name": "Hero",
      "kind": "image",
      "sourcePath": "src/assets/hero.png",
      "mimeType": "image/png",
      "width": 1600,
      "height": 900,
      "alt": "Product interface",
      "createdAt": "2026-05-15T00:00:00.000Z",
      "updatedAt": "2026-05-15T00:00:00.000Z"
    }
  }
}
```

Asset rules:

- `sourcePath` is project-relative and must stay inside the project root.
- Absolute paths and path traversal are rejected.
- V1 assets support browser-safe raster images: `png`, `jpg`, `jpeg`, `webp`, and `gif`.
- Design JSON stores `data-trickroom-asset-id`, not `sourcePath` or file bytes.
- The file route serves only by resolving a system handle plus `assetId`; it does not accept arbitrary path parameters.

`icons.json` shape:

```json
{
  "version": 1,
  "metadata": {
    "indexedAt": "2026-05-15T00:00:00.000Z"
  },
  "iconFolderPaths": ["src/design-system/icons"],
  "icons": {
    "src/search": {
      "name": "search",
      "sourcePath": "src/design-system/icons/search.svg",
      "viewBox": "0 0 24 24",
      "paint": "stroke",
      "hash": "sha256:..."
    }
  },
  "diagnostics": []
}
```

Icon rules:

- `icons.json` is generated from `system.json` `iconFolderPaths`.
- Only `.svg` files are indexed.
- Folders are scanned in order; duplicate icon IDs produce diagnostics and the first entry wins.
- Unsafe SVG content is skipped during indexing and sanitized again before the SVG route returns content.
- Design JSON stores `data-trickroom-icon-id`, not raw SVG.

## System Component Manifest

Path:

```text
<projectRoot>/.trickroom/systems/<safe-system-name>/components.json
```

Purpose:

- Stores authored design-system components for one configured system.
- Lives beside `system.json`, `tokens.json`, `assets.json`, and `icons.json` under the same system folder.
- Is the source of truth for component metadata, draft templates, and published immutable versions.

Handle-based resolution:

- APIs, queries, and the manifest service resolve a system by **handle**, not by folder name alone.
- A handle may be any of:
  - `systemId` from `system.json` (preferred for automation),
  - `systemName` (display name),
  - `storageKey` (the safe folder key, for example `core`).
- `findDesignSystem` tries those identities in that order. When a record exists, `components.json` is read from that record's folder.
- When no record matches, Trickroom falls back to the legacy safe-key directory layout under `.trickroom/systems/<handle>/`.

Example:

```text
.trickroom/systems/core/components.json
```

can be addressed as `sys_…` (system id), `Core` (system name), or `core` (storage key), as long as each resolves to the same stored system.

Top-level shape:

```ts
type SystemComponentManifest = {
  version: 1;
  metadata: {
    schemaVersion: 1;
    createdAt: string;
    updatedAt: string;
  };
  settings?: { autoMigrateComponents?: boolean };
  migrationPolicy: {
    allowAutomaticMigration: boolean;
    maxAutomaticMigrationsPerRun: number;
    requireExplicitReview: boolean;
    preserveDrafts: boolean;
  };
  components: Record<string, SystemComponentRecord>;
};
```

`components` record key invariant:

- `components` is keyed by stable opaque `componentId` values such as `cmp_00000000-0000-4000-8000-000000000001`.
- Every record must satisfy `record.componentId === key`.
- Reads and writes reject manifests where the map key and `component.componentId` diverge.
- `slug` is a separate human-facing identifier. Slugs must be unique within the manifest but are not map keys.
- Display names, groups, and order are metadata only; they do not identify storage rows.

Component record shape (simplified):

```ts
type SystemComponentRecord = {
  componentId: string;
  slug: string;
  name: string;
  description?: string;
  group?: string;
  order?: number;
  createdAt: string;
  updatedAt: string;
  draft?: SystemComponentDraftPayload;
  published?: {
    currentVersion: string;
    versions: Record<string, PublishedSystemComponentVersion>;
  };
};
```

Draft vs published semantics:

- **Draft** is mutable workspace state on a component record. API routes can update draft template, slots, variants, override targets, and metadata without changing published history.
- **Publish** snapshots the current draft into `published.versions[version]`, sets `published.currentVersion`, and stores immutable `templateHash` and `variantSchemaHash` values for that version.
- Published versions are append-only for Phase 1. Editing a published version in place is not supported; create a new draft and publish again.
- A component may have a draft only, published only, or both. Listing APIs expose `hasDraft` / `hasPublished` summaries for the SystemEditor catalog.
- Draft edits never mutate an existing published version payload.

Template path terminology:

- Component templates reuse `RecipeTemplateNode` trees (the same shape recipes use).
- `RecipeTemplateNode.path` is a **stable template identity**, not a slash-separated DOM path.
- Valid examples: `root`, `label`, `icon`, `fallback`.
- Invalid examples: `root/label`, `children/0/icon`.
- Validation requires exactly one root node, conventionally with `path: "root"`, and unique non-empty paths across the tree.
- Slots, variant class targets, and override targets reference these template paths via `hostPath` / `path` / `classesByPath` keys.

Revision and hash write safety:

- Every `components.json` revision is a content hash of the exact serialized file:

```text
sha256:<hex digest>
```

- Reads return `revision` with the manifest.
- Writes require `expectedRevision` from the prior read. Stale revisions return `STALE_WRITE` and do not modify the file.
- Writes are atomic: Trickroom writes a temporary JSON file and renames it into place.
- Published versions also store deterministic `templateHash` and `variantSchemaHash` values so attached instances can detect template/schema drift. Usage scans compare the attached version and stored hashes with the current published component.

System-component marker props:

- Attached component instances stamp structural nodes with `data-trickroom-system-component-*` props (system id, component id, instance id, version, template path, slot name, variant values, overrides, and published hashes).
- Generic element mutation tools reject writes to these marker keys.
- Marker props are omitted when extracting partial subtrees out of a design.
- Root nodes compare stored template/schema hashes against the currently published component during usage scanning and inspector review.
- Instance override state is stored with the attached instance metadata. Override targets are path-scoped published capabilities (`className`, `text`, `icon`, `asset`) and may also expose an explicit allowlist of registry control props such as `placeholder` or `disabled`. The inspector wires each capability and prop into the matching component-owned layer's normal editing surface, validates prop values against the registry control, and lets users reset prop overrides to the published template/default value. The instance root stays focused on variants, status, migration, and detach — there is no generic Overrides section.

Ownership boundary rules:

- Nodes inside an attached component instance are **component-owned** unless they are slot hosts or the instance root.
- Component-owned structural nodes cannot be renamed, re-parented, or deleted through normal design edits.
- Content may be inserted only into explicit slot hosts or outside the component boundary.
- Non-root owned nodes cannot be moved across the component boundary.
- Only the instance root may be deleted to remove the whole attached component.
- SystemEditor draft authoring and design-file insertion both rely on the same ownership helpers.

SystemEditor route and component workflow:

- Route: `/system/:systemId` (see `src/components/Root.tsx`).
- `:systemId` accepts either the stable `systemId` or the display `systemName`; the shell resolves the system from the loaded project systems list.
- SystemEditor is a dedicated workspace shell with left navigation for **Components**, **Tokens**, **Assets**, and **Icons**, plus a right-hand inspector.
- **Components**: create draft component records, author draft templates, slots, variants, and override targets, publish immutable versions, inspect usage counts, and review stale/hash-mismatch usages.
- **Tokens**: read-only browse of stored synced token domains. **Token source-definition authoring is out of scope**; theme/CSS source files are edited outside Trickroom.
- **Assets** and **Icons**: browse existing system catalogs using the same data as the project system detail pane.
- Launch from the project system detail pane via **Open System Editor** (`getSystemEditorPath`).

Design authoring and migration behavior:

- Published components can be inserted into design files as attached instances. Inserted nodes carry component marker props and are governed by the ownership boundary rules above.
- Instance updates change declared variant values and override target class names; component marker props remain internal and are blocked from generic element-prop mutation.
- Extracting a complete attached component root into a new design preserves the attachment with a fresh instance id. Extracting a partial component-owned subtree strips component marker props so the extracted design is independent.
- Detaching a component instance removes all system-component marker props from that instance and makes the former structural nodes normal editable design elements.
- Stale detection reports attached instances whose referenced version is no longer current. Hash mismatches and unsafe migrations are surfaced as separate review signals from simple version staleness.
- Manual migration (`migrateSystemComponentInstance` in MCP) updates one stale instance to the current published version when the migration is safe, or returns a review-required preview when `onlySafe` blocks the write.
- Bulk migration (`bulkMigrateSystemComponentUsages` in MCP) scans a system, optional component, or design file. It is always explicit: MCP does not auto-apply migrations on read or publish. By default `onlySafe` is true, so safe migrations are applied and review-required or blocked instances are reported without writing them.
- Automatic application inside the bulk migration helper runs only when callers pass `automatic: true`. That path requires `settings.autoMigrateComponents` on the component manifest and the design's `componentMigrationPolicy` to allow migration (`inherit` or `auto`; `manual` skips automatic writes). MCP bulk migration does not pass `automatic`, so MCP callers must invoke bulk or per-instance migration tools explicitly. The manifest `migrationPolicy` object is stored metadata and is not the runtime gate for automatic bulk migration.
- The project REST API exposes component settings (`autoMigrateComponents`) and usage scans, but no migration execution route. Stale instances remain reportable whenever automatic settings are off and can still be migrated through explicit MCP tools.

REST surface (project API):

```text
GET    /api/trickroom/systems/:systemHandle/components
POST   /api/trickroom/systems/:systemHandle/components
GET    /api/trickroom/systems/:systemHandle/components/usage
POST   /api/trickroom/systems/:systemHandle/components/settings
GET    /api/trickroom/systems/:systemHandle/components/:componentId
GET    /api/trickroom/systems/:systemHandle/components/:componentId/usage
GET    /api/trickroom/systems/:systemHandle/components/:componentId/used-by
GET    /api/trickroom/systems/:systemHandle/components/:componentId/versions/:version/expand
POST   /api/trickroom/systems/:systemHandle/components/:componentId/template
POST   /api/trickroom/systems/:systemHandle/components/:componentId/slots
POST   /api/trickroom/systems/:systemHandle/components/:componentId/variants
POST   /api/trickroom/systems/:systemHandle/components/:componentId/override-targets
POST   /api/trickroom/systems/:systemHandle/components/:componentId/metadata
POST   /api/trickroom/systems/:systemHandle/components/:componentId/publish
```

`:systemHandle` follows the same id/name/storage-key resolution rules as manifest reads.

## MCP Audit Log

Path:

```text
<projectRoot>/.trickroom/audit-log.jsonl
```

Purpose:

- Records MCP creation and mutation attempts and outcomes when `mcp.auditLog` is true.

Write behavior:

- Appended by MCP mutation tools.
- Not written for read-only tools.
- Each entry is JSON Lines so it can be inspected or processed incrementally.

## Per-User Project Registry

Default path:

```text
~/.trickroom/projects.json
```

Purpose:

- Stores recent project locations.
- Stores the last app-level active project and local location.
- Lets the Electron app find the last app-level project, and lets MCP catalog, list, resolve, and select registered project locations.

Shape:

```ts
type ProjectRegistry = {
  schemaVersion: 1;
  locations: ProjectLocationRef[];
  lastActiveProjectId?: string;
  lastActiveLocationId?: string;
};
```

Write behavior:

- Opening a project upserts its local location.
- MCP `openProject` is a compatibility alias that registers a project location and selects it for the MCP session.
- `lastActiveProjectId` and `lastActiveLocationId` are app-level registry values and do not select or retarget MCP sessions.
- Closing a project in the app clears only the in-memory active project for that app session; it does not remove recent project history.

## Files Trickroom Reads But Does Not Edit

Configured Tailwind CSS:

- Paths come from `system.json` `cssPath`.
- CSS paths must resolve inside the project root.
- Trickroom reads imports to load Tailwind's design system.
- Trickroom does not edit the CSS source file.

Package CSS imports:

- Tailwind loading can resolve CSS package imports from the configured CSS file directory.
- Package imports are read for token extraction only.

Application source files:

- Trickroom does not rewrite your React components, routes, pages, or app CSS.
- The current component registry is built into Trickroom rather than imported from your source tree.

## Concurrency And Revision Safety

Every design file revision is a hash of the exact file contents:

```text
sha256:<hex digest>
```

Browser editor:

- Uses a local dirty revision counter.
- Autosaves after `1000ms`.
- Clears dirty state only when the completed save still matches the current in-memory revision.

MCP:

- `createDesignFile` creates a new UUID file with exclusive no-overwrite semantics.
- Every existing-file mutation tool requires `expectedRevision`.
- The revision must come from a prior read.
- If the file changed, the tool returns `REVISION_MISMATCH` and does not write.
- The safe response is to re-read, re-plan if needed, and retry with the new revision.

## What Trickroom Does Not Delete

Trickroom does not delete:

- The selected project folder.
- Application source files.
- Configured Tailwind CSS files.
- The legacy `trickroom.config.json` during migration.

The destructive exception is inside design files: deleting a layer removes that element and all descendants from that design JSON.
