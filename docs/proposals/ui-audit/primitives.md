# Primitives and theme audit

Scope: `src/components/ui/` (38 files), `src/index.css`, `src/main.tsx`, and dark-mode handling.
Rule sets: `ui-design-guidelines` (cited as UDG) and `writing-for-ui` (cited as WFU). Pattern numbers refer to each skill's "Patterns to detect and fix" list.
Call-site counts come from `grep` over `src/` without test files and without `src/components/ui/`. They count matching lines, so treat them as approximate.

## Inventory

| Primitive | Variants | Call sites (approx.) |
| --- | --- | --- |
| `Text` | variant: title, subtitle, label, text (default), eyebrow, section-header, section-divider (deprecated). tone: foreground, muted, faint, accent, danger, inverse, inverse-muted | 153. eyebrow 7, section-header 14, section-divider 5, title 3, subtitle 7, label 26, faint 39, muted 25, danger 34, accent 0, inverse 0 |
| `Button` | variant: block (deprecated), blockDark (deprecated), filled, ghost, outlined. flavor: warning. isSelected | 135. block 58, outlined 39, ghost 24, filled 19, blockDark 3, flavor warning 11 |
| `Badge` | tone: neutral, info, success, warning, danger. edge: solid (default), stamped | 20, of which 19 pass `edge="stamped"` |
| `Chip` | tone: base, scope, ghost, struck | 5. ghost 0 |
| `Kbd` | none | 4 |
| `Row` | state: default, selected | 1 |
| `PaneHeader` | slots: eyebrow, title, meta, errors, actions, banner | 2 |
| `DetailSection`, `DetailSectionRow` | tone: default, danger | 9 and 2 |
| `EmptyState` | size: sm, md (default) | 7. sm 3 |
| `StateCell` | state: met, gap, unknown | 4 |
| `StatusDot` | tone: idle, synced, review, syncing, error. shape: round, square | 2 |
| `MetricCard` | mono | 10 |
| `Card` | edge: inset (default), border. tone: default, danger, warning | 39 |
| `Dialog` parts | none | 5 `DialogContent` |
| `AlertDialog` parts, `ConfirmationDialog` | tone: default, destructive | 6 `ConfirmationDialog`, 1 raw `AlertDialogPopup` |
| `Sheet` | none | 1 |
| `FloatingPanel` | none | 1 |
| `Command*` | size: default, compact | 2 roots. `CommandGroupLabel` about 11 uses, `CommandFooterHint` about 11 |
| `contextMenu` (styles only) | none | 2 |
| `Tabs` | variant: line (default), block | 5 lists |
| `Segmented` | none | 8 |
| `Switch` | none | 5 |
| `Checkbox` | none | 5 |
| `Field`, `InputField`, `TextareaField`, `FieldControl` | none | 35 `<Field` matches (includes Base UI `Field.Root` uses), 11, 3, 1 |
| `Input` | variant: inline, block, outlined, form, formCompact, formEmbedded | 40 |
| `InputGroup`, `InputGroupButton` | none | 5 |
| `ReadOnlyField` | none | 8 |
| `CopyButton` | labels, variant pass-through | 6 |
| `EditableTitle` | size: lg, md | 3 |
| `Disclosure` | none | 2 |
| `Separator` | orientation | 15 |
| `ScrollArea` | none | 24 |
| `Alert` | variant: panel (default), inline. tone: danger (default), warning, info | 36. panel 15, inline 13 |
| `Autocomplete*` | none | 1 |
| `HeatSwatch` | scale: usage, findings. step 0 to 4 | 3 |
| `AnnotationMarker`, `AnnotationStatusChip` | look: 7. size: dot, count | 5 and 1 |
| `layer-tree` styles | layerRow, layerChevron, layerDropIndicator, slot cues, layerChangeMarker | 2 editors |
| `PanelEdgeStrip` | side: left, right | 1 |

Primitives that do not exist: Skeleton, Tooltip, Popover, Menu, toast variants, a compact no-results empty state, a command-palette dialog shell, a keyboard-hint pair. Findings UI-10 to UI-14 cover them.

## What the running-app observations map to

- "welcome", "new project", "design", "memory": `Text variant="eyebrow"`, `src/components/ui/text.tsx:42`, 7 call sites.
- "recent", "designs", "systems", "audit log": `Text variant="section-header"`, `src/components/ui/text.tsx:43-44`, 14 call sites. The count next to it ("designs 4") is a separate `<Text tone="faint" className="font-mono text-[11px]">` at `src/components/project/Designs.tsx:129` and `src/components/project/Systems.tsx:204`.
- "STEP 1 OF 2" is not a primitive variant. `src/components/CreateProjectPanel.tsx:285-289` hand-rolls `font-mono text-[10px] uppercase tracking-wider` on `Text tone="faint"`.
- "MCP · READ-WRITE" is not a primitive variant either. `src/components/project/ProjectHeader.tsx:171` puts `font-mono text-[10px] uppercase tracking-wider` on an outlined `Button`, with a literal `{" · "}` at line 177.
- Row meta "518 layers · just now": `src/components/project/Designs.tsx:284-293`, `<Text tone="muted" className="... font-mono text-[10px]">` with a literal `{" · "}`.
- Dimmed keyboard hint labels: `src/components/project/ProjectPane.tsx:16` (`tone="faint"`, `text-xs`), plus two other hand-rolled versions (UI-14).
- Monospace helper sentence: `src/components/CreateProjectPanel.tsx:271-273`, `<Text tone="muted" className="pl-7 font-mono text-[10px]">Link a Tailwind CSS file now, or add one after the project exists.</Text>`.

