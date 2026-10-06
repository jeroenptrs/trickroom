# Design system lint: work plan

Companion to [design-system-lint.md](./design-system-lint.md), which is the
locked analysis. This file is the implementation breakdown the orchestrating
thread follows. Trunk branch: `t3/design-system-lint-orchestration`. Each work
package (WP) is developed on its own branch off the trunk, reviewed, then
merged into the trunk. The trunk is merged into `main` once WP6 is done.

Status key: todo, in progress, in review, merged.

## Decisions taken while planning

These resolve ambiguities the analysis left open and apply to all WPs.

- Design-only is inherited: marking a template node design-only also makes
  every descendant design-only. A design-only subtree is dropped from
  codegen and from `hashCodegenSource`. A variant or compound class entry
  that targets a path inside a design-only subtree is a codegen error.
- The engine lives in `src/lint/`. Pure modules (contract, rules, report,
  ratchet) are separate from filesystem adapters (`run-lint.ts`), following
  the `src/codegen/` split between `generate.ts` and `run-codegen.ts`.
- One report per system at `.trickroom/systems/<id>/lint-report.json`, one
  config per system at `.trickroom/systems/<id>/lint.json`. Both versioned
  (`version: 1`) so they can be migrated like other persisted shapes.
- The code side needs to know where the app's source is. Rule config holds
  `include`/`exclude` globs relative to the project root; the default scans
  the folder that contains `codegen.outDir` and its parent `src`-like root.
  WP2 fixes the exact default.
- `oxc-parser` is a regular dependency and is marked external in every Vite
  SSR bundle (same mechanism as `playwright-core`, see
  `optionalRuntimeDependencies` in the `vite.*.config.ts` files).
- Numbers the dashboard shows are read from the report file. Nothing in the
  browser recomputes findings.
- Decisions taken in WP2 (details in [docs/lint.md](../lint.md)):
  - `lint.json` keys rule instances by rule kind id, one instance per kind;
    per-component scoping is a kind's `options`. Unknown ids are errors, so a
    planned kind cannot be configured before it ships.
  - Default source globs: the source-like root containing `codegen.outDir`
    (up to and including the first `src`, `app`, `lib`, `source` or
    `packages` segment, else the top-most segment), `src/**` without codegen.
  - Every report carries `ratchetBaseline`. A passing run sets it to its own
    numbers; a failing run written on demand (dashboard `POST`,
    `write: "always"`) keeps the previous one, so a failing report never
    lowers the bar. The CLI and the MCP tool write nothing on a failure.
  - The compiled Tailwind utility inspector is the only lazy input of the
    rule context; token names per domain are in the contract. The source
    index is built once per run (the heat map needs it).
  - Two code-side kinds ship in WP2: `code.variants-file-stale` (error) and
    `code.variants-file-orphaned` (warning). A project without a `codegen`
    block gets one `info` finding, not a violation.
  - The `lint` MCP tool needs read-write mode in every case, like
    `design_export`, and lives in the `designValidation` group.
  - `oxc-parser` is external in every SSR bundle as `nativeRuntimeDependencies`,
    a separate list from the optional `playwright-core`.
- Dogfood target for WP6 is this repository's own `.trickroom` project
  (system `trickroom`, 16 components), with a `codegen` block pointing at a
  scratch `outDir`. The lead developer's day-to-day app is a second pass they
  run themselves.

## Work packages

### WP1: design-only template nodes

Status: merged. Model: Opus 5.5. Depends on nothing.

- `RecipeTemplateNode.designOnly?: boolean` in `src/types.ts`; validation in
  `src/utils/system-components-validation.ts` accepts it.
- Manifest version 2 -> 3 with the migration pattern in
  `src/utils/system-component-manifest-service.ts` (`normalizeSystemComponentManifest`).
  Reading a v2 manifest yields v3 in memory; the next write persists it.
- Codegen: `collectParts` in `src/codegen/model.ts` skips design-only
  subtrees; `checkTarget` reports `DESIGN_ONLY_CLASS_TARGET` (error) for
  variant or compound classes pointing into one. `hashCodegenSource` in
  `src/codegen/header.ts` strips design-only subtrees before hashing. Draft
  and published template hashes are unchanged (they describe the template,
  not the generated code).
