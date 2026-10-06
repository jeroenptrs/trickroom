# User Guide

Trickroom is a local design workspace for web UI. It stores designs in your project as JSON and renders them with the same ingredients the app is built from: React components, component registries, and Tailwind class names.

The central idea is "Design Is Code": the editable design is not a separate binary canvas file. It is a small component tree with props, children, text content, and class names that can be versioned, reviewed, and safely edited by tools.

## What Trickroom Does

Trickroom helps you:

- Create a Trickroom project in an existing project folder.
- Create design files under `.trickroom/designs`.
- Build a design tree from registered components.
- Edit layers, names, text, and Tailwind classes.
- Link a design to a configured Tailwind system.
- Snapshot Tailwind color tokens from project CSS.
- Let agents inspect and edit designs through MCP.

The current app focuses on UI structure and Tailwind styling. It is not a bitmap editor, a full Figma replacement, or a code generator for arbitrary app components.

## Key Terms

Project:

A local folder that contains `.trickroom/config.json`. Trickroom registers recently opened projects in per-user app state so the browser app and MCP server can find them again.

Design:

A folder under `.trickroom/designs/<id>/` with a `design.json` and one JSON file per board in `boards/`. It has a name, an optional linked system, and top-level `boards` that contain a tree of elements. Designs created by older versions of Trickroom (one `.trickroom/designs/<id>.json` file) still open and move to the folder layout when they are next saved, or all at once with `trickroom migrate`.

System:

A named Tailwind CSS entry stored in `.trickroom/systems/<safe-system-name>/system.json` with a stable `systemId`, display `systemName`, and optional `cssPath`. Trickroom reads the CSS to extract color tokens and stores system-owned files in the same folder.

Element or layer:

One node in a design tree. The UI calls it a layer. The file format calls it a node. Every node has an ID, props, and either text content or child nodes.

Registry component:

A component definition that Trickroom knows how to render and author. The built-in `trickroom` registry currently provides `container` and `text`.

## Start A Project

Start Trickroom with a project path:

```sh
trickroom serve /path/to/project
```

Run `trickroom` without a command to start the server and choose a project in the browser.

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

- Rename the design by clicking its title in the layers panel header, or in the toolbar while the layers panel is collapsed.
- Link or unlink a design system when no element is selected.
- Add container layers.
- Add text layers.
- Select layers from the layer tree.
- Double-click a layer name to rename it.
- Drag layers to reorder or reparent them.
- Right-click a layer and delete it.
- Edit text content for text layers.
- Edit a layer's Tailwind classes as free text, with autocomplete from the linked system (see [The Inspector](#the-inspector)).
- Pan the canvas with the wheel.
- Zoom with `Ctrl` or `Cmd` plus wheel.
- Pan with middle mouse drag or Space plus left drag.
- Rely on autosave after edits.
- Manually save while there are unsaved changes.
- The layers panel starts collapsed. Its header sits at the start of the toolbar above the stage: the back button, the design name (click it to rename), the linked system, the design tokens button and a button to expand the layers panel. Expand it with that button or with `Alt` + `[` (`⌥ [` on macOS); the header then moves back into the panel. Collapse it again with the panel button at the right end of its header, after the save state, or the same shortcut. Collapse and expand the properties panel with the toggle button at the right end of the toolbar, or with `Alt` + `]` (`⌥ ]`). The stage takes the freed width. The choice holds while you move between designs and resets on a page reload. A collapsed layers panel keeps autosave, `Cmd`/`Ctrl` + `S` and the layer shortcuts working.
- Move focus between the layers panel, the stage and the properties panel with `Alt` + `1`, `2` and `3`. Focusing a collapsed panel expands it first.
- Go back to the project screen with `Cmd`/`Ctrl` + `[`.

System editor:

- Add an icon folder by its project-relative path, for example `src/icons`. Trickroom indexes the SVGs inside it.
- Register an image asset by its project-relative path, for example `public/images/hero.png`. The file stays where it is. The browser has no file picker or upload, so the image has to be in the project already.
- The left sidebar starts collapsed, with its header floating over the top-left of the workspace: the back button, the system name and sync state (in the component editor: back to components, the component name and its draft or published state), and a button to expand the sidebar. Expand it with that button or with `Alt` + `[`; collapse it again with the panel button at the right end of its header (in the component editor, at the right end of the component header) or the same shortcut. The sidebar keeps working while collapsed: draft sync and the layer shortcuts stay active, and the open component tab is kept.
- Collapse the inspector with the panel button in its header, or with `Alt` + `]`. Collapsing keeps the selection and leaves a strip on the right edge to expand it again; the X next to it clears the selection instead. With nothing selected the right side stays empty, as before.
- `Alt` + `1` and `Alt` + `3` expand a collapsed panel before focusing it. The choice holds for the session, separately from the design editor, and resets on a page reload.

Shared server:

- Local loopback use stays unauthenticated by default.
- `trickroom serve /path/to/project --host 0.0.0.0` generates a token and prints a machine-readable ready line containing the tokenized bootstrap URL.
- Because `0.0.0.0` is not an address a browser can open, the printed URL uses the machine's hostname instead. If that name doesn't resolve from the machine you browse from, set the host to print with `--public-host <host>`, `TRICKROOM_PUBLIC_HOST`, or once in `~/.trickroom/settings.json`:

  ```json
  { "version": 1, "mcp": { "toolGroups": {} }, "server": { "publicHost": "devbox.local" } }
  ```

- Behind a reverse proxy, where the address you open has a different scheme or port than the one Trickroom listens on, set the full base URL instead with `--public-url <url>`, `TRICKROOM_PUBLIC_URL`, or `server.publicUrl`. It wins over the public host and is printed without Trickroom's own port:

  ```json
  { "version": 1, "mcp": { "toolGroups": {} }, "server": { "publicUrl": "https://devbox.example.com" } }
  ```
- `--no-open` prevents browser launch while retaining human status output; `--silent` also suppresses human status output.
- Opening the bootstrap URL once stores an HTTP-only cookie and redirects to the clean URL.

## The Inspector

The right-hand inspector shows the selected layer in one scrolling panel: its classes first, then its properties. The component editor's draft inspector uses the same layout.

Classes:

- The class field holds the layer's own `className`, written the way you would write it in code. It wraps, uses a monospace font, and accepts a pasted class string.
- Changes are written when the field loses focus or on `Cmd`/`Ctrl` + `Enter`. `Escape` discards the edit and restores the stored value. Whitespace and line breaks are collapsed to single spaces when written.
- Suggestions for the class under the caret come from the linked system's compiled Tailwind design system: every utility, including the project's theme tokens and custom `@utility` definitions, and every variant (`hover:`, `md:`, `dark:`, `group-hover:` …). Without a linked system, suggestions come from default Tailwind. Use the arrow keys to move through suggestions, `Enter` or `Tab` to accept, `Escape` to close the list, and `Ctrl` + `Space` to open it.
- Classes Tailwind does not recognize get a wavy red underline and a line below the field, with a "did you mean" fix when a close match exists. Classes that a later class overrides (`p-4` followed by `p-6`) are listed with a one-click remove.
- Classes the layer inherits are listed above the field as read-only chips, grouped by where they come from: **Recipe** (library base classes), **Component**, **Variant**, and **Compound variant**. A struck-through chip is overridden by a later class. On a component instance, the field edits the instance's class override, not the component.
- In the component draft inspector, the **Style target** picker chooses which classes you edit: the base template, a variant value, or a compound variant. Each active target gets its own field.

Properties:

- Text content, asset and icon pickers, registry controls, and recipe controls for the selected layer.
- On component instances: variant values, overrides, update and migration status, and detach.
- In the component draft inspector: slot and override target settings.
- With nothing selected: the design system picker, the dark-mode preview toggle, and the keyboard shortcut list.