## Findings

### High

- **UI-01. The ghost button and the checkbox have no focus indicator.**
  - Severity: high. A keyboard user cannot see where focus is on 24 ghost buttons and every checkbox.
  - Rule: UDG "Interaction and keyboard" (every workflow completes from the keyboard). No numbered pattern covers focus rings.
  - Locations: `src/components/ui/button.tsx:6` (base has `focus-visible:outline-none`), `src/components/ui/button.tsx:17-18` (ghost has no `focus-within:` or `focus-visible:` class, every other variant sets `not-disabled:focus-within:inset-shadow-cyan-500`), `src/components/ui/checkbox.tsx:7` and `:11`.
  - Current: ghost is `"text-slate-600 not-disabled:hover:bg-slate-100 not-disabled:hover:text-slate-950 not-disabled:active:bg-cyan-100 not-disabled:active:text-cyan-900"`. The checkbox carries `// TODO: decide on focus-visible state` and its class has no focus style. `Checkbox` also omits `className` from its props, so a call site cannot add one.
  - Inherits: 24 ghost call sites, including the sheet close button (`src/components/project/memory/MemoryNotesDrawer.tsx:41`) and the hover-revealed remove button (`src/components/HomeShell.tsx:53`). 5 checkbox call sites.
  - Fix: add `not-disabled:focus-visible:inset-shadow-cyan-500` to ghost. Add `focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_2px] focus-visible:inset-shadow-cyan-500` (or an outline with offset) to the checkbox root for both checked and unchecked states.
  - Confidence: high.

- **UI-02. `ConfirmationDialog` turns initial focus off, so a destructive confirm does not open with focus on Cancel.**
  - Severity: high. Six confirm dialogs inherit it, at least three of them destructive.
  - Rule: UDG "Sheets, dialogs, and forms": "open the real confirm dialog with focus on Cancel".
  - Location: `src/components/ui/alert-dialog.tsx:177`.
  - Current: `<AlertDialogPopup initialFocus={false} className={confirmationPopup()}>`. No ref points at the Cancel button (`alert-dialog.tsx:203-214`).
  - Inherits: 6 call sites. Confirmed `tone="destructive"` at `src/components/HomeShell.tsx:185`, `src/components/project/DesignDetailPane.tsx:317`, `src/components/project/SystemDetailPane.tsx:1043`.
  - Fix: create a ref for the Cancel button inside `ConfirmationDialog` and pass `initialFocus={cancelRef}`.
  - Confidence: high that focus is not sent to Cancel. Medium on what Base UI does with `false` (I read it as "do not move focus", which leaves focus on the trigger behind the modal). I did not run the app.

### Medium

- **UI-03. The app has no dark theme, and the two `dark:` classes it does have make dialogs behave differently on a dark OS.**
  - Severity: medium.
  - Rule: UDG pattern 26 (Missing dark twin), and "Every colour you set needs its dark-mode counterpart".
  - Locations: `src/components/ui/dialog.tsx:7`, `src/components/ui/alert-dialog.tsx:11`, `src/index.css:11-34`, `src/main.tsx:23-24`.
  - Current: `src/index.css` declares fonts only. It has no `@custom-variant dark`, no `prefers-color-scheme` block, and no `color-scheme`. Tailwind v4 therefore maps `dark:` to the OS setting. The only `dark:` classes in app chrome are the two backdrops: `"... bg-slate-950 opacity-20 ... dark:opacity-70 ..."`. On a dark OS the dialog backdrop goes from 20% to 70% while every surface stays white. The sheet backdrop stays `bg-slate-950/20` (`sheet.tsx:8`) and both command palettes hand-roll `bg-slate-950/70` (`src/components/project/CommandMenu.tsx:259`, `src/components/chrome/AddLayerCommandMenu.tsx:313`). The toaster forces `"!rounded-none !border-slate-200 !bg-white !text-slate-950"`. No theme toggle exists. The other `dark:` matches are in `src/components/Capture.tsx`, which renders user designs, not app chrome.
  - Inherits: every colour in all 38 primitives is a raw slate, cyan, red, amber, or emerald step with no counterpart.
  - Fix: decide first. To stay light-only, delete the two `dark:opacity-70` classes, set `color-scheme: light` on `:root`, and pick one backdrop opacity for dialog, sheet, and palette. To support dark, move the palette into semantic `@theme` tokens (surface, ink, ink-muted, line, accent) and give each a dark value, instead of adding `dark:` to every class string.
  - Confidence: high on the code. Whether dark mode is a product goal is the lead developer's call.

