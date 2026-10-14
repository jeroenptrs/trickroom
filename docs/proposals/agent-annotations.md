# Agent annotations

Status: direction agreed with the lead developer on 2026-10-14, not yet
implemented. Research behind it: [agent-feedback-survey.md](./agent-feedback-survey.md).

## Goal

A designer selects a layer in the design editor, or a node in the component
editor, and writes a remark on it. Agents working through MCP see open
remarks as part of their normal tool traffic, ideally in the same turn,
address them by changing the design, and the change lands as a reply under
the remark. The designer resolves it or adds more feedback.

The conversation with the agent stays in the harness (Claude Code, Codex,
T3 Code). Trickroom owns the remarks, the anchors, the lifecycle and the
record of what changed. It does not own a chat.

## Non-goals

- A chat panel, prompt queue, interrupt or steer control inside Trickroom.
  The harness has them.
- Drawn or pixel-anchored annotations. Layers have ids; pixels do not.
- Comments between people without an agent in the loop. The same model can
  carry them later, but they do not prove the loop.
- Generated variations with keep or discard. Agents can write variants as
  sibling boards.

## Decisions

### Canvas selection ships first

The Layers rail is the only way to select a layer in the design editor; the
canvas has no click-to-select, hover or breadcrumb. The component draft stage
selects on click by adding an outline class to the rendered element. Before
annotations:

- One stage interaction layer for both editors: hover outline with the layer
  name, click to select, Escape to clear, double-click to drill into
  children, ancestor breadcrumb in the inspector header.
- Selection and hover are overlay boxes in the stage document, like the focus
  and change highlights (`placeStageOverlayBox`), not classes on the element.
  The component editor moves to the same overlay.
- Single selection only. Nothing in annotations needs multi-select.

### Storage: per user, outside the repo

Annotation threads are transient working state, not design data. They are
not committed. A remark that should outlive the thread is graduated to a
memory note (below), which is committed.

```text
~/.trickroom/annotations/<projectId>/designs/<designId>/<threadId>.json
~/.trickroom/annotations/<projectId>/systems/<systemId>/components/<componentId>/<threadId>.json
```

- Keyed by the stable `projectId` from `.trickroom/config.json`, so every
  worktree and every agent session on the same project reads the same store.
  Keying by path, as the design locks do, would hide a remark made in the
  main checkout from an agent working in a worktree of the same branch.
- Scoped by branch. A thread records the git branch and worktree path it was
  created from. Tool results and the editor show the current checkout's
  threads; threads from other branches are listed only on request
  (`annotation_list({ branch: "all" })`, an "other branches" section in the
  inspector) and never surfaced as work to do. A remark made against a
  feature branch is about that branch's state: on main the layer may not
  exist, or may exist and be wrong to touch. After a merge the designer can
  move a thread to the current branch. A detached checkout or a project
  without git uses one unscoped bucket.
- One file per thread, mirroring `boards/<boardId>.json`: the designer opens
  and resolves threads while an agent replies on others, and no two writes
  touch the same file.
- `TRICKROOM_HOME` relocates it like the rest of the per-user state.
- Files carry `version: 1` and a migration chain from day one, as design
  files and memory notes do.
- Resolved and dismissed threads stay until the designer clears them
  (per board, per design). Bloat is not a concern outside the repo.

Rejected: committing open threads only. Open and resolved are one file whose
state changes, so "commit open only" needs a second location or a move on
resolve, and worktrees still would not share threads.

### Anchors

```ts
type AnnotationTarget =
  | { kind: "design"; designId: string }
  | { kind: "board"; designId: string; boardId: string }
  | { kind: "layer"; designId: string; boardId: string; elementId: string }
  | {
      kind: "componentNode";
      systemId: string;
      componentId: string;
      nodePath: string;
      /** Variant values the remark is pinned to; absent = every configuration. */
      variants?: Record<string, string>;
    };
```

Every target carries a snapshot taken when the thread was created: layer
name, component (`library/component`), ancestor names, design revision,
git branch and worktree path, stage mode and responsive width. A board is reviewed at several widths, so
"this wraps badly" needs the width.

Component-node remarks apply to all variant configurations by default. The
annotation popover has a "Pin to current configuration" control that stores
the variant values the designer was looking at.

### Detached, not deleted

Detached is derived, never stored. A thread whose element no longer exists
renders with its snapshot and a detached marker, and reattaches when the id
returns (undo, git checkout, Take theirs). `design_apply` warns when a step
deletes an element with open threads. Steps that mint ids (`copySubtree`,
`detachSystemComponent`, component extraction) do not move threads; the
designer or agent re-anchors explicitly.

### Lifecycle

```text
open ──▶ acknowledged ──▶ addressed ──▶ resolved
  │           │               │            ▲
  │           └──▶ needs_input ┘            │
  └──────────────────────────────▶ dismissed
```

- `open`: sent by the designer. Drafts never reach disk (below).
- `acknowledged`: an agent session has seen it. Set automatically the first
  time the thread appears in full in a tool result for that session. It
  records `sessionId` and a timestamp, and means "possibly being worked on".
  It is advisory: other sessions still see the thread, with "acknowledged by
  another session N minutes ago", and it expires after the session has been
  silent for a while (proposed: 15 minutes), which covers an agent that saw
  the thread and never acted on it. Expiry changes nothing on the thread
  itself. It never blocks.
- `addressed`: an agent replied with a change record.
- `needs_input`: an agent asked a question. The designer's reply reopens.
- `resolved`: done. `dismissed`: not doing this, with a reason.
- A designer reply on an addressed, resolved or dismissed thread reopens it.
- Every transition records `by: { role: "human" | "agent"; sessionId? }` and
  a time. State is per thread, never per batch: five remarks sent together
  come back with four addressed and one still open.

