# Architecture

Trickroom has four runtime surfaces that all work against the same local project files:

1. React app for project selection and design editing.
2. Hono HTTP API for browser/Electron app data access.
3. Electron shell for packaged desktop use.
4. Stdio MCP server for agent access.

## Runtime Map

React app:

- Entry: `src/main.tsx`
- Routes: `src/App.tsx`
- Project gate: `src/components/Root.tsx`
- Project home: `src/components/Project.tsx`
- Design editor: `src/components/Design.tsx`

Routes:

- `/`: project home when a project is active.
- `/design/:uuid`: design editor.
- `/new`: project creation dialog.

Local HTTP API:

- Entry: `src/server.ts`
- Prefix: `/api/trickroom`
- Tailwind routes: `src/routes/tailwind.ts`

Electron:

- Main process: `electron/main.ts`
- Preload bridge: `electron/preload.ts`
- Backend supervisor: `electron/backend-supervisor.ts`

MCP:

- CLI: `bin/trickroom-mcp.js`
- Stdio runtime: `src/mcp/stdio.ts`
- Tools and prompts: `src/mcp/server.ts`
- Governance: `src/mcp/governance.ts`

## Project Session Flow

Opening a project does two things:

- Ensures `.trickroom/config.json` exists and has a stable `projectId`.
- Registers the local location in the per-user registry.

The Hono app stores the active project in memory. Project-scoped routes resolve that active project before reading config, designs, or Tailwind snapshots.

When `TRICKROOM_PROJECT_DIR` is set, startup opens that project. Otherwise the app can start with no active project and let the UI choose one.

## HTTP API

Routes under `/api/trickroom`:

| Route | Purpose |
| --- | --- |
| `GET /health` | Runtime health and active project metadata. |
| `GET /session` | Active project, registry active project, and recent projects. |
| `POST /projects/open` | Open/register a project path. |
| `POST /projects/close` | Clear the active project in this app session. |
| `GET /project-root` | Return the active project root. |
| `GET /config` | Read `.trickroom/config.json`. |
| `POST /config` | Create project config when missing. |
| `GET /design?file=...` | Read one design JSON file. |
| `GET /designs` | List valid design summaries. |
| `PUT /design?file=...` | Validate and write one design JSON file. |
| `/tailwind/*` | Sync, read, and confirm Tailwind token snapshots. |

In Electron mode, every API request must include the `trickroom_session` cookie matching `TRICKROOM_SESSION_TOKEN`. Browser CLI mode is a local unauthenticated server.

## Electron Shell

Packaged Electron builds run the same React app and Hono API, but the main process supervises the backend:

- Parses an optional initial project path from argv.
- Starts the built backend as a child process.
- Forces the backend to bind to `127.0.0.1` on a dynamic port.
- Waits for a structured ready payload.
- Generates a random session token.
- Sets an HTTP-only same-origin session cookie.
- Creates a locked-down `BrowserWindow`.
- Installs navigation guards, permission denial, and CSP.
- Exposes only `pickProjectFolder()` through preload.
- Stops the backend process before quit.

The native menu calls the same HTTP project open/close routes as the React UI. Electron does not maintain a separate project model.

Hot development mode can use `TRICKROOM_ELECTRON_RENDERER_URL` to point Electron at a loopback Vite server instead of starting the built backend.

## Browser Editor Flow

The design route:

1. Reads the design file from `/api/trickroom/design`.
2. Hydrates `designStore`.
3. Renders artboards inside an iframe.
4. Renders editor chrome outside the iframe.
5. Injects linked system theme CSS into the iframe when applicable.
6. Autosaves dirty serialized design state through `PUT /api/trickroom/design`.

The iframe shell is:

```text
src/iframe/shell.html
```

It loads the Tailwind browser runtime from:

```text
public/tailwind/index.global.js
```

## MCP Flow

The MCP server is separate from the Hono app.

Startup project selection:

1. Infer a direct-child project from the process working directory when it contains a valid MCP-enabled `trickroom` project config.
2. If no valid CWD project is found, start with no selected MCP project.
3. Register additional local project roots with `registerProject`; select one for the MCP session with `selectProject`.

Project-scoped tools operate on the session-selected project, not desktop app active-state switches. MCP startup and runtime still use the global project registry for discovery (`listProjects` and resource discovery), but no automatic retargeting happens when the desktop UI changes its active project.

MCP design creation and mutations use the same design file service as the app-facing code, with additional policy checks. Creation uses exclusive file creation for new UUIDs; existing-file mutations require content-hash revisions.

## Build Shape

Package scripts:

- `pnpm dev`: generate Tailwind baseline tokens, then start Vite.
- `pnpm build`: build web runtime and MCP runtime.
- `pnpm build:web-runtime`: generate tokens, run TypeScript, build the app/server runtime.
- `pnpm build:mcp`: build `dist/mcp-stdio.js`.
- `pnpm build:electron`: build Electron main and preload bundles.
- `pnpm build:desktop`: build web runtime, MCP runtime, and Electron bundles.
- `pnpm desktop:package`: package with Electron Forge.
- `pnpm desktop:make`: build and run Electron Forge makers.

The custom Vite SPA server plugin in `plugin/spa-server`:

- Serves Hono API routes in development.
- Falls through to Vite for browser routes.
- Builds the client to `dist/client`.
- Builds the Hono app as server output.
- Writes `dist/index.js`, which starts `@hono/node-server`.
- Uses `TRICKROOM_HTTP_PORT` and `TRICKROOM_HTTP_HOST` at runtime.

The MCP Vite config builds the stdio runtime as SSR output without clearing the app build output.

## Important Boundaries

Project-owned state:

- `.trickroom/config.json`
- `.trickroom/designs/*.json`
- `.trickroom/systems/*/system.json`
- `.trickroom/systems/*/tokens.json`
- `.trickroom/audit-log.jsonl`

Per-user state:

- `~/.trickroom/projects.json`

Runtime/build output:

- `dist/`
- `dist-electron/`
- `out/`

Source-of-truth design state is not in Electron, not in browser local storage, and not in an external hosted service. It is the project files.
