# Architecture

Trickroom has three runtime surfaces that work against the same local project files:

1. React app for project selection and design editing.
2. Hono HTTP API for browser app data access.
3. Stdio MCP server for agent access.

## Runtime Map

React app:

- Entry: `src/main.tsx`
- Routes: `src/App.tsx`
- Project gate: `src/components/Root.tsx`
- Project home: `src/components/Project.tsx`
- Design editor: `src/components/Design.tsx`

Local HTTP API:

- App entry: `src/server.ts`
- Production entry: `src/server-entry.ts`
- CLI: `bin/trickroom.js serve`
- Prefix: `/api/trickroom`
- Tailwind routes: `src/routes/tailwind.ts`

MCP:

- CLI: `bin/trickroom.js mcp`
- Stdio runtime: `src/mcp/stdio.ts`
- Server composition root: `src/mcp/server.ts`
- Tools: `src/mcp/tools/` (one module per tool group)
- Prompts: `src/mcp/prompts.ts`
- Governance: `src/mcp/governance.ts`

Design system lint:

- CLI: `bin/trickroom.js lint` (`src/cli/lint.ts`, built into `dist/lint.js`)
- Engine: `src/lint/` (pure modules; `run-lint.ts` is the filesystem adapter)
- MCP tool: `src/mcp/tools/lint.ts`
- HTTP routes: `src/routes/system-lint.ts`; one design: `GET /api/trickroom/design/lint` in `src/server.ts`
- Dashboard: `src/components/system-editor/SystemEditorLintPanel.tsx` and `src/components/system-editor/lint/`

## Project Session Flow

Opening a project ensures `.trickroom/config.json` exists with a stable `projectId` and registers the location in per-user app state. The Hono app keeps the active project in memory, and project-scoped routes resolve it before reading config, designs, or Tailwind snapshots.

When `TRICKROOM_PROJECT_DIR` is set, startup opens that project. Otherwise the app starts without an active project and lets the UI open one by path.

## HTTP Authentication

Loopback hosts such as `localhost`, `127.0.0.1`, and `::1` remain unauthenticated unless `TRICKROOM_SESSION_TOKEN` is explicitly configured. Binding the production server or Vite development server to a non-loopback host without that variable fails at startup.

`trickroom serve --host <host>` sets the bind host. For a non-loopback host, it preserves an explicitly configured token or generates a cryptographically random one. Once listening, the CLI writes a structured ready record to stdout with the actual address and tokenized bootstrap URL.

