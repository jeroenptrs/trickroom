# Agent annotations: work plan

Companion to [agent-annotations.md](./agent-annotations.md), the agreed
direction, and [agent-feedback-survey.md](./agent-feedback-survey.md), the
research behind it. This file is the implementation breakdown the
orchestrating thread follows. Trunk branch: `t3/agent-annotations`. Each work
package (WP) is developed on its own branch off the trunk, reviewed, then
merged into the trunk. The trunk is merged into `main` once WP6 is done, and
`pnpm build` is run on `main` so running Trickroom instances pick the
feature up on restart.

Status key: todo, in progress, in review, merged.

Baseline on `main` at 4f893bb (2026-10-14): 2916 tests passing, 4 skipped;
135 pre-existing `tsc -b` errors; `node bin/trickroom.js lint --check` green.
Only errors in files a WP touches are that WP's.

## Decisions taken while planning

These resolve what the proposal left open and apply to every WP.

- Vocabulary in code: `annotation` is the thread, `entry` is one message in
  it (human remark, agent reply, change record), `target` is the anchor.
  Never `comment` or `feedback` (`feedback_submit` is taken).
- Store: `<TRICKROOM_HOME>/annotations/<projectId>/designs/<designId>/<annotationId>.json`
  and `.../systems/<systemId>/components/<componentId>/<annotationId>.json`.
  `TRICKROOM_HOME` resolution is the one `src/app-state/home.ts` already
  does. Files carry `version: 1` with a `{ from, to, migrate }` chain in the
  same shape as `designFileMigrations`. Directory mode 0700, files 0600,
  like the feedback store.
- Two processes write the store: the HTTP server (as the human) and the
  stdio MCP server (as an agent). Writes take a per-annotation lock with the
  design-file lock mechanism (`src/services/design-file-lock.ts`), and every
  write is read-modify-write of one file, atomic rename.
- Branch of a checkout: read `.git/HEAD` from the project root, following a
  `gitdir:` file for worktrees, without spawning git. Cache per request. A
  detached HEAD or no git yields the scope `"*"`. The scope is part of the
  annotation (`branch`, `worktreePath`), not of the path, so a later "move
  to current branch" is a field change.
- Attribution: the HTTP annotation endpoints record `by: { role: "human" }`;
  MCP tools record `by: { role: "agent", sessionId }` with the session id
  `src/mcp/tools/context.ts` already mints. Nothing else sets `by`.
- The editor learns about agent writes to the store through the existing
  `/api/trickroom/events` SSE stream: the server watches the project's
  annotation folder (it is outside `.trickroom`, so `ProjectFileEvents`
  needs a second root) and emits `annotation` events with the annotation id.
  The browser refetches that annotation.
- Acknowledged: set by the MCP server when an annotation's full body is
  included in a tool result for a session that has not seen that revision
  of it. The per-session cursor is in MCP session state, not on disk.
  Expiry (15 minutes without a tool call from that session) is computed on
  read from `acknowledged.at` and the session's last-call time, which the
  MCP server writes to `<store>/sessions/<sessionId>.json` on every call.
- Drafts live in the editor chrome store and `sessionStorage`, keyed by
  project and target, so a reload keeps them and nothing reaches disk until
  Send.
- Memory gets a `{{layer:<designId>/<elementId>}}` reference type,
  resolved like `{{design:...}}` (valid when the element exists in the
  design, broken otherwise), with a deep link that selects the layer.
- Stage selection and hover are overlay boxes in the stage document through
  `placeStageOverlayBox`, as the focus and change highlights are. The
  component draft stage drops its outline class and uses the same overlay.
  Pointer handling lives in the stage document (the iframe), resolving
  `data-trickroom-node-id` on the event path; the chrome store stays the
  single source of selection.
- Visual language: slate and cyan, square corners, IBM Plex. Pins and
  markers are small squares, not circles. Open is cyan, addressed is a
  hollow cyan square, needs input is a slate square with a cyan border,
  detached is dashed slate, resolved is slate at 40%.