- System editor: a "Design only" toggle in the component inspector for the
  selected template node, an inherited state shown read-only on descendants,
  and a marker in the component layer tree.
- MCP: `component_draft_create` and `component_draft_update` accept the flag
  as part of the template (it is a node field, no new parameter); the
  `component-authoring` guide topic documents it.
- Docs: `docs/project-files.md` (manifest version, field), `docs/codegen.md`.
- Tests: migration, codegen skip, hash stability, class-target error, UI toggle.

### WP2: lint foundation

Status: merged. Model: Fable 5.1 (architecture). Depends on nothing; WP3,
WP4 and WP5 depend on it.

Deliverables, all in the repo:

- `docs/lint.md`: the engine architecture, the exact shapes of `lint.json`
  and `lint-report.json`, the system contract shape, the rule kind catalogue
  with ids and severities, the ratchet semantics, CLI and MCP usage. This is
  the reference WP3 to WP5 build against; keep it current.
- `src/lint/contract.ts`: `SystemContract` (serializable: system id and name,
  components with slug, componentId, published version, export name, file
  name, slots, axes with values and defaults, booleans, compounds; token
  domains and tokens; design-only paths) and `buildSystemContract` from the
  system manifest and component manifest, reusing `src/codegen/model.ts`.
- `src/lint/config.ts`: `lint.json` schema, defaults, loader, issues and
  normalization in the style of `src/codegen/config.ts`. Rule instances are
  data: rule kind id, enabled, severity, options, allow-lists, thresholds.
- `src/lint/report.ts`: `LintReport` and `LintFinding` shapes, writer and
  reader, stable ordering so the committed file diffs cleanly.
- `src/lint/ratchet.ts`: compare a run with the committed report and the
  thresholds; produce pass/fail with the numbers that got worse.
- `src/lint/rules/`: the rule kind interface (`id`, `side: "code" | "design"`,
  `defaultSeverity`, `run(context)`) and a registry. Ship the first code-side
  rule kind here: variants file stale or missing, built on `runCodegen` in
  check mode.
- `src/lint/source/`: `oxc-parser` based TSX parsing with a small module
  model (imports with resolved relative paths, exports, JSX elements with
  attribute literals, string literals in `className` and `tv()`/`cn()`-like
  calls). Syntactic only. Include the generated-variants-file detection via
  `parseCodegenHeader`. WP3 builds its rules on this model.
- `src/lint/run-lint.ts`: filesystem adapter: read project config, system,
  components, lint config, scan files, run rules, compute the ratchet, write
  the report. Mirrors `src/codegen/run-codegen.ts` in shape and safety
  (realpath checks, no writes outside `.trickroom`).
- CLI `trickroom lint [project] [--check] [--json] [--system <id>]` in
  `src/cli/lint.ts`, `vite.lint.config.ts`, `bin/cli-command.js`,
  `bin/trickroom.js`, `package.json` scripts. Exit codes follow codegen:
  0 pass, 1 ratchet failure, 2 error.
- MCP tool `lint` registered in `src/mcp/tools/`, added to `tool-names.ts`
  and `tool-groups.ts`, with the surface tests updated.
- Hono: `GET /api/trickroom/systems/:systemName/lint` returns the stored
  report, `POST` runs the engine and writes it. Client query options in
  `src/queries/system-lint.ts`, and the query prefix added to
  `src/hooks/useProjectFileEvents.ts` so a new report refreshes the UI.
- `oxc-parser` added to dependencies and to the SSR externals.
- Tests for each module, plus one end-to-end test that lints a temp project
  built with `createCodegenTestProject` and finds a stale variants file.

### WP3: code-side rules

Status: merged. Model: Opus 5.5. Depends on WP2.

Rule kinds, each with tests on fixture TSX:

- Bound wrapper does not call its variants function.
- Slot emitted by codegen never called in the wrapper.
- Variant value passed in JSX (wrapper or usage site) does not exist on the
  axis; required axis (no default) missing.
- Class strings in bound wrappers and usage sites use tokens the system does
  not define, or duplicate what a variant already provides. Reuse
  `src/mcp/diagnostics.ts` class parsing.
