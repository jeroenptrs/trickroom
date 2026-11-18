# Findings: home screens and project screen

Scope: `src/components/{HomeShell,OpenProjectPanel,CreateProjectPanel,MCPSetupDialog,McpToolSettingsDialog,Root,Project,AppDialogHost,OpenDesignTokensButton}.tsx`, `system-attention-toasts.ts`, `src/components/project/**`, and the strings these screens surface.

Rule ids: `UI-n` is pattern n in `ui-design-guidelines`. `WR-n` is pattern n in `writing-for-ui`. A section name is cited when no numbered pattern fits.

Paths are relative to `/root/workspace/trickroom/`. Counts: 6 high, 16 medium, 8 low.

The app has no dark theme (no `dark:` classes in scope, no dark tokens in `src/*.css`), so UI-26 is not reported anywhere.

---

## High

- **PRJ-01. The home screen advertises a shortcut that does nothing there.**
  - Severity: high. Confidence: high.
  - Rule: ui-design-guidelines, "Show only what exists" ("Don't let the UI claim something the system doesn't do") and "Interaction and keyboard" ("hints show only for commands that work on the current page").
  - Location: `src/components/OpenProjectPanel.tsx:104-109`.
  - Current: `<Kbd>⌘K</Kbd>` + `Open the command menu anywhere`.
  - Evidence: `Mod+K` is registered only in `src/components/project/CommandMenu.tsx:181-191` (mounted by `ProjectHeader.tsx:148`) and in `src/components/chrome/Layers.tsx:790`. `HomeShell` mounts neither, so ⌘K is dead on both home routes.
  - Fix: delete the hint row (lines 104-109). The home screen already shows every command the menu would offer. If the menu must work here, mount `CommandMenu` in `HomeShell` first and then keep the hint as `Command menu`.

- **PRJ-02. Three shortcut hints name the wrong key or a key that is not bound.**
  - Severity: high. Confidence: high.
  - Rule: ui-design-guidelines, "Show only what exists" and "Interaction and keyboard".
  - Locations and current text:
    - `src/components/project/CommandMenu.tsx:342-349` and `:484-491`: `Create new project…` with hint `⌘N`. `Mod+N` creates a design (`src/components/project/Designs.tsx:96-104`). Pressing it from this menu's hint creates an "Untitled" design instead of a project.
    - `src/components/project/CommandMenu.tsx:323-330` and `:465-472`: `Open another folder…` with hint `⌘O`. No `Mod+O` hotkey exists anywhere in `src/`.
    - `src/components/project/ProjectPane.tsx:47`: `{ kbd: "⌘K", label: "switch project" }`. ⌘K opens the command menu. ⌘P opens the switcher (`CommandMenu.tsx:193-203`), and the header says `switch ⌘P` (`ProjectHeader.tsx:163-166`).
  - Fix: remove the `⌘N` and `⌘O` spans from the four command items (or bind `Mod+O` to `handleOpenAnotherFolder` and keep that one). Change `ProjectPane.tsx:47` to `{ kbd: "⌘P", label: "switch project" }`. Add a `New design` item with `⌘N` to the command menu so the real binding is listed once.

- **PRJ-03. The MCP mode button does not say what a click does, and the only way from read-only to off passes through read-write.**
  - Severity: high. Confidence: high (behaviour), medium (preferred control).
  - Rule: writing-for-ui "Buttons" ("Say what happens") and WR-6, WR-8. ui-design-guidelines "Sheets, dialogs, and forms" ("Mutually exclusive actions sit side by side as one choice"), "States" ("Every failure keeps a retry"), UI-20.
  - Location: `src/components/project/ProjectHeader.tsx:29-39` (cycle), `:125-134` (mutation), `:168-183` (button).
  - Current: `aria-label={`Set MCP mode after ${mcpMode}`}` reads "Set MCP mode after read-write". Visible label `MCP{" · "}{mcpMode}` in `font-mono text-[10px] uppercase tracking-wider`, with a `RefreshCcw` icon that reads as "refresh".
  - Problems confirmed in code:
    1. `getNextMcpSettings` cycles off, read-only, read-write, off. A user on read-only who wants MCP off must first grant agents write access. Each click applies at once.
    2. `updateMcpMutation` has no `onError` and nothing renders its error. A failed write is silent.
    3. The read-only state is orange (`text-orange-700`, warning tone) although it is the safer of the two enabled modes. Judgment call.
  - Fix: replace the button with the existing `Segmented` primitive, label `MCP`, `ariaLabel="MCP access for agents"`, options `Off`, `Read only`, `Read and write`. Render the mutation error next to it as `Could not change MCP access: {reason}`. If the cycle button stays, use `aria-label={`MCP access: ${current}. Change to ${next}.`}`, replace the `·` with a gap, and drop `uppercase`.

- **PRJ-04. A failed note delete is silent, and failed design and system deletes report behind the modal.**
  - Severity: high. Confidence: high.
  - Rule: ui-design-guidelines "Sheets, dialogs, and forms" ("Show a backend error inside the dialog, above the footer") and "States" ("Every failure keeps a retry").
  - Locations:
    - `src/components/project/memory/MemoryNotesPanel.tsx:170-181` and `:291-310`: `deleteMutation.error` is never read. On failure the dialog stays open, the button returns to `Delete`, and no message appears.
    - `src/components/project/DesignDetailPane.tsx:82-84`, `:132-138`, `:299-319`: the delete error becomes `actionError` in the pane header, behind the dialog backdrop. The dialog has no error slot filled.
    - `src/components/project/SystemDetailPane.tsx:809-810`, `:857`, `:983-987`, `:1023-1045`: same for `Disconnect`.
  - Reference: `src/components/HomeShell.tsx:188-192` already passes an `Alert` as `ConfirmationDialog` children.
  - Fix: pass the error as children in all three dialogs: `Could not delete the note: {reason}`, `Could not delete {design.name}: {reason}`, `Could not disconnect {systemDisplayName}: {reason}`.