- **UI-04. Section labels are monospace words with a forced lowercase transform, and section headings dim.**
  - Severity: medium. It sits on every main screen.
  - Rules: UDG pattern 20 (Monospace for words), UDG pattern 3 and "Titles, subtitles, section headings, and joining words never dim", WFU pattern 8 (Template chrome).
  - Locations: `src/components/ui/text.tsx:42`, `:43-44`, `:46-47`, `src/components/ui/command.tsx:31-32`, `src/components/ui/command.tsx:26-27`.
  - Current: eyebrow `"font-mono text-[10px] lowercase tracking-normal text-cyan-700"`. section-header `"font-mono text-[11px] lowercase tracking-normal text-slate-500"`. section-divider `"bg-slate-50 px-5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-500"`. `CommandGroupLabel` repeats the section-divider string.
  - Three effects:
    1. The transform rewrites authored copy. `<Text variant="eyebrow">New project</Text>` renders "new project". The field label "Open by path" (`src/components/OpenProjectPanel.tsx:76-80`) renders "open by path". Acronyms and names lose their case.
    2. section-header is a section heading at `text-slate-500`. The tone doc comment at `text.tsx:19` states the intent: "faint: section headers/meta".
    3. Siblings differ. Call sites recolour the eyebrow: `className="text-slate-400"` at `src/components/system-editor/SystemEditorLintPanel.tsx:326` and `src/components/system-editor/SystemEditorTokensPanel.tsx:629`, `className="text-amber-700"` at `src/components/project/SystemDetailPane.tsx:943`.
  - Several eyebrows also restate the title under them (WFU pattern 1): "New project" over "Create project" (`src/components/CreateProjectPanel.tsx:122-129`), "Welcome" over "Open a project" (`src/components/OpenProjectPanel.tsx:44-51`).
  - Inherits: 7 eyebrow, 14 section-header, 5 section-divider, about 11 `CommandGroupLabel`.
  - Fix: drop `lowercase` and `uppercase` and write the strings in sentence case. Render section-header in the body font at a small size and semibold with the default ink. Keep mono for the count beside it. Delete eyebrows that restate the title. Fold section-divider and `CommandGroupLabel` into one group-label variant.
  - Confidence: medium. Lowercase mono labels read as a deliberate part of the brutalist language, so the font and case are a judgment call for the lead developer. The copy mutation by `lowercase` and the per-site recolouring are confirmed defects either way.

- **UI-05. Views hand-roll a third and fourth label style because no primitive covers inspector group labels.**
  - Severity: medium.
  - Rules: UDG "Siblings share one styling", WFU pattern 8 (all-caps eyebrow labels).
  - Locations (sample): `src/components/system-editor/SystemEditorInspector.tsx:600`, `:637`, `:654`, `:682`, `:701`, `:724`, `:1283`, `:1329`, `:1359`, `:1397`. `src/components/system-editor/ComponentDraftProperties.tsx:425`, `:510`. `src/components/chrome/classes/ClassCompositionPanel.tsx:146`, `:164`. `src/components/chrome/Layers.tsx:1217`. `src/components/CreateProjectPanel.tsx:287`. `src/components/project/ProjectHeader.tsx:171`.
  - Current: `"text-[10px] font-semibold uppercase tracking-wider text-slate-500"` in the sans font, with drift to `text-slate-400`, `text-cyan-700`, `tracking-wide`, `tracking-normal`, `text-[9px]`, and no `font-semibold`.
  - Inherits: 42 `uppercase` class strings in views. The design and system editors use these, while project screens use the lowercase mono `section-header`. One app has two opposite conventions for the same job.
  - Fix: after UI-04 settles the label style, add one `Text` variant for it and replace the 42 strings.
  - Confidence: high on the inventory, medium on which style should win.

- **UI-06. `Text` offers three dim tones and no meta variant, so each view picks its own size, tone, and font for secondary text.**
  - Severity: medium.
  - Rules: UDG "Only two roles may dim", UDG pattern 20, WFU pattern 6 (Separators).
  - Locations: `src/components/ui/text.tsx:49-57`, `src/components/ui/field.tsx:33`, `src/components/ui/alert-dialog.tsx:28`.
  - Current: `muted: "text-slate-600"`, `faint: "text-slate-500"`, and views add raw `text-slate-400` (71 class strings). `Field` adds a fourth, alpha-based one: `"pt-0.5 text-slate-900/60"`. `ConfirmationDialog` dims its body sentence: `"px-4 py-4 text-sm leading-relaxed text-slate-700"`.
  - How views use it: 39 `tone="faint"` and 25 `tone="muted"` call sites, with sizes `text-[10px]`, `text-[11px]`, and `text-xs`. 79 class strings combine `font-mono` with slate-400 or slate-500. Mono lands on words, not only on values: the row meta at `src/components/project/Designs.tsx:284-293` ("518 layers · just now") and the helper sentence at `src/components/CreateProjectPanel.tsx:271-273`. `src/` holds 41 literal ` · ` separators.
  - Fix: keep one dim tone for labels and meta. Add a `meta` variant (body font, one size, the dim tone) and a `value` or `code` variant (mono, default ink) so paths and ids get mono and sentences do not. Give the confirm body the default ink. Replace ` · ` with a gap or a `Separator`.
  - Confidence: high on the inventory. Medium on dimming the line under a row name, which the skill allows.

