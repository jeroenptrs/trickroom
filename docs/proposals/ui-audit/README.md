# UI audit, 2026-11-18

This audit checks the Trickroom browser app against two rule sets: `ui-design-guidelines` (layout, components, states) and `writing-for-ui` (every string). It is the input for a fix run. Nothing in `src/` was changed.

The audit has 164 findings: 19 high, 88 medium, 57 low. The five files next to this one hold them with `path:line`, the current text or class, the fix, and a confidence.

| File | Scope | Ids | High | Medium | Low |
| --- | --- | --- | --- | --- | --- |
| `primitives.md` | `src/components/ui/`, `src/index.css`, toaster | `UI-01` to `UI-29` | 2 | 16 | 11 |
| `project.md` | Home screens, project screen, memory notes, MCP dialogs | `PRJ-01` to `PRJ-30` | 6 | 16 | 8 |
| `design-editor.md` | `Design.tsx`, `chrome/`, `stage/`, `annotations/` | `DES-01` to `DES-31` | 4 | 17 | 10 |
| `system-tokens.md` | System editor shell, tokens, assets, icons, inspector | `SYS-01` to `SYS-39` | 3 | 21 | 15 |
| `components-lint.md` | Component authoring, lint dashboard | `CMP-01` to `CMP-35` | 4 | 18 | 13 |

## How the audit was done

Five agents each read one scope in full and wrote one file. The app also ran against a copy of this repo's `.trickroom` folder, and the home screen, project screen, both detail panes, the command menu, a confirm dialog, the design editor, the system editor, and the not-found states were screenshotted at 1440 by 900.

Every high finding was then checked a second time, in the code or in the running app. The table in the next section says which.

## High findings

| Id | Finding | Checked |
| --- | --- | --- |
| `PRJ-03` | The MCP button cycles off, read-only, read-write, off. Going from read-only to off first grants write access. One click applies, a failure is silent, and the aria-label reads "Set MCP mode after read-write". | Live and code |
| `PRJ-02` | The command menu shows `⌘N` on "Create new project…" (it creates a design) and `⌘O` on "Open another folder…" (not bound). The welcome pane says `⌘K` switches project. | Code |
| `PRJ-01` | The home screen says "⌘K Open the command menu anywhere". The menu is not mounted on the home routes. | Code |
| `PRJ-04` | A failed note delete shows nothing. Failed design delete and system disconnect report behind the open dialog. | Code |
| `PRJ-05` | A root load failure leaves a blank app with a small red label, no retry, and no way to close the project. | Code |
| `PRJ-06` | The notes sheet shows "0 notes" and "No notes yet" while loading and after a load error, with "Add note" enabled. | Code |
| `DES-01` | Deleting a layer or a whole board is one key press, has no undo, and autosaves after one second. | Code (no undo or history in `design-store.ts`) |
| `DES-02` | A design that fails to load shows only a small label, with no back button and no retry. | Live. A missing id shows "Loading design data..." for several seconds, then `Failed to load design data: Unexpected token '<', "<!doctype "... is not valid JSON`. |
| `DES-03` | Save state lives only in the layers rail, which starts hidden. A failed save shows a truncated raw message and no retry. | Code |
| `DES-04` | "Extract as {layer name}" creates a new design and navigates away. The label does not say so. | Code |
| `SYS-01` | The system editor's loading, error, and not-found states are a label on a blank screen. | Live ("No system found for “nope”.") |
| `SYS-02` | "Discard suggestions" also confirms the review. Both buttons change label when either is clicked. | Code |
| `SYS-03` | Component diagnostics are cut with `.slice(0, 8)` and no "more" row. | Code |
| `CMP-01` | A draft conflict says "Save or reload before continuing". Save is disabled in that state and no reload control exists. | Code |
| `CMP-02` | The guard dialog is titled "Discard unsaved changes?" and its primary button is "Save". | Code |
| `CMP-03` | The lint Design map and finding locations show boards and layers by raw id. | Code |
| `CMP-04` | Deleting a draft layer removes its subtree with no undo. | Code (no undo or history in `component-draft-store.ts`) |
| `UI-01` | The ghost button and the checkbox have no focus indicator. | Code |
| `UI-02` | `ConfirmationDialog` passes `initialFocus={false}`. | Live. With the disconnect dialog open, focus stays on the "Disconnect..." button behind the backdrop. |

## Decisions the fix run needs first

Each decision changes how many findings apply, so settle them before the run starts. The recommendation is the first option.

