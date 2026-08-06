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
- Prefix: `/api/trickroom`
- Tailwind routes: `src/routes/tailwind.ts`

MCP:

- CLI: `bin/trickroom-mcp.js`
- Stdio runtime: `src/mcp/stdio.ts`
- Tools and prompts: `src/mcp/server.ts`
- Governance: `src/mcp/governance.ts`

## Project Session Flow

Opening a project ensures `.trickroom/config.json` exists with a stable `projectId` and registers the location in per-user app state. The Hono app keeps the active project in memory, and project-scoped routes resolve it before reading config, designs, or Tailwind snapshots.

When `TRICKROOM_PROJECT_DIR` is set, startup opens that project. Otherwise the app starts without an active project and lets the UI open one by path.

## HTTP Authentication

Loopback hosts such as `localhost`, `127.0.0.1`, and `::1` remain unauthenticated unless `TRICKROOM_SESSION_TOKEN` is explicitly configured. Binding the production server or Vite development server to a non-loopback host without that variable fails at startup.

`trickroom --host <host>` sets the bind host. For a non-loopback host, it preserves an explicitly configured token or generates a cryptographically random one. The printed shared URL includes `?token=...` for bootstrap.

On the first valid `GET` or `HEAD` request containing `?token=`, the Hono app:

1. Sets `trickroom_session` as an HTTP-only, SameSite=Strict cookie scoped to `/`.
2. Redirects to the same path and query string with `token` removed.
3. Authenticates later requests with that cookie.

The `x-trickroom-session` header remains available for non-browser clients. Invalid or missing credentials receive HTTP 403.

## HTTP API

Routes under `/api/trickroom` include runtime health and session state, project open/close operations, config and design reads/writes, exports, systems, memory, and Tailwind synchronization. See `src/server.ts` and `src/routes/` for the source-of-truth route definitions.

## Browser Editor Flow

The design route reads a design through the HTTP API, hydrates `designStore`, renders boards inside an iframe, and keeps editor chrome outside it. Dirty serialized state autosaves through the API. Linked system theme CSS is injected into the iframe when applicable.

The iframe shell is `src/iframe/shell.html`; it loads the Tailwind browser runtime from `public/tailwind/index.global.js`.

## MCP Flow

The MCP server is separate from the Hono app. It can infer an MCP-enabled direct-child project from the working directory, or start without a selected project and use registry tools to discover and select one.

MCP creation and mutation use the same design-file services as the HTTP app, with additional governance checks. Existing-file mutations require content-hash revisions.

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