- Every WP: `pnpm test`, `biome check --write`, `tsc -b` (no new errors in
  touched files), `node bin/trickroom.js lint --check`. Docs updated in the
  same WP (`docs/project-files.md`, `docs/mcp.md`, `docs/user-guide.md`,
  `docs/design-model.md` as applicable). Persisted shapes get tests for
  version 1 reads, idempotent migration and newer-version refusal.
- Acknowledged (orchestrator, 2026-10-14): a stored status plus an
  `acknowledged: { sessionId, at }` field. MCP moves `open` to
  `acknowledged` only; it never moves `addressed`, `needs_input`,
  `resolved` or `dismissed` back. Expiry is derived on read and changes
  nothing on disk. For surfacing and counts, `acknowledged` is open work.
- Annotation revisions (orchestrator, 2026-10-14): every annotation has a
  content revision returned from reads, and HTTP writes accept an optional
  expected revision, so a stale editor cannot silently overwrite an agent's
  concurrent transition.
- Canvas clicks on interactive elements inside a board (inputs, buttons,
  links, Base UI triggers) select and do not navigate, submit or open; WP1
  records how.
- A press on a board's own background selects the board (a board is a
  layer, and board-level annotations need it); a press on canvas space
  outside every board clears (orchestrator, WP1 review).
- Open work (WP2): `open` and `acknowledged` are agent work; `needs_input`
  and `addressed` wait on the designer. `countAnnotations` /
  `summarizeAnnotationCounts` are the one definition; MCP surfacing, list
  counts, `editor_context` and the rail markers all use them.
- Change-record revert state (WP2): `before` holds the own state (parent,
  props, text or child ids) of each layer the write changed, plus board
  order and settings when changed; `after` holds hashes of the same. An
  unrelated later edit on the same board neither blocks nor is undone by
  a revert. Revert runs inside the design lock through `aroundStore` and
  re-checks the annotation under its lock before writing.
- MCP branch guard (orchestrator, WP3 review): `annotation_reply` and
  `design_apply` `addresses` refuse an annotation outside the session's
  branch scope with `WRONG_BRANCH`, checked at call start and again under
  the annotation lock. The `"*"` bucket stays writable from a detached
  checkout. Every MCP response derives bodies, ids, counts and `next` from
  one fresh, eligible set.
