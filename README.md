# Trickroom

Trickroom is a local-first design workspace for web interfaces. It lets you create and edit UI design files inside a real project folder, using React component instances and Tailwind class names as the source of truth.

The app is intentionally close to code: designs are JSON files under `.trickroom/designs`, components come from registries, styling is stored as Tailwind class strings, and Tailwind design-system tokens can be snapshotted from your project CSS.

## What You Use It For

- Open or create a Trickroom project in an existing codebase.
- Create design files that live in the project under `.trickroom`.
- Build UI structure with container and text layers.
- Reorder, reparent, rename, and delete layers.
- Edit text content, raw Tailwind class names, and color properties.
- Link a design to a configured Tailwind system and review synced color tokens.
- Let agents inspect or mutate designs through MCP with explicit policy and revision checks.

Trickroom is not a general image editor and it does not rewrite your application source code. It works on Trickroom project metadata, design JSON, token snapshots, and optional MCP audit logs.

## Start The App

Install globally:

```sh
npm install -g trickroom
```

Open the current folder:

```sh
trickroom .
```

Or pass a project directory:

```sh
trickroom /path/to/project
```

The browser runtime defaults to `http://localhost:18100/`. Loopback use needs no authentication. To share it on a network, pass a non-loopback host; the CLI generates a session token and prints a one-time bootstrap URL:

```sh
trickroom --host 0.0.0.0 /path/to/project
```

## Files Trickroom Writes

Project-owned files:

- `.trickroom/config.json`: project name, project ID, and MCP policy.
- `.trickroom/designs/<uuid>.json`: design files.
- `.trickroom/designs/.gitkeep`: created when initializing the designs directory.
- `.trickroom/systems/<safe-system-name>/system.json`: system ID, display name, CSS path, and icon folders.
- `.trickroom/systems/<safe-system-name>/tokens.json`: stored Tailwind color-token snapshots.
- `.trickroom/audit-log.jsonl`: MCP mutation audit log when enabled.

Per-user app state:

- `~/.trickroom/projects.json`: recent projects and the active local project location. Override with `TRICKROOM_HOME`.

Trickroom reads configured Tailwind CSS files and their imports to extract tokens, but it does not edit those CSS files.

## Agents And MCP

Enable MCP in `.trickroom/config.json`:

```json
{
  "name": "Example App",
  "mcp": {
    "enabled": true,
    "mode": "read-write"
  }
}
```

Start the server:

```sh
trickroom-mcp
```

Agents can list projects, open/switch the active project, create design files, read designs, inspect elements, validate files, discover component registries, read linked design-system tokens, dry-run operations, and mutate design files. Existing-file mutations require an `expectedRevision` from a prior read, so agents must re-read after conflicts instead of guessing.

For the full tool map and safety model, see [Agents And MCP](./docs/mcp.md).

## Documentation

Start with [the user guide](./docs/user-guide.md). The rest of the docs are organized by question:

- [Files And Safety](./docs/project-files.md)
- [Agents And MCP](./docs/mcp.md)
- [Concepts And Design Model](./docs/design-model.md)
- [Tailwind Systems And Classname Editing](./docs/tailwind-design-systems.md)
- [Architecture](./docs/architecture.md)
- [Development](./docs/development.md)

## Development

```sh
pnpm install
pnpm dev
pnpm test
```

Build the browser runtime and MCP bundle:

```sh
pnpm build
```

## License

This project is licensed under [AGPL-3.0](./LICENSE). If your organization needs a commercial license that does not require open-sourcing your modifications, contact [contact@jeroenpeeters.be](mailto:contact@jeroenpeeters.be).
