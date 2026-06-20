# Trickroom Docs

These docs are organized as a user guide first and implementation notes second. Start with the workflows and safety boundaries, then read the architecture pages when you need to understand how the pieces are built.

## Start Here

1. [User Guide](./user-guide.md): what Trickroom does, key terms, Electron capabilities, normal workflows, and current limits.
2. [Files And Safety](./project-files.md): every durable file Trickroom creates or edits, what it only reads, and what protections exist.
3. [Agents And MCP](./mcp.md): what agents can ask Trickroom to do, which tools are read-only, which tools write, and which operations are destructive.

## Deeper Topics

- [Concepts And Design Model](./design-model.md): project, design, system, registry, board, layer, element, props, and the "Design Is Code" philosophy.
- [Tailwind Systems And Classname Editing](./tailwind-design-systems.md): Tailwind token snapshots, theme injection, and how class strings become reactive property controls.
- [Architecture](./architecture.md): React app, Hono API, Electron shell, MCP server, build output, and runtime data flow.
- [Development](./development.md): local setup, scripts, packaging, generated files, and test coverage.

## Quick Safety Summary

Trickroom writes project metadata under `.trickroom`, recent-project state under `~/.trickroom`, and no application source files. MCP writes are gated by project config, design-file allowlists, component allowlists, and content-hash revisions. `deleteElement` removes a subtree and cannot be undone by Trickroom itself.

## Source Pointers

- `src/components/`: React app, project screens, editor chrome, and stage.
- `src/server.ts`: local HTTP API.
- `src/project.ts`: project config and path handling.
- `src/services/design-file-service.ts`: design file path safety, validation, atomic writes, and revisions.
- `src/services/design-transform-service.ts`: MCP mutation semantics.
- `src/mcp/server.ts`: MCP prompts, tools, policy, and audit logging.
- `src/utils/tailwind-*`: Tailwind token sync, storage, theme CSS, and class-name modeling.
- `electron/main.ts`: Electron backend supervision, native menu, folder picker, and security guard setup.
