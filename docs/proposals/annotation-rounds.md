# Annotation rounds

Status: agreed with the lead developer on 2026-10-15, in progress. Builds on
[agent-annotations.md](./agent-annotations.md), shipped to `main` on
2026-10-14. The work breakdown is the "Rounds" section of
[agent-annotations-workplan.md](./agent-annotations-workplan.md).

## Goal

A designer bundles annotations into a round and sends it in one go. An
agent makes one `annotation_watch` call that waits on the round and keeps
returning work until the designer closes it. Every annotation in the round
should end resolved or dismissed. Either the agent made the change and the
designer accepted it, or the agent proposed a resolution and the designer
accepted that. When the designer has no more feedback, they close the
round, and the agent's waiting call returns for the last time.

Today there is no unit that says "this is the batch I want handled". An
agent learns about the designer's verdicts only on its next tool call, and
cannot stay in one turn until the feedback is handled.

## Non-goals

- A chat, prompt queue or steer control. The harness keeps the
  conversation, as before.
- A third delivery state. A remark is a draft (in the editor) or sent (on
  disk, in the open round). There is no "published".
- A second waiting tool. `annotation_watch` gains `round: true`.
- Agents opening or closing rounds. A round belongs to the designer.
- Changing what "seen" means, or the `addresses` rule for a remark sent
  while the agent worked.

## Vocabulary

- `round`: the bundle. A design, or a system component, has at most one
  open round per branch.
- `annotation`, `entry`, `target`: as before. Never `comment` or
  `feedback`.
- Delivery states of a remark: draft and sent.
- Annotation statuses: `open`, `acknowledged`, `addressed`, `needs_input`,
  `proposed` (new), `resolved`, `dismissed`.

## Decisions

### 1. Round storage

Round files sit next to the annotations of their container:

```text
<TRICKROOM_HOME>/annotations/<projectId>/designs/<designId>/rounds/<roundId>.json
<TRICKROOM_HOME>/annotations/<projectId>/systems/<systemId>/components/<componentId>/rounds/<roundId>.json
```

A round file, version 1:

```json
{
  "version": 1,
  "id": "4c2e…",
  "projectId": "proj_…",
  "container": { "kind": "design", "designId": "…" },
  "branch": "feature/checkout",
  "worktreePath": "/home/me/app",
  "status": "open",
  "openedAt": "2026-10-15T10:00:00.000Z",
  "annotationIds": ["6b1f…", "9a07…"],
  "sends": [
    { "id": "s1…", "at": "2026-10-15T10:00:00.000Z", "annotationIds": ["6b1f…", "9a07…"] }
  ]
}
```

A closed round adds `closedAt` and `closedBy` (`{ role: "human" }`). Round
files follow the annotation file rules: folders 0700, files 0600, an
atomic rename for every write, and a lock. Every round write of a
container (open, append a send, close) takes one lock keyed by that
container's `rounds` folder, so two sends cannot open two rounds. Round
files carry `version` and run through `roundFileMigrations`, a chain in the
same `{ from, to, migrate }` shape as `annotationFileMigrations`. It starts
empty, so the next change has a place to go.

Annotations gain an optional `roundId`. That is a persisted shape change:
`ANNOTATION_FILE_VERSION` becomes 2. The migration from version 1 rewrites
only the version field, because a version 1 file has no `roundId`. The
next write stores version 2. A Trickroom from before this change lists a
version 2 file as a problem and never rewrites it, as with any newer file.

Round files are per-user working state, like annotations. They are never
committed. `docs/project-files.md#annotations` documents them.

### 2. Sending

`POST /api/trickroom/annotations/send` sends a batch:

```json
{
  "designId": "…",
  "drafts": [
    { "key": "…", "target": { "kind": "layer", "designId": "…", "boardId": "…", "elementId": "…" }, "body": "…", "snapshot": { "stageMode": "responsive", "responsiveWidth": 390 } }
  ],
  "expectedScope": { "branch": "…", "worktreePath": "…" }
}
```

A component container passes `systemId` and `componentId` instead of
`designId`. Every target must be in that container. The server holds the
container's round lock for the whole send and does these steps in order:

1. It finds the open round of this container on the checkout's branch, or
   writes a new one that lists no annotations yet.