- **PRJ-05. A load failure at the root leaves a blank app with a small chip and no way out.**
  - Severity: high. Confidence: medium (I did not run the failure path).
  - Rule: ui-design-guidelines "States" ("Every failure keeps a retry"), UI-12. writing-for-ui "Errors" ("Say what happened and how to fix it").
  - Location: `src/components/Root.tsx:169-175`, `:177-184`, `:190-196`, `:198-212`, `:214-220`, and the `SystemEditorFallback` at `:36-46`.
  - Current: `Loading project data...` in a `bg-slate-500` chip at `left-3 top-3`. Errors: `Failed to load session: {message}`, `Failed to load project data: {message}`, `Failed to load system data: {message}` in a `bg-red-500` chip. `Loading system editor` in mono uppercase.
  - Problems: there is no retry button on any of the three errors. For a config or systems error the user still has an active project, so `HomeRoutes` never renders and the user cannot close the project or pick another one. The loading state is a sentence, not a skeleton of the shell.
  - Fix: render a full-pane error state built on `EmptyState`: title `Could not load {project name or "the project"}`, the reason, a `Retry` button that calls `refetch()`, and a `Close project` button (calls `closeProject`) for the config and systems cases. For loading, render the project shell skeleton (header bar, 72-wide sidebar with the row skeleton that `Designs.tsx:165-183` already has).

- **PRJ-06. The notes sheet shows "0 notes" and "No notes yet" while loading and after a load error.**
  - Severity: high. Confidence: high.
  - Rule: UI-13 (empty as error), UI-12, ui-design-guidelines "States" ("A failed secondary request never ... renders as zero").
  - Location: `src/components/project/memory/MemoryNotesPanel.tsx:126` (`notes` defaults to `[]`), `:213-215` (count), `:233-237` (error alert), `:250-257` (empty state has no `isPending` or `isError` guard). `MemoryNotesButton.tsx:34` has the same `?? 0`.
  - Current: with `memoryQuery.isError`, the panel renders the raw `{loadError}` alert and `No notes yet` + `Capture intent, usage, conventions, and decisions for this scope.` together. The `Add note` button is enabled in the error state, and a create then runs without `expectedRevision` (`:142`).
  - Fix: while `isPending`, render two note-card skeletons and hide the count. On error, render only `Could not load notes: {reason}` with a `Retry` button, and disable `Add note`. Show the empty state only when `isSuccess && notes.length === 0`.

---

## Medium

- **PRJ-07. The project switcher and the command menu have no clickable trigger.**
  - Severity: medium. Confidence: high.
  - Rule: ui-design-guidelines "Interaction and keyboard" (shortcuts are accelerators; UI-23 "Anchor it under its trigger").
  - Location: `src/components/project/ProjectHeader.tsx:162-167` (`switch` + `<Kbd>⌘P</Kbd>` is a plain `div`), `src/components/project/CommandMenu.tsx:257-268` (`fixed top-24 left-1/2 w-[640px] -translate-x-1/2`).
  - Problem: switching project, closing the project, and opening another folder are reachable only by keyboard. The palette is centred because it has nothing to anchor to.
  - Fix: make the project name area a button that opens the switcher (label: the project name, trailing `⌘P` hint), and anchor the popup under it. Move rename to the command menu or keep `EditableTitle` on double-click.

- **PRJ-08. Removing a recent project is hidden until hover, asks for confirmation although it is reversible, and uses the delete icon.**
  - Severity: medium. Confidence: high.
  - Rule: ui-design-guidelines "Lists, tables, and cards" ("Row actions are always visible, never revealed on hover"), UI-16. writing-for-ui "Destructive actions" ("For a reversible action, offer undo and skip the confirmation").
  - Location: `src/components/HomeShell.tsx:52-61` (`opacity-0 group-hover:opacity-100 focus-visible:opacity-100`, `Trash2`), `:171-193` (dialog).
  - Current dialog: title `Remove recent project`, body `This removes {name} from the recent projects list. The project files stay on disk.`, action `Remove`.
  - Fix: show the button at rest with the `X` icon, aria-label and tooltip `Remove from recent projects`. Remove on click with no dialog. Show a toast `{name} removed from recent projects` with an `Undo` action, if the API can add a project back to the list without opening it. I did not find such an endpoint in `src/queries/projects.ts`. Without one, drop the undo and keep the toast, because the user can reopen the folder by path. Keep the inline error as `Could not remove {name}: {reason}`.