Who may resolve: both. The designer resolves in the editor, singly or in
bulk ("resolve all addressed on this board"). An agent may resolve when the
designer asks it to in conversation, and may dismiss with a reason. What is
enforced is attribution, not permission: the MCP server knows every call it
handles is an agent, and the editor writes through the HTTP API as the human,
so `resolvedBy` cannot be forged. The editor renders agent-resolved threads
distinctly and offers "accept all agent-resolved" and "reopen". This keeps
the information Bolt's auto-resolve-on-send throws away, without a
permission rule the server could not verify ("the human said so") and
without a project setting nobody can name.

### Batch, then send

Annotations are drafts in browser state until the designer presses Send,
per thread or per board. Once a thread is on disk it is in front of a working
agent within one tool call, so a half-written remark must never be on disk.
Threads written through the HTTP API are sent by definition.

### Agent replies and change records

An agent reply is a thread entry. It may carry text, a question, a proposed
dismissal, or a pointer to a change record. Change records are their own
entries:

```ts
type ChangeRecord = {
  revisionBefore: string;
  revisionAfter: string;
  boards: string[];
  layerIds: string[];
  operations: { operation: string; summary: string }[];
  summary: string;
  /**
   * The layers this write touched, serialized as they were before the
   * write (not the annotation): what "revert this change" restores.
   */
  before: Record<string, Node>;
};
```

- Clicking a change record in the editor reveals and flashes the layers, the
  same path external changes use today.
- "Revert this change" restores `before` while the touched layers are at
  `revisionAfter`'s content, and refuses with the board-revision check when
  they have moved on. The audit log is opt-in and outside the design folder,
  so it cannot carry this.
- `before` is dropped when the thread is resolved or dismissed, to bound
  file size: revert is available while the thread is live.

### Graduation to memory

Resolving a thread offers "Save as memory note". The note body is the
remark plus the final reply, with a `{{layer:<designId>/<elementId>}}`
reference (new reference type, resolved like the existing ones). Memory is
the committed, durable form; threads are not.

## MCP surface

Name the feature annotations. `feedback_submit` already means "an agent
reports a problem with Trickroom".

- `annotation_list({ designFileId | systemId, status?, boardId?, branch? })`:
  threads with ids and anchors, so every follow-up call has what it needs.
  Current branch by default; `branch: "all"` for the rest.
- `annotation_reply({ threadId, body?, question?, dismiss?: { reason },
  resolve?: { summary } })`: reply without a design write. Sets
  `needs_input`, `dismissed` or `resolved` as appropriate.
- `design_apply` gains `addresses: [{ threadId, reply }]`. The design write,
  the change record and the transition to `addressed` commit under the design
  lock in one journaled write, so a reply can never describe a write that was
  refused with `REVISION_MISMATCH`.
- `annotation_watch({ designFileId, timeoutMs })`: blocks until sent threads
  arrive, batched over a short window. For "keep working on my feedback"
  sessions where no other tool is being called.
- `editor_context` adds open thread counts for the open design and the
  selected layer.

### Surfacing in results

Delivery between tool calls is what every harness converges on, and it is
the only boundary an MCP server has. Results of `design_read`,
`design_apply`, `design_validate`, `design_screenshot` and `editor_context`
carry the open threads of the design they touched. `project_list` and
`design_list` carry counts per design.

- Per-session cursor: full bodies only for threads new or changed since this
  session last saw them. Afterwards a count and the ids.
- Bounded: at most N bodies per result, with `annotation_list` named as the
  follow-up.
- Phrased as the next action: "2 new annotations on board Checkout. Address
  them with design_apply addresses, or reply with annotation_reply: ...".
  The server instructions and the guide core get one line each.

Appearing in full in a result is what sets `acknowledged`.

## Editor

- Stage: a pin per thread as an overlay box in the stage document, with
  state colour (open cyan, addressed hollow, detached dashed slate). Clicking
  a pin selects the layer and opens the thread.
- Layers rail: a marker on rows with open threads, counted up to the board.
- Inspector: a third tab, Annotations, listing threads for the selected
  layer, then the board and design threads above. Composer with Send, state
  controls, reply, bulk resolve, revert on change records, save as memory.
- Component editor: the same tab on the draft inspector, with the pin-to-
  configuration control.
- Agent presence: "acknowledged by a session N minutes ago" on the thread,
  derived from the state, not a separate feature.

## Later: structured steering

Steering grows out of the same model and the same delivery path:

- Board- and design-level threads with an `intent` (`change`, `question`,
  `approve`) and a priority order the designer can drag.
- Board holds enforced by the server: `design_apply` refuses writes to a held
  board with a clear status. No chat product can offer this, because none
  sits in the agent's write path.
- Approve before write: an agent posts a plan as a `needs_input` reply, the
  designer approves in the editor.

## Work packages

1. Stage selection parity: shared interaction overlay for both editors,
   hover, click, drill, breadcrumb, Escape.
2. Annotation storage and service: file layout, versioning, lifecycle,
   HTTP API, change records, detached derivation, tests.
3. MCP: `annotation_list`, `annotation_reply`, `annotation_watch`,
   `addresses` on `design_apply`, surfacing with cursor, acknowledged,
   guide and server instruction lines.
4. Editor: pins, rail markers, inspector tab, composer and send, bulk
   resolve, revert, graduation to memory.
5. Component editor anchors and pin-to-configuration.

Packages 2 and 3 can run in parallel with 1. Package 4 depends on 1 and 2.