- **UI-07. Selected-state text uses `cyan-500` on `cyan-50`, below the contrast the `Text` ramp itself documents.**
  - Severity: medium. It affects the selected tab and every selected layer row.
  - Rule: UDG "Build hierarchy with size, not colour" (colour encodes role). No numbered pattern. The project's own comment at `src/components/ui/text.tsx:14-23` calls the ramp "WCAG-aware" and uses `cyan-700` for accent text.
  - Locations: `src/components/ui/tabs.tsx:16`, `src/components/ui/layer-tree.ts:60`, `src/components/ui/context-menu.ts:13`.
  - Current: tabs line `"... data-active:bg-cyan-50 ... data-active:text-cyan-500 ..."`. Layer row `selected: true: "bg-cyan-50 text-cyan-500 inset-shadow-transparent"`. Context menu item `"data-highlighted:active:text-cyan-500 data-highlighted:active:bg-cyan-50"`. The block tab, block button, and `Row` use `bg-cyan-100 text-cyan-900` for the same state.
  - Inherits: line tabs (default variant, 5 tab lists), both layer trees.
  - Fix: use `bg-cyan-100 text-cyan-900` everywhere a row or tab is selected.
  - Confidence: high on the classes. I estimated the contrast (roughly 2.3:1) and did not measure it.

- **UI-08. `Segmented` does not expose which option is selected.**
  - Severity: medium. Screen-reader users get a group of plain buttons.
  - Rule: WFU "Cutting text must not cut information", WFU pattern 10 (Lost information).
  - Location: `src/components/ui/segmented.tsx:52-63`.
  - Current: `<Button ... isSelected={isSelected} title={option.title} aria-label={option.title} ...>`. `isSelected` only switches classes in `button.tsx`. No `aria-pressed` is set.
  - Inherits: 8 call sites in the inspectors.
  - Fix: add `aria-pressed={isSelected}` to each cell.
  - Confidence: high.

- **UI-09. `StatusDot` is a bare coloured span with no text for screen readers.**
  - Severity: medium.
  - Rule: WFU "A status dot keeps text for screen readers", WFU pattern 10.
  - Location: `src/components/ui/status-dot.tsx:25-41`.
  - Current: `<span data-slot="status-dot" className={statusDot({ tone, shape, className })} {...props} />`. No `label` prop, no `sr-only` child, no role.
  - Inherits: 2 call sites. `src/components/project/Systems.tsx:111` renders it alone in the sidebar row, and the syncing branch at `:103-108` is `aria-hidden` with no text. `src/components/project/SystemStatusBadge.tsx:35` has a visible label beside it. `src/components/project/ProjectHeader.tsx:176` hand-rolls a dot (`size-1.5 rounded-full`) instead of using the primitive.
  - Related: `SystemStatusBadge` wraps dot plus word in a `Badge` for every state, including the normal one. That is UDG pattern 25 (Status badge at rest), for the view audit.
  - Fix: add a required `label` prop that renders `<span className="sr-only">`, with an explicit `decorative` opt-out for a dot that sits next to its word.
  - Confidence: high.

- **UI-10. No Skeleton primitive exists, and loading shows as sentences.**
  - Severity: medium.
  - Rules: UDG pattern 12 (Loading sentence), UDG "States: always have a skeleton".
  - Locations: none in `src/components/ui/`. Hand-rolled skeletons at `src/components/project/Designs.tsx:165-181` and `src/components/system-editor/SystemEditorAssetsPanel.tsx:443`. Loading sentences at `src/components/project/SystemDetailPane.tsx:337`, `:346`, `:351`, `:380`. `src/components/project/memory/MemoryReferenceSuggest.tsx:104`. `src/components/annotations/OtherBranchesSection.tsx:63`. `src/components/chrome/Properties.tsx:473`, `:542`. `src/components/system-editor/SystemEditorIconsPanel.tsx:343`, `:500`. `src/components/system-editor/SystemEditorAssetsPanel.tsx:332`. `src/components/system-editor/SystemEditorComponentsPanel.tsx:340`. `src/components/system-editor/ComponentDraftProperties.tsx:196`, `:241`.
  - Current: `"Loading..."`, `"Loading…"`, `"Loading icon index..."`, `"Loading assets"`. The two hand-rolled skeletons use `animate-pulse` with `bg-slate-200` blocks.
  - Inherits: 16 loading strings in views against 2 skeletons.
  - Fix: add `Skeleton` (a square `bg-slate-200` block with the pulse) and give `MetricCard`, list rows, and pickers a skeleton state built from it.
  - Confidence: high.

- **UI-11. `MetricCard` has no loading, error, or no-data state, so callers put status words in the value slot.**
  - Severity: medium.
  - Rules: UDG "Every card keeps its footprint across loading, error, and no-data", "Every failure keeps a retry", "A failed secondary request never ... renders as zero", pattern 12.
  - Location: `src/components/ui/metric-card.tsx:24-65`. Props are `value: string` and `detail: string` only.
  - Current at call sites: `src/components/project/SystemDetailPane.tsx:336-340` sets the value to `"Loading..."`, `"Unavailable"`, or the count. `:345-349` uses `"Loading..."` and `"Error"`. These render in `text-2xl font-medium`, the same as a real number. The error branch has no retry. The footprint itself holds, because the card sets `min-h-32`.
  - Also: `detail` is required, so every tile carries a caption that restates its label: "Root boards in this design" under "Boards", "Total rendered layers" under "Layers" (`src/components/project/DesignDetailPane.tsx:184-191`). That is WFU pattern 1.
  - Inherits: 10 call sites.
  - Fix: add a `state` prop (`loading`, `error`, `empty`) that renders a skeleton or a short message with a retry action in the same box. Make `detail` optional.
  - Confidence: high.