- **PRJ-09. Forms disable submit on field errors and validate on every keystroke.**
  - Severity: medium. Confidence: high.
  - Rule: ui-design-guidelines "Sheets, dialogs, and forms" ("Validate on blur, not per keystroke, and don't disable the submit button on field errors").
  - Locations:
    - `src/components/CreateProjectPanel.tsx:39-42` and `:111-117`: `submitDisabled` includes `hasPartialSystemLink || hasInvalidSystemName`. Both alerts (`:257-268`) appear while the user types. Typing the system name before the CSS path shows `Provide both a design system name and CSS path, or leave both empty.` on the first character.
    - `src/components/CreateProjectPanel.tsx:120-311`: the panel is a `div`, not a `form`, and the submit is `type="button"`. Enter in a field does nothing.
    - `src/components/OpenProjectPanel.tsx:92`, `src/components/project/CommandMenu.tsx:562`, `src/components/project/CreateSystemDialog.tsx:66-69` and `:187`, `src/components/project/memory/MemoryNoteEditor.tsx:63`: submit disabled while a required field is empty.
  - Fix: wrap `CreateProjectPanel` in a `form` with `onSubmit`. Keep buttons enabled except while pending. Validate on blur and on submit, show the message under the field, and focus the first invalid field. Messages: `Enter a project name.`, `Enter the project folder.`, `Enter a CSS file for this system, or remove the system.`, `Use letters, numbers, - _ and @ only.`

- **PRJ-10. The create-project form presents one form as two steps, and the step counter changes when you click "Add +".**
  - Severity: medium. Confidence: high.
  - Rule: WR-8 (template chrome), WR-1, UI-20, writing-for-ui "Buttons". ui-design-guidelines "Decide what not to draw".
  - Location: `src/components/CreateProjectPanel.tsx`.
  - Current and fix:
    - `:285-290` `Step {showSystem ? "2" : "1"} of 2` in `font-mono text-[10px] uppercase tracking-wider`. Delete it. Nothing advances between steps.
    - `:135-137` and `:183-185` numbered squares `1` and `2`. Delete them, keep the section titles.
    - `:122` eyebrow `New project` above the title `Create project`. Delete the eyebrow.
    - `:191` `Add +` and `Remove`. Replace with `Add system` (with the `Plus` icon, not a typed `+`) and `Remove system`.
    - `:271-273` `Link a Tailwind CSS file now, or add one after the project exists.` in `font-mono text-[10px]`. Remove `font-mono`, use `text-[11px]`: `Optional. You can add a system later.`
    - `:230-233` `Optional. Path is relative to the project folder — e.g. src/index.css.` Replace with `Relative to the project folder.` The placeholder at `:222` already shows `src/index.css`, and "Optional" is wrong once the section is open, because both fields are then required.
    - `:186-188` `Design system` becomes `System` (see PRJ-13).
    - `:251-253` `New designs will automatically link to this system.` becomes `New designs link to this system.`

- **PRJ-11. Selecting "Create new project…" closes the open project before the form is filled, and Cancel does not return to it.**
  - Severity: medium. Confidence: medium (read from code, not run).
  - Rule: ui-design-guidelines "States" ("Preserve context through routine updates").
  - Location: `src/components/project/CommandMenu.tsx:229-233` (`closeMutation.mutate()` then navigate to `/new`), `src/components/CreateProjectPanel.tsx:292-299` (`Cancel` navigates to `/`, which is now the home screen).
  - Fix: on Cancel, reopen the project that was active (pass its `projectRoot` in router state), or open the create form without closing the project and close it only on a successful create.

- **PRJ-12. The same fact is shown and edited in several places on the design and system panes.**
  - Severity: medium. Confidence: high for the duplication, medium for which copy to keep.
  - Rule: ui-design-guidelines "Keep headers lean" ("No metadata line under the name"), "Give every fact one home", UI-19. WR-1, WR-2.
  - Design pane, `src/components/project/DesignDetailPane.tsx`:
    - The UUID appears four times: header meta `:124-131`, `Design ID` field with copy `:240-250`, `Design file` field `:254` (label says file, value is the bare UUID), and inside `Resource URI` `:255-265`. The header also has a copy button for the resource link `:156-161`.
    - The name is editable twice: `EditableTitle` `:117-122` and the `Design name` input with `Save` `:208-239`.
    - Metric details restate their labels: `Root boards in this design`, `Total rendered layers`, `Linked system`, `Last file modification` (`:183-204`).
  - System pane, `src/components/project/SystemDetailPane.tsx`:
    - Name editable twice: `:949-954` and `:541-572`.
    - System ID twice, both with a copy button: metric card `:393-401` (`Project config key`) and `:573-583`.
    - Sync time and CSS file three times: header `:825` `index.css · synced 5m ago`, `Last Sync` card `:388-392`, `CSS source path` `:614-649`.
    - Diff counts three times: header chips `:966-973`, the mini bar in the Tokens card `:367`, and the sidebar row meta.
    - Metric details: `Stored token records`, `Indexed asset images`, `Design usage count`.
  - Fix: keep rename in the header only and delete both `Identity` name inputs. Drop the header meta lines. Keep one id row per pane, in a single `Details` section. Rename `Design file` to show the real path (`.trickroom/designs/{uuid}`) or delete it. Make `detail` optional on `MetricCard` (the fix belongs in `src/components/ui/metric-card.tsx`) and delete the restating details. Delete the `System ID` and `Last Sync` cards.

