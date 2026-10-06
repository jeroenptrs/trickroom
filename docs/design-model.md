# Concepts And Design Model

Trickroom designs are serialized React component trees. The editor normalizes those trees for interaction, renders them in an iframe, and serializes them back to JSON for autosave or MCP mutations.

## Design Is Code

Trickroom is built with Tailwind, React, and component libraries, and its output uses the same kind of primitives:

- React components are the rendered units.
- Component registries define what can be authored.
- Tailwind class strings are the styling source of truth.
- Design files are JSON and can be versioned in git.

The same libraries used to build the application also define the vocabulary of the design output: Tailwind remains Tailwind, React remains the rendering model, and component libraries become registries that constrain what a design can contain.

The app does not keep styling in a private canvas format. When you edit a layer's classes in the inspector, you are editing its Tailwind class string. When an agent adds a text layer, it is adding a registry-backed node to a JSON design tree.

## Project

A project is a local folder with Trickroom metadata:

```text
<projectRoot>/.trickroom/config.json
```

The config stores:

- Project name.
- Stable project ID.
- Optional MCP policy.

Opening a project also registers its local path in per-user app state so recent projects and implicit MCP startup work.

## Design

A design is a folder with a manifest and one file per board:

```text
<projectRoot>/.trickroom/designs/<designId>/
  design.json            version, name, systemId, updatedAt
  boards/<boardId>.json  version, order key, board tree
  memory.json            memory notes
```

In memory (and in the HTTP API and MCP tools) a design is one object:

- `name`: display name in the app.
- `systemId`: optional linked Tailwind system.
- `updatedAt`: when the design last changed. Trickroom sets it on every write that changes the design and orders the project screen by it, so the order survives git checkouts, which reset file times. Writers do not set it.
- `boards`: top-level root elements, in order.

Storing boards separately keeps diffs small and lets people and agents work on different boards of one design at the same time: each board has its own revision, a write that changes board A does not conflict with a change to board B, and two branches that each add a board merge without a conflict. Board order comes from an `order` key in each board file, so reordering or inserting a board rewrites only that board.