- **UI-12. `EmptyState` has no compact no-results variant and no action slot.**
  - Severity: medium.
  - Rules: UDG "No results in a filtered list use the compact variant", "An empty collection shows the primary action once, in the empty state".
  - Location: `src/components/ui/empty-state.tsx:14-28`, `:46-53`.
  - Current: sizes are `sm: { root: "gap-3 px-4 py-10", tile: "size-10", ... }` and `md`. Both draw the icon tile. `icon` and `description` are required. There is no `action` prop, only free `children`.
  - How views cope: no-results text is hand-rolled as plain strings: "No matching designs." (`src/components/project/Designs.tsx:207`), "No matching assets" (`src/components/system-editor/SystemEditorAssetsPanel.tsx:514`), "No matching icons" (`src/components/system-editor/SystemEditorIconsPanel.tsx:581`), "No matching targets." (`src/components/project/memory/MemoryReferenceSuggest.tsx:107`), "No results found." (`src/components/project/CommandMenu.tsx:288`). Punctuation differs between them. Empty collections point at the toolbar instead of offering the action: "Press ⌘N or use + New above to create your first design board." (`src/components/project/Designs.tsx:202`), same shape at `src/components/project/Systems.tsx:224`.
  - Inherits: 7 `EmptyState` call sites and at least 8 hand-rolled no-results strings.
  - Fix: add `size="compact"` (one line, no tile, no description) and an `action` prop. Make `icon` and `description` optional.
  - Confidence: high.

- **UI-13. No Tooltip or Popover primitive exists. Views use the native `title` attribute.**
  - Severity: medium.
  - Rules: UDG "Popovers, menus, and tooltips" (chips get tooltips, info buttons open popovers), UDG "an icon button with a tooltip", WFU "Essential detail can't live only in a tooltip".
  - Locations: none in `src/components/ui/`. `grep` finds zero `Tooltip` or `Popover` imports under `src/components/`. `src/components/ui/segmented.tsx:57` bakes `title={option.title}` into the primitive.
  - Current: 109 literal `title="..."` attributes in `src/components/` (192 `title=` in total, some of which are component props), for example `title="Back to project"` at `src/components/chrome/DesignHeader.tsx:166`. `src/components/chrome/WorkspaceToolbar.tsx:162` puts a whole explanatory sentence in a `title`.
  - Effect: native titles do not appear on keyboard focus or touch and cannot be styled. No info-button popover exists, so headers and cards have nowhere to move secondary detail.
  - Inherits: every icon-only button in the app.
  - Fix: add `Tooltip` and `Popover` wrappers over Base UI (the library is already a dependency), then an `InfoButton` built on `Popover`.
  - Confidence: high.

- **UI-14. `Dialog` has no header, body, or footer parts, so each dialog copies the layout and two layouts exist.**
  - Severity: medium.
  - Rules: UDG process step 2 (name the pattern you reuse), UDG "Show a backend error inside the dialog, above the footer".
  - Locations: `src/components/ui/dialog.tsx:8-11`, `src/components/ui/alert-dialog.tsx:21-33`.
  - Current: `title: "p-2"`, `description: "px-2 mb-4"`. All 5 `DialogTitle` call sites override the class, and 4 reset it with `"p-0 text-sm font-medium text-slate-900"` (`src/components/MCPSetupDialog.tsx:98`, `src/components/McpToolSettingsDialog.tsx:167`, `src/components/chrome/ExtractSystemComponentDialog.tsx:372`, `src/components/project/CreateSystemDialog.tsx:94`). Each also copies the close button string `"border-none bg-transparent p-1 focus-visible:outline-none focus-visible:inset-shadow-[0_0_0_1px] focus-visible:inset-shadow-cyan-500"`, which has no hover state. `ConfirmationDialog` already owns that header and footer as slots but does not export them.
  - The fifth dialog diverges: `src/components/project/CommandMenu.tsx:526-560` uses the primitive defaults with a `text-lg` title, two `block` buttons split by a vertical separator as its footer, and a hand-rolled error `"w-fit bg-red-500 px-2 py-1 text-xs text-white"` instead of `Alert`.
  - `content` also sets conflicting widths: `"... w-96 w-full max-w-xs md:max-w-md ..."` (`dialog.tsx:9`, `alert-dialog.tsx:13`).
  - Inherits: 5 dialogs and 6 confirm dialogs.
  - Fix: export `DialogHeader` (icon, title, close), `DialogBody`, `DialogError`, and `DialogFooter` from one file, build `ConfirmationDialog` on them, and delete the `title` and `description` defaults nobody uses. Remove `w-96`.
  - Confidence: high.

- **UI-15. `Field` has no error slot, and only two of six input variants style the invalid state.**
  - Severity: medium.
  - Rule: UDG "Validate on blur ... Show a backend error inside the dialog". Error display is part of the form contract the skill assumes.
  - Locations: `src/components/ui/field.tsx:10-39`, `src/components/ui/input.tsx:17-26`.
  - Current: `Field` takes `label` and `description` only. `aria-invalid:inset-shadow-red-500` exists on `form` and `formCompact` and is missing on `inline`, `block`, `outlined`, and `formEmbedded`. Inside `InputGroup` (which uses `formEmbedded`) an invalid field therefore shows nothing.
  - How views cope: zero `Field.Error` uses, 3 `aria-invalid` call sites, and 13 `<Alert variant="inline">` messages placed by hand below fields with no `aria-describedby` link (for example `src/components/CreateProjectPanel.tsx:257-268`).
  - Fix: add an `error` prop to `Field` that renders Base UI `Field.Error` with the inline `Alert` look, and move the `aria-invalid` ring into the `input` base class. Let `InputGroup` read `has-[[aria-invalid=true]]` for its frame.
  - Confidence: high.