- Variants file imported outside its component; re-export from the wrapper
  is the sanctioned way to borrow styling.
- Configurable: styling of component X allowed only on component X.
- Component identity resolution: the module importing a generated variants
  file is the component; per-component override in `lint.json` for barrels.

### WP4: design-side rules and configuration

Status: merged. Model: Opus 5.5. Depends on WP2 and WP1.

- Design-side rule kinds through the engine: token and class rules (the
  existing `getDesignDiagnostics` checks, now configurable per system),
  variant or compound targets a design-only node, instances use valid
  variant values.
- `design_validate` and the editor's validation path run the design-side
  rules with the system's `lint.json`, so severities and allow-lists apply.
- The design side of the report: findings per Design file and board, and
  component usage in designs for the coverage view.

Decisions taken in WP4 (details in [docs/lint.md](../lint.md)):

- Three kinds: `design.unknown-class-token` (warning; options `allow`
  and `codes`), `design.design-only-class-target` (error, component-level,
  location null) and `design.unknown-variant-value` (error, checked against
  the version the instance uses). After merging WP3, one pure module holds
  the per-class checks (`src/utils/class-token-diagnostics.ts`), shared by
  both class kinds and `getDesignDiagnostics`; `design-class-diagnostics.ts`
  only adds the design element on top.
- The contract gains `versions` (axes of every published version, from the
  variant schema) and `classTargets`, and uses WP1's
  design-only path set (slot default children of a design-only host
  included).
- Kinds declare their options as specs (`LintRuleKind.options`,
  `src/lint/rule-options.ts`); `getLintConfigIssues` validates `lint.json`
  against them and `LINT_RULE_OPTION_SPECS` is derived from them. Invalid
  options are `INVALID_LINT_CONFIG` for a lint run and the dashboard's save,
  and fall back to the defaults (with a warning) in `design_validate` and
  the editor.
- `designs[]` follows the dashboard's convention: the `board: null` row of
  a design holds only what is on no board; the design's total is the sum of
  its rows.
- Lint reads designs without the design lock (`readDesignFileWithoutLock`),
  so it never replays a journal or writes; unreadable designs are
  `DESIGN_UNREADABLE` warnings.
- `design_validate` reports lint findings with the rule kind id as `code`
  and the former class code in `check`; `design_apply` keeps its codes.
- The editor gets `GET /api/trickroom/design/lint` and a findings list in
  the design inspector (selected layer, or the design's totals).
- Coverage rows gain `designUsages` (optional in the type so older reports
  still parse).

### WP5: dashboard and rule configuration UI

Status: merged. Model: Opus 5.5. Depends on WP2; verify against WP3 and WP4
output once merged.

- New `lint` page in the System editor (`SYSTEM_EDITOR_PAGES`,
  `SystemEditorPage`, deep link, rail entry).
- Views from the analysis: adherence (by rule kind and severity, code and
  design, delta against baseline, thresholds), component coverage, codebase
  heat map (file tree coloured by usage and findings, drill to findings),
  design-side equivalent per Design and board.
- Rule configuration editor writing `lint.json` through the server.
- "Run lint" action calling the POST route; stale report indicator.
- Brutalist visual language, flexbox, `src/components/ui/` primitives.

### WP6: dogfood and release

Status: todo. Model: Opus 5.5 for fixes, orchestrator for the release.

- Run on this repository's project until the report is clean or every
  remaining finding is a real one. Fix false positives in the rules.
- Docs pass: `docs/README.md`, `docs/mcp.md`, `docs/development.md`,
  `docs/user-guide.md`, CLAUDE.md pointers.
- Pull request from the trunk to `main`.

## Review protocol

Every WP is reviewed by a GPT-6.1 Sol thread on the Codex provider, running
read-only in the WP's worktree. The reviewer checks the diff against the
trunk for correctness, test coverage, adherence to the analysis and this
plan, and the repo conventions in CLAUDE.md. Findings go back to the
implementing thread; the orchestrator merges when the reviewer has no
blocking findings and `pnpm test`, `biome check` and `tsc -b` (no new errors
in touched files) pass.
