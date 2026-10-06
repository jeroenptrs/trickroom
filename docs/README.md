# Trickroom Docs

These docs are organized as a user guide first and implementation notes second. Start with the workflows and safety boundaries, then read the architecture pages when you need to understand how the pieces are built.

## Start Here

1. [User Guide](./user-guide.md): what Trickroom does, key terms, browser capabilities, normal workflows, and current limits.
2. [Files And Safety](./project-files.md): every durable file Trickroom creates or edits, including `components.json` and system-component revision rules, what it only reads, and what protections exist.
3. [Agents And MCP](./mcp.md): what agents can ask Trickroom to do, which tools are read-only, which tools write, and which operations are destructive.

## Deeper Topics

- [Concepts And Design Model](./design-model.md): project, design, system, registry, board, layer, element, props, and the "Design Is Code" philosophy.
- [Tailwind Systems And Classname Editing](./tailwind-design-systems.md): Tailwind token snapshots, theme injection, and how the inspector completes and validates class strings.
- [Architecture](./architecture.md): React app, Hono API, MCP server, authentication, build output, and runtime data flow.
- [Component Codegen](./codegen.md): generate and check tailwind-variants files from published system components with `trickroom codegen`.
- [Design System Lint](./lint.md): check how the app and the Designs use a design system with `trickroom lint`, the `lint` MCP tool and the report the dashboard reads; the specification for `lint.json`, `lint-report.json`, the contract, the rule kinds and the ratchet.
- [Development](./development.md): local setup, scripts, packaging, generated files, and test coverage.

## Quick Safety Summary

Trickroom writes project metadata under `.trickroom`, recent-project state, settings and agent feedback on the MCP tools under `~/.trickroom`, and no application source files, except the variants files `trickroom codegen` writes to the `outDir` you configure. `trickroom lint` reads application sources and writes only `lint-report.json` under the system folder. MCP writes are gated by project config, design-file allowlists, component allowlists, and content-hash revisions. A `deleteElement` operation removes a subtree and cannot be undone by Trickroom itself.

## Source Pointers

- `src/components/`: React app, project screens, editor chrome, and stage.
- `src/server.ts`: local HTTP API.
- `src/project.ts`: project config and path handling.
- `src/services/design-file-service.ts`: design file path safety, validation, atomic writes, and revisions.
- `src/services/design-transform-service.ts`: MCP mutation semantics.
- `src/mcp/tools/`: MCP tools, one module per tool group; `src/mcp/prompts.ts`: MCP prompts; `src/mcp/governance.ts`: policy and audit logging.
- `src/utils/tailwind-*`: Tailwind token sync, storage, theme CSS, and class-name modeling.
- `src/server-entry.ts`: production HTTP server startup, host policy, and static app serving.