- **PRJ-13. One thing has several names: system, design system; CSS file, token source, CSS source path; create, connect, link, define, disconnect.**
  - Severity: medium. Confidence: high for the inconsistency, medium for the chosen term.
  - Rule: writing-for-ui "Names" ("Keep one name for one thing everywhere"), WR-3. Glossary in `CLAUDE.md`: System, Design, Board.
  - Locations and current text:
    - `Design system`: `CreateProjectPanel.tsx:187`, `:204` (`Design system name` aria-label over a visible `System name`), `:221`, `:259`, `:265`; `CreateSystemDialog.tsx:95` title `Create design system` with button `Create system` (`:190`); `Root.tsx:140`, `:164` `Some design systems ...`.
    - The source file: `CSS file` (`CreateProjectPanel.tsx:215`), `Token source` (`CreateSystemDialog.tsx:130`), `Token Source` and `CSS source path` (`SystemDetailPane.tsx:614`, `:618`), `a tokens file or Tailwind config` (`Systems.tsx:224`), `a Tailwind CSS file` (`CreateProjectPanel.tsx:272`).
    - Verbs: `Create system`, `Create new system…` (`CommandMenu.tsx:377`), `connect` (`Systems.tsx:224`), `Link` (`CreateProjectPanel.tsx:272`), `Define a design system` (`CreateSystemDialog.tsx:107`), `Disconnect system` (`SystemDetailPane.tsx:660`, `:1030`).
    - `design board` for a Design: `Designs.tsx:202` `create your first design board`, `ProjectPane.tsx:38` `Start by creating a design board.` ⌘N creates a Design with no boards (`Designs.tsx:77-80`).
    - `workspace` for a Project: `OpenProjectPanel.tsx:66` `Start a new .trickroom workspace`.
    - `Systems.tsx:224` also promises a `Tailwind config`, which the dialog does not accept. It takes one CSS file (`CreateSystemDialog.tsx:133-146`).
    - The two create forms disagree on allowed names: `CreateProjectPanel.tsx:20` enforces `/^[A-Za-z0-9_@-]+$/`, while `CreateSystemDialog.tsx:122` suggests `e.g. Acme Web`, which that pattern rejects. I did not find the server rule.
  - Fix: use `system` everywhere, `CSS file` for the source, and the pair `Add system` and `Remove system` (or keep `Disconnect` and use `Connect system` for creation, but pick one pair). Replacement strings: dialog title `Add system`, button `Add system`, command `Add system…`, field label `CSS file`, section title `CSS file`, toast `{name} has token changes to review` and `{n} systems have token changes to review`. `OpenProjectPanel.tsx:66`: delete the sub-line. `Designs.tsx:202` and `ProjectPane.tsx:38`: see PRJ-17.

- **PRJ-14. Words are set in monospace, and eyebrows restate the title under them.**
  - Severity: medium. Confidence: medium. The mono lowercase label is part of the current visual language, so treat the primitive change as a decision for the lead.
  - Rule: UI-20 ("Mono is for refs, ids, and values"), WR-8, WR-1. ui-design-guidelines "Build hierarchy with size, not colour" ("Siblings share one styling").
  - Root cause in the primitive: `src/components/ui/text.tsx:42-47`, variants `eyebrow`, `section-header`, `section-divider` all carry `font-mono` and `lowercase` or `uppercase`. `src/components/ui/command.tsx:31-32` `groupLabel` and `:51-53` footer hints do the same.
  - Eyebrows that add nothing (delete):
    - `OpenProjectPanel.tsx:44` `Welcome` above `Open a project` (also a greeting, WR-11).
    - `CreateProjectPanel.tsx:122` `New project` above `Create project`.
    - `DesignDetailPane.tsx:115` `Design` and `SystemDetailPane.tsx:942-946` `System`. The sidebar section already says which list the item came from. The two eyebrows also differ in colour (`text-cyan-700` default against a `text-amber-700` override).
    - `memory/MemoryNotesDrawer.tsx:29` `Memory` above the project or design name. Here the eyebrow is the only place that says what the sheet is. Replace eyebrow and title with one title: `Notes for {title}`.
  - Words in mono (move to the body font; fix in the primitive, then check call sites): `HomeShell.tsx:132` `recent`, `Designs.tsx:128` `designs`, `Systems.tsx:203` `systems`, `AuditLogLink.tsx:29` `audit log`, `OpenProjectPanel.tsx:76-79` `Open by path` (a field label rendered as a section header), `ProjectHeader.tsx:163-165` `switch`, `ProjectHeader.tsx:171` MCP label, `CreateProjectPanel.tsx:271`, `:285-290`, `Root.tsx:40`, `memory/MemoryNotesPanel.tsx:99` `agent` and `you`, `Designs.tsx:284-292` and `Systems.tsx:154-159` meta lines (`518 layers`, `just now` are words and counts, not refs).
  - Keep mono for: paths (`HomeShell.tsx:47`, `ProjectHeader.tsx:149`), UUIDs, token names, commands, `{{type:id}}` tokens, kbd hints.

- **PRJ-15. `·`, `—` and `->` are used as separators and link arrows.**
  - Severity: medium. Confidence: high.
  - Rule: WR-6, WR-8.
  - Locations and current text:
    - `Designs.tsx:288-291` `{n} layers{" · "}{time}`.
    - `Systems.tsx:59` `` `${cssBasename} · ` ``, `:82` `` `${label} · ${stylesheets} since last review` ``.
    - `SystemDetailPane.tsx:356` `` `${iconSampleRow ?? "No icon folders"} · ${n} diagnostic(s)` ``, `:825` `[cssBasename, `synced ${editedTime}`].join(" · ")`.
    - `ProjectHeader.tsx:177` `MCP{" · "}`.
    - `memory/MemoryNotesPanel.tsx:101` `` ` · ${note.author.label}` ``, `memory/MemoryNoteBody.tsx:28` `` `${reference.detail} · ${reference.raw}` `` (tooltip).
    - `CreateProjectPanel.tsx:231` `project folder — e.g.`.
    - `AuditLogLink.tsx:36` `{countLabel} -&gt;`.
  - Fix: render the two facts as separate spans in a `flex gap-2` row (or use the `Separator` primitive, vertical). In the tooltip string use one fact per line. For the audit link use the `ArrowUpRight` icon.

