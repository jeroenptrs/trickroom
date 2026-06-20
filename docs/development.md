# Development

This repository is a TypeScript, React, Vite, Hono, Electron, Tailwind, and MCP project managed with pnpm.

## Requirements

The package declares:

```json
{
  "packageManager": "pnpm@10.33.2",
  "type": "module"
}
```

Install dependencies:

```sh
pnpm install
```

## Common Commands

Run the browser app in development:

```sh
pnpm dev
```

Run tests:

```sh
pnpm test
```

Build browser runtime and MCP runtime:

```sh
pnpm build
```

Build the full desktop runtime:

```sh
pnpm build:desktop
```

Run Electron after building desktop output:

```sh
pnpm electron:dev
```

Run Electron against the Vite development server with main/preload watch:

```sh
pnpm electron:dev:hot
```

Package the app:

```sh
pnpm desktop:package
```

Create platform makers:

```sh
pnpm desktop:make
```

## Scripts

From `package.json`:

| Script | Purpose |
| --- | --- |
| `pnpm dev` | Generate Tailwind baseline tokens, then start Vite. |
| `pnpm build` | Build the web runtime and MCP runtime. |
| `pnpm build:web-runtime` | Generate tokens, run TypeScript, build app/server. |
| `pnpm build:mcp` | Build the stdio MCP output. |
| `pnpm build:electron` | Build Electron main and preload bundles. |
| `pnpm build:desktop` | Build web, MCP, and Electron outputs. |
| `pnpm electron:dev` | Build desktop output, then launch Electron. |
| `pnpm electron:dev:hot` | Run Vite and a hot Electron shell. |
| `pnpm desktop:package` | Build and package with Electron Forge. |
| `pnpm desktop:prepare-dmg-native` | Compile macOS DMG maker helpers when needed. |
| `pnpm desktop:make` | Build and run Electron Forge makers. |
| `pnpm preview` | Run Vite preview. |
| `pnpm generate:tailwind-tokens` | Regenerate Tailwind default color token baseline. |
| `pnpm test` | Run Vitest once. |

## Running The Browser Runtime

Development:

```sh
pnpm dev
```

Production-style local CLI:

```sh
pnpm build
node bin/trickroom.js /path/to/project
```

Default browser URL:

```text
http://localhost:18100/
```

Runtime overrides:

| Variable | Purpose |
| --- | --- |
| `TRICKROOM_HTTP_PORT` | Built server port. |
| `TRICKROOM_HTTP_HOST` | Built server host. |
| `TRICKROOM_PROJECT_DIR` | Selected project root. |
| `TRICKROOM_HOME` | Per-user app-state directory. |

Pass `--silent` to `bin/trickroom.js` to prevent automatic browser launch.

## Running Electron

Build-and-run mode:

```sh
pnpm electron:dev
```

Hot mode:

```sh
pnpm electron:dev:hot
```

Open an initial project:

```sh
pnpm electron:dev -- /path/to/project
pnpm electron:dev:hot -- /path/to/project
```

Hot mode defaults to:

```text
http://127.0.0.1:18100/
```

Electron environment:

| Variable | Purpose |
| --- | --- |
| `TRICKROOM_ELECTRON=1` | Internal backend Electron-mode flag. |
| `TRICKROOM_HTTP_HOST=127.0.0.1` | Electron backend host. |
| `TRICKROOM_HTTP_PORT=0` | Dynamic backend port. |
| `TRICKROOM_SESSION_TOKEN` | Internal loopback API session token. |
| `TRICKROOM_ELECTRON_RENDERER_URL` | Hot-mode renderer/backend URL. |
| `TRICKROOM_ELECTRON_DEVTOOLS=1` | Enable DevTools menu item. |
| `TRICKROOM_ELECTRON_SMOKE=1` | Hidden smoke mode that exits after session check. |

Smoke mode:

```sh
TRICKROOM_ELECTRON_SMOKE=1 pnpm electron:dev
```

Run packaged smoke mode directly:

```sh
TRICKROOM_ELECTRON_SMOKE=1 out/Trickroom-darwin-arm64/Trickroom.app/Contents/MacOS/Trickroom
```

## Packaging And Signing

Package:

```sh
pnpm desktop:package
```

Package and sign on macOS:

```sh
TRICKROOM_MAC_SIGN=1 pnpm desktop:package
```

Default identity:

```text
Developer ID Application: Jeroen Peeters (7RJS2LBMGB)
```

Override identity:

```sh
TRICKROOM_MAC_SIGN=1 \
TRICKROOM_MAC_SIGN_IDENTITY="Developer ID Application: Name (TEAMID)" \
pnpm desktop:package
```

Use a non-default keychain:

```sh
TRICKROOM_MAC_SIGN=1 \
TRICKROOM_MAC_SIGN_KEYCHAIN="/path/to/keychain-db" \
pnpm desktop:package
```

Store notarization credentials:

```sh
xcrun notarytool store-credentials trickroom-notary \
  --apple-id "you@example.com" \
  --team-id "7RJS2LBMGB" \
  --password "app-specific-password"
```

Sign and notarize:

```sh
TRICKROOM_MAC_SIGN=1 \
TRICKROOM_NOTARY_KEYCHAIN_PROFILE=trickroom-notary \
pnpm desktop:make
```

macOS app output:

```text
out/Trickroom-darwin-arm64/Trickroom.app
```

Packaging uses a hoisted pnpm layout and disables ASAR so the supervised backend and MCP helper execute normal files from `Contents/Resources/app`.

## Running MCP Locally

Build MCP:

```sh
pnpm build:mcp
```

Start the MCP server:

```sh
node bin/trickroom-mcp.js
```

Projects opened through MCP must contain:

```json
{
  "mcp": {
    "enabled": true
  }
}
```

Packaged helper:

```sh
out/Trickroom-darwin-arm64/Trickroom.app/Contents/Resources/mcp-helper/mcp
```

## Repository Layout

```text
bin/                       CLI entry points
docs/                      User and developer documentation
electron/                  Electron main, preload, supervisor, and helpers
plugin/spa-server/         Local Vite SPA/Hono server plugin
public/tailwind/           Browser Tailwind runtime asset
scripts/                   Build-time scripts
src/app-state/             Per-user project registry helpers
src/components/            React UI, editor chrome, stage, and primitives
src/hooks/                 Stage navigation and Tailwind sync hooks
src/iframe/                Iframe shell used by the design stage
src/libraries/             Component registry definitions
src/mcp/                   MCP server, governance, diagnostics, tests
src/queries/               Browser fetch/query wrappers
src/routes/                Hono route modules
src/services/              Design file and mutation services
src/stores/                TanStack Store editor state
src/utils/                 JSON helpers and Tailwind utilities
test-projects/             Local fixture projects
```

## Generated Files

Generated source:

```text
src/utils/default-tailwind-tokens.ts
```

Regenerate:

```sh
pnpm generate:tailwind-tokens
```

The generator loads the installed Tailwind package's `index.css`, extracts the `--color` namespace, records the package version, and writes the baseline token map.

Do not manually edit generated token data unless the goal is to replace generator output.

## Tests

The Vitest suite covers:

- Project config paths, migration, and app-state registry.
- Server config and design routes.
- Design file path safety, validation, revisions, and atomic writes.
- Browser design store behavior.
- Tailwind token extraction, storage, sync, and theme CSS.
- Tailwind class parsing and property modeling.
- MCP startup, prompts, governance, read tools, mutations, diagnostics, and inspector smoke behavior.
- Electron navigation guards and backend supervisor behavior.