2. It writes every annotation file with `roundId`. A draft that fails (its
   layer is gone, say) is reported and does not stop the others.
3. It appends one send to the round file, with the ids that were written.

Closing takes the same lock, so a round cannot close in the middle of a
send. The lock order is the round lock, then an annotation's lock; nothing
takes them the other way round.

The answer is `{ scope, round, annotations, failed }`. `failed` lists
`{ key, code, error }` per draft that was not written. The editor drops a
draft from its draft store only when the answer lists it as written, as
`sendAnnotationDrafts` does today.

Agents treat a send as landed only once the round file lists it. An
annotation whose `roundId` names a round that does not list it is pending.
MCP listings, surfacing, counts and `annotation_watch` leave pending
annotations out, so an agent never gets half a batch. A pending annotation
older than 30 seconds lands anyway: that is a send whose process died
between steps 2 and 3, and hiding it for good would lose the remark.

**Send** on one draft goes through the same route with one draft.
`POST /api/trickroom/annotations` stays for API clients and creates an
annotation outside any round.

### 3. Proposing a resolution

New status `proposed`. The agent thinks the annotation needs no change:
it is already the case, it conflicts with another remark, it is out of
scope, or the agent recommends another approach. It asks the designer to
close it:

```ts
annotation_reply({ annotationId, propose: { summary }, body? })
```

`propose` is exclusive with `question`, `dismiss`, `resolve` and
`reanchor`; `body` may go with it. It adds a `proposal` entry
(`{ kind: "proposal", summary }`) and sets `proposed`. A resolved or
dismissed annotation cannot be proposed (`ALREADY_CLOSED`).

`proposed` waits on the designer: it is human work, like `addressed` and
`needs_input`. The editor shows **Proposed: <summary>** with **Accept**,
which resolves it as the human, and the composer. A reply reopens it, as
on `addressed`. An agent's `resolve` stays as it is: only when the
designer asked, shown as "Resolved by agent" with **Accept**.

`proposed` counts wherever `addressed` counts: the editor's open-work
definition (`HUMAN_WORK_STATUSES`), `counts.byStatus` in the `annotations`
block, `annotation_list`'s `live` filter and the project screen square.

### 4. Bulk designer actions

The design editor's **Annotations** tab gets a round header while a round
is open on this branch:

- Progress: `n of m closed`, and how many wait on the designer.
- **Send round**: sends every draft in the design, not only those on the
  board in view. **Send all drafts** on a board stays.
- **Accept all proposed**: resolves every proposed annotation in the round.
- **Resolve all addressed**: exists; it stays per board.
- **Close round** (below).

With no round open and drafts in the design, the header shows
**Send round** alone. The command menu gets **Send round** and **Close
round**. The component editor's tab gets the same header.

### 5. Closing a round

The designer closes a round with **Close round**. That name is used
everywhere. Closing is allowed with live annotations left: the editor
confirms and names how many stay open. Annotations of a closed round keep
their status and stay visible. A reply on one reopens the annotation but
not the round. A send after a close opens a new round. Agents cannot close
a round.

`POST /api/trickroom/annotations/rounds/:roundId/close` closes it
(`expectedScope` as on every write). Closing a closed round changes
nothing and answers `written: false`.

### 6. The waiting tool

```ts
annotation_watch({ designFileId, boardId?, timeoutMs?, round?: true })
annotation_watch({ systemId, componentId, timeoutMs?, round: true })
```

Without `round`, the call behaves as today. With `round: true`, it waits for
the first of these, checked in this order, and returns `status`:

- `"work"`: unseen agent work on the current branch, as today: new remarks,
  reopens and re-anchors. At most 10 in full, with `more`, `counts` and
  `next`.
- `"verdict"`: the designer acted on an annotation this session addressed
  or proposed, since the session last saw it: accepted it (`resolved`) or
  dismissed it. A reopen with a remark is agent work, so it comes back as
  `"work"`. So does a revert, which opens the annotation again; its
  `revert` entry shows in the body.
- `"closed"`: the round was closed. Returns `round` (`id`, `closedAt`,
  counts of its annotations by status) and the live annotations left, in
  full, so the agent can finish them before it ends its turn. Nothing more
  arrives for that round. `next` says so and names `annotation_list`.