- **PRJ-16. Headings and buttons mix title case with sentence case.**
  - Severity: medium. Confidence: high.
  - Rule: writing-for-ui "Follow the product first" ("Sentence case is the default").
  - Locations, current, replacement:
    - `HomeShell.tsx:160`, `MCPSetupDialog.tsx:99` `MCP Setup` becomes `MCP setup`.
    - `McpToolSettingsDialog.tsx:168` `MCP Settings` becomes `MCP tools` (it only toggles tool groups, and `MCP setup` and the header MCP mode are two other MCP surfaces).
    - `DesignDetailPane.tsx:253` `Storage & Resource` becomes `Storage`. `:268` and `SystemDetailPane.tsx:658` `Danger Zone` becomes `Danger zone`.
    - `SystemDetailPane.tsx:586` `Project Default` becomes `Project default`. `:614` `Token Source` becomes `CSS file`. `:651` `Storage & Debug Paths` becomes `Storage`. `:387` `Used By` becomes `Used by`. `:389` `Last Sync` becomes `Last sync`.
  - Lowercase labels that should start with a capital: `ProjectPane.tsx:45-47`, `:63-66` (`new design`, `navigate`, `open`), `project-view-utils.ts:57-59` badge labels, `Systems.tsx:95` `no token data`.

- **PRJ-17. The empty project says the same thing three times, and the "nothing selected" pane restates the sidebar.**
  - Severity: medium. Confidence: high.
  - Rule: WR-1, WR-2, WR-11. ui-design-guidelines "States" ("An empty collection shows the primary action once, in the empty state, not also in the toolbar").
  - Locations and current text:
    - `ProjectPane.tsx:35-50`: `Sparkles` icon, `Welcome to Trickroom`, `This project doesn't have any designs or systems yet. Start by creating a design board.`, the project path in mono, three kbd hints.
    - `Designs.tsx:198-203`: `No designs yet`, `Press ⌘N or use + New above to create your first design board.`
    - `Systems.tsx:220-225`: `No systems yet`, `Press ⌘⇧N or use + New above to connect a tokens file or Tailwind config.`
    - `ProjectPane.tsx:56-69`: `Nothing selected`, `Pick a design or system from the sidebar to preview its contents and edit metadata.`, hints including `↵ open`, which does nothing while nothing is selected (`Designs.tsx:115`, `Systems.tsx:195`).
  - Other confirmed details: the button the copy calls `+ New` has no `+` (`Designs.tsx:139-140` uses `FilePlus2` and the text `New`). Both sidebar buttons have the same accessible name `New` (`Designs.tsx:133-141`, `Systems.tsx:208-215`).
  - Fix:
    - Welcome pane: icon neutral, title `No designs or systems yet`, description `Create a design to start drawing, or add a system to use your tokens.`, two buttons `New design` and `Add system`. Delete the path and the hint row.
    - Sidebar empty states: `No designs yet` with description `Create one with New design.` and `No systems yet` with `Add one to use your tokens.` The `EmptyState` primitive requires `description`; make it optional there if you want title only.
    - Sidebar buttons: visible text `New`, `aria-label="New design"` and `aria-label="Add system"`.
    - Nothing-selected pane: title `Select a design or system`, no description, hints `↑↓ select`, `⌘N new design`, `⌘⇧N add system`.

- **PRJ-18. Loading is shown as sentences and failures have no retry inside the panes.**
  - Severity: medium. Confidence: high.
  - Rule: UI-12, ui-design-guidelines "States" ("Every failure keeps a retry", "Every card keeps its footprint").
  - Locations and current text:
    - `McpToolSettingsDialog.tsx:205-208` `Loading MCP tool groups...`. On error (`:190-194`) the list area is empty and there is no retry.
    - `SystemDetailPane.tsx:336-343` `Loading...`, `Unavailable`, `Could not load usage count`. `:345-356` `Loading...`, `Error`, `Loading icon index...`, `Failed to load icon index`. `:371-384` `...`, `Error`, `Loading assets`, `Failed to load assets`. These render as the 2xl metric value.
    - `AuditLogLink.tsx:20-24` `...` and `unavailable` as link text. The link still opens.
    - `memory/MemoryReferenceSuggest.tsx:104` `Loading…`.
    - `Designs.tsx:185-189` `Failed to load designs: {message}` with no retry.
  - Fix: give `MetricCard` a `loading` prop that draws a value-sized skeleton block (primitive change in `src/components/ui/metric-card.tsx`), and an error variant with a small retry icon button. In the MCP tools dialog draw three row skeletons. Add `Retry` to the designs list error and the MCP tools error.