1. **Mono, lowercase, and uppercase labels.** The `eyebrow` and `section-header` variants set words in mono and force `lowercase`. The two editors hand-roll 42 sans uppercase labels for the same job. The skills say mono is for refs, ids, and values, and that eyebrows are template chrome. `CLAUDE.md` says the brutalist language is deliberate. Recommendation: keep one mono label style as house style, drop the `lowercase` and `uppercase` transforms so copy renders as written, replace the 42 hand-rolled strings with that one variant, and move sentences and row meta lines to the body font. Affects `UI-04`, `UI-05`, `UI-06`, `UI-20`, `PRJ-14`, `DES-09`, `DES-21`, `SYS-25`, `SYS-26`, `CMP-15`.
2. **Dark mode.** The app is light-only. Two `dark:opacity-70` classes on dialog backdrops are the only dark styles, so a dark OS gets a 70% backdrop over a white app (confirmed in a screenshot). Recommendation: stay light-only for now, delete the two classes, and set `color-scheme: light`. Affects `UI-03`, `UI-23`.
3. **Undo or confirm for layer delete.** Neither the design store nor the draft store has history. Recommendation: confirm only when the target is a board or has children, as a stopgap, and plan undo as its own project. Affects `DES-01`, `CMP-04`, `CMP-32`, `DES-29`.
4. **One name per thing.** Recommendation: "system" (not "design system"), "CSS file" for the source, "Add system" and "Remove system", "layer" in every editor, "element" for library items, "Tailwind default" (not "baseline"), "compound variant". Affects `PRJ-13`, `DES-06`, `DES-30`, `SYS-11`, `SYS-12`, `CMP-11`, `CMP-12`, `CMP-26`.
5. **Detail pane headers and repeated facts.** The design pane shows the design UUID four times and lets you rename in two places (confirmed in a screenshot). Recommendation: rename in the header only, one id row per pane, drop metric captions that restate the label, and keep the `PaneHeader` slots. Do not adopt the skill's "dot, name, tabs" header wholesale, because that rule comes from another product. Affects `PRJ-12`, `PRJ-28`, `UI-17`, `SYS-16`, `CMP-14`.
6. **Command palette position.** Both palettes are centred with a fixed 640px width. Recommendation: keep the global palette centred, add a `max-w`, and give the project switcher a clickable trigger. Anchor only the Add layer menu when its `+` button opens it. Affects `UI-28`, `PRJ-07`, `DES-27`.

## Suggested order for the fix run

Primitives come first because 135 button call sites, 153 text call sites, and every dialog inherit them. After that, the four view scopes touch separate files and can run in parallel.

1. **Primitives, one agent, serial.** Accessibility fixes that need no decision: `UI-01`, `UI-02`, `UI-07`, `UI-08`, `UI-09`, `UI-19`. Then the missing primitives that the views need: Skeleton (`UI-10`), `MetricCard` states (`UI-11`), compact `EmptyState` with an action (`UI-12`), Tooltip and Popover (`UI-13`), dialog parts with an error slot and a third footer button (`UI-14`, needed by `CMP-02`), `Field` error (`UI-15`), one select primitive (`DES-22`, `SYS-31`, `CMP-33`), and the label variants from decision 1.
2. **Broken or misleading behaviour, parallel by scope.** The high findings above, plus `PRJ-11`, `SYS-05`, `SYS-06`, `SYS-19`, `SYS-24`, `CMP-08`, `CMP-21`, `DES-18`, `DES-19`, `DES-20`.
3. **States, parallel by scope.** Skeletons and retries: `PRJ-18`, `DES-11`, `DES-12`, `SYS-07`, `SYS-08`, `CMP-09`, `CMP-10`. Replace `window.confirm` with `ConfirmationDialog`: `DES-05`, `CMP-05`. Validate on blur: `PRJ-09`, `DES-13`, `DES-17`, `SYS-21`.
4. **Copy pass, parallel by scope.** Names (decision 4), error wording (`PRJ-19`, `SYS-09`, `CMP-19`, `DES-28`), separators (`PRJ-15`, `DES-07`, `SYS-14`, `SYS-22`, `CMP-23`), sentence case (`PRJ-16`), one ellipsis character (`PRJ-25`, `SYS-28`).
5. **Structure, parallel by scope.** Repeated facts and badges at rest (`PRJ-12`, `PRJ-21`, `SYS-15`, `CMP-06`, `CMP-14`, `CMP-17`), the doubled lint navigation (`CMP-13`), card in card (`SYS-18`), the shortcuts overlay (`DES-15`).

Shared files need one owner per step: `SystemEditorInspector.tsx` (findings from both `SYS` and `CMP`), `SystemStatusBadge.tsx` and `SystemTokenRows.tsx` (`PRJ` and `SYS`), `src/utils/readJsonOrThrow.ts` (every scope prints its fallback).

## Overlaps and corrections

- `SYS-20` proposes "Save to keep your version, or reload to take the new one" for the draft conflict. `CMP-01` shows that Save is disabled in that state. Use the `CMP-01` fix.
- `UI-27` and `CMP-18` are the same finding (a switch inside the lint config form).
- `UI-02` and the note under `PRJ-22` are the same finding.
- `PRJ-21` and `SYS-15` both change `SystemStatusBadge`. Do them together.
- `UI-11` is the root cause of `PRJ-18` and part of `PRJ-12`.
- `SYS-03`, `SYS-21`, and parts of `SYS-33` and `SYS-39` render inside the Components workspace.

## Findings to weigh before fixing

These follow the letter of a rule and may not suit this product.

- `UI-16`: strikethrough on a shadowed class is a devtools convention that designers and developers know.
- `CMP-34`: folder and file icons in a file tree, and disabled lint rules shown greyed, are both conventional.
- `SYS-37`: dashed empty states. Valid only if a drop target is planned.
- `SYS-33`: hash and id rows in the inspector. Agents use ids over MCP, so some rows earn their place.
- `PRJ-27`: the dotted tile on design rows may be a planned thumbnail slot.

## Not covered

- Error text that the server writes (`src/server.ts`, `src/services/`, `src/routes/`). The UI prints it verbatim, and one live example was a raw JSON parse error.
- The `base-ui` and `charts` registries and `src/recipes/`, whose labels appear in the Add layer menu.
- Narrow widths, long names, toasts, hover and drag states. None of these was rendered.
- `Capture.tsx` and `src/libraries/`, which render user designs and not app chrome.
- The stores, hooks, and queries were searched for strings and not read line by line.