- **UI-16. `Chip` marks a shadowed class with strikethrough, and carries an unused dashed "ghost" tone.**
  - Severity: medium for struck, low for ghost.
  - Rules: UDG "Mark the active one of several definitions with a trailing icon, not a strikethrough on the others". UDG pattern 1 (Ghost rows) for the ghost tone.
  - Location: `src/components/ui/chip.tsx:12-13`.
  - Current: `ghost: "border border-dashed border-slate-300 text-slate-400"`, `struck: "bg-white text-slate-400 line-through"`.
  - Inherits: struck is applied at `src/components/chrome/classes/ClassCompositionPanel.tsx:153`. Ghost has 0 call sites.
  - Fix: mark the winning class with a trailing glyph and render shadowed classes as plain base chips. Delete the ghost tone.
  - Confidence: high on the code. Medium on the rule fit, because strikethrough on an overridden class is a common devtools convention.

- **UI-17. `PaneHeader` builds metadata, eyebrow, and error lines into the detail header.**
  - Severity: medium.
  - Rules: UDG "Keep headers lean", UDG pattern 14 (Jumping header).
  - Location: `src/components/ui/pane-header.tsx:9-45`.
  - Current: slots `eyebrow`, `title`, `meta`, `errors`, `actions`, `banner` in a column with `gap-1`. `meta` and `errors` render only when set, so the header height changes with state. The title row is `flex-wrap`, described in the doc comment as "wraps title + status badges".
  - Inherits: 2 call sites (`src/components/project/DesignDetailPane.tsx:115`, `src/components/project/SystemDetailPane.tsx`), which are the two main detail screens.
  - Fix: reduce the contract to status dot, title, and actions at a fixed one-line height. Move meta behind an info button (needs UI-13) and errors into the pane body.
  - Confidence: medium. The skill's header rules come from a different product, so check them against how designers use these two panes.