- **PRJ-19. Error messages are "Failed to X: {raw server text}", several fall back to vague text, and some show the raw text with no context.**
  - Severity: medium. Confidence: high.
  - Rule: WR-5, writing-for-ui "Errors" ("Could not launch {name}" plus the reason), WR-3.
  - Locations and current text, with replacements:
    - `HomeShell.tsx:190` `Failed to remove project: {e}` becomes `Could not remove {name}: {e}`.
    - `OpenProjectPanel.tsx:100`, `CommandMenu.tsx:544` `Failed to open project: {e}` becomes `Could not open {path}: {e}`.
    - `CreateProjectPanel.tsx:279` `Failed to create project: {e}` becomes `Could not create {name}: {e}`.
    - `Designs.tsx:187`, `:192` become `Could not load designs: {e}` and `Could not create the design: {e}`.
    - `McpToolSettingsDialog.tsx:192`, `:133` `Failed to load MCP settings: {e}`, `Failed to update MCP tool settings` become `Could not load MCP tools: {e}` and `Could not save {group.label}: {e}`.
    - `SystemDetailPane.tsx:451` `Settings action failed` becomes `Could not save the system settings.` `:878` `Failed to load token snapshot: {e}` becomes `Could not load stored tokens: {e}`. `:990` `Failed to save overrides: {e}` becomes `Could not confirm the review: {e}` (the button says `Confirm review`).
    - `ProjectHeader.tsx:74` `Project location unavailable.` becomes `Could not rename the project. Reopen it and try again.`
    - `memory/MemoryNotesPanel.tsx:156`, `:173` `Memory revision unavailable; reopen the drawer.` becomes `Notes are still loading. Try again.`
    - `src/utils/readJsonOrThrow.ts:21` (outside the listed scope, but every screen here surfaces it) `Request failed with status 500` becomes `The Trickroom server returned an error (500).`
  - Raw text with no lead-in: `ProjectHeader.tsx:107-111`, `DesignDetailPane.tsx:132-138`, `SystemDetailPane.tsx:534-538` and `:983-987`, `CreateSystemDialog.tsx:170-174`, `memory/MemoryNotesPanel.tsx:233-237`, `CommandMenu.tsx:251-255`. Prefix each with the action that failed.
  - Layout: `CommandMenu.tsx:251-255` renders the error as a `bg-red-500` chip inside the header's flex row, and `ProjectHeader.tsx:107-111` adds an alert under the title. Both change the header height (UI-14). `CommandMenu.tsx:542-546` uses a red chip where every other form uses `Alert variant="panel"`. Use a toast for the close and switch failures and `Alert` in the path dialog.

- **PRJ-20. The "attention" toasts have a vague shared title, hide names they already have, and offer no next step.**
  - Severity: medium. Confidence: high.
  - Rule: writing-for-ui "Toasts" ("Confirm the outcome, with at most one next step"), "Status text" ("Show names"), WR-9.
  - Location: `src/components/Root.tsx:134-141`, `:158-165`.
  - Current: title `Your systems need attention` for both the warning and the info toast. Descriptions `{name} has issues syncing tokens`, `Some design systems have issues syncing tokens`, `{name} has token changes to review`, `Some design systems have token changes to review`.
  - Fix: put the fact in the title and drop the shared one. Warning: `{name} could not sync tokens` or `{n} systems could not sync tokens`, description: the names joined (first three, then `and N more`). Info: `{name} has token changes to review` or `{n} systems have token changes to review`. Add one action, `Review`, that navigates to `getSystemEditorPath(id, { tab: "tokens" })` for the single-system case.

- **PRJ-21. The system pane shows a status badge at rest, and the sidebar meta prints empty diffs.**
  - Severity: medium. Confidence: high.
  - Rule: UI-25, ui-design-guidelines "Show only what exists" ("Absence is not a status").
  - Locations:
    - `SystemDetailPane.tsx:955` `<SystemStatusBadge state={syncState} />` always renders, including `Synced` with its dot (`SystemStatusBadge.tsx:16-21`). The sidebar already limits the badge to abnormal states (`Systems.tsx:133-136`).
    - `SystemStatusBadge.tsx:20` label `Error`. Replace with `Sync failed`.
    - `Systems.tsx:86-91` returns `` `${prefix}+${added} / -${removed}` `` whenever `baselineDiff` exists, which produces `index.css · +0 / -0`. `:95` `no token data`.
    - A sidebar row in review or error draws a leading `StatusDot` (`Systems.tsx:151`), a badge with a second dot (`SystemStatusBadge.tsx:35`), and a `warning` flavor on the row (`Systems.tsx:145`).
  - Fix: in the pane header render the badge only for `review`, `error`, `syncing`, `idle`. When both diff counts are 0, fall through to the token count (`128 tokens`). Replace `no token data` with `Not synced`. Drop the dot inside the badge when the row already has one.

- **PRJ-22. Confirm buttons do not name the action, descriptions repeat the title as a question, and the disconnect copy uses storage jargon.**
  - Severity: medium. Confidence: high.
  - Rule: WR-4, writing-for-ui "Destructive actions" ("Confirm buttons name the action", "State the consequence only when the action can't be undone"), WR-3.
  - Locations, current, replacement:
    - `DesignDetailPane.tsx:306-315`: title `Delete design`, body `Delete "{name}"? This removes the design file from this project.`, action `Delete`. Body becomes `"{name}" and its boards are deleted from this project. This can't be undone.` Action becomes `Delete design`.
    - `SystemDetailPane.tsx:1030-1041` and `:661`: `Disconnect "{name}"? This removes the system from the project config and deletes its Trickroom system storage.` and `Removes this system from project config and deletes Trickroom system storage for tokens, manifests, assets, and icon indexes.` Body becomes `Trickroom stops reading tokens from {cssBasename} and deletes the stored tokens, assets, and icons for "{name}". The CSS file stays on disk.` Action becomes `Disconnect system`. I did not verify what the server deletes; the replacement follows the current claim.
    - `memory/MemoryNotesPanel.tsx:298-302`: `Delete this memory note? This cannot be undone.`, action `Delete`. Body becomes `This can't be undone.` Action becomes `Delete note`.
    - `HomeShell.tsx:174-183`: remove the dialog (PRJ-08).
  - Related, in the primitive: `src/components/ui/alert-dialog.tsx:177` sets `initialFocus={false}`. The guideline asks for focus on Cancel in a destructive confirm.

