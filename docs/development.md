# Development

This repository is a TypeScript, React, Vite, Hono, Tailwind, and MCP project managed with pnpm.

## Requirements

Install dependencies with the package-manager version declared in `package.json`:

```sh
pnpm install
```

## Common Commands

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Generate Tailwind baseline tokens, then start Vite. |
| `pnpm build` | Build the web, server, MCP, migrate, feedback, codegen and lint runtimes. |
| `pnpm build:web-runtime` | Generate tokens, typecheck, and build the client. |
| `pnpm build:server` | Build the production Hono server. |
| `pnpm build:mcp` | Build the stdio MCP output. |
| `pnpm build:migrate` | Build `dist/migrate.js` for `trickroom migrate`. |
| `pnpm build:feedback` | Build `dist/feedback.js` for `trickroom feedback`. |
| `pnpm build:codegen` | Build `dist/codegen.js` for `trickroom codegen` (entry `src/cli/codegen.ts`, config `vite.codegen.config.ts`). |
| `pnpm build:lint` | Build `dist/lint.js` for `trickroom lint` (entry `src/cli/lint.ts`, config `vite.lint.config.ts`). |

Screenshot support is optional. The published package declares `playwright-core` as an optional peer, while keeping it as a development dependency for this repository. Install it alongside Trickroom and provide Chrome/Chromium before using screenshot APIs or MCP tools:

```sh
pnpm add -D playwright-core
pnpm exec playwright-core install chromium
```

An existing browser may instead be selected with `TRICKROOM_CHROME_PATH` or the screenshot request's `executablePath`. Both server builds keep `playwright-core` as a runtime external so normal Trickroom installation and startup do not bundle it.

`oxc-parser` (the TSX parser behind `trickroom lint`) is a regular dependency with a native binding, so every SSR bundle keeps it external as well (`nativeRuntimeDependencies` in the `vite.*.config.ts` files).
| `pnpm preview` | Preview the built client. |
| `pnpm generate:tailwind-tokens` | Regenerate the Tailwind default color baseline. |
| `pnpm test` | Run Vitest once. |
| `pnpm typecheck` | Typecheck all configured TypeScript projects. |

## Running The Browser Runtime

Development:

```sh
pnpm dev
```

Production-style local CLI:

```sh
pnpm build
node bin/trickroom.js serve /path/to/project
```

The default URL is `http://localhost:18100/`. Runtime variables are:

| Variable | Purpose |
| --- | --- |
| `TRICKROOM_HTTP_PORT` | Built server port. |
| `TRICKROOM_HTTP_HOST` | Built server bind host. |
| `TRICKROOM_PUBLIC_URL` | Base URL used in printed, emitted, and opened URLs, e.g. behind a reverse proxy; see [Public host](#public-host). |
| `TRICKROOM_PUBLIC_HOST` | Host used in printed, emitted, and opened URLs; see [Public host](#public-host). |
| `TRICKROOM_SESSION_TOKEN` | Enables HTTP session authentication; required on non-loopback hosts. |
| `TRICKROOM_PROJECT_DIR` | Initial project root. |
| `TRICKROOM_HOME` | Per-user app-state directory. |
| `TRICKROOM_MCP_CALL_LOG` | `1` or `0`: turn the MCP call log on or off for one MCP session, over `mcp.callLog` in settings. |

Serve flags are:

| Flag | Purpose |
| --- | --- |
| `--host <host>` | Bind to a hostname or IP address. |
| `--public-url <url>` | Base URL to show instead of the bind host and port, e.g. behind a reverse proxy; see [Public host](#public-host). |
| `--public-host <host>` | Host to show in URLs instead of the bind host; see [Public host](#public-host). |
| `--port <port>` | Bind to a port; use `0` to select an available port. |
| `--token <token>` | Enable HTTP session authentication with an explicit token. |
| `--no-open` | Do not launch a browser; retain human status output. |
| `--silent` | Do not launch a browser or print human status output. |

After listening, the CLI writes one JSON ready record to stdout. Human status is written to stderr, so stdout remains machine-readable. The ready record includes the actual port, bootstrap URL, and session token when authentication is enabled.

```json
{"type":"trickroom:server-ready","version":1,"host":"localhost","publicHost":"localhost","publicUrl":null,"port":18100,"url":"http://localhost:18100/?token=secret","token":"secret","authenticated":true}
```

`host` is the bind address. `publicHost` is the host used in `url`. `publicUrl` is the configured public base URL, or `null` when none is set.

`--silent` still emits this record because it is the automation contract.

To share the server on a network:

```sh
node bin/trickroom.js serve /path/to/project --host 0.0.0.0 --no-open
```

The CLI generates a token when one is not already configured. Opening the ready record's bootstrap URL once stores an HTTP-only cookie and redirects to a URL without the token. An explicit token can be supplied through `--token` or `TRICKROOM_SESSION_TOKEN`.

### Public host

The bind host is often not an address another machine can open: `0.0.0.0` and `::` listen on every interface. URLs printed by `trickroom serve`, the ready record's `url`, and the browser it opens use a separate public address, resolved in this order:

1. `--public-url <url>`
2. `TRICKROOM_PUBLIC_URL`
3. `server.publicUrl` in `~/.trickroom/settings.json` (or `$TRICKROOM_HOME/settings.json`)
4. `--public-host <host>`
5. `TRICKROOM_PUBLIC_HOST`
6. `server.publicHost` in the same settings file
7. Inferred: for a wildcard bind host (`0.0.0.0`, `::`, `[::]`), the machine's hostname; otherwise the bind host itself.

To make a remote machine always print a URL you can open, set it once in the user settings file:

```json
{
  "version": 1,
  "mcp": { "toolGroups": {} },
  "server": { "publicHost": "devbox.tailnet.ts.net" }
}
```

A public URL is used exactly as written: its scheme, host, and port replace the bind host and listening port, and the listening port is not appended. It must be `http` or `https` with an optional port; a path, query string, fragment, credentials, or wildcard host is rejected, because the app loads `/assets/` and `/api/` from the root of its origin. Use it when a reverse proxy terminates TLS in front of Trickroom:

```sh
trickroom serve /path/to/project --host 0.0.0.0 --public-url https://devbox.example.com
```

```json
{
  "version": 1,
  "mcp": { "toolGroups": {} },
  "server": { "publicUrl": "https://devbox.example.com" }
}
```

The session cookie is marked `Secure` when the request arrives over HTTPS, either directly or through a proxy that sets `X-Forwarded-Proto: https`. Over plain HTTP it is not, so local HTTP use keeps working. If the proxy does not send `X-Forwarded-Proto`, the cookie is still set and sent over HTTPS, just without `Secure`.

A public host must be a bare host name or IP address; a scheme, port, or path is rejected at startup. IPv6 addresses are bracketed in URLs automatically. Neither setting affects authentication: a non-loopback bind host still requires a session token even if the public host is `localhost`. An unreadable settings file is reported and ignored, and the host is inferred.

Vite also rejects non-loopback development binds without `TRICKROOM_SESSION_TOKEN`:

```sh
TRICKROOM_SESSION_TOKEN="choose-a-long-random-token" pnpm dev -- --host 0.0.0.0
```

In development, Vite prints its own `Local` and `Network` URLs (one per interface IP address, never `0.0.0.0`) and does not take `--public-url` or `--public-host`. Vite rejects requests whose `Host` header is not an IP address, `localhost`, or a name in `server.allowedHosts`, so the dev config adds the hostname of `TRICKROOM_PUBLIC_URL` or `server.publicUrl`, and `TRICKROOM_PUBLIC_HOST` or `server.publicHost`, to `allowedHosts`.

## Migrating Design Storage

```sh
pnpm build:migrate
node bin/trickroom.js migrate path/to/project --dry-run
node bin/trickroom.js migrate path/to/project
```

Converts every design of a project to the folder layout and reconciles designs that exist in both layouts. See [Files And Safety](project-files.md#design-file-versions). Set `TRICKROOM_HOME` when trying it on a copy, so its lockfiles stay out of your own Trickroom home.

## Reviewing Agent Feedback

```sh
pnpm build:feedback
node bin/trickroom.js feedback --since 2w --calls
```

Reads `<TRICKROOM_HOME>/feedback/` and prints a Markdown summary; see [Feedback](mcp.md#feedback). Set `TRICKROOM_HOME` to a scratch folder when trying `feedback_submit` against a local build, so test reports stay out of your own home.

## Running MCP Locally

```sh
pnpm build:mcp
node bin/trickroom.js mcp
```

Projects opened through MCP must enable MCP in `.trickroom/config.json`.

## Running Lint Locally

```sh
pnpm build:lint
node bin/trickroom.js lint --check
```

This repository lints its own `.trickroom` project: `.trickroom/systems/trickroom/lint.json` scans `src/**` without tests, and the committed `lint-report.json` is the baseline. `--check` writes nothing and exits 1 when a number got worse than the baseline, naming it. After a change that lowers a count (fewer arbitrary text sizes, say), run `node bin/trickroom.js lint` without `--check` and commit the new report with the change. Never commit a report with `"status": "fail"`: the dashboard's "Run lint" writes one when a run fails, so the UI can show it. `--json` prints the whole result. See [Design System Lint](lint.md).

`oxc-parser` ships prebuilt native bindings per platform as optional dependencies; when `pnpm install` skips them (an unsupported platform, `--no-optional`), `trickroom lint` fails to load the parser. Reinstall with optional dependencies.

## Repository Layout

```text
bin/                       CLI entry points
docs/                      User and developer documentation
plugin/spa-server/         Local Vite SPA/Hono server plugin
public/tailwind/           Browser Tailwind runtime asset
scripts/                   Build-time scripts
src/app-state/             Per-user project registry helpers
src/components/            React UI, editor chrome, stage, and primitives
src/hooks/                 Stage navigation and Tailwind sync hooks
src/iframe/                Iframe shell used by the design stage
src/libraries/             Component registry definitions
src/lint/                  Design system lint engine (contract, rules, source model, report, ratchet)
src/mcp/                   MCP server, governance, diagnostics, and tests
src/queries/               Browser fetch/query wrappers
src/routes/                Hono route modules
src/services/              Design file and mutation services
src/stores/                TanStack Store editor state
src/utils/                 JSON helpers and Tailwind utilities
test-projects/             Local fixture projects
```

## Generated Files

`src/utils/default-tailwind-tokens.ts` is generated by `pnpm generate:tailwind-tokens` from the installed Tailwind package. Do not manually edit it unless replacing the generator output.

## Tests

The Vitest suite covers project config and registry state, HTTP authentication and routes, design file safety and migrations, browser editor state, Tailwind extraction and storage, MCP governance and tools, and component behavior.
