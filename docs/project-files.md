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

You can override the per-user app-state location with `TRICKROOM_HOME`. It holds:

```text
~/.trickroom/
  projects.json                 recent project locations (see Per-User Project Registry)
  settings.json                 app settings: MCP tool groups, mcp.callLog, server and screenshot options
  locks/designs/<hash>.lock     design write locks (see Concurrency And Revision Safety)
  runtime/servers/<pid>.json    discovery records of running Trickroom servers
  feedback/                     created on first use, 0700
    feedback-YYYY-MM.jsonl      agent reports from feedback_submit (0600)
    calls-YYYY-MM.jsonl         per-call log, only with mcp.callLog (0600)
```

Nothing under it is project data or is sent anywhere. The feedback files are JSON Lines with `"v": 1` entries; see [Feedback](mcp.md#feedback) for the format and `trickroom feedback` for reviewing them.

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

Layout (design file version 2):

```text
<projectRoot>/.trickroom/designs/<designId>/
  design.json            manifest: version, name, systemId and other top-level fields
  boards/<boardId>.json  one board: version, order key and the board's node tree
  memory.json            the design's memory notes (see Memory Notes)
```

Purpose:

- Stores one Trickroom design per folder, named by the design id (a UUID for designs Trickroom creates). The id is the design handle in the app, the HTTP API (`?id=`) and MCP.
- Stores each board in its own file, so an edit to one board changes one file, two branches that each add a board to the same design touch no shared file, and a write to board A does not conflict with a concurrent write to board B.
- The set of boards is the listing of `boards/`; there is no board list in the manifest. Boards sort by their `order` key, then by board id.

In-memory design shape (what the HTTP API and MCP tools return, assembled from the files):

```ts
type TrickroomDesign = {
  name: string;
  systemId?: string | null;
  systemName?: string | null;
  componentMigrationPolicy?: "inherit" | "manual" | "auto";
  boards: Node[]; // in order
};

type Node = {
  id: string;
  props: Props;
  children: string | Node[];
};
```

`design.json`:

```json
{
	"version": 2,
	"name": "Checkout",
	"systemId": "sys_00000000-0000-4000-8000-000000000000"
}
```

`boards/00000000-0000-4000-8000-000000000001.json`:

```json
{
	"version": 2,
	"order": "V",
	"board": {
		"id": "00000000-0000-4000-8000-000000000001",
		"props": {
			"data-trickroom-name": "Root",
			"data-trickroom-library": "trickroom",
			"data-trickroom-component": "container",
			"data-trickroom-role": "branch"
		},
		"children": []
	}
}
```

Every file of a design carries the same `version`, so a board file that arrives from another branch is self-describing.

Board order:

- `order` is a fractional index: a string of base-62 digits (`0-9A-Za-z`) compared as a plain string, where a key can always be generated between two others (`design-order.ts`).
- Adding a board writes only the new board's file, with a key between its neighbours. Moving a board rewrites only that board's file. Deleting a board unlinks its file.
- Two branches that insert a board in the same place can produce equal keys; ties sort by board id, and the next write that needs room between them re-keys one board.
- A missing or invalid key sorts last and is replaced on the next write that touches the design's order.

Write behavior:

- The browser app creates designs from the project screen. The editor autosaves the whole design through `PUT /api/trickroom/design?id=<designId>`; the design file service compares it with what is on disk and writes only the files that changed: a board file when its board or its order key changed, `design.json` when a top-level field changed, and an unlink per deleted board.
- MCP `design_create` creates designs when policy allows and refuses to overwrite an existing id. Unlike the app's new designs, an MCP-created design starts without boards (or with a copy of an existing element as its board). MCP `design_apply` edits existing designs when policy and revisions allow.
- Each file is written atomically (a temporary file renamed into place). A write that changes more than one file (moving a layer between boards, promoting a layer to a board or demoting a board, reordering plus editing, converting a legacy design) is journaled; see [Multi-file writes](#multi-file-writes).
- Written JSON is tab-indented with a stable key order (`version` first; in the manifest then `name`, `systemId`, `systemName`, `componentMigrationPolicy`, other keys), so identical designs produce identical bytes.
- Every write checks that each element id is unique in the design, is a safe single path segment usable as a file name (letters, digits, `-`, `_`, `.`; not first or last; no `/`, `\`, `:` or other reserved characters), and that no two board ids differ only in letter case. Board ids name board files, and any layer can become a board.
- Reading a design never writes it. Opening a design in the app or capturing a screenshot leaves the files, the revision and the git worktree untouched.
- `GET /api/trickroom/design/board?id=<designId>&board=<boardId>` returns one board and its revision (`{ board, revision }`, also in `x-trickroom-board-revision`); in the folder layout it reads only that board's file.

### Design revisions

A design's revision is an opaque token (`r2.` followed by base64url) built from the revision of its manifest and of every board, in board order. Board and manifest revisions are content hashes of the in-memory value with object keys sorted, so the same design has the same revision whatever its formatting, key order or storage layout. Callers compare revisions for equality and pass them back; they never parse them.

A revision-checked write merges at board level against the revision the caller read (`expectedRevision`):

- Boards the caller did not change (equal to their revision in `expectedRevision`) keep what is on disk now, including changes another writer made since. The same holds for the manifest.
- A board the caller changed or deleted must be unchanged on disk since `expectedRevision`; otherwise the write is refused with `REVISION_MISMATCH` and the stale boards are named (`mismatch.staleBoardIds`; the manifest and order are reported as `manifest` and `order`). The same holds for a changed manifest.
- Boards another writer added are kept. Boards another writer deleted stay deleted, unless the caller changed them (a mismatch).
- When the caller kept the relative order of the boards it knew, the order on disk wins and new boards slot in after their predecessor. When the caller reordered, its order wins unless the order on disk changed too (a mismatch).
- The returned revision describes the merged state. The HTTP API sets `x-trickroom-design-merged: true` when the stored design kept changes the request did not have; the browser applies those changes from the response like any external change.
- HTTP design reads and writes also report every part's revision in `x-trickroom-design-state` (URI-encoded JSON `{ manifest, boards: [{ id, revision }] }`), design change events carry the same as `state`, and `GET /api/trickroom/design/manifest?id=` returns the top-level fields with those revisions and no board contents. The browser compares these for equality to reload only the parts that changed; it never parses the design revision token.

`updateDesignFile` (used by every MCP mutation and by bulk component migration) applies a mutation to a fresh read and writes it with the caller's revision as `expectedRevision` and the fresh read as the base: a mutation of board A succeeds when only board B changed since the caller's read.

A revision that is not a design token (for example an older `sha256:` revision) checks every change strictly. Designs that cannot be read report a hash of their stored bytes as their revision; only a write naming exactly that revision can replace them.

### Multi-file writes

Under the design lock, a write that changes more than one file first stores `<designId>/.journal.json` (through a temporary file and an atomic rename) with the full new contents of every file it will write and every file it will remove, applies them one by one (board files, then `design.json`, then unlinks), and deletes the journal.

- Interrupted before the journal is in place: only a temporary file is left; the old state stands.
- Interrupted after the journal is in place (between any two apply steps, or before deleting the journal): the journal is complete and replaying it yields the new state.

Every process that takes the design lock replays a leftover journal before anything else, and a reader that finds one takes the lock and replays it before reading. Replaying is idempotent. Journal paths are checked to stay inside the design. Reads take a consistent snapshot without the lock by checking every file of the design before and after reading and retrying when anything changed; a read never sees half of a write. Watchers and the design listing ignore the journal and temporary files (names starting with `.` or ending in `.tmp`).

Deleting a design removes the legacy file and the legacy memory file, then renames the folder away (`designs/.<id>.deleted-<uuid>`) in one step before removing it, so an interrupted delete leaves a whole design, never part of one.

### Design file versions

Design files carry a `version` (`DESIGN_FILE_VERSION` in `src/services/design-file-schema.ts`, currently `2`). Files without one are version 0.

| Version | Layout | Change |
| --- | --- | --- |
| 0 | `designs/<id>.json` | Files written before versioning. `componentMigrationPolicy: null` is accepted and means "not set". |
| 1 | `designs/<id>.json` | Adds `version`. Drops `componentMigrationPolicy: null`. |
| 2 | `designs/<id>/` | Splits the design into `design.json` plus one file per board, and moves memory into the folder. The in-memory shape is unchanged. |

Read path:

1. Read the design's files: the folder (`design.json` and `boards/*.json`) when `design.json` exists, otherwise the legacy `designs/<id>.json`. Board files are assembled in board order.
2. Run the ordered migration chain (`designFileMigrations`) from the stored version up to the current one, in memory.
3. Validate the result as a design and drop `version`: designs in memory, in HTTP responses and in MCP tools are always in the current shape.

The HTTP design read additionally detaches invalid known recipe instances and canonicalises `systemName` to `systemId`, also in memory only. It returns the design's revision, so the next write's revision check matches, and sets `x-trickroom-design-migration: {"fromVersion":1,"toVersion":2}` when the stored version was older and `x-trickroom-recipe-repair` when recipes were repaired. The migrated and repaired shape is persisted by the next real write.

Write path:

- Writers may omit `version`; the service treats such a payload as the current shape and stamps the current version. A payload with an older version runs through the chain first.
- Writes always produce the folder layout. A legacy design is converted on its first real write (all its files in one journaled write, removing `designs/<id>.json` and moving `designs/<id>.memory.json` into the folder). Trickroom never writes the legacy layout.
- A design, or any of its files, with a version newer than this Trickroom supports is refused with `UNSUPPORTED_DESIGN_VERSION` (HTTP 422). Trickroom never down-converts a newer file.

`trickroom migrate`:

```text
trickroom migrate [project] [--dry-run] [--json]
```

Converts every design of a project at once instead of on each design's first write, and reconciles designs that exist in both layouts (below). Each design is migrated as one journaled write under its lock and read back to confirm the in-memory design is unchanged. `--dry-run` lists what would change without writing. Output reports counts and sizes, never design contents; `--json` prints the full report. Designs that cannot be read, or that come from a newer Trickroom, are skipped and left alone; the command then exits with status 2.

Both layouts at once:

- If both `designs/<id>.json` and `designs/<id>/` exist (for example after a git merge where one branch edited the old file and another migrated), the folder wins. Reads, the design summary (`warnings: [{ code: "LEGACY_DESIGN_FILE_PRESENT" }]`) and MCP `validateDesignFile` (a warning issue) report the old file. Writes leave it alone.
- `trickroom migrate` reconciles: boards only the old file has are added after their predecessor; boards that differ (or whose ids already exist elsewhere in the folder) are saved to `designs/<id>/conflicts/<boardId>.json` as `{ version, source, board }`; differing top-level fields are saved to `conflicts/design.json`; memory notes only the old memory file has are added and a differing old memory file is saved to `conflicts/memory.json`. The old files are then removed. The folder's version of everything wins; resolve the `conflicts/` files by hand and delete them. Trickroom does not read them.

Unreadable designs:

- Listing designs includes designs that cannot be opened instead of hiding them, so a design written by a newer Trickroom does not silently disappear. Summaries from `GET /api/trickroom/designs` carry a `diagnostic` with `code` `UNSUPPORTED_DESIGN_VERSION`, `INVALID_DESIGN_PAYLOAD`, or `INVALID_DESIGN_JSON`, a message, and the stored `version` when known. Opening one returns HTTP 422 with the same message.
- Summaries are cached per design on a fingerprint of all of its files (inode, size and modification time of the manifest, every board file, the legacy file and the journal), so a change to any file refreshes the summary and its revision.

When adding a version:

1. Bump `DESIGN_FILE_VERSION` and append a `{ from, to, migrate }` step to `designFileMigrations`. Steps must not mutate their input.
2. If the step changes the on-disk layout, teach the design file service and `design-storage.ts` to read and write it; the in-memory design shape and the chain stay the same. Board files carry their own version: a board-level change must migrate board files by their own version.
3. Cover the step in `design-file-schema.test.ts` (from 0, idempotence, newer versions refused) and the layout in the design file service tests.
4. Update the table above and `docs/design-model.md`.

Path safety:

- Design ids must be a single path segment: `.`, `..`, slashes, backslashes and a leading `.` are rejected.
- Board and element ids must be safe file names (see Write behavior).

Validation rules:

- `version` may be omitted (version 0) or must be a supported version; newer versions are refused, not down-converted.
- `design.json` must declare a version of at least 2; each board file must hold `{ version, order, board }` with `board.id` equal to its file name.
- `name` must be a string.
- `systemId` may be omitted, `null`, or a stable system id.
- `systemName` is a legacy read/write compatibility field. New design writes store `systemId`; API responses may include `systemName` as display metadata.
- `boards` must be an array of valid nodes.
- Every node must have a string `id`, unique in the design.
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
- Manual migration (MCP `component_migrate` with a `rootElementId`) updates one stale instance to the current published version when the migration is safe, or returns a review-required preview when `onlySafe` blocks the write.
- Bulk migration (MCP `component_migrate` without a `rootElementId`) scans a system, optional component, or design file. It is always explicit: MCP does not auto-apply migrations on read or publish. By default `onlySafe` is true, so safe migrations are applied and review-required or blocked instances are reported without writing them.
- Automatic application inside the bulk migration helper runs only when callers pass `automatic: true`. That path requires `settings.autoMigrateComponents` on the component manifest and the design's `componentMigrationPolicy` to allow migration (`inherit` or `auto`; `manual` skips automatic writes). MCP bulk migration does not pass `automatic`, so MCP callers must run `component_migrate` explicitly, per instance or in bulk. The manifest `migrationPolicy` object is stored metadata and is not the runtime gate for automatic bulk migration.
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

## Memory Notes

Memory notes are durable steering/alignment notes attached to a primitive. They capture why a thing exists, how it should be used, and what constrains it. Memory is authored agent-first via MCP and is never auto-injected into agent context; tools and prompts only hint that relevant notes may exist.

Scopes and paths:

```text
<projectRoot>/.trickroom/memory.json                       # project scope
<projectRoot>/.trickroom/designs/<designId>/memory.json    # design scope
<projectRoot>/.trickroom/systems/<safe-system-name>/memory.json  # system scope
```

Design memory is stored in its own file rather than embedded in the design files so design diffs and memory diffs stay independent and design reads stay lean. Designs still in the legacy layout keep their memory next to the design file, in `designs/<designId>.memory.json`; it moves into the folder with the design (on the design's first write or `trickroom migrate`). A folder design still reads an old memory file next to it and moves it on its next memory write. Memory writes for a design take the design's lock. Deleting a design deletes its memory.

Manifest shape:

```ts
type MemoryManifest = {
  version: 1;
  scope:
    | { kind: "system"; id: string }   // systemId
    | { kind: "design"; id: string }   // design uuid
    | { kind: "project" };
  metadata: { createdAt: string; updatedAt: string };
  notes: Record<string, MemoryNote>;   // keyed by noteId
};

type MemoryNote = {
  noteId: string;            // "note_<uuid>", and noteId === map key
  title?: string;
  body: string;              // markdown, stored verbatim
  category:
    | "intent"
    | "usage"
    | "conventions"
    | "constraints"
    | "decision"
    | "todo";
  tags?: string[];
  pinned?: boolean;
  order?: number;
  createdAt: string;
  updatedAt: string;
  author: { kind: "agent" | "user"; label?: string };
};
```

Rules:

- `category` must be one of the six enum values; unknown categories are rejected (`INVALID_CATEGORY`).
- `noteId` must equal its map key; divergent manifests are rejected (`INVALID_MANIFEST`).
- Note bodies are stored verbatim. Bodies may embed canonical reference tokens such as `{{design:<uuid>}}`, `{{component:<id>}}`, `{{token:<domain>/<name>}}`, `{{asset:<id>}}`, and `{{icon:<id>}}`. Writes return non-blocking `referenceWarnings` for unresolved tokens; reads may pass `resolveReferences=true` (REST query param or MCP `resolveReferences` argument) to attach per-note resolution metadata without mutating stored bodies.
- Design scope ids must be a single path segment; `.`, `..`, slashes, and backslashes are rejected (`INVALID_SCOPE`).
- System scope requires a configured system; unknown systems are rejected (`SCOPE_NOT_FOUND`).

Revision and write safety:

- Every `memory.json` revision is a content hash of the exact serialized file (`sha256:<hex digest>`).
- An absent file reads as an empty manifest with a deterministic revision (fixed epoch timestamps), so a first write does not spuriously conflict.
- Note updates and deletes (`memory_write` actions `update` and `delete` in MCP) require `expectedRevision`; stale revisions return `STALE_WRITE` and do not modify the file. Adding a note is append-only and does not require a revision.
- Writes are atomic (temp file + rename) and serialized per file path.

REST surface:

| Scope | List / get | Create | Update | Delete | Reference targets |
| --- | --- | --- | --- | --- | --- |
| Project | `GET /api/trickroom/memory` | `POST /api/trickroom/memory` | `PATCH /api/trickroom/memory/:noteId` | `DELETE /api/trickroom/memory/:noteId` | `GET /api/trickroom/memory/reference-targets?type=&query=` |
| Design | `GET /api/trickroom/designs/:designId/memory` | `POST …` | `PATCH …/:noteId` | `DELETE …/:noteId` | `GET …/reference-targets?type=&query=` |
| System | `GET /api/trickroom/systems/:systemName/memory` | `POST …` | `PATCH …/:noteId` | `DELETE …/:noteId` | `GET …/reference-targets?type=&query=` |

List/get responses accept `?resolveReferences=true` to attach per-note `references` arrays. Each resolved reference may include `deepLink` (an in-app route) for valid targets. REST writes are audit-logged when `mcp.auditLog` is enabled (`source: "rest"`).

### Memory manifest migrations

New `memory.json` files are written at `version: 1` (`MEMORY_MANIFEST_VERSION` in `memory-manifest-service.ts`).

Read path:

1. Parse JSON from disk.
2. Run `migrateMemoryManifest` to rewrite older persisted shapes when the version is bumped.
3. Run `normalizeMemoryManifest` to validate scope, notes, categories, and `noteId === key` invariants.
4. Reject unsupported versions with `INVALID_MANIFEST` rather than partially loading unknown shapes.

Write path:

- All writers persist the current `MEMORY_MANIFEST_VERSION` via `serializeMemoryManifest`.
- Content-hash revision (`sha256:…`) is computed from the exact serialized bytes after normalization.

When bumping the manifest version:

1. Increment `MEMORY_MANIFEST_VERSION` and add a `migrateVXToVY` hop in `migrateMemoryManifest`.
2. Extend `normalizeMemoryManifest` for any new required fields or enum values.
3. Add regression tests in `memory-manifest-service.test.ts` covering the migration hop and normalized output.
4. Document the shape change in this section and in `docs/design-model.md` if the note model changes.

There is no automatic backfill across scopes; each `memory.json` migrates independently on read/write.

## MCP Audit Log

Path:

```text
<projectRoot>/.trickroom/audit-log.jsonl
```

Purpose:

- Records MCP creation, mutation, and screenshot attempts and outcomes when `mcp.auditLog` is true.

Write behavior:

- Appended by MCP mutation and screenshot tools. Screenshot metadata is recorded, but PNG bytes are never logged.
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
- Lets the browser app find the last app-level project, and lets MCP catalog, list, resolve, and select registered project locations.

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
- MCP `project_select` with a `path` registers a project location and selects it for the MCP session.
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

Every design revision is an opaque token that combines a revision per board and one for the manifest (see [Design revisions](#design-revisions)). Memory and system component manifest revisions are content hashes of the exact file (`sha256:<hex digest>`).

Browser editor:

- Tracks unsaved edits per board (including boards added or deleted locally), for board order and for the design's name and system, each stamped with the store revision of its latest edit.
- Keeps a base: the last version of every board, the order and the top-level fields known to be on disk, with their revisions.
- Autosaves the whole design after `1000ms`. The service writes only the boards that changed.
- Sends the persisted revision with existing-design writes (`PUT /api/trickroom/design?id=<designId>` with `x-trickroom-expected-revision`; without it the write is rejected with HTTP 428; new designs are created with `POST`). A save that changes a board another writer changed since the browser read it receives HTTP 409 and does not overwrite disk state; the editor then compares revisions with the disk again and retries once it has caught up. A save of board A while another writer changed board B succeeds and keeps both.
- Moves the base to what a completed save stored for every part it sent; edits made while the save was in flight stay dirty. A save that kept another writer's changes (`x-trickroom-design-merged`) applies them from the response without a reload.
- Subscribes to project file events. An event for the open design fetches only the boards whose revision differs from the base (and the manifest when it changed); other boards, the selection and the view are untouched. A board with local edits that also changed on disk merges by layer; only changes to the same layer prop or text on both sides (or structure that does not merge) ask the human, per board, to take the disk version or keep the local one. Keeping the local one overwrites that board only, with the disk version as the expected revision. The persisted revision moves to the disk revision once the base matches it.

MCP:

- `design_create` creates a new design with exclusive no-overwrite semantics.
- `design_apply`, which makes every change to an existing design, requires `expectedRevision`.
- The revision must come from a prior read.
- If a board (or the design's name, settings or board order) the tool changes was changed since that read, the tool returns `REVISION_MISMATCH` and does not write. Changes to other boards do not block the write. A mutation that fails while the caller's revision is out of date (for example an element another writer removed) also returns `REVISION_MISMATCH`.
- The safe response is to re-read, re-plan if needed, and retry with the new revision.

Write serialisation:

- Every design write, create, delete, migration and design memory write runs its read-check-write inside a per-design lock in the shared design file service, so the HTTP server and every MCP process get it. The lock covers the manifest, every board file, the memory file and the journal. Of two writers changing the same board from the same revision, exactly one succeeds and the other receives a revision mismatch; writers changing different boards both succeed.
- Within a process, writes to one design queue behind each other.
- Across processes, the queue head holds a lockfile created exclusively (`open(path, "wx")`) containing its pid, hostname, a token, and the acquisition time.
- Lockfiles live in the per-user home, not the project: `~/.trickroom/locks/designs/<hash>.lock` (or under `TRICKROOM_HOME`), where `<hash>` is derived from the design's legacy `designs/<id>.json` path with the project root resolved through `realpath` (the same lock older Trickroom versions take). They are never committed and never trigger the project file watchers. Every process writing a project must resolve the same Trickroom home.
- A lock is stale when its holder pid no longer exists on the same host, or when it is older than 10 seconds. Stale locks are removed and acquisition retries. A writer gives up after 5 seconds; the HTTP API answers HTTP 423 and the service raises `DESIGN_FILE_LOCKED`.
- A holder only removes the lockfile if it still contains its own token.
- A lock-taker replays a journal left by an interrupted write before doing anything else.

Change events (`GET /api/trickroom/events`, event `change`):

- Changes to the files of one design are batched and reported once they settle (75 ms without a change) and no journaled write is in progress, as `{ file: "designs/<id>", designId, revision, operation, boards }`: `revision` is the design's revision (null when deleted) and `boards` lists the boards whose content changed since the previous event, each with its revision (null when removed). During a steady stream of writes a batch is reported once it is 250 ms old, so a design that keeps changing still produces an event at least that often; an event sent before the files settled is followed by one more check once they have. Repeats of an already reported revision, and of a reported deletion, are dropped.
- Memory files and system files are reported per file: `{ file, revision, operation }` with a content hash revision.

## What Trickroom Does Not Delete

Trickroom does not delete:

- The selected project folder.
- Application source files.
- Configured Tailwind CSS files.
- The legacy `trickroom.config.json` during migration.

The destructive exceptions are inside designs: deleting a layer removes that element and all descendants from its board file, deleting a board removes its file, and deleting a design removes its folder, its legacy file and its memory. `trickroom migrate` removes legacy design and memory files after moving or reconciling their content.
