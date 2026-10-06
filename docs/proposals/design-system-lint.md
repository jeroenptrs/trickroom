# Design system lint

Status: analysis locked, not yet implemented. This document is the brief for
the implementation effort. Implementation is phased; rollout is not. The
feature ships when everything below works on the lead developer's day-to-day
project.

## Goal

Trickroom's design systems become enforceable. One lint engine checks both
sides of the unidirectional sync:

- Design side: layers in Designs and Components use the system's tokens,
  classes and components correctly.
- Code side: the React app that consumes the generated variants files uses
  the system's components, variants and tokens correctly.

Agents and developers hit it through the CLI and MCP. Designers see the
results in a dashboard inside the System editor.

## Decisions

### Language and hosting

- TypeScript, inside this repo, as a shared engine with two entry points:
  `trickroom lint` (CLI) and a `lint` MCP tool. The design-side rules also
  run inside the existing `design_validate` path.
- Reason: every fact the rules check already lives here. `src/codegen/model.ts`
  is the one definition of which layers become tv() slots and axes.
  `src/mcp/diagnostics.ts` already parses class strings against system tokens.
  The generated header carries componentId, slug and source hashes. A Go or
  Rust engine would duplicate all of it.
- The engine consumes a serializable "system contract" (slugs, slots, axes,
  values, tokens, bindings) produced by Trickroom, not the stores directly.
  That keeps a native port or a lint-tool adapter possible later.
- No Biome, ESLint, Oxlint or IDE integration in this effort. Biome plugins
  are GritQL and cannot read `.trickroom`; Oxlint takes JS plugins and would
  be a thin adapter over this engine if ever wanted.
- Only new dependency: `oxc-parser` (Rust-backed, Node bindings) for TSX.
  Chosen for speed, since design systems and codebases both get large; the
  `typescript` package is a fallback only if oxc cannot parse the real app.
  Import resolution is syntactic; no type checker.

### Rule kinds vs rule instances

- Rule kinds are shipped code in the engine. Rule instances are data,
  configured per design system (which components, severities, allow-lists).
  People and agents compose instances; nobody writes TypeScript to use the
  linter.
- Rule configuration is stored in the system's folder, as
  `.trickroom/systems/<id>/lint.json` next to `system.json`. It travels with
  the system and is committed like the rest of the system.

### Component identity (code side)

- Convention: the module that imports a generated variants file is that
  component. Its exports are the bound React component(s).
- Rule: more than one module importing the same variants file is a finding
  ("variants reused outside <component>"). Reuse of the styling elsewhere
  goes through a re-export from the wrapper. Direct import means "I am the
  component"; re-export import means "I borrow the styling" and gets only
  the styling rules, not the component rules.
- Escape hatch: optional per-component override in project config for
  barrel files, renamed wrappers, or deliberate sharing. Not needed on day
  one.
- Usage sites (`<Button variant="danger">` in views) import the wrapper, so
  once the wrapper is the component, usage rules need no extra wiring.

### Design-only layers (data change, needs migration)

- Add a boolean flag on component template nodes: design-only.
- Effects: codegen skips the node entirely; the node drops out of
  `hashCodegenSource` so toggling helpers never marks generated files
  stale; variant or compound classes targeting a design-only node is a
  codegen error.
- Styled vs unstyled stays inferred as today (styled becomes a tv slot).
  Element parity between template and wrapper is a later rule, not a
  prerequisite; a classless node has nothing to adhere to until it gains
  classes, at which point "slot never called" catches it.
- Follows the existing system-component revision and migration pattern in
  `src/services/`.

### Initial rule kinds

Code side:

- Variants file stale or missing (the existing codegen `--check`, surfaced
  as a diagnostic).
- Bound wrapper does not call its variants function.
- Slot emitted by codegen never called in the wrapper.
- Variant value passed in JSX (wrapper or usage site) does not exist on the
  axis; required axis missing.
- Class strings in bound wrappers and usage sites use tokens the system
  does not define, or duplicate what a variant already provides.
- Variants file imported outside its component (see identity above).
- Configurable: styling of component X allowed only on component X.

Design side (through `design_validate` and the editor):

- Same token and class rules as today, now configurable per system.
- Variant/compound targets a design-only node.
- Instances of a component use valid variant values.

Later, not prerequisites: template-to-wrapper element parity (tree walk,
reported as possible mismatches because of conditionals), accessibility
semantics.

### Dashboard (inside the System editor)

- Lives per design system, next to the rule configuration.
- Data source: the engine writes one lint report (JSON, timestamped) per
  system into `.trickroom/systems/<id>/lint-report.json`. CLI and MCP runs
  write it; the Trickroom server can run the engine on demand and write it
  too. Only the latest report is kept, and it is committed, so it acts as
  the shared baseline across machines and pull requests.
- Ratchet: a run compares itself to the committed report. It fails when any
  tracked number got worse than the baseline, or dips under a threshold set
  in `lint.json`. `trickroom lint --check` exits non-zero in that case, so it
  can gate a commit, a pull request or an agent's edit. A passing run
  overwrites the baseline. No trend history beyond "previous vs now".
- Views:
  - Adherence: findings by rule kind and severity, for code and for designs,
    with the delta against the committed baseline and the thresholds.
  - Component coverage: each system component with its state: has published
    version, has generated variants, has a bound wrapper, is used in the
    app, is used in designs. Gaps are first-class, not just errors.
  - Heat map of the codebase: a file tree (or directory treemap) of the web
    app, each node coloured by usage count and finding count, drilling down
    to files and findings.
  - Design-side equivalent: per Design file and board.
- Dashboard numbers come from the same report the CLI prints. No second
  computation.

## Phasing (implementation only)

1. Data changes: design-only flag with migration, hash and codegen checks.
2. System contract export and the engine core with the code-side rules
   above, CLI and MCP entry points, report writer.
3. Design-side rules wired into `design_validate` and the editors, rule
   configuration per system.
4. Dashboard in the System editor reading the report store.
5. Dogfood on the lead developer's web app until clean; then release as one
   feature.

## Resolved with the lead developer

- Rule config: `.trickroom/systems/<id>/lint.json`, committed.
- Reports: latest only, committed, used as a ratchet baseline plus
  thresholds. Worse than baseline or under threshold fails the run.
- Parser: `oxc-parser`, speed first.

Remaining for the implementation thread: the exact field shapes of
`lint.json` and `lint-report.json`, which fall out of the first rule kinds.