---

## Low

- **PRJ-23. MCP tools dialog: only a hidden shortcut opens it, rows are separate cards, and the switch name flips with its state.**
  - Severity: low. Confidence: high.
  - Rule: ui-design-guidelines "Interaction and keyboard" ("Every new shortcut appears in the shortcuts overlay"), "Surfaces, borders, and spacing" ("Related rows are one surface with dividers, not separate floating cards"), WR-3.
  - Locations: `AppDialogHost.tsx:8-14` (`Mod+,` is the only entry point; no menu item or button mentions it). `McpToolSettingsDialog.tsx:62` (`border border-slate-200 bg-slate-50` per row, `gap-2` list at `:204`) with an inner `border-t` at `:84`. `:80` `aria-label={`${enabled ? "Disable" : "Enable"} ${label}`}` overrides the visible `<label htmlFor>`, so a screen reader hears "Disable Design mutation, switch, on".
  - Copy in `src/mcp/tool-groups.ts` (surfaced here): `Design mutation` (`:52`), `Design inspection` (`:40`), `Validation & dry-run` (`:59`). Replace with `Edit designs`, `Read designs`, `Validate and lint`.
  - Fix: add `MCP tools…  ⌘,` to the command menu and a button in `MCPSetupDialog`. Render the groups as one bordered list with `divide-y`. Delete the switch `aria-label`.

- **PRJ-24. Audit log link: wrong plural, text arrow, and a link that stays live while "unavailable".**
  - Severity: low. Confidence: high.
  - Rule: WR-8, writing-for-ui "Fit" (plurals), "Status text".
  - Location: `src/components/project/AuditLogLink.tsx:20-24`, `:30-37`.
  - Current: `` `${count} entries` `` gives `1 entries`. Link text `{countLabel} -&gt;`. The href is the raw JSON endpoint `/api/trickroom/audit-log/summary`.
  - Fix: `pluralize(count, "entry", "entries")`, `ArrowUpRight` icon, and render plain text `Could not load` with a retry when the query fails.

- **PRJ-25. Pending labels and "opens a dialog" markers mix `...` and `…`.**
  - Severity: low. Confidence: high.
  - Rule: writing-for-ui "Follow the product first" (one punctuation convention).
  - `…`: `OpenProjectPanel.tsx:94`, `CreateProjectPanel.tsx:306`, `CommandMenu.tsx:283`, `:323`, `:342`, `:377`, `:564`, `Designs.tsx:154`, `MemoryReferenceSuggest.tsx:104`.
  - `...`: `HomeShell.tsx:183`, `Designs.tsx:140`, `CreateSystemDialog.tsx:190`, `DesignDetailPane.tsx:233`, `:284`, `:315`, `SystemDetailPane.tsx:337`, `:346`, `:351`, `:566`, `:642`, `:671`, `:896`, `:1040`, `McpToolSettingsDialog.tsx:207`, `Root.tsx:172`, `:193`, `MemoryNoteEditor.tsx:224`, `MemoryNotesPanel.tsx:302`.
  - Fix: use `…` everywhere.
  - Related bug: both `Save` buttons in system settings read the same mutation (`SystemDetailPane.tsx:566`, `:642`), so saving the name also turns the CSS path button into `Saving...`.

- **PRJ-26. Counts and a pin icon are dimmed or tinted for rank.**
  - Severity: low. Confidence: medium.
  - Rule: UI-3 ("A running count on a column header and a pin icon in a row were both corrected back to the default colour").
  - Locations: `Designs.tsx:129-131` and `Systems.tsx:204-206` (`tone="faint"` count beside the section header), `memory/MemoryNotesPanel.tsx:57` (`Pin` in `text-cyan-600`), `memory/MemoryNotesPanel.tsx:213-215` (`{n} notes` above the list of the same notes, WR-2), `ProjectPane.tsx:16` and `EmptyState` description (`tone="faint"`, fix in `src/components/ui/empty-state.tsx:65`: a description is not meta, use `muted` at most).
  - Fix: default ink for the counts and the pin. Delete the `{n} notes` line and right-align `Add note`.

- **PRJ-27. Rows carry decoration that says nothing: a placeholder thumbnail on every design row and a folder icon on every switcher row.**
  - Severity: low. Confidence: medium (the dotted tile may be a planned thumbnail slot).
  - Rule: UI-7, ui-design-guidelines "Popovers, menus, and tooltips" ("No leading icons").
  - Locations: `Designs.tsx:255-262` (a `size-10` dotted square, identical on every row, mirrored by the skeleton at `:175`), `CommandMenu.tsx:431-434` (`Folder` on each recent project). Action rows in the menu correctly keep their icons.
  - Fix: remove both. If a real thumbnail is planned, add the tile when it exists.

- **PRJ-28. Design pane order and extras: the danger zone is not last, a decorative "Glyph" card follows it, and storage paths are advertised.**
  - Severity: low. Confidence: medium.
  - Rule: ui-design-guidelines "Settings, preferences, and flags" ("the danger zone comes last"), "Show only what exists" ("Don't advertise internals"), "Decide what not to draw".
  - Locations: `DesignDetailPane.tsx:268-288` (danger zone) then `:290-295` (`Glyph`, an `aria-hidden` generated SVG up to 700px wide). `SystemDetailPane.tsx:651-656` `Storage & Debug Paths` with four read-only paths and no copy buttons.
  - Fix: move the danger zone to the end. Delete the `Glyph` section, or use the glyph as the row thumbnail in PRJ-27. Delete the debug paths section or fold one `Storage` path into `Details`.
  - Related: `SystemDetailPane.tsx:591-600` uses a `Checkbox` that saves on click. A control that applies at once is a `Switch`.