URLs use a public address that is resolved separately from the bind host. A configured public base URL (`--public-url`, then `TRICKROOM_PUBLIC_URL`, then `server.publicUrl` in the user settings file) is used as written, for example `https://devbox.example.com/` behind a TLS-terminating reverse proxy. Otherwise the URL is `http://<public host>:<port>/`, with the public host taken from `--public-host`, then `TRICKROOM_PUBLIC_HOST`, then `server.publicHost`, then inference (the machine hostname for a wildcard bind such as `0.0.0.0`, otherwise the bind host). `src/server-public-host.ts` holds this resolution. The token requirement is always decided on the bind host. The session cookie has no `Domain` attribute and requests are not checked against an expected `Host` or `Origin`, so a browser arriving through any name for the machine can bootstrap a session. The cookie is `Secure` when the request URL is `https:` or `X-Forwarded-Proto` is `https`. See [Development](development.md#public-host) for an example settings file.

On the first valid `GET` or `HEAD` request containing `?token=`, the Hono app:

1. Sets `trickroom_session` as an HTTP-only, SameSite=Strict cookie scoped to `/`.
2. Redirects to the same path and query string with `token` removed.
3. Authenticates later requests with that cookie.

The `x-trickroom-session` header remains available for non-browser clients. Invalid or missing credentials receive HTTP 403.

## HTTP API

Routes under `/api/trickroom` include runtime health and session state, project open/close operations, config and design reads/writes, exports, systems, memory, and Tailwind synchronization. See `src/server.ts` and `src/routes/` for the source-of-truth route definitions.

## Browser Editor Flow

The design route reads a design and its content-hash revision through the HTTP API, hydrates `designStore`, renders boards inside an iframe, and keeps editor chrome outside it. Dirty serialized state autosaves through revision-checked API writes. Linked system theme CSS is injected into the iframe when applicable.

The server watches design files, system-owned files and the project config (`config.json`) under `.trickroom`, plus the stylesheets a system's Tailwind CSS reads elsewhere in the project (`tailwind-source` events, see [Canvas Class Merging](tailwind-design-systems.md#canvas-class-merging)), and broadcasts settled changes through `GET /api/trickroom/events`. Changes to the files of one design are batched into one event per design (after 75 ms without a change, or at least every 250 ms while writes keep coming), emitted only when no journaled multi-file write is in progress, carrying the design id, its revision, the boards that changed and `state`: the manifest revision and every board's revision, in order. The same event is broadcast to every connected browser client.

The open design follows the disk board by board (`src/hooks/useDesignLiveSync.ts`, `src/stores/design-sync.ts`):

- The store keeps a base: the last version of every board, the board order and the top-level fields known to be on disk, with their revisions. Design reads and writes report the revisions in `x-trickroom-design-state`.
- A change event goes to the editor that has the design open instead of refetching it. The editor compares the event's revisions with its base and fetches only the boards that differ (`GET /api/trickroom/design/board?id=&board=`), plus `GET /api/trickroom/design/manifest?id=` when the name, system or policy changed. Order, added and removed boards come from the event. Syncs run one at a time, wait for a save in flight, and run at most every 300 ms while writes keep coming. A stream reconnect or a refused save compares revisions again through the manifest read.
- A board that changed on disk and has no unsaved local edits takes the disk version without touching other boards, the selection, the active board or the view. Entities of unchanged layers are reused, so only changed layers re-render.
- A board changed both locally and on disk is merged three-way against the base, layer by layer (`src/stores/design-merge.ts`); board order and top-level fields merge the same way. What does not merge (the same prop or text changed on both sides, a layer deleted on one side and changed on the other, a child list reordered while the other side changed it) becomes a conflict: autosave pauses and a dialog asks, per board (and for design settings or board order), to take the disk version or keep the local one. Keeping the local one moves that part's base to the disk version, so the next save overwrites exactly that part, checked against the version the human saw.
- Once every part of the base matches a disk state, the store's persisted revision moves to that state's revision, so the next save's revision check names exactly what the local edits were based on.

Dirty state is tracked per board (including boards added or deleted locally), for board order and for the top-level fields, each stamped with the store revision of its latest edit. The editor autosaves whole designs through `PUT /api/trickroom/design?id=<designId>`; the service writes only the boards that changed and keeps other writers' boards. A save result becomes the base for every part it stored as sent; edits made while it was in flight stay dirty. When a save kept changes the browser did not have (`x-trickroom-design-merged`), the editor applies them from the response like any external change.

Boards and layers changed by an external write are marked until the human has seen or touched them (`src/stores/external-change-store.ts`, `src/hooks/useExternalChangeMarkers.ts`): a tag on the board row and a square on changed layer rows in the Layers panel, an "N changed" button in the responsive board navigation, and a dashed outline on the changed layers (`StageChangeHighlight`) when the board is in view. A board's marker clears a few seconds after it has been in view, or when a layer in it is selected or edited.

Annotations reach the editor through the same stream; see [Annotations](#annotations).

The inspector edits a selected layer's `className` as text. Its autocomplete reads `GET /api/trickroom/tailwind/class-catalog` (every utility and variant of the linked system's compiled Tailwind design system, cached server-side) and checks unrecognized classes with `POST /api/trickroom/tailwind/class-inspect`.

Component instances render with classes resolved from their Component version and overrides and merged the way the project's code merges them (`GET /api/trickroom/tailwind/class-merge`, `useClassMerge`, `ClassMergeContext`); raw elements render their `className` as written. See [Canvas Class Merging](tailwind-design-systems.md#canvas-class-merging).

The iframe shell is `src/iframe/shell.html`; it loads the Tailwind browser runtime from `public/tailwind/index.global.js`.

The chrome-less `/capture/:design/:board?` route reuses the same iframe shell and `Artboards` renderer. It exposes persistent node IDs as render-only DOM attributes and signals readiness only after design hydration, managed styles, Tailwind compilation, font stylesheets, and `document.fonts.ready` settle. `POST /api/trickroom/screenshot` drives this route through an optional Playwright/Chrome runtime and returns PNG data, optionally writing an explicit `.png` path.

## Stage Overlay Containment

Every canvas board renders into one shared iframe document. Without containment, every Base UI portal would fall back to that document's body, and each board's dialogs, sheets and popovers would stack against the editor pane and ignore pan and zoom. Instead, each board contains its own overlays. This is render-time only: nothing about it reaches the design file or exports.

- **Containing block.** The iframe shell (`src/iframe/shell.html`) gives each board root `contain: layout`, so `fixed` descendants position against the board. A `fixed inset-0` backdrop covers its own board and moves with it. Layout containment does not clip.
- **Portal target.** `Artboards` wraps each board in `StageBoardPortalContext` (`useStageBoardPortal` in `src/libraries/stage-portal.tsx`). The portal wrappers in `src/libraries/base-ui/` resolve their container through `useStagePortalContainer`, and an explicitly authored container still wins. The board's portal host mounts only while a portal asks for it. It is out of flow, covers the board and sits above board content.
- **Height floor.** A board with no authored height gets a minimum height while an overlay is open in it: 800px on the canvas, the viewport height in the responsive view and capture.
- **Component drafts.** The system editor's draft stage (`ComponentDraftStage`) does the same for its single board. The board's content area below the name strip is the containing block and portal target.

The canvas differs from the responsive view and capture, which mount a single board:

| | Canvas and draft stage | Responsive view and capture |
|---|---|---|
| Dialogs, drawers, alert dialogs | Non-modal, pointer dismissal off, no initial focus unless authored | Authored modal behaviour |
| Floating UI collision avoidance | Off: popups sit exactly as authored | On, with the board as collision boundary |

The canvas renders overlays non-modal because several open modals in one document would mark each other `aria-hidden`, lock scroll and trap focus, and a canvas click or pan would dismiss them. Collision avoidance is off because it clips against the iframe viewport, which on the canvas is the editor pane, so popups would jump while panning. Alert dialogs render through a Dialog root on the canvas and keep `role="alertdialog"`. Select uses anchored positioning on the stage, because item-aligned mode positions a fixed popup from viewport geometry.

Known limits:

- Viewport units (`100vh`, `dvh`, `vw`) and responsive breakpoints still resolve against the iframe, not the board. A `min-h-dvh` backdrop can extend past a short board.
- While an overlay exists, the portal host is the board's first child. Position-based variants on the board's children (`first:`, `odd:`, `even:`, `nth-*`) count the host, so they can match differently while an overlay is open. The host's inline styles keep `*:`, `space-y-*` and `divide-*` from moving it.

## Stage Interaction

The design canvas and the component draft stage share one interaction layer (`src/components/stage/stage-interaction.ts`, rendered by `StageSelectionLayer`). It lives in the stage document, next to the focus and change highlights, and reads and writes the editor's store through a `StageSelectionSource` (`stage-selection-sources.ts`: the design store, or the component draft store with template paths as ids). The store stays the single source of the selection; the stage reports what was clicked. The capture route renders `Artboards` without it.

- **Pointer resolution.** Delegated listeners on the stage window, none per layer. A press resolves the event path to the nearest element carrying `data-trickroom-node-id` whose id the store holds; library components that do not forward the id resolve to their nearest rendered ancestor. Overlays portalled into a board keep their own ids. Draft nodes carry their template path in the same attribute. A board is a layer, so a press on its background selects it; a press that resolves to no layer (canvas space outside every board, a draft board's empty area) clears the selection. A selection press blurs the editor control that had focus, so its pending edit commits to its own layer first, then focuses the stage viewport. Chrome inputs that hold a draft therefore commit on blur (layer renames in both Layers panels, the class field); outside-press listeners in the editor document never see a stage press.
- **Board content is inert.** The primary and right-button presses (pointer and mouse down and up) and every click, auxclick, double-click and context menu on board content are taken in the capture phase on the stage window, before React or Base UI see them: a press selects and nothing else, so links do not navigate, buttons do not submit, inputs do not take focus and triggers do not open. Overlays open through their recipe controls. Middle-button and Space presses pass through for panning, and elements marked `data-trickroom-stage-chrome` (highlights, pins) handle their own events.
- **Overlays.** The selection and hover outlines are boxes in the stage document, placed with the same measuring as the focus and change highlights (`src/components/stage/stage-overlay.ts`), so the rendered class strings stay the design's own. While something is selected or hovered they follow their layer every animation frame, writing styles only when it moved; with nothing to show, the loop stops. Element lookups are cached while the element stays in the document. Hover is off while a button or Space is held and in a board whose portal host holds an open overlay (each board's host is found once and cached, invalidated by a MutationObserver on the board's own child list, so the per-frame check does not grow with board size); any press ends it until the pointer moves, and every frame re-checks the overlay, so one that opens under a resting pointer hides the hover. Double-click drills only when both presses were selection presses, never while panning.
- **Keyboard.** Keys pressed while the stage has focus are re-dispatched on the editor document (except Space, Tab and typing into a board's own inputs), so the editor's shortcuts work after a click on the canvas. Enter and Shift+Enter are layer shortcuts of the Layers panels.

## MCP Flow

The MCP server is separate from the Hono app. It can infer an MCP-enabled direct-child project from the working directory, or start without a selected project and use registry tools to discover and select one.

MCP creation and mutation use the same design-file services as the HTTP app, with additional governance checks. Existing-design mutations require revisions and are checked per board: a mutation of one board succeeds when only other boards changed since the read. The MCP process watches `.trickroom/designs` recursively and refreshes its resource list when design files change.

## Annotations

Annotations are per-user remarks for agents (see [Concepts](design-model.md#annotations)). Three parts touch them: the editor, the HTTP server and the stdio MCP server, the last two as separate processes over one store.

- **Store.** `src/services/annotation-store.ts` owns `<TRICKROOM_HOME>/annotations/<projectId>/`: one JSON file per annotation under its design or component folder, keyed by the project's stable id so every checkout and agent session of the project shares it. Every write is a read-modify-write of one file under a per-annotation lock (the design-file lock mechanism, lockfiles in `<TRICKROOM_HOME>/locks/annotations/`), then an atomic rename. Listings keep the files they parsed in a process-wide cache (at most 32 MB of files or 50,000 files, least recently used out first), each entry with the signature of the file it was read from (device, inode, size, change and modification time in nanoseconds, from the handle it was read through). A file is read again once its path has another signature, which every write gives it (the rename puts a new inode in place), whichever process wrote it. So the closed history of a design is not read and parsed again on every MCP call that surfaces annotations; the entries are frozen, since every reader shares them. Cached files are stat'ed synchronously in chunks of 256 with a yield between chunks (several times cheaper than a promise per file, without holding the event loop), and a surfacing block lists the folder once. Detached and current boards are derived against one index of the design per listing (`designTargetLocator`), not a walk per annotation. Layout and format: [Files And Safety](project-files.md#annotations).
- **Service.** `src/services/annotation-service.ts` (designs) and `src/services/component-annotations.ts` (component nodes) hold the lifecycle: create, reply, transitions, acknowledge, bulk resolve, re-anchor, move to a branch, clear, change records and revert. Every write takes an explicit `by`; the HTTP routes pass the human, the MCP tools the agent with its session id. The pure rules (what counts as work, where a target is now, detached, shared change records) are in `src/services/annotation-model.ts`, which the editor imports too.
- **Branch scope.** `src/services/checkout-scope.ts` reads the checkout's branch from `.git/HEAD` (following a worktree's `gitdir:` file) without spawning git, once per request. Lists, counts and surfacing filter on it; MCP writes to another branch's annotation are refused (`WRONG_BRANCH`) when the call starts and again under the annotation's lock. `CheckoutScopeEvents` watches the one git folder that holds `HEAD` (not recursively, and only while an event stream is open) and reports when the scope changes, for the editor (below).
- **HTTP.** `src/routes/annotations.ts` serves `/api/trickroom/annotations` for the editor: list, counts per design (the project screen's design list), read, create, reply, transition, bulk resolve, re-anchor, move, clear and revert, each recorded as the human. Writes take the revision the editor holds and answer 409 when the annotation changed meanwhile. They also take the checkout scope the editor listed in (`expectedScope: { branch, worktreePath }`) and answer 409 `SCOPE_CHANGED`, with the current scope in `details.scope`, when another branch has been checked out since. List and single reads answer with `scope`.
- **Events.** The HTTP server watches the project's annotation folder as a second root of `ProjectFileEvents` (`src/services/project-file-events.ts`) and sends `event: annotation` on `GET /api/trickroom/events`, so the editor sees agent writes from the other process within one event; the project screen refetches its counts on each. When the checkout's scope changes (`git checkout`, `git switch`), it sends `event: annotation-scope` with `{ branch, worktreePath }`.
- **Design writes that address annotations.** `design_apply` with `addresses` validates the annotations before the write, then passes `afterWrite` (`createAddressesRecorder`) to `updateDesignFile`: under the design lock, once the design is stored, it captures what changed and records the same change on every addressed annotation at once: it takes all their locks in id order (`updateMany`), writes every change entry, then releases them. A revert from any checkout of the branch therefore sees all of the batch or none of it. A refused write records nothing. Component drafts do the same under the component manifest's cross-process write lock. The lock order is always container (design or manifest) first, then annotation.
- **Revert.** The editor's Revert goes through HTTP to `revertChange` (or `revertComponentChange`): it checks that the touched layers still have the hashes the write left. Under the design lock (`revertUnderLocks`), where any `addresses` recording of that write has finished, it finds the other annotations on this branch that the same write addressed (same `writeId`) and takes all their locks with the annotation's, in id order (`AnnotationStore.updateMany`). It checks each, and the annotation's branch, writes the design, then records the revert on every one, holding all locks throughout. A held lock or a failed check refuses before the design changes; one that moved into this branch after the set was found makes it start over. The reverted design reaches the editor through design live sync like any external change.
- **MCP surfacing.** `src/mcp/annotation-session.ts` keeps a per-session cursor in memory. `withAnnotations` appends an `annotations` block (new bodies, open ids, counts, `next`) to the results of the design reads and writes, `editor_context` and the component tools; showing an `open` annotation in full acknowledges it under its lock. The session's last call time goes to `sessions/<sessionId>.json` in the store, which is what acknowledgement expiry reads. `annotation_watch` watches the design's annotation folder from the stdio process, so it needs no HTTP server.

In the editor:

- The design route lists the open design's annotations on the checkout's branch once (`GET /api/trickroom/annotations?designId=`, `src/queries/annotations.ts`) into `editorAnnotationsStore` (`src/stores/editor-annotations-store.ts`, through `useAnnotationLiveSync`). The store is generic over the container (a design, or a component in the component editor).
- The server watches the project's annotation folder as a second root and sends `event: annotation` with `{ annotationId, container, operation, revision }` (writes within 75 ms of each other on one file arrive as one event). `useProjectFileEvents` hands it to the editor that has that container loaded (`src/queries/annotation-live-events.ts`), which refetches that one annotation (`GET /api/trickroom/annotations/:id?designId=`) unless it already holds the event's revision, typically its own write echoing back, or drops it when deleted. After the stream reconnects the list is read again.
- Every write sends the revision the editor holds (`expectedRevision`, or `expectedRevisions` on bulk resolve). On a 409 the editor refetches the annotation and shows its current state instead of retrying; the HTTP layer records every write as the human, and only the MCP server records agents. A revert writes the design server-side; the design then arrives through design live sync like any external change.
- The store holds the scope its list was of. Another scope reported by the server (an `annotation-scope` event, the `scope` of a list or single read, or a `SCOPE_CHANGED` refusal, all through `subscribeAnnotationScope`) starts a new generation of the container, the same mechanism as opening another design: requests in flight no longer apply, the annotations held are dropped, and the list, the other-branches list and the design-list counts are fetched again. Every write sends the scope held as `expectedScope`, so a tab still showing the old branch is refused rather than writing to its annotations; its unsent text stays a draft. Drafts are keyed by target, not branch, and are kept.
- `acknowledgement` is derived from the agent session's clock, not from the content, so it can change while the revision does not: a read of the same revision always updates it, whatever the request order, keeping the later `lastSeenAt` (on a tie, the idle one). The editor counts the 15 minutes down from `lastSeenAt` itself (`isAcknowledgementActive`), and reads the annotation again when one would go idle, in case the session called since.
- Drafts are browser state only (`src/stores/annotation-draft-store.ts`), mirrored to `sessionStorage` per project and keyed by target, and reach the API only on Send.
- What counts as work and where a target is now come from the pure `src/services/annotation-model.ts`, shared with the server and MCP; the editor answers "where is this layer now" from the design store (`designStoreTargetLocator`), so a local move, delete or undo shows before it is saved. The Layers panel's markers are derived once per change into per-row entries that keep their object when unchanged, so an annotation event re-renders only the rows whose marker changed.
- Pins are a second overlay kind in the stage document (`StageAnnotationPins`, `stage-annotation-pins.ts`): one origin per stage marked as stage chrome, one pooled box per pinned layer, one delegated click listener. The origin sits inside the panned world, so a pan moves the pins with it; they are measured (`measureStageOverlayBox`) for a short burst of frames after anything that could move them (a store change, a zoom, a resize, fonts) and idle otherwise. Their looks are inline styles, since the stage document does not load the app's stylesheet; the rail and inspector use the same looks through `components/ui/annotation-marker.tsx`.

## Design Storage

`DesignFileService` (`src/services/design-file-service.ts`) is the only code that knows where a design lives. Callers address designs by id and get the in-memory design; the service reads and writes the folder layout (`designs/<id>/design.json`, `boards/<boardId>.json`, `memory.json`), still reads the legacy single-file layout, and converts it on the first write.

- `design-storage.ts`: paths, consistent lock-free reads of all of a design's files, file shapes.
- `design-revision.ts`: per-board and manifest revisions and the composite design revision token.
- `design-merge.ts`: plans a revision-checked write at board level (what to keep, what to write, what is stale).
- `design-order.ts`: fractional order keys for boards.
- `design-journal.ts`: the write-ahead journal for writes that change more than one file.
- `updateDesignFile`: the read-check-write every mutation goes through (MCP tools and bulk component migration).
- `migrateDesign` and `src/cli/migrate.ts`: `trickroom migrate`.

See [Files And Safety](project-files.md#design-files) for the layout, revisions, journal and locking.

## Component Codegen

`src/codegen/` turns published system components into tailwind-variants files ([Component Codegen](codegen.md)). `generate.ts` (with `model.ts`, `emit.ts`, `header.ts`, `names.ts`) is pure: manifest in, file texts and diagnostics out. `config.ts` validates and resolves the `codegen` block. `run-codegen.ts` connects them to the filesystem for both callers, `src/cli/codegen.ts` (`trickroom codegen`) and `design_export` with `format: "variants"`: it reads the system and component manifests with `readOnly`, runs the configured formatter (`formatter.ts`, no shell), compares with disk and writes only what differs.

## Design System Lint

`src/lint/` checks how the app and the Designs use a design system ([Design System Lint](lint.md)). `contract.ts`, `config.ts`, `report.ts`, `ratchet.ts`, `rules/` and `source/` are pure; `run-lint.ts` connects them to a project for `src/cli/lint.ts` (`trickroom lint`), the `lint` MCP tool and `src/routes/system-lint.ts` (`GET`/`POST /api/trickroom/systems/:system/lint`). The only file it writes is `.trickroom/systems/<id>/lint-report.json`, which the System editor reads through `src/queries/system-lint.ts`. Its design-side rules also run on one design through `src/lint/design-lint.ts`, for `design_validate` and the editor's `GET /api/trickroom/design/lint` (`src/queries/design-lint.ts`, shown in the design inspector).

MCP screenshot tools lazily start a loopback-only capture host fixed to the selected project, so visual capture does not depend on the browser app's active project. Inline capture is allowed by read-only policy; writing an `outputPath` requires read-write policy. Screenshot attempts are audit logged when project auditing is enabled.

## Editor Channel

The editor channel lets a local process, in practice the MCP server, see what the human has open in the browser and point the browser at a design, board or layer. It carries no design data and keeps no state on disk apart from the discovery record.

### Discovery record

The MCP server is a separate process and cannot otherwise find the HTTP server. Once a server listens, it writes `<TRICKROOM_HOME>/runtime/servers/<pid>.json` (`src/app-state/runtime-servers.ts`):

```json
{ "version": 1, "pid": 4242, "url": "http://127.0.0.1:18100/", "token": "…", "projectId": "proj_…", "projectRoot": "/work/app", "startedAt": "2026-10-04T10:00:00.000Z" }
```

- Written by the `serve` entry (`src/server-entry.ts`) and the dev plugin (`plugin/spa-server/discovery.ts`), never by `createTrickroomApp`, so the MCP screenshot capture host does not register itself.
- `url` is for local processes: the actual bound address, with wildcard binds dialed through `127.0.0.1`. The public URL settings are for humans and are not used.
- `token` is the session token, or null without session auth. The directory is `0700` and the file `0600`.
- The record follows the active project through `app.trickroomRuntime.subscribeActiveProject` and is deleted on exit and on SIGINT, SIGTERM and SIGHUP. Records of killed servers stay behind until a client finds them stale.

### Tabs and their context

Each tab has an in-memory `clientId` (`src/queries/editor-channel.ts`) and opens the project event stream as `GET /api/trickroom/events?clientId=<id>`. The stream is the tab's presence: the server forgets the tab when its last stream closes.

`EditorChannel` (rendered by `Root`) reports the tab's context to `POST /api/trickroom/editor-context`, debounced by 150 ms and again whenever the stream reconnects:

```json
{ "clientId": "…", "projectId": "proj_…", "designFileId": "<design uuid>", "activeBoardId": "…", "selectedId": "…", "stageMode": "canvas", "responsiveWidth": 640, "focusedAt": 1759572000000, "visible": true, "sentAt": 1759572000150 }
```

Design fields are null outside the design route. `focusedAt` is updated when the tab gains focus, becomes visible, or is interacted with (at most once a second). The server moves it onto its own clock using `sentAt`, so tabs in different browsers compare fairly. `stageMode`, `activeBoardId` and `responsiveWidth` live in `src/stores/stage-view-store.ts`; the design route resets that store on mount and unmount.

`GET /api/trickroom/editor-context` returns the server's active `projectId`, the connected tabs (each with `ageMs` since its last report and the normalized `focusedAt`), and `mostRecentlyFocusedClientId`. Contexts live only in memory (`src/services/editor-sessions.ts`).

### Focus requests

`POST /api/trickroom/editor-focus` takes `{ designFileId, boardId?, elementId?, clientId?, projectId? }`. The server picks the given tab, or the most recently focused tab showing the project, sends it a `focus` SSE event with a `requestId`, and waits up to 2 s for `POST /api/trickroom/editor-focus/ack`. It answers `{ status, clientId, requestId, outcome, message }`:

- `ok`, with `outcome` `revealed` (already open design), `navigated` (another design) or `queued` (hidden tab; applied when it is shown).
- `blocked_dirty`: the tab would have to leave a design with unsaved changes, a save in flight or a pending conflict (or a system editor draft with unsaved edits). The human sees a toast.
- `browser_on_other_project`: the server or the tab shows another project. The server's active project is never switched.
- `no_browser`: no connected tab (or the given one is gone). `stale`: the tab did not acknowledge in time.

The tab applies a request by navigating to the design's deep link, `/design/<uuid>?board=<id>&layer=<id>` (`src/utils/design-deep-link.ts`). The same link works on its own, including on a cold load: once the design is hydrated, `useDesignDeepLink` switches to the board (a layer implies its board), selects the layer, consumes the parameters and issues a reveal request. On reveal, `useStageNavigation` centres the canvas on the element (or scrolls it into view in responsive mode) once it is rendered and styled, the Layers panel expands collapsed ancestors and scrolls to the row, and `StageFocusHighlight` outlines the element with its layer name for about two seconds. The design route mounts one editor per design, so the stage hooks always bind to the current design's iframe.

### Client for local processes

`src/services/editor-channel.ts` is what MCP tools call:

- `getEditorContext(projectId, options?)` resolves with `ok` plus the server, the project's tabs and the focused tab, or with `no_server`, `no_browser`, `browser_on_other_project` or `stale` and a message.
- `requestEditorFocus({ projectId, designFileId, boardId?, elementId?, clientId? }, options?)` resolves with the server's focus status (including `blocked_dirty`), the target tab and the outcome.

Both list the discovery records, delete records whose process is gone (`process.kill(pid, 0)`) or whose URL no longer answers as a Trickroom server, probe the rest through `GET /api/trickroom/health` with the token, and use the server whose active project matches (the one with the most recently focused tab when several do). Requests time out after 0.75 s (health), 1.5 s (context) and 3.5 s (focus). They never throw.

## Build Shape

- `pnpm dev`: generate Tailwind baseline tokens and start Vite.
- `pnpm build`: build the web, server, and MCP runtimes.
- `pnpm build:web-runtime`: generate tokens, typecheck, and build the client.
- `pnpm build:server`: build `dist/index.js` from `src/server-entry.ts`.
- `pnpm build:mcp`: build `dist/mcp-stdio.js`.
- `pnpm build:migrate`: build `dist/migrate.js`, run by `trickroom migrate`.
- `pnpm build:feedback`: build `dist/feedback.js`, run by `trickroom feedback`.
- `pnpm build:codegen`: build `dist/codegen.js`, run by `trickroom codegen`.
- `pnpm build:lint`: build `dist/lint.js`, run by `trickroom lint`.
- `pnpm build:tailwind-worker`: build `dist/tailwind-canonicalize-worker.js`, the worker thread that canonicalizes Tailwind classes for the lint rules off the main thread.
- `pnpm build:tailwind-modules`: build `dist/tailwind-module-runtime.js`, what every bundle loads Tailwind `@plugin` and `@config` modules with.

The custom Vite SPA server plugin serves Hono routes during development and falls through to Vite for browser routes. Production uses `TRICKROOM_HTTP_PORT` and `TRICKROOM_HTTP_HOST` at runtime.

## Important Boundaries

Project-owned state lives in `.trickroom/`. Per-user state (the project registry, settings, agent feedback and annotations) lives under `~/.trickroom` by default (`TRICKROOM_HOME`) and is never committed. Runtime build output lives in `dist/`.

The project files—not browser local storage or an external hosted service—are the source of truth.
