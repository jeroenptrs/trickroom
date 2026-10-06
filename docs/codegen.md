# Component Codegen

Trickroom can write each published system Component as a [tailwind-variants](https://www.tailwind-variants.org/) file in your codebase, and check later that those files still match the Components. This page is for a developer or coding agent adopting it in their own project.

## What Is Generated

One `.ts` file per selected Component, containing a `tv()` call built from the Component's authored classes: the template's `className`s, the classes each variant value adds, compound variants and default variant values. Variant axes keep Trickroom's layering order, and boolean axes (values `true` and `false`) become real booleans. Each axis also gets an exported type alias.

What is not generated, and stays with you:

- The React component that wraps the variants: markup, props, refs, behaviour.
- Classes that come from a Library's registry Elements or Recipes.
- Instance overrides set in Designs.
- Design-only template nodes and everything under them (see [Design-Only Nodes](#design-only-nodes)).

Every generated file starts with two header lines and imports `tv` from `tvImport` (default `./tv`, a module you provide, for example one that calls `createTV` with your `tailwind-merge` config).

## Configure

Add a `codegen` block to `.trickroom/config.json`. The minimal block:

```json
"codegen": { "version": 1, "outDir": "src/components/ui" }
```

`system` defaults to the project's default system; `fileName`, `tvImport`, `shape`, `include`, `exclude` and `formatter` are optional. Every field is described in [Files And Safety](project-files.md#codegen-block).

The formatter runs on every generated file before it is compared or written, so the files on disk can match your formatting. It runs without a shell from the project root, gets the source on stdin and must print the formatted source on stdout; `{file}` in `args` becomes the output path relative to the project root. For Biome:

```json
"formatter": { "command": "./node_modules/.bin/biome", "args": ["format", "--stdin-file-path={file}"] }
```

The command comes only from the config file. Nothing on the command line or over MCP can set it, but a check runs it too.

## Shapes

- **flat**: only the root carries classes. The file exports `tv({ base, variants, compoundVariants, defaultVariants })` and a call returns a class string.
- **slots**: other template nodes carry classes too. Each styled node becomes a slot keyed by its path in camelCase (the root is always `root`), and a call returns one function per slot.

`shape: "auto"` (the default) picks flat when only the root is styled and slots otherwise; `shape: "slots"` always emits slots. A slotted result is used like this:

```tsx
const s = toastVariants({ type });
return (
  <div className={s.root({ class: className })}>
    <span className={s.title()}>{title}</span>
  </div>
);
```

## Design-Only Nodes

A template node with `designOnly: true` exists in Designs but not in code: an annotation, a measurement guide, a layout helper. The flag is inherited, so its whole subtree is design-only too, including the default children of slots hosted inside it. Set it with the "Design only" switch in the component inspector, or as a template node field over MCP.

- Codegen skips design-only nodes with their subtree: none of them becomes a slot, and their classes do not count when `shape: "auto"` decides between flat and slots.
- A variant value or compound variant whose `classesByPath` names a path inside a design-only subtree fails the run with `DESIGN_ONLY_CLASS_TARGET`. Remove or retarget the entry, or clear the flag. A path that is not in the template at all is still `UNKNOWN_CLASS_TARGET`.
- A design-only root makes the whole Component design-only: it gets no file, and the run reports a `DESIGN_ONLY_COMPONENT` warning. Its variant and compound classes are still checked first, so any class entry fails with `DESIGN_ONLY_CLASS_TARGET`. A file generated for it earlier shows up as orphaned.
- `sourceHash` leaves design-only subtrees out, together with slots hosted and override targets pointing inside them, so editing inside one does not change it. Empty `children` and `defaultChildren` lists are left out of the hash too, so an empty list, an omitted one and one holding only design-only nodes hash the same; a Component stored with an explicit empty list gets a one-time `sourceHash` change from this rule. Turning the flag on or off for a node that codegen emits does change it, because the output changes.

The flag is part of the Component's template, so changing it is a draft change that needs a publish like any other. A publish still moves `publishedVersion` and `templateHash` in the header, so a check reports the file `stale` (`source-changed`) until it is regenerated; when only design-only nodes changed, `sourceHash` is the same as on disk and regenerating rewrites only the header line.

## Names

- File: `fileName` with `{slug}` replaced by the Component slug, default `{slug}.variants.ts` (`otp-field.variants.ts`).
- Export: the slug in camelCase plus `Variants` (`otpFieldVariants`).
- Axis types: the slug and the axis key in PascalCase (`OtpFieldSize`). No initialism dictionary: `otp` stays `Otp`.
- Slot keys: the node path in camelCase. Paths that collide, map to `base` or are not valid identifiers are errors.

Two Components that produce the same file or export name fail the whole run.

## Header

```ts
// Generated by Trickroom. Do not edit.
// trickroom-codegen: {"version":1,"systemId":"sys_…","componentId":"cmp_…","slug":"toast","source":"published","publishedVersion":"3","templateHash":"sha256:…","variantSchemaHash":"sha256:…","sourceHash":"sha256:…"}
```

| Field | Meaning |
| --- | --- |
| `systemId`, `componentId`, `slug` | What the file was generated from. |
| `source` | `published`, or `draft` when generated with `--source draft` from a Component that has a draft. |
| `publishedVersion` | The published version used; null for a draft. |
| `templateHash`, `variantSchemaHash` | The Component's own hashes for that version. |
| `sourceHash` | A hash of everything generation reads. Renaming labels and editing design-only nodes do not change it. |

The header is how Trickroom recognises its own files. A formatter must leave the two lines in place.

## Run It

```sh
trickroom codegen [project] [--check] [--json] [--source published|draft] [--force]
```

Without `--check` it generates everything in memory first, then writes only the files whose content differs, creating `outDir` when needed. Any error means nothing is written.

With `--check` nothing on disk changes: not the generated files, not the config, not the system manifests. Each Component gets a status:

| Status | Meaning |
| --- | --- |
| `ok` | The file matches (CRLF line endings on disk are fine). |
| `missing` | No file yet. |
| `stale` | The file differs. `reason` says why: `source-changed` (the Component moved on: its header has another version, source or hash), `body-edited` (the header matches, the body was edited or reformatted) or `not-generated` (the file has no Trickroom header). |
| `error` | The formatter failed for this file. |

Orphaned files are reported separately: files in `outDir` with this system's header that no selected Component generates any more (renamed, deleted or excluded Components). Trickroom never deletes them; delete them yourself once nothing imports them.

Exit codes:

| Code | When |
| --- | --- |
| 0 | Check: everything is `ok` and there are no orphans. Write: everything is written or already current. |
| 1 | Check: something is `missing`, `stale` or orphaned. |
| 2 | No or invalid `codegen` block, a generation error, a formatter failure, a path outside the project, or a refused overwrite. |

Run `trickroom codegen --check` in CI to catch Components that changed without their files being regenerated.

### Ownership And `--force`

Trickroom only replaces files that carry its header. If a target file exists without one, for example because an older generator or a person wrote it, the whole run is refused with `REFUSED_OVERWRITE` and the list of paths. To hand such files over to Trickroom, review them and run `trickroom codegen --force` once; after that they carry the header and later runs recognise them. `--force` is a CLI flag only.

`outDir` and each target are resolved with symlinks followed and must stay inside the project.

### Draft Source

`--source draft` generates from each Component's draft, and from the published version for Components without one. Those files say `source: "draft"` in their header, so a later published check reports them `stale` (`source-changed`) until the drafts are published and the files regenerated. This is intended: draft output is for trying changes, not for committing.

## JSON Result

`--json` prints this object alone on stdout. It is an interface: tooling can read it to report staleness.

```ts
type CodegenRunResult = {
  status: "ok" | "drift" | "error";
  mode: "write" | "check";
  source: "published" | "draft";
  system: { id: string; name: string } | null;
  outDir: string;             // relative to the project root, "/" separators
  components: Array<{
    slug: string;
    componentId: string;
    file: string;             // relative to the project root
    status: "ok" | "missing" | "stale" | "error";
    source: "published" | "draft";   // what this run generated from
    shape: "flat" | "slots";
    publishedVersion: string | null;
    sourceHash: string;
    onDisk: { publishedVersion: string | null; sourceHash: string; source: "published" | "draft" } | null;
    reason?: "source-changed" | "body-edited" | "not-generated";
    message?: string;
  }>;
  orphaned: string[];
  diagnostics: Array<{
    code: string;             // e.g. REFUSED_OVERWRITE, FORMATTER_FAILED, UNKNOWN_INCLUDE_SLUG
    severity: "error" | "warning";
    message: string;
    slug?: string;
    componentId?: string;
    path?: string;
    paths?: string[];         // REFUSED_OVERWRITE
  }>;
  written: string[];          // empty in check mode
};
```

`status` is `drift` only in check mode. In write mode, `components` shows the state after the run (written files are `ok`) and `written` lists what changed. Components skipped with a warning (for example an `include` slug that is not published) appear only in `diagnostics`. Without a `codegen` block, `--json` prints `{ "status": "error", "code": "CODEGEN_NOT_CONFIGURED", "message" }` instead.

## Diagnostics

Generation diagnostics carry a `code`, a `severity`, a `message` and, where they apply, the Component `slug`, `componentId` and template `path`. Any error stops the whole run; a warning skips one Component.

| Code | Severity | When |
| --- | --- | --- |
| `UNKNOWN_INCLUDE_SLUG`, `UNKNOWN_EXCLUDE_SLUG` | error | `include` or `exclude` names a slug the system does not have. |
| `UNPUBLISHED_COMPONENT` | error | An `include`d Component has no published version. |
| `MISSING_PUBLISHED_VERSION` | error | `currentVersion` points at a version that is not stored. |
| `NO_SOURCE_PAYLOAD` | warning, error when included | With `--source draft`, a Component has neither a draft nor a published version. |
| `DESIGN_ONLY_COMPONENT` | warning | The template root is design-only; the Component is skipped. |
| `DUPLICATE_FILE_NAME`, `DUPLICATE_EXPORT_NAME` | error | Two Components produce the same file or export name. |
| `INVALID_EXPORT_NAME` | error | The slug does not produce a valid identifier. |
| `DUPLICATE_PART_PATH` | error | A path appears twice across the template and slot default children. |
| `RESERVED_PART_PATH`, `INVALID_PART_IDENTIFIER`, `PART_KEY_COLLISION` | error | A styled path maps to `base`, to an invalid identifier, or to the same slot key as another path. |
| `UNKNOWN_CLASS_TARGET` | error | Variant or compound classes name a path that is not in the template. |
| `DESIGN_ONLY_CLASS_TARGET` | error | Variant or compound classes name a path inside a design-only subtree. |
| `DEFAULT_CHILD_CLASS_TARGET` | error | Variant or compound classes name a slot default child. |
| `RESERVED_AXIS_NAME`, `INVALID_TYPE_ALIAS`, `DUPLICATE_TYPE_ALIAS` | error | An axis key collides with a tailwind-variants option or produces an unusable or duplicate type name. |
| `INVALID_BOOLEAN_AXIS`, `BOOLEAN_AXIS_WITHOUT_DEFAULT` | error | A boolean axis does not have exactly `true` and `false`, or has no default. |
| `TEMPLATE_PROPS_CLASS_NAME` | error | A template node sets `props.className`; move it to `className`. |

`trickroom codegen --check` reports these like any other error: status `error`, exit code 2.

## From An Agent

`design_export({ format: "variants" })` runs the same thing over MCP and returns the same object as `codegen` in the success payload; `check: true` and `source` work as above. It needs read-write mode, also for checks, because a check runs the formatter. There is no `force` over MCP: a refused overwrite is a tool error that asks a human to run the CLI with `--force`. See [Agents And MCP](mcp.md#export).