There are no visual style controls (color pickers, spacing boxes, and so on). Write the Tailwind classes directly, or have an agent write them through MCP.

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
- Designs: `.trickroom/designs/<id>/design.json` and `.trickroom/designs/<id>/boards/<boardId>.json`
- System metadata and Tailwind token snapshots: `.trickroom/systems/<safe-system-name>/system.json` and `.trickroom/systems/<safe-system-name>/tokens.json`
- MCP audit log, if enabled: `.trickroom/audit-log.jsonl`
- Per-user recent project registry: `~/.trickroom/projects.json`
- Agent feedback on the MCP tools, and the optional call log: `~/.trickroom/feedback/`

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
- Call `project_list` first to see the session's project and the other registered projects with their `locationId`.
- Call `project_select({ locationId })` to switch the MCP session project, or `project_select({ path })` for a project that is not registered yet.
- Attach design resources using `trickroom://proj/<locationId>/design/<designId>` references.

Agents can also change design files when policy allows, with `design_create` and `design_apply`:

- Create a new design file, empty or from a copy of an existing element.
- Add elements, recipes (dialogs, menus, selects) and design system component instances, and fill their slots.
- Rename layers, update class strings, controls and text.
- Move, copy or delete elements, and rename the design.

`design_apply` takes an ordered list of operations and writes them as one change, or nothing if a step fails.

Existing-design mutations require an `expectedRevision` from a previous read. If the file changed, the tool returns `REVISION_MISMATCH` and the agent must re-read before retrying. New design creation instead fails if the chosen UUID already exists.

Agents can also see what you have selected in the editor (`editor_context`) and point your editor at what they changed (`editor_focus`).

See [Agents And MCP](./mcp.md) for the full tool map.

### Reviewing agent feedback

Agents can report friction with Trickroom's tools (an error they could not act on, output too large to use, a missing capability) through `feedback_submit`. Reports stay on your machine in `~/.trickroom/feedback/`, one JSON Lines file per month, each with the agent's last few tool calls (names, outcomes, durations and sizes; never arguments, results or design content). Run `trickroom feedback` to see the last 30 days: counts by category, tool and severity, then each report. Add `--since 2w`, `--tool design_apply` or `--category output_too_large` to narrow it, or `--json` for the raw entries. To also measure how agents use the tools without waiting for reports, set `"callLog": true` under `"mcp"` in `~/.trickroom/settings.json` (off by default) and run `trickroom feedback --calls` for calls, error rates, durations and output sizes per tool. The output is Markdown, so you can paste it into an agent conversation and ask what to fix first.

### Working alongside an agent

When an agent (or another tab, or a git checkout) changes the design you have open, the editor picks up only the boards that changed. Your selection, the board you are on, zoom and scroll stay where they are, and your unsaved edits to other boards are kept and saved as usual.

- Changed boards get a **Changed** tag in the Layers panel, and changed layers a cyan square. In the responsive view, **N changed** next to the board navigation jumps to the next changed board. When a changed board is in view, its changed layers are outlined briefly. The markers clear a few seconds after you have seen the board, or as soon as you select or edit something in it.
- If you and the agent changed the same board, the changes are merged layer by layer. You are only asked when both changed the same property or text of a layer (or moved things in ways that do not combine). The dialog lists each conflicting board; for each, **Take theirs** loads the version on disk and drops your edits to that board, **Keep mine** saves your version of that board over the one on disk. Other boards are not affected by either choice.

## Current Limits

- The built-in registry currently has `container` and `text`.
- Tailwind token sync currently stores color-domain tokens only.
- MCP can create and edit design files but does not currently edit project config.
- Browser and MCP writes both use content-hash revisions to prevent stale existing-file writes. When an external edit arrives while the browser is dirty, the editor asks whether to reload it or keep the local version.

## Practical Suggestions

- Commit `.trickroom` files if you want designs to move with the project.
- Keep MCP in `read-only` mode until you are comfortable with the mutation workflow.
- Enable `auditLog` before letting agents perform larger edit sessions.
- Use `design_validate` with the planned operations before a write when the target parent, role, or insertion point is uncertain.
- Use `design_validate` on the whole design after multi-step agent edits.