The files carry a `version`: Trickroom migrates older designs (including the single-file `designs/<id>.json` layout of versions 0 and 1) in memory when it reads them, never rewrites a design just because it was opened, and writes the current layout on the next save or when you run `trickroom migrate`. Designs returned by the HTTP API and MCP tools are always in the current shape and omit `version`. See [Files And Safety](project-files.md#design-files).

Example board file:

```json
{
  "version": 2,
  "order": "V",
  "board": {
    "id": "root",
    "props": {
      "data-trickroom-name": "Root",
      "data-trickroom-library": "trickroom",
      "data-trickroom-component": "container",
      "className": "bg-white text-gray-900"
    },
    "children": []
  }
}
```

Element ids are unique within a design and must be usable as file names, since any layer can become a board.

## System

A system is a named Tailwind CSS entry stored in `system.json`:

```json
{
  "version": 1,
  "systemId": "sys_00000000-0000-4000-8000-000000000000",
  "systemName": "Core",
  "cssPath": "src/index.css"
}
```

When a design links to a system, Trickroom can:

- Read the configured CSS.
- Extract color tokens from Tailwind's `--color` namespace.
- Store a token snapshot under `.trickroom/systems/<safe-system-name>/tokens.json`.
- Inject stored tokens into the design iframe.
- Offer those token names in color controls.

## Memory

Memory (also called design notes) is durable steering and alignment context attached to a primitive. It answers why something exists, how it should be used, and what constrains it.

Memory can be attached at three scopes, each stored as its own `memory.json` (see `docs/project-files.md` for paths and shape):

- **Project**: why the project exists and how to steer broad work.
- **System**: usage conventions and constraints for a design system.
- **Design**: intent and rationale for a specific design, stored in the design folder as `memory.json`.

Each note has a stable `noteId`, a markdown `body`, and a `category` from a fixed enum (`intent`, `usage`, `conventions`, `constraints`, `decision`, `todo`). Memory is authored via MCP and the project overview drawer UI; it is never auto-injected into agent context — reads and prompts only hint that relevant notes may exist for the current domain.

### Reference grammar and resolution

Note bodies may embed inline reference tokens so notes can point at related entities:

```text
{{design:<uuid>}}
{{component:<componentId>}}
{{token:<domain>/<name>}}
{{asset:<assetId>}}
{{icon:<iconId>}}
```

Tokens are stored verbatim. On write, Trickroom returns non-blocking `referenceWarnings` for tokens that do not resolve in the current scope. On read, REST (`?resolveReferences=true`) and MCP (`resolveReferences: true`) attach per-note `references` with `valid`, `broken`, or `unresolvable_scope` status and, for valid targets, a `deepLink` in-app route. The project overview memory drawer renders resolved tokens as chips (valid chips navigate via `deepLink`) and offers `{{` intellisense backed by the reference-targets endpoint, which MCP exposes as `memory_read({ scope, referenceType })`.

## Registry

A registry describes components Trickroom can render and author.

The built-in registries currently include:

| Library | Component | Role | Rendered behavior | Children |
| --- | --- | --- | --- | --- |
| `trickroom` | `container` | `branch` | Generic layout/content `div` | Node array |
| `trickroom` | `text` | `text` | Text content `div` | String |
| `base-ui` | `separator` | `leaf` | Base UI separator primitive | Empty array |
| `trickroom` | `asset` | `leaf` | System-scoped raster image | Empty array |
| `trickroom` | `icon` | `leaf` | System-scoped sanitized SVG icon | Empty array |

Registry identity is stored on every element:

```json
{
  "data-trickroom-library": "trickroom",
  "data-trickroom-component": "container",
  "data-trickroom-role": "branch"
}
```

The role is the authored content shape:

- `branch`: contains child nodes.
- `text`: stores editable text in `children`.
- `leaf`: terminates the tree with no authored content.

Registry props are system-owned. The editor and MCP mutation tools treat `data-trickroom-name`, `className`, and registry-declared control props as writable instance props.

## Board, Element, And Layer

The file format calls the top-level roots `boards`.

The UI calls visible rows in the hierarchy `layers`.

The code often calls the same thing an `element` or `node`.

In practice:

- A board is a root element.
- A layer is an element shown in the sidebar tree.
- An element has an `id`, `props`, and `children`.
- Branch elements have child node arrays.
- Text elements have string children.
- Leaf elements have empty child arrays.

## Props

Persisted props include:

- `data-trickroom-name`: human-readable layer name.
- `data-trickroom-library`: registry library ID.
- `data-trickroom-component`: registry component ID.
- `data-trickroom-role`: explicit content-shape role: `branch`, `text`, or `leaf`.
- `className`: optional Tailwind class string.
- Registry-declared control props, such as Base UI Separator `orientation`.
- `data-trickroom-asset-id`: stable system asset ID for `trickroom/asset`.
- `data-trickroom-icon-id`: stable system icon ID for `trickroom/icon`.

Registries may provide default instance props. Base UI Separator exposes these in
`defaults.props` (for example `orientation`) and exposes base rendering classes in
`defaults.baseClassName` where applicable. When a separator is
materialized in design snapshots, the base classes become part of the rendered
`className` string, while the editable instance `className` remains separate.

MCP exposes `data-trickroom-name` through the friendlier `name` alias.

## Browser Editor Store

The browser editor normalizes a design into:

- `rootIds`: ordered root element IDs.
- `entitiesById`: flat entity map.
- `selectedId`: selected element.
- `dirtyIds`: element-level dirty markers.
- `designDirty`: dirty marker for design-level fields.
- `revision`: in-memory monotonic counter for save bookkeeping.

Normalization makes editing easier:

- Text nodes become entities with `text`.
- Branch and leaf nodes become entities with `childIds`; leaf nodes always have an empty list.
- Parent IDs are tracked explicitly.

Serialization reverses the process and emits the persisted `TrickroomDesign`.

## Hydration And Autosave

When the design route loads a file, it hydrates the editor store.

Hydration is conservative:

- If local dirty edits exist, incoming query data is ignored.
- If the serialized store already matches the incoming design, nothing changes.
- Selection is preserved when the selected element still exists.

Autosave is owned by the sidebar:

- Dirty changes schedule a save after `1000ms`.
- Manual save is available while dirty changes exist.
- Saving serializes the whole design.
- Dirty state is cleared only if the saved revision still matches the current in-memory revision.

## Rendering

The design editor renders the canvas in an iframe.

The iframe shell:

```text
src/iframe/shell.html
```

It loads:

```text
public/tailwind/index.global.js
```

`Artboards` renders every root element recursively:

1. Read the element's registry props.
2. Find the registered React component.
3. Pass string content for text role elements.
4. Render child elements for branch role elements.
5. Render leaf role elements without authored children.

The sidebar is outside the iframe. That keeps editor controls separate from the design stage.

Each board is the containing block and portal target for its own overlays, so an open dialog or sheet positions against its board instead of the editor pane. This is render-time only and changes nothing in the design file. See [Stage Overlay Containment](architecture.md#stage-overlay-containment).

## Layer Editing Rules

The layer tree supports:

- Select.
- Rename.
- Add container.
- Add text.
- Drag reorder.
- Drag reparent.
- Delete.

Add behavior:

- With no selection, add at the root.
- With a selected element, add next to the selected element.
- Hold Shift to insert before instead of after/end.
- Hold Alt to add inside the selected element.
- Adding inside a text element is disabled or ignored.

Move behavior:

- Moving into itself is rejected.
- Moving into a descendant is rejected.
- Moving into a text element is rejected.

MCP mutation services enforce the same structural rules and return explicit errors.

## Properties

When no element is selected, the properties area shows the design-system picker.

When an element is selected, the sidebar shows one scrolling panel:

- Classes: the element's own `className` as an editable text field with Tailwind autocomplete, plus read-only chips for classes inherited from a recipe, component, or variant.
- Text content for text role elements.
- Registry-declared controls such as Separator orientation.
- Asset and icon selectors when the selected `trickroom/asset` or `trickroom/icon` element belongs to a design with a linked system.
- Component instance controls (variants, overrides, update, detach) for attached components.

See [The Inspector](./user-guide.md#the-inspector) for how the class field behaves.

## Why This Shape Matters

The design model is intentionally narrow and inspectable:

- Git diffs can show actual design changes.
- Agents can reason over IDs, props, parents, and revisions.
- Tailwind classes remain the canonical styling language.
- Component registries create a path toward app-specific design building blocks.
- System-scoped resources keep image paths and SVG source files outside design JSON while preserving stable asset/icon IDs on elements.
- The same data can be edited by the browser UI and MCP tools.
