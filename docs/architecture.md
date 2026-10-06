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

The server watches design files and system-owned files under `.trickroom` and broadcasts settled changes through `GET /api/trickroom/events`. Changes to the files of one design are batched into one event per design (after 75 ms without a change, or at least every 250 ms while writes keep coming), emitted only when no journaled multi-file write is in progress, carrying the design id, its revision, the boards that changed and `state`: the manifest revision and every board's revision, in order. The same event is broadcast to every connected browser client.

The open design follows the disk board by board (`src/hooks/useDesignLiveSync.ts`, `src/stores/design-sync.ts`):

- The store keeps a base: the last version of every board, the board order and the top-level fields known to be on disk, with their revisions. Design reads and writes report the revisions in `x-trickroom-design-state`.
- A change event goes to the editor that has the design open instead of refetching it. The editor compares the event's revisions with its base and fetches only the boards that differ (`GET /api/trickroom/design/board?id=&board=`), plus `GET /api/trickroom/design/manifest?id=` when the name, system or policy changed. Order, added and removed boards come from the event. Syncs run one at a time, wait for a save in flight, and run at most every 300 ms while writes keep coming. A stream reconnect or a refused save compares revisions again through the manifest read.
- A board that changed on disk and has no unsaved local edits takes the disk version without touching other boards, the selection, the active board or the view. Entities of unchanged layers are reused, so only changed layers re-render.
- A board changed both locally and on disk is merged three-way against the base, layer by layer (`src/stores/design-merge.ts`); board order and top-level fields merge the same way. What does not merge (the same prop or text changed on both sides, a layer deleted on one side and changed on the other, a child list reordered while the other side changed it) becomes a conflict: autosave pauses and a dialog asks, per board (and for design settings or board order), to take the disk version or keep the local one. Keeping the local one moves that part's base to the disk version, so the next save overwrites exactly that part, checked against the version the human saw.
- Once every part of the base matches a disk state, the store's persisted revision moves to that state's revision, so the next save's revision check names exactly what the local edits were based on.

Dirty state is tracked per board (including boards added or deleted locally), for board order and for the top-level fields, each stamped with the store revision of its latest edit. The editor autosaves whole designs through `PUT /api/trickroom/design?id=<designId>`; the service writes only the boards that changed and keeps other writers' boards. A save result becomes the base for every part it stored as sent; edits made while it was in flight stay dirty. When a save kept changes the browser did not have (`x-trickroom-design-merged`), the editor applies them from the response like any external change.

Boards and layers changed by an external write are marked until the human has seen or touched them (`src/stores/external-change-store.ts`, `src/hooks/useExternalChangeMarkers.ts`): a tag on the board row and a square on changed layer rows in the Layers panel, an "N changed" button in the responsive board navigation, and a dashed outline on the changed layers (`StageChangeHighlight`) when the board is in view. A board's marker clears a few seconds after it has been in view, or when a layer in it is selected or edited.

The inspector edits a selected layer's `className` as text. Its autocomplete reads `GET /api/trickroom/tailwind/class-catalog` (every utility and variant of the linked system's compiled Tailwind design system, cached server-side) and checks unrecognized classes with `POST /api/trickroom/tailwind/class-inspect`.

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

## MCP Flow

The MCP server is separate from the Hono app. It can infer an MCP-enabled direct-child project from the working directory, or start without a selected project and use registry tools to discover and select one.

MCP creation and mutation use the same design-file services as the HTTP app, with additional governance checks. Existing-design mutations require revisions and are checked per board: a mutation of one board succeeds when only other boards changed since the read. The MCP process watches `.trickroom/designs` recursively and refreshes its resource list when design files change.

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

`src/lint/` checks how the app and the Designs use a design system ([Design System Lint](lint.md)). `contract.ts`, `config.ts`, `report.ts`, `ratchet.ts`, `rules/` and `source/` are pure; `run-lint.ts` connects them to a project for `src/cli/lint.ts` (`trickroom lint`), the `lint` MCP tool and `src/routes/system-lint.ts` (`GET`/`POST /api/trickroom/systems/:system/lint`). The only file it writes is `.trickroom/systems/<id>/lint-report.json`, which the System editor reads through `src/queries/system-lint.ts`.

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

The custom Vite SPA server plugin serves Hono routes during development and falls through to Vite for browser routes. Production uses `TRICKROOM_HTTP_PORT` and `TRICKROOM_HTTP_HOST` at runtime.

## Important Boundaries

Project-owned state lives in `.trickroom/`. Per-user project registry state lives under `~/.trickroom` by default. Runtime build output lives in `dist/`.

The project files—not browser local storage or an external hosted service—are the source of truth.
