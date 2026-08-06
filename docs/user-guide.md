# User Guide

Trickroom is a local design workspace for web UI. It stores designs in your project as JSON and renders them with the same ingredients the app is built from: React components, component registries, and Tailwind class names.

The central idea is "Design Is Code": the editable design is not a separate binary canvas file. It is a small component tree with props, children, text content, and class names that can be versioned, reviewed, and safely edited by tools.

## What Trickroom Does

Trickroom helps you:

- Create a Trickroom project in an existing project folder.
- Create design files under `.trickroom/designs`.
- Build a design tree from registered components.
- Edit layers, names, text, Tailwind classes, and color properties.
- Link a design to a configured Tailwind system.
- Snapshot Tailwind color tokens from project CSS.
- Let agents inspect and edit designs through MCP.

The current app focuses on UI structure and Tailwind styling. It is not a bitmap editor, a full Figma replacement, or a code generator for arbitrary app components.

## Key Terms

Project:

A local folder that contains `.trickroom/config.json`. Trickroom registers recently opened projects in per-user app state so the browser app and MCP server can find them again.

Design:

A JSON file under `.trickroom/designs/<uuid>.json`. It has a name, an optional linked system, and top-level `boards` that contain a tree of elements.

System:

A named Tailwind CSS entry stored in `.trickroom/systems/<safe-system-name>/system.json` with a stable `systemId`, display `systemName`, and optional `cssPath`. Trickroom reads the CSS to extract color tokens and stores system-owned files in the same folder.

Element or layer:

One node in a design tree. The UI calls it a layer. The file format calls it a node. Every node has an ID, props, and either text content or child nodes.

Registry component:

A component definition that Trickroom knows how to render and author. The built-in `trickroom` registry currently provides `container` and `text`.

## Start A Project

Start Trickroom with a project path:

```sh
trickroom /path/to/project
```

In the browser app, enter a project path, open a recent project, or create Trickroom metadata in an existing folder.

When a project is opened, Trickroom ensures the project has a stable `projectId` in `.trickroom/config.json` and registers the local path in `~/.trickroom/projects.json`.

## What You Can Do In The Browser App

Project screen:

- Open an existing folder as a Trickroom project.
- Create project metadata when no config exists.
- Set a project name during creation.
- Optionally configure the first Tailwind system by name and CSS path.
- Switch back to project selection.
- Open recent projects.
- Create a new design file.
- Open existing design files.
- Review configured systems and token changes.
- Save and confirm Tailwind color-token override choices.

Design editor:

- Rename the design by clicking the title in the sidebar.
- Link or unlink a design system when no element is selected.
- Add container layers.
- Add text layers.
- Select layers from the layer tree.
- Double-click a layer name to rename it.
- Drag layers to reorder or reparent them.
- Right-click a layer and delete it.
- Edit text content for text layers.
- Edit raw Tailwind class names.
- Edit background, text, and border color through property controls.
- Pan the canvas with the wheel.
- Zoom with `Ctrl` or `Cmd` plus wheel.
- Pan with middle mouse drag or Space plus left drag.
- Rely on autosave after edits.
- Manually save while there are unsaved changes.

Shared server:

- Local loopback use stays unauthenticated by default.
- `trickroom --host 0.0.0.0 /path/to/project` generates and prints a tokenized bootstrap URL.
- Opening the bootstrap URL once stores an HTTP-only cookie and redirects to the clean URL.

## Typical Workflow

1. Open a project folder.
2. Create Trickroom metadata if the folder does not have it yet.
3. Optionally add one or more Tailwind systems from the project systems UI.
4. Create a design.
5. Add container and text layers.
6. Edit text and Tailwind classes.
7. Link the design to a system.
8. Review system token snapshots if Trickroom reports changes.
9. Commit `.trickroom/config.json`, `.trickroom/designs`, and `.trickroom/systems` if you want designs and system snapshots versioned with the project.

## Files Trickroom Creates Or Edits

The short version:

- Project config: `.trickroom/config.json`
- Design files: `.trickroom/designs/<uuid>.json`
- System metadata and Tailwind token snapshots: `.trickroom/systems/<safe-system-name>/system.json` and `.trickroom/systems/<safe-system-name>/tokens.json`
- MCP audit log, if enabled: `.trickroom/audit-log.jsonl`
- Per-user recent project registry: `~/.trickroom/projects.json`

Trickroom reads configured CSS files and imports to understand Tailwind tokens. It does not edit those CSS files or your app source files.

See [Files And Safety](./project-files.md) for the full list and exact write behavior.

## Agents Through MCP

When MCP is enabled for a project, agents can use Trickroom as a structured design workspace instead of editing JSON blindly.

Agents can safely ask:

- What projects are registered?
- Which project is selected for this MCP session?
- What design files exist?
- What is inside a design file?
- Where is one element in the hierarchy?
- Is a design structurally valid?
- What components can be used?
- What Tailwind tokens are available for the linked system?
- What would happen if this operation ran?
- Which registered project should be targeted (`locationId`)?

For multi-project MCP sessions:
- Call `listProjects` first to inspect available projects and their `locationId`.
- Call `selectProject({ locationId })` to set the active MCP session project.
- Attach design resources using `trickroom://proj/<locationId>/design/<designId>` references.

Agents can also mutate design files when policy allows:

- Create a new blank design file.
- Rename a design file.
- Add an element.
- Rename an element or update its class string.
- Update text content.
- Move an element.
- Delete an element and all descendants.

Existing-design mutations require an `expectedRevision` from a previous read. If the file changed, the tool returns `REVISION_MISMATCH` and the agent must re-read before retrying. New design creation instead fails if the chosen UUID already exists.

See [Agents And MCP](./mcp.md) for the full read-only/write/destructive tool map.

## Current Limits

- The built-in registry currently has `container` and `text`.
- The visible color UI currently edits background, text, and border colors.
- The class-name parser recognizes more color families than the UI exposes.
- Tailwind token sync currently stores color-domain tokens only.
- MCP can create and edit design files but does not currently edit project config.
- Browser API saves do not use MCP-style expected revisions; the browser editor relies on its local dirty revision tracking and autosave flow.

## Practical Suggestions

- Commit `.trickroom` files if you want designs to move with the project.
- Keep MCP in `read-only` mode until you are comfortable with the mutation workflow.
- Enable `auditLog` before letting agents perform larger edit sessions.
- Use `validateOperation` before a mutation when the target parent, role, or insertion point is uncertain.
- Use `validateDesignFile` after multi-step agent edits.
