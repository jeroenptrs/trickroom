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
- Tools and prompts: `src/mcp/server.ts`
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

The server watches design JSON and system-owned files under `.trickroom` and broadcasts settled changes through `GET /api/trickroom/events`. Browser clients use that SSE stream to refresh TanStack Query data. A clean open design hot-swaps to the new disk snapshot; a dirty design pauses autosave until the user chooses the disk or local version. The same event is broadcast to every connected browser client.

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

MCP creation and mutation use the same design-file services as the HTTP app, with additional governance checks. Existing-file mutations require content-hash revisions.

MCP screenshot tools lazily start a loopback-only capture host fixed to the selected project, so visual capture does not depend on the browser app's active project. Inline capture is allowed by read-only policy; writing an `outputPath` requires read-write policy. Screenshot attempts are audit logged when project auditing is enabled.

## Build Shape

- `pnpm dev`: generate Tailwind baseline tokens and start Vite.
- `pnpm build`: build the web, server, and MCP runtimes.
- `pnpm build:web-runtime`: generate tokens, typecheck, and build the client.
- `pnpm build:server`: build `dist/index.js` from `src/server-entry.ts`.
- `pnpm build:mcp`: build `dist/mcp-stdio.js`.

The custom Vite SPA server plugin serves Hono routes during development and falls through to Vite for browser routes. Production uses `TRICKROOM_HTTP_PORT` and `TRICKROOM_HTTP_HOST` at runtime.

## Important Boundaries

Project-owned state lives in `.trickroom/`. Per-user project registry state lives under `~/.trickroom` by default. Runtime build output lives in `dist/`.

The project files—not browser local storage or an external hosted service—are the source of truth.