- **PRJ-29. Design diagnostics use implementation words.**
  - Severity: low. Confidence: medium.
  - Rule: WR-3, writing-for-ui "Errors".
  - Locations: `project-view-utils.ts:56-67` badge labels `unsupported version`, `invalid design`, `invalid json`, `v{n} unsupported`. `DesignDetailPane.tsx:171-178` `This design cannot be opened.`, the raw message in mono, `Restore the file, for example from version control. Board and layer counts are best-effort.` `DesignDetailPane.tsx:50` shows `-` as the System value. `Designs.tsx:237` puts the reason only in a `title` tooltip.
  - Fix: one badge label `Can't open`. Alert: `This design can't be opened.` then the reason, then `Restore the file from version control.` (invalid cases) or `It was saved by a newer version of Trickroom.` (unsupported version, if that is the cause; I did not verify it), then `Board and layer counts may be wrong.` Show `None` for no linked system.

- **PRJ-30. Notes editor: the UI says Markdown but renders plain text, the picker is mouse-only, and labels use internal words.**
  - Severity: low. Confidence: high for the code facts, medium for severity.
  - Rule: ui-design-guidelines "Show only what exists", "Interaction and keyboard" ("Lists share one key map"). WR-1, WR-3.
  - Locations and current text:
    - `memory/MemoryNoteEditor.tsx:153-162`: label `Body`, description `Markdown. Type {{ to insert design, component, token, asset, or icon references.`, placeholder `Markdown body…`. `memory/MemoryNoteBody.tsx:48-52` renders the body as `whitespace-pre-wrap` text, so `**bold**` shows its asterisks. The description omits `board` and `layer`, which the picker offers (`memory-reference-editor.ts:26-35`).
    - `memory/MemoryReferenceSuggest.tsx:32-62`, `:98-130`: `role="listbox"` options respond to `onMouseDown` only. No arrow or Enter handling exists in the editor.
    - `memory/MemoryNotesDrawer.tsx:26` `aria-label={title}` (the sheet is announced as the project name), `:44` `Close memory drawer`. `memory/MemoryNotesButton.tsx:46` `` `${label} (${count})` ``. `memory/MemoryNotesPanel.tsx:255` `...for this scope.`, `:100` `agent` and `you`.
    - `memory/MemoryNoteEditor.tsx:63`, `:208-216`: `Cancel` carries an `X` icon.
  - Fix: label `Note`, description `Type {{ to reference a design, board, layer, component, token, asset, or icon.`, no placeholder. Either render Markdown or drop the word. Add arrow, Enter, and Escape handling to the picker. Strings: sheet `aria-label={`Notes for ${title}`}`, `Close`, `` `Memory, ${count} ${pluralize(count, "note")}` ``, `Notes record intent, conventions, and decisions for you and for agents.`, `Agent` and `You`.

---

## Files read in full

- `src/components/HomeShell.tsx`, `OpenProjectPanel.tsx`, `CreateProjectPanel.tsx`, `MCPSetupDialog.tsx`, `McpToolSettingsDialog.tsx`, `Root.tsx`, `Project.tsx`, `AppDialogHost.tsx`, `OpenDesignTokensButton.tsx`, `system-attention-toasts.ts`
- `src/main.tsx`
- `src/components/project/`: `AuditLogLink.tsx`, `CommandMenu.tsx`, `CreateSystemDialog.tsx`, `DesignDetailPane.tsx`, `DesignGlyph.tsx`, `Designs.tsx`, `ProjectHeader.tsx`, `ProjectPane.tsx`, `SystemDetailPane.tsx`, `SystemDiffChips.tsx`, `SystemStatusBadge.tsx`, `SystemTokenRows.tsx`, `Systems.tsx`, `project-view-utils.ts`, `useScrollSelectedIntoView.ts`
- `src/components/project/memory/`: all nine files
- Primitives read to confirm root causes: `src/components/ui/text.tsx`, `empty-state.tsx`, `pane-header.tsx`, `metric-card.tsx`, `detail-section.tsx`, `readonly-field.tsx`, `copy-button.tsx`, `kbd.tsx`, `row.tsx`, `alert-dialog.tsx`, the style block of `command.tsx`
- `src/mcp/tool-groups.ts` (labels shown in the MCP tools dialog), `src/utils/readJsonOrThrow.ts`

## Not covered, or covered partly

- `src/queries/projects.ts`, `systems.ts`, `memory.ts`, `mcp-settings.ts`, `config-file.ts`, `audit-log.ts`: searched for user-facing strings, not read line by line. They contain none of their own. Every error goes through `readJsonOrThrow`, so the visible text is the server's `error` field or `Request failed with status N`. The server-side messages (`src/server.ts`, `src/services/`) were not audited.
- `SystemTokenRows.tsx`: read, but its components are consumed by the system editor, not by the project screen, so I left its findings to the system-editor audit (uppercase mono `section-divider`, a chevron disclosure, `More {n}`).
- `OpenDesignTokensButton.tsx` is used by the design editor header and the system editor only. No finding.
- `MCPSetupDialog.tsx`: no finding beyond the title case in PRJ-16.
- Nothing was run. Every finding comes from reading code, so hover, focus, and narrow-width behaviour were not observed.
- Button, Alert, Sheet, Segmented, Badge, Chip, StatusDot, Input, and Dialog primitives were not read in full.