- `"idle"`: no open round on this design (or component) and nothing
  unseen. Returns at once. `next` says the designer has not sent a round
  and tells the agent to go on with its task, not to keep waiting.
- `"timeout"`: as today. `next` is the call that keeps waiting, with
  `round: true`, and `round` (`id`, `openedAt`, counts) says the round is
  still open.

A session remembers the rounds it has seen open, per container. A round it
saw open that is closed now, and not yet reported, returns `"closed"` even
when it closed between two calls.

Result shapes:

```json
{ "status": "work", "round": { "id": "…", "openedAt": "…", "counts": { "total": 3, "closed": 1, "agentWork": 1, "humanWork": 1, "byStatus": { "acknowledged": 1, "addressed": 1, "resolved": 1 } } },
  "annotations": [{ "annotationId": "…", "status": "acknowledged", "…": "…" }],
  "counts": { "agentWork": 1, "humanWork": 1, "byStatus": { "acknowledged": 1, "addressed": 1 } },
  "next": "…" }
{ "status": "verdict", "round": { "…": "…" }, "annotations": [ … ], "next": "…" }
{ "status": "closed", "round": { "id": "…", "closedAt": "…", "counts": { … } }, "annotations": [ … ], "next": "…" }
{ "status": "idle", "next": "…" }
{ "status": "timeout", "round": { "id": "…", "openedAt": "…", "counts": { … } }, "counts": { … }, "next": "…" }
```

Every `next` names the exact follow-up call. The server instructions get
one clause about `round: true` (they are trimmed to stay under 2,048
characters). The full loop goes in `guide({ topic: "annotations" })` and
in the tool description.

### 7. Component rounds

Component annotations use the same rounds. `annotation_watch` takes
`systemId` and `componentId`, as `annotation_list` does. With them it
watches the component's folder; `round: true` works the same. If the
component side does not fit, design rounds ship complete and the
workplan lists what is missing.

### 8. Seen and `addresses` stay as they are

A round does not change what "seen" means. A remark sent while the agent
worked is not answered by the write, as the current docs say.

### 9. Counts on `project_list` and `design_list`

When a round is open on the current branch, a design's counts add
`round: { id, open: true, sent, closed }`: annotations sent in it, and how
many of them are resolved or dismissed. A session that starts sees there is
a round waiting.

## Editor controls

- Round header in the **Annotations** tab (design and component editor):
  `Round · n of m closed · k waiting on you`, **Send round**, **Accept all
  proposed** (when there is one), **Close round**.
- A proposed annotation: status chip **Proposed**, the line
  **Proposed: <summary>**, **Accept**, and the reply composer.
- Pins and rail markers show `proposed` as they show `addressed`: a hollow
  cyan square.
- **Close round** asks to confirm when live annotations are left: "3
  annotations stay open. Close the round?"
- The editor learns about round changes through a new `annotation-round`
  event on `/api/trickroom/events` (`{ roundId, container }`), and reads
  `GET /api/trickroom/annotations/rounds?designId=` (or `systemId` and
  `componentId`): `{ scope, round }`, the open round on this branch with
  its counts, or null.

## Open questions

Decided here, not covered by the brief:

1. A pending annotation (its round does not list it) lands for agents after
   30 seconds. That covers a server that died between writing the
   annotations and appending the send.
2. `POST /api/trickroom/annotations` stays and creates an annotation
   outside any round. The editor no longer uses it.
3. `propose` on a resolved or dismissed annotation is refused with
   `ALREADY_CLOSED`. `question` keeps its current behaviour.
4. A dismissal by the designer of an annotation this session addressed or
   proposed is a `"verdict"`, like an acceptance.
5. **Resolve all addressed** stays per board. **Accept all proposed** works
   on the whole round, because the round is what the header shows.
6. `"work"` covers all unseen agent work on the branch, also annotations
   outside the round (sent before rounds existed, or through the API).
   That matches "as today".
7. `"closed"` is reported to a session that saw the round open, whether in
   `annotation_watch`, a result's `annotations` block or `annotation_list`.
   A session that never saw a round gets `"idle"` once it is closed.