- **UI-18. `Button` accepts a variant that does not exist, and its deprecated variant is the most used.**
  - Severity: medium.
  - Rule: UDG process step 8 (a change to a shared primitive's contract reaches the views).
  - Locations: `src/components/ui/button.tsx:9-14`, `:22-24`, `:85`. `src/components/CreateProjectPanel.tsx:190`.
  - Current: `<Button type="button" variant="link" onClick={handleToggleSystem}>{showSystem ? "Remove" : "Add +"}</Button>`. The union is `"block" | "blockDark" | "filled" | "ghost" | "outlined"`, so this renders the base class only: no hover, no focus ring, no colour. `block` is marked `// @deprecated prefer ghost` and still has 58 call sites, and the primitives themselves depend on it: `segmented.tsx:55`, `copy-button.tsx:15`, `input-group.tsx:46`, `alert-dialog.tsx:207`.
  - Also: `flavor: "warning"` renders red and has compound classes only for `block`, `blockDark`, and `outlined`. One call site pairs it with `ghost`, where it does nothing.
  - Fix: either add a real `link` variant (text plus glyph, per UDG "A link is a text button with a link glyph") or change that call site to `ghost`. Rename the flavor to `danger`. Migrate the primitives off `block` before the views.
  - Confidence: high.

### Low

- **UI-19. Focus rings differ in colour, and buttons show them on mouse press.**
  - Rule: UDG "Siblings share one styling".
  - Locations: `src/components/ui/tabs.tsx:16` (`not-disabled:focus-within:inset-shadow-cyan-200`), `src/components/ui/input.tsx:18-20` (`inline` and `block` use `cyan-200`), against `cyan-500` in `button.tsx`, `input.tsx:22-25`, `switch.tsx:7`, `disclosure.tsx:15`, `editable-title.tsx:7`.
  - Current: `cyan-200` on white is close to invisible. `button.tsx` and `tabs.tsx` use `focus-within:`, which also fires on a mouse click, where other primitives use `focus-visible:`.
  - Inherits: line tabs (5 lists), 2 input variants, all buttons.
  - Fix: one ring, `focus-visible:inset-shadow-cyan-500`, in every primitive.
  - Confidence: high.

- **UI-20. `Badge` sets status words in uppercase monospace, and its default edge is the one nobody uses.**
  - Rules: UDG pattern 20, WFU pattern 8. UDG "Pick the appearance by meaning".
  - Locations: `src/components/ui/badge.tsx:5`, `:47-50`. Same treatment at `src/components/ui/annotation-marker.tsx:70` (`"... font-mono text-xs uppercase tracking-wider"`) and `src/components/ui/layer-tree.ts:129`.
  - Current: `"inline-flex items-center gap-1 rounded-none px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"`. Default `edge: "solid"`, while 19 of 20 call sites pass `edge="stamped"`.
  - Fix: make `stamped` the default. Whether badge words stay uppercase mono follows the decision in UI-04.
  - Confidence: medium. The uppercase mono stamp reads as intended house style.

- **UI-21. Chip, badge, and kbd do not share one footprint.**
  - Rule: UDG "Keep chip metrics identical across neighbours".
  - Locations: `src/components/ui/chip.tsx:4-7`, `src/components/ui/badge.tsx:5`, `src/components/ui/kbd.tsx:8`, `src/components/ui/command.tsx:27`, `:55`.
  - Current: chip `"px-1 py-0.5 font-mono text-xs"`, badge and kbd `"px-1.5 py-0.5 font-mono text-[10px]"`, `CommandKeyBadge` `"px-1 font-mono text-[10px]"` with no vertical padding. The comment in `chip.tsx` says "same footprint" as Badge. `text-xs` sets a 16px line height. `text-[10px]` sets none, so badge and kbd height depends on the parent's line height.
  - Evidence of the mismatch: `src/components/system-editor/lint/LintFindingsView.tsx:69` overrides the chip with `className="text-[10px]"`.
  - Fix: give all four an explicit `leading-4` and the same padding, or one shared base class.
  - Confidence: medium. I derived the heights from the classes and did not measure them.

- **UI-22. Keyboard hints are hand-rolled three ways.**
  - Rules: UDG "Siblings share one styling", UDG pattern 20.
  - Locations: `src/components/project/ProjectPane.tsx:12-21` (`Kbd` then `Text tone="faint" className="text-xs"`), `src/components/project/ProjectHeader.tsx:163-166` (`Text tone="faint" className="font-mono text-[10px]"` then `Kbd`, label first), `src/components/chrome/Properties.tsx:767-768` (`text-[11px] text-slate-500`), and `src/components/ui/command.tsx:50-55` (`footerLeft: "... font-mono text-[10px] text-slate-500"` with `CommandKeyBadge`, a second key style next to `Kbd`).
  - Current: dimming the hint label is allowed by the skill. The differences are the order, the size, the font, and two key-cap styles.
  - Fix: add a `KbdHint` primitive (key, then label in the body font) and use `Kbd` inside the command footer.
  - Confidence: high.

- **UI-23. The toaster styles only the container, in light colours.**
  - Rule: UDG "A toast title may take the type colour", UDG pattern 26.
  - Location: `src/main.tsx:20-27`.
  - Current: `toast: "!rounded-none !border-slate-200 !bg-white !text-slate-950"`. No `title`, `description`, `error`, `success`, `warning`, or `actionButton` class names. Views call `toast.error` 13 times, `toast.success` 10, `toast.warning` 4, `toast.info` 4.
  - Fix: add class names per type for the title colour and square the action button, in the same `classNames` object.
  - Confidence: medium. I did not render a toast, so I do not know how sonner's default icon and font look against the house style.

- **UI-24. `CopyButton` drops a failed copy without feedback.**
  - Rule: WFU "Errors: say what happened and how to fix it".
  - Location: `src/components/ui/copy-button.tsx:46-48`.
  - Current: `.catch(() => { setCopied(false); })`. The default names are fine: `aria-label={copied ? \`Copied ${subject}\` : \`Copy ${subject}\`}` with `subject = "to clipboard"`.
  - Inherits: 6 call sites.
  - Fix: on failure, show a failed state on the button or call `toast.error("Could not copy {subject}")`.
  - Confidence: high.

- **UI-25. `Row` is used once, and the one use hides its action until hover.**
  - Rules: UDG "The row is the click target", "Row actions are always visible, never revealed on hover".
  - Locations: `src/components/ui/row.tsx:4-15`, `src/components/HomeShell.tsx:35-62`.
  - Current: `Row` is a `div` with `"hover:bg-slate-100"` and no focus-within or disabled styling. The click target is an inner `button`. The remove button is `"... opacity-0 group-hover:opacity-100 focus-visible:opacity-100"`. About 20 class strings in views hand-roll `hover:bg-slate-100` or similar rows instead of using `Row`, for example the design and system lists.
  - Fix: make `Row` render the interactive element (button or link) with focus and selected styling, add a fixed trailing-action slot, and move the lists onto it.
  - Confidence: high on usage. The row-level remove action is a view decision for the home-screen audit.

- **UI-26. Hover fills inside inset-ring containers cover the ring.**
  - Rule: UDG pattern 10 (Vanishing inset ring).
  - Locations: `src/components/ui/readonly-field.tsx:29-37` (container `"... bg-slate-50 inset-shadow-[0_0_0_1px] inset-shadow-slate-200"` with a flush `CopyButton` whose `block` variant fills `bg-slate-100` on hover), `src/components/ui/input-group.tsx:22` and `:48` (the group has an inset ring, and `InputGroupButton` switches to its own full ring on hover: `"not-disabled:hover:inset-shadow-[0_0_0_1px]"`).
  - Inherits: 8 `ReadOnlyField` and 5 `InputGroup` call sites.
  - Fix: give both containers a real `border border-slate-200` and keep the internal divider.
  - Confidence: medium. I reasoned from paint order and did not look at the rendered hover.

- **UI-27. A switch is used for a value that saves with a form.**
  - Rule: UDG "A switch applies at once; a checkbox submits with the form".
  - Location: `src/components/system-editor/lint/LintConfigEditor.tsx:363-369`. The switch calls `onChange(setRuleEnabled(config, kind.id, checked))` on a draft that the "Save lint.json" button commits (`:881-887`).
  - Current: neither `switch.tsx` nor `checkbox.tsx` documents the difference, and they differ in size (`h-4 w-7` against `size-6`), which pushes views toward the switch in dense rails.
  - Fix: use a checkbox there, add a compact checkbox size, and state the rule in both doc comments.
  - Confidence: medium. I read the save path by `grep`, not the whole file.

- **UI-28. Both command palettes hand-roll the dialog shell, centred with a fixed width.**
  - Rule: UDG pattern 23 (Centred palette).
  - Locations: `src/components/project/CommandMenu.tsx:257-267`, `src/components/chrome/AddLayerCommandMenu.tsx:311-317`. `src/components/ui/command.tsx` has no dialog part.
  - Current: `"fixed top-24 left-1/2 w-[640px] -translate-x-1/2 shadow-2xl outline-none ..."`. There is no `max-w`, so the popup is wider than a viewport under 640px.
  - Fix: add a `CommandDialog` part that owns backdrop, position, and `max-w-[calc(100vw-2rem)]`. Anchoring under the trigger is the lead developer's call.
  - Confidence: high on the code, low on whether pattern 23 should apply to a global ⌘K palette.

- **UI-29. Small gaps in menus, disclosure, and alerts.**
  - `src/components/ui/context-menu.ts:12`: the popup has no `max-h` and no `overflow-y-auto` (UDG "A long menu caps its height to the viewport"). `autocomplete.tsx:11` and `command.tsx:28` do cap theirs.
  - `src/components/ui/disclosure.tsx:15`: the trigger has no hover state. `text-slate-700` and a `text-slate-400` chevron.
  - `src/components/ui/alert.tsx:72`: every `Alert` is `role="alert"`, including static `info` and `warning` notes, so screen readers announce them on mount. Use `role="status"` or no role for non-errors.
  - No Menu primitive: `src/components/chrome/WorkspaceToolbar.tsx:1` imports Base UI `Menu` directly and styles it in the view.
  - Three default inks: `title` is `text-slate-900` (`text.tsx:38`), `foreground` is `text-slate-950` (`text.tsx:50`), `DetailSectionRow` title is `text-slate-800` (`detail-section.tsx:64`).
  - Confidence: high on each class quoted.

## Checked and found in order

- No doubled dividers inside the primitives. `DetailSection`, `MetricCard`, `ConfirmationDialog`, and `PaneHeader` each draw one line between parts.
- `InputGroup` follows the compound-control rule: one outline, one internal divider, focus on the whole group.
- `ConfirmationDialog` renders `children` above the footer, which is where the skill puts a backend error. `src/components/HomeShell.tsx:188-192` uses it that way.
- `StateCell` has a dashed `unknown` state, so unknown is not shown as off. Its main call site passes `aria-label` (`src/components/system-editor/lint/LintCoverageView.tsx:59`).
- `Autocomplete` and `CommandList` cap their height and scroll.
- No "Loading" string, placeholder default, or close-button name is baked into a primitive, apart from the `sr-only` "Close" in `alert-dialog.tsx:190`, the "ESC" badge in `command.tsx:113`, and the `CopyButton` labels in UI-24.

## Files read in full

`src/index.css`, `src/main.tsx`, and all 38 files in `src/components/ui/`: `alert-dialog.tsx`, `alert.tsx`, `annotation-marker.tsx`, `autocomplete.tsx`, `badge.tsx`, `button.tsx`, `card.tsx`, `checkbox.tsx`, `chip.tsx`, `command.tsx`, `context-menu.ts`, `copy-button.tsx`, `detail-section.tsx`, `dialog.tsx`, `disclosure.tsx`, `editable-title.tsx`, `empty-state.tsx`, `field.tsx`, `floating-panel.tsx`, `heat-swatch.tsx`, `input-group.tsx`, `input.tsx`, `kbd.tsx`, `layer-tree.ts`, `metric-card.tsx`, `pane-header.tsx`, `panel-edge-strip.tsx`, `readonly-field.tsx`, `row.tsx`, `scroll-area.tsx`, `segmented.tsx`, `separator.tsx`, `sheet.tsx`, `state-cell.tsx`, `status-dot.tsx`, `switch.tsx`, `tabs.tsx`, `text.tsx`.

## Not covered

- I did not run the app. Heights, contrast, hover paint order, toast rendering, and Base UI focus behaviour are read from code.
- Call sites were sampled by `grep` and partial reads, not read in full. The files sampled most: `HomeShell.tsx`, `OpenProjectPanel.tsx`, `CreateProjectPanel.tsx`, `project/ProjectPane.tsx`, `project/ProjectHeader.tsx`, `project/Designs.tsx`, `project/Systems.tsx`, `project/SystemDetailPane.tsx`, `project/DesignDetailPane.tsx`, `project/CommandMenu.tsx`, `project/CreateSystemDialog.tsx`, `project/memory/MemoryNotesDrawer.tsx`, `McpToolSettingsDialog.tsx`.
- `Card` call sites (39) were counted by edge (10 inset, 8 border, 19 default) and not checked one by one for card-in-card or hoverable children.
- `Tabs`, `ScrollArea`, `Autocomplete`, `EditableTitle`, `FloatingPanel`, `PanelEdgeStrip`, `HeatSwatch`, and `AnnotationMarker` call sites were counted and not sampled in depth.
- `src/components/Capture.tsx` and `src/components/stage/` render user designs and were out of scope.