- MCP surfacing (WP3): the per-session "seen" cursor compares status,
  entry ids and target, not the content revision; `new` holds only agent
  work; a session acknowledges only bodies it returns. When the designer
  adds a remark while an agent's `addresses` write is in flight, the change
  is recorded but the annotation stays open work and the new remark is
  surfaced in the same result. Agents re-anchor through
  `annotation_reply({ reanchor })`. Bodies carry the snapshot (stage mode,
  responsive width, design revision). `annotation_watch` defaults to 50 s
  (below the TS SDK's 60 s request timeout), max 5 min. The session clock
  file is written only once a session has acknowledged or written an
  annotation in the project, at most every 5 s.
- Editor ordering (WP4 review): the browser never compares annotation
  revisions for order (they are hashes). Every read and write takes a
  sequence at request start; a response applies only if nothing newer
  touched that annotation and the container generation is unchanged,
  otherwise an ordered re-read. A list sets a floor for unlisted ids.
- Editor presentation (WP4): pins and rail markers show the most urgent
  state (needs input, addressed, detached, open, draft, agent-resolved,
  closed); layer pins at the layer's top-right, board pins top-left,
  design-level annotations have no pin. Drafts live in their own
  `sessionStorage` store. Pure model functions live in
  `src/services/annotation-model.ts` (browser-safe), re-exported by the
  service. The thread UI in `src/components/annotations/` is shared and
  container-agnostic for WP5.

## Work packages

### WP1: stage selection parity

Status: merged (PR #28, 2026-10-14; three review rounds). Model: Opus 5.5. Depends on nothing. Parallel with WP2.

- Shared stage interaction module used by `Artboards.tsx` (design editor)
  and `ComponentDraftStage.tsx` (component editor): hover outline with the
  layer name label, click to select, double-click to drill into the first
  child, Escape to clear, click on empty board space to clear.
- Selection outline persists while selected and follows the canvas (same
  animation-frame placement the change highlight uses). Hover never fires
  during a drag or while an overlay (dialog, popover) in the board is open.
- Ancestor breadcrumb in the Properties header of both editors; clicking a
  crumb selects it.
- Keyboard: Enter drills, Shift+Enter selects the parent (the Layers rail
  already has arrow navigation; reuse its handlers).
- Component draft stage: remove the `outline outline-2 ...` class injection
  and render the overlay instead, so the preview class string stays clean.
- Tests: pointer resolution (nearest ancestor with a node id, portal hosts,
  missing renderer), hover suppression, breadcrumb.
- Verify in headless Chromium (see Verification) that clicking a layer on
  the canvas selects it in the rail and the inspector.

### WP2: annotation store, service and HTTP API

Status: merged (PR #27, 2026-10-14; two review rounds). Model: Opus 5.5. Depends on nothing. Parallel with WP1.

- Types in `src/types.ts` or a new `src/services/annotations.types.ts`:
  `Annotation`, `AnnotationTarget`, `AnnotationEntry` (human remark, agent
  reply, question, dismissal, change record), `AnnotationStatus`,
  `AnnotationSnapshot` (layer name, component, ancestor names, design
  revision, branch, worktree path, stage mode, responsive width).
- `src/services/annotation-store.ts`: path resolution, versioned read and
  write, locking, listing by design or component with branch filter and
  status filter, pruning of resolved and dismissed entries' `before` state.
- `src/services/annotation-service.ts`: create (status open, requires
  `branch`), reply, transitions with `by`, reopen on human reply, resolve
  and dismiss, bulk resolve, re-anchor, move to current branch, clear
  resolved; derivation of `detached` against a design read; `acknowledged`
  expiry derivation.
- Change records: `recordChange(annotationIds, { revisionBefore,
  revisionAfter, boards, layerIds, operations, summary, before })`, called
  from the design write path when a write carries `addresses`. The design
  write and the annotation writes happen under the design lock in that
  order, with the annotation write skipped when the design write fails.
- Revert: `revertChange(annotationId, entryId)` restores `before` through
  the design transform service when every touched layer still has the
  content it had at `revisionAfter`, else returns a `CHANGED_SINCE` error
  listing the layers.
- Delete warnings: the design transform service reports, per deleted
  element, the open annotations anchored to it or to its descendants, so
  WP3 can surface them.
- HTTP API under `/api/trickroom/annotations`: list, create, reply,
  transition, bulk resolve, re-anchor, move to branch, clear, revert.
  Human attribution. `/api/trickroom/events` gains `annotation` events.
- Memory: `{{layer:...}}` reference type in the reference grammar,
  resolution and deep link.
- Docs: new "Annotations" section in `docs/project-files.md` (per-user
  state, never committed, format, locking).
- Tests for every service rule in the proposal's Lifecycle section.

### WP3: MCP surface

Status: merged (PR #29, 2026-10-14; five review rounds). Model: Opus 5.5. Depends on WP2. Parallel with WP4.

- `annotation_list`, `annotation_reply`, `annotation_watch` in a new
  `src/mcp/tools/annotations-tools.ts` (the existing `annotations.ts` holds
  tool annotation presets; do not merge them), registered in `TOOL`, a new
  tool group, and `tool-names.ts` order. `annotation_watch` blocks with a
  short batch window and a bounded timeout and returns new or changed
  annotations for the current branch.
- `design_apply` gains `addresses: [{ annotationId, reply }]`: validated
  before the write (unknown id, wrong design, resolved thread are step
  errors), recorded after it through WP2's `recordChange`. The result lists
  the annotations addressed.
- Surfacing: a shared `withAnnotations(result, designId, session)` helper
  appends `annotations: { new: [...full bodies...], openIds, counts, next }`
  to results of `design_read`, `design_apply`, `design_validate`,
  `design_screenshot` and `editor_context`, bounded to 10 bodies, with the
  per-session cursor, and marks those bodies acknowledged. `project_list`
  and `design_list` get counts. The `next` text names the exact follow-up
  call.
- Delete warnings from WP2 become `design_validate` and `design_apply`
  warnings naming the annotations.
- Server instructions, the guide core and a new `annotations` guide topic:
  what annotations are, the loop (list or read, address with `addresses`,
  reply for questions, resolve only when asked), branch scoping, and that
  `feedback_submit` is for tool problems.
- `editor_context` adds open counts for the open design and the selected
  layer.
- Docs: `docs/mcp.md` tool reference, read-only and write classification,
  governance (annotation writes need read-write mode; reads work in
  read-only mode), audit log entries for `addresses` and resolves.
- Tests: tool surface list, surfacing cursor behaviour, acknowledged,
  `addresses` happy path and each failure, watch timeout.

### WP4: design editor UI

Status: merged (PR #30, 2026-10-14; three review rounds; agent steps re-verified through the real stdio server after rebasing on WP3). Model: Opus 5.5. Depends on WP1 and WP2. Parallel with WP3.

- Stage pins: one overlay square per annotation anchored to a visible
  layer, state-coloured, clickable (selects the layer and opens the
  thread), with a count badge when several share a layer. Board-level
  annotations pin to the board's top-left corner.
- Layers rail: marker on rows with open annotations, counted up to the
  board row. Toggle "show resolved" in the rail header.
- Inspector: an Annotations tab next to the existing inspector content,
  listing threads for the selected layer, then the board, then the design.
  Each thread: target name, state, entries in order, change records as
  "Changed N layers" rows with reveal-and-flash on click and a Revert
  control, reply composer, Resolve, Dismiss, Reopen, Re-anchor to
  selection, Move to this branch. Agent-resolved threads show a hollow
  check and an Accept control; the header has "Accept all agent-resolved"
  and "Resolve all addressed" for the board.
- Composer: new annotation on the selected layer (or board, or design when
  nothing is selected), draft kept in chrome store and `sessionStorage`,
  Send per thread and "Send all drafts" for the board. A draft shows a
  dashed pin.
- "Other branches" section at the bottom, collapsed, with Move here.
- Resolve offers "Save as memory note" with the `{{layer:...}}` reference,
  through the existing memory service.
- Live updates from the `annotation` SSE event. Acknowledged shows as
  "seen by an agent N min ago".
- Command menu entries: new annotation, send drafts, next open annotation.
- Docs: `docs/user-guide.md` Annotations section with the loop from the
  designer's side.
- Verify in headless Chromium: create, send, see it through the HTTP list,
  simulate an agent reply through the HTTP API with agent attribution (a
  test-only header is not acceptable; drive the MCP stdio server against
  the same `TRICKROOM_HOME`), see the entry appear live, resolve.

### WP5: component editor anchors

Status: in progress (branch `annotations/wp5-component-anchors`). Model: Opus 5.5. Depends on WP4.

- `componentNode` targets: `systemId`, `componentId`, `nodePath`, optional
  `variants`. Snapshot carries the node name and the variant values in view.
- Annotations tab on the component draft inspector with the same thread UI
  as WP4 (shared components, not a copy), plus "Pin to current
  configuration" in the composer, which stores the current variant values,
  and a chip on pinned threads.
- Pins on the draft stage via WP1's overlay; a pinned thread shows only
  when its variant values match the configuration in view.
- MCP: `annotation_list({ systemId, componentId })`, and
  `component_draft_update` and `component_publish` gain `addresses` with
  the same change record shape (revisions are the component revisions).
- Detached derivation against the draft template (node path no longer
  exists).
- Docs: `docs/mcp.md` and `docs/user-guide.md` additions.

### WP6: dogfood, release and build

Status: todo. Model: Opus 5.5. Depends on WP3, WP4, WP5.

- End to end on this repository's own `.trickroom` project in a scratch
  `TRICKROOM_HOME`: annotate layers in the editor, run a real agent session
  against the built MCP server (`pnpm build:mcp`, then the stdio server
  with that home) that lists, addresses with `design_apply addresses`,
  asks a question, and resolves on request; verify the editor shows every
  step live, revert works and refuses after a further edit, and branch
  scoping hides a worktree's annotations from the main checkout.
- Fix what the dogfood finds. Record follow-ups below.
- Docs pass: `docs/README.md` safety summary mentions the per-user
  annotation store, `docs/architecture.md` data flow, `docs/design-model.md`
  concepts.
- Release review of the trunk against `main` (reviewer protocol below),
  fix rounds, then the release PR trunk -> `main`, merged.
- On `main` in the main checkout `/root/workspace/trickroom`:
  `git pull --ff-only`, `pnpm install --frozen-lockfile`, `pnpm build`,
  `pnpm test`, `node bin/trickroom.js lint --check`. The build in `dist/`
  is what running instances load after restart; report its commit.

## Orchestration protocol

- Trunk `t3/agent-annotations`, branched from `main`, carries this plan and
  the proposal. WP branches `annotations/wpN-<slug>` off the trunk, in their
  own worktrees, each a top-level T3 thread on Opus 5.5 (personal Claude
  provider instance). Workers may spawn Sonnet 5.5 subagents for small
  repetitive edits and Haiku 5.5 for trivial ones.
- Every WP opens a draft PR against the trunk and links it to its thread.
  The orchestrator links every PR to its own thread as well.
- Review: a GPT-6.1 Sol thread (Codex provider instance `codex`) on the WP
  worktree with a read-only brief, 2 to 3 rounds, fixes sent to the
  implementing thread with `t3_thread_send`. Merge into the trunk only after
  the reviewer approves and `pnpm test`, `biome check`, `tsc -b` (no new
  errors) and `lint --check` are green on the WP branch rebased on the
  current trunk.
- Keep the WP status lines in this file current on the trunk, and the
  follow-ups list below.
- Stage and commit by path. Never `git stash` or `git add -A`.
- Worker threads on the personal provider can hit the subscription session
  limit mid-run. If a wait returns failed, read the last message before
  relaunching, and prefer resuming the same thread.

## Verification

The T3 preview tools cannot reach the local dev server here. Workers verify
UI with the repo's `playwright-core` headless Chromium:

- Port 18100 is usually taken by a `trickroom serve` from another checkout;
  leave it alone. The spa-server plugin in `vite.config.ts` pins 18100 and
  overrides `--port`, so start Vite through a temporary untracked config
  that wraps `vite.config.ts` and sets another port, and delete it
  afterwards.
- Set `TRICKROOM_HOME` to a temp folder so the registry in `~/.trickroom`
  (and now the annotation store) is not touched, and point the server at a
  `/tmp` copy of this repo's `.trickroom` project so autosaves do not dirty
  committed design files.
- A restarted dev server loses the active project; reopen it by path
  through the API before each check. Edits to `src/services` by a concurrent
  worker trigger SSR reloads that drop it again.
- `pkill -f <pattern>` matches the agent's own shell; kill by PID.

## Follow-ups

- Flaky pre-existing test (on `main` before this feature):
  `src/services/project-file-events.test.ts` "stops watching a missing
  folder's ancestors once nothing waits on them" counted 19 events instead
  of 20 once under full-suite load; passes alone. Its older siblings use
  fixed sleeps; WP2 moved its own watcher tests to readiness promises.
- WP2: annotation files of a deleted design stay in the store until
  cleared; a design delete could offer to clear them.
- WP2: locating an annotation without a container hint scans every
  container folder; fine at current scale, the editor passes `?designId=`.
- WP4 verification runs in parallel with WP3, so its "agent reply" step
  uses a separate Node process calling the WP2 service with agent
  attribution against the same `TRICKROOM_HOME` (what the MCP server
  process does); the real stdio server is exercised in WP3 and WP6.
- WP3: `editor_context` `selectedLayer` counts cover the selected element
  only, not its descendants.
- WP3: the MCP server instructions are 27 characters under the 2048 limit;
  the next addition needs a trim.
- WP3: `annotation_list({ status: "open" })` is a literal status filter, so
  a second call after acknowledgement returns nothing; agents should use
  the default `live` filter (the guide says so).
- WP4: change-record name substitution does not handle escaped quotes
  inside JSON string literals (a `\"<uuid>\"` can be shown as a layer
  name); display only, stored data unchanged.
- WP4: collapsed rail rows do not sum their children's counts (only the
  board row does); pins on nested layers that share a corner overlap; the
  project screen's design list shows no annotation counts.
