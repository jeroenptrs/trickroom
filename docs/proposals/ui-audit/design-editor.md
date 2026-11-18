# Design editor audit findings

Scope: `src/components/Design.tsx`, `chrome/`, `stage/`, `annotations/`, the responsive stage files, and the editor strings from hooks, stores, and queries. Audited against `ui-design-guidelines` (UI) and `writing-for-ui` (WUI). Pattern numbers refer to each skill's "Patterns to detect and fix" list. Paths are relative to `src/`.

Counts: 4 high, 17 medium, 10 low.

## High

- **DES-01. Deleting a layer or a board is instant, has no undo, and autosaves after one second.**
  - Severity: high. Confidence: high.
  - Rule: UI "Lists, tables, and cards" (a destructive action never sits in a row menu), UI "Sheets, dialogs, and forms" (undo in the toast for reversible actions, the real dialog otherwise), WUI "Destructive actions", WUI pattern 4.
  - Locations: `components/chrome/LayerContextMenu.tsx:195-200`, `components/chrome/Layers.tsx:1099-1104`, `components/chrome/EditorShell.tsx:40` (`AUTOSAVE_DELAY_MS = 1000`).
  - Current: context menu item `Delete` calls `deleteElement(id)` directly. `Backspace` and `Delete` do the same for the selection. A root layer is a board, so one key press removes a whole board with all of its layers. `stores/design-store.ts` has no undo or history (a search for `undo`, `redo`, and `history` returns nothing), and `docs/user-guide.md:257` tells users a detached annotation reattaches on "undo".
  - Fix: add undo for delete and show a toast `Layer deleted` or `Board deleted` with an `Undo` action. Until undo exists, open `ConfirmationDialog` when the target is a board or has children: title `Delete board {name}`, description `{n} layers are deleted with it. This can't be undone.`, action `Delete board`. Rename the menu item to `Delete layer` (or `Delete board` on a root row).

- **DES-02. A design that fails to load leaves a blank page with a small red label, no retry, and no way back.**
  - Severity: high. Confidence: high.
  - Rule: UI pattern 12 (loading sentence), UI "States" (always a skeleton, every failure keeps a retry), WUI "Errors", WUI pattern 3.
  - Locations: `components/Design.tsx:377-400`.
  - Current: `Missing design id`, `Failed to load design data: {errorMessage}`, `Loading design data...`, each in `absolute left-3 top-3 ... px-2 py-1 text-xs text-white`. The editor shell does not render in these states, so the back button is not on screen. The code carries `// TODO: make isLoading and hasError work with a rendered sidebar and iframe`.
  - Fix: render `EditorShell` in all three states. Loading: skeleton rows in the layers panel and a skeleton board on the stage, toolbar buttons as skeletons. Error: an error state on the stage with title `Could not open this design`, the reason below it, a `Retry` button that calls `designQuery.refetch()`, and `Back to project`. Replace `Missing design id` with a redirect to `/`.

- **DES-03. Save state and save errors are invisible in the default layout, and a failed save has no retry.**
  - Severity: high. Confidence: high.
  - Rule: UI "States" (every failure keeps a retry), WUI "Cutting text must not cut information" (essential detail can't live only in a tooltip), WUI "Errors", WUI pattern 10.
  - Locations: `components/chrome/EditorShell.tsx:146-179`, `components/chrome/EditorShell.tsx:266-272`, `components/chrome/WorkspaceToolbar.tsx:627-635`.
  - Current: `SaveControl` renders only inside the layers rail. A collapsed rail is `className="hidden"`, and the toolbar header that replaces it renders only `<DesignPanelToggle panel="rail" />`. `docs/user-guide.md:93` says the rail starts collapsed, so a new user never sees unsaved, saving, saved, or failed. On failure the control becomes `<span className="truncate text-red-500" title={error}>{error}</span>`, which shows the raw server message (or `Save failed`) truncated in a 264px header, replaces the save button, and pauses autosave until the next edit. Saved and saving are icon-only `<span title="Saved">` and `<span title="Saving">` with no text for screen readers. The save button has `title="Unsaved changes"`, which names a state, not the action.
  - Fix: move the save mutation state to a store and render the indicator in both headers. On failure show `Could not save` with a `Retry` button and put the reason in a popover. Give the idle states screen-reader text (`Saved`, `Saving`). Name the button `Save` with `aria-label="Save (unsaved changes)"`.

- **DES-04. "Extract as {layer name}" does not say that it creates a new design and leaves this one.**
  - Severity: high. Confidence: high for the label, medium for the severity.
  - Rule: WUI "Buttons" (say what happens), WUI "Names", WUI pattern 4.
  - Locations: `components/chrome/LayerContextMenu.tsx:164-176`, `components/chrome/LayerContextMenu.tsx:136-149`.
  - Current: `Extract as {layerName}` sits above `Extract as system component`. The first saves the design, creates a new design file named after the layer, and navigates to `/design/{uuid}`. Nothing in the label mentions a design. The failure text is `Failed to extract layer to a new design.`
  - Fix: `Extract to new design` and `Extract as component` (the glossary noun is Component). Error: `Could not extract {layerName} to a new design` with the reason as description.

## Medium

- **DES-05. Five irreversible actions confirm through `window.confirm`.**
  - Severity: medium. Confidence: high.
  - Rule: UI "Sheets, dialogs, and forms" (open the real confirm dialog with focus on Cancel), WUI "Destructive actions" (confirm buttons name the action), WUI pattern 4.
  - Locations: `components/chrome/LayerContextMenu.tsx:70-72`, `components/chrome/LayerContextMenu.tsx:87-89`, `components/chrome/AttachedComponentProperties.tsx:280-282`, `components/chrome/AttachedComponentProperties.tsx:288-290`, `components/chrome/AttachedComponentProperties.tsx:309-315`.
  - Current: the browser dialog with OK and Cancel, and these texts: `Update the recipe instance containing "{layerName}"? Recipe structure may change while editable settings and slot contents are preserved where possible.`; `Detach the recipe instance containing "{layerName}"? This keeps the layers but removes recipe protection from the whole instance.`; `Reset all overrides for "{componentName}"? This removes all className, text, icon, asset, and prop overrides on this instance.`; `Detach "{componentName}"? This keeps the layers but removes component protection from the whole instance.`; `Update "{componentName}" to version {v}? {n} migration notes may affect authored content.`
  - Fix: use `ConfirmationDialog` from `ui/alert-dialog`, which `AnnotationRoundHeader` already uses. Proposed copy:
    - Title `Detach recipe`, description `The layers stay. They no longer update with the recipe. This can't be undone.`, action `Detach recipe`.
    - Title `Update recipe`, description `The structure can change. Settings and slot content are kept where they still fit.`, action `Update recipe`.
    - Title `Reset overrides`, description `Removes every class, text, icon, asset, and property override on this instance. This can't be undone.`, action `Reset overrides`.
    - Title `Detach {componentName}`, description `The layers stay. They no longer update with the component. This can't be undone.`, action `Detach instance`.
    - Title `Update {componentName} to version {v}`, description `{n} migration notes need review.` or `Structure and settings are kept where they still fit.`, action `Update instance`.

- **DES-06. One thing has several names: layer, element, frame, container, item.**
  - Severity: medium. Confidence: high.
  - Rule: WUI "Names" (one name for one thing), WUI pattern 3, the glossary in `CLAUDE.md`.
  - Locations: `components/chrome/Layers.tsx:1170`, `components/chrome/Layers.tsx:1188`, `components/chrome/Layers.tsx:1198`, `components/chrome/Properties.tsx:743`, `components/chrome/Properties.tsx:745-746`, `components/chrome/AddLayerCommandMenu.tsx:316`, `components/chrome/AddLayerCommandMenu.tsx:336-340`, `components/chrome/AddLayerCommandMenu.tsx:346-348`, `components/chrome/AddLayerCommandMenu.tsx:369`.
  - Current: toolbar titles `Add container`, `Add element`, `Repeat last added item`. Shortcut list `Add frame`, `Add element`, `Repeat last`. Menu `Add layer…`, dialog name `Add layer`, placeholders `Search elements to add…` and `Search library elements…`, empty text `No matching elements.` The home page of the menu lists components and recipes too, so "elements" is wrong there by the glossary.
  - Fix: toolbar titles `Add container (F)`, `Add text (T)`, `Add layer (A)`, `Repeat last layer (.)`. Shortcut list `Add container`, `Add layer`, `Repeat last layer`. Placeholders `Search layers to add…` on the home page and keep `Search library elements…` on the libraries page. Empty text `No matching layers.` on the home page.

- **DES-07. `·` and `—` are used as separators in sixteen strings.**
  - Severity: medium. Confidence: high.
  - Rule: WUI pattern 6.
  - Locations and fixes:
    - `components/chrome/WorkspaceToolbar.tsx:114` `Canvas mode — all boards visible` becomes `Show all boards on a canvas`.
    - `components/chrome/WorkspaceToolbar.tsx:120` `Responsive mode — single board preview` becomes `Preview one board at a set width`.
    - `components/chrome/DesignHeader.tsx:157` `{systemName} · design system` becomes `{systemName} system`.
    - `components/chrome/DesignLintFindings.tsx:69` `{rule} · {location}` becomes two spans with a gap.
    - `components/chrome/DesignLintFindings.tsx:107` `{n} errors · {n} warnings` becomes `{n} errors, {n} warnings`.
    - `components/chrome/classes/ClassCompositionPanel.tsx:21` `Variant · {axis}: {value}` becomes `Variant {axis}: {value}`.
    - `components/annotations/AnnotationRoundHeader.tsx:116-117` `Round · {closed} of {total} closed · {n} waiting on you` becomes `{closed} of {total} closed` plus `, {n} waiting on you` only when n is above zero.
    - `components/annotations/AnnotationEntries.tsx:105` `Changed 3 layers · reverted` becomes `Changed 3 layers (reverted)`.
    - `components/annotations/OtherBranchesSection.tsx:82` `{name} · {branch}`: drop the suffix, because the expanded thread already prints `On branch {branch}` (`AnnotationThread.tsx:318-325`).
    - `components/chrome/AddLayerCommandMenu.tsx:180`, `:477`, `:501`, `:570`: see DES-08.
    - `utils/annotation-presentation.ts` `describeVariantPin` joins with ` · `, shown by `components/annotations/VariantPinChip.tsx:36`. Use `, `.

- **DES-08. The Add layer menu describes items with internal values.**
  - Severity: medium. Confidence: high.
  - Rule: WUI pattern 3 (implementation nouns), WUI pattern 6, UI pattern 20 (monospace for words), UI pattern 7 (icon on every row).
  - Locations: `components/chrome/AddLayerCommandMenu.tsx:121-128`, `components/chrome/AddLayerCommandMenu.tsx:176-200`, `components/chrome/AddLayerCommandMenu.tsx:475-479`, `components/chrome/AddLayerCommandMenu.tsx:501`, `components/chrome/AddLayerCommandMenu.tsx:524`, `components/chrome/AddLayerCommandMenu.tsx:569-571`, `components/chrome/Properties.tsx:170-177` and `:201-203`.
  - Current: the second line of a row is `{definition.role} · {controlKeys.join(", ")}`, for example `branch · className, as`, or the bare word `recipe`, or `{slug} · v{version}`, all in `font-mono text-[10px] text-slate-500`. The same line also carries prose such as `On the selection, or the design` in mono. Group labels read `Your system · {groupPath}`, `Trickroom builtins`, and `{library} · {section.title}` (for example `base-ui · Components`). Every row has the same leading icon per type (`Box`, `Blocks`, `Package`). The inspector header subtitle prints `{library}/{component} / {role}`, for example `trickroom/container / branch`.
  - Fix: second line is `definition.description` (the registry already has `Generic layout and grouping element.`), in the body font. For a system component show `v{version}` at the right, where shortcuts sit. Group labels: `Your system`, `Your system - {groupPath}`, `Built in`, `{Library name} components`, `{Library name} recipes`. Move the type icon to the group label. Inspector subtitle: `{library}/{component}` only.

- **DES-09. Words are set in monospace.**
  - Severity: medium. Confidence: high.
  - Rule: UI pattern 20.
  - Locations: `components/chrome/LayerBreadcrumb.tsx:24` (layer names, `font-mono text-xs text-slate-400`), `components/chrome/DesignConflictDialog.tsx:177` (layer names, `font-mono text-[11px] text-cyan-700`), `components/chrome/DesignLintFindings.tsx:106` (the counts line, `font-mono font-normal text-slate-500`), `components/annotations/AnnotationEntries.tsx:99` (`Changed 3 layers`, `font-mono text-xs text-cyan-700`), `components/annotations/AnnotationEntries.tsx:280` (`Question`, `Reverted a change`, `font-mono uppercase tracking-wider`), `components/chrome/WorkspaceToolbar.tsx:235` (`3 changed`, `font-mono text-[9px] ... uppercase`), `components/chrome/AddLayerCommandMenu.tsx:124` (see DES-08).
  - Fix: remove `font-mono` in each. Keep mono for the lint rule id (`DesignLintFindings.tsx:66`), class names, the slug field, and the template path.

- **DES-10. Hierarchy is built with dimmed colour on values, counts, and headings.**
  - Severity: medium. Confidence: medium (each item is a judgment on "label or meta").
  - Rule: UI pattern 3, UI "Build hierarchy with size, not colour" (a count on a header keeps the default colour, siblings share one styling).
  - Locations:
    - `components/chrome/Properties.tsx:268` tab count `font-mono text-xs text-slate-500`.
    - `components/annotations/OtherBranchesSection.tsx:57` header count `font-normal text-slate-500`.
    - `components/chrome/AttachedComponentProperties.tsx:351-372` the values for Name, Version, Status, Latest, and Modified inherit `text-slate-600` while their labels are `text-slate-700`.
    - `components/chrome/WorkspaceToolbar.tsx:215` the board counter `text-[10px] ... text-slate-600`, and `:464` the active zoom mode `Fit` in `text-slate-400`.
    - `components/chrome/classes/ClassCompositionPanel.tsx:146` and `:164` two sibling group labels, one `text-slate-400` and one `text-cyan-700`.
    - `components/chrome/Layers.tsx:1217` the `Layers` heading in `text-slate-400`.
  - Fix: default ink (`text-slate-950`) for values, counts, and headings, and a smaller size where rank is needed. Give both class group labels the same tone.

- **DES-11. Loading states are sentences, not skeletons.**
  - Severity: medium. Confidence: high.
  - Rule: UI pattern 12.
  - Locations: `components/chrome/AttachedComponentProperties.tsx:560-566` (`Loading component metadata…`), `components/annotations/OtherBranchesSection.tsx:62-63` (`Loading…`), `components/chrome/Properties.tsx:472-473` (`Loading assets`), `components/chrome/Properties.tsx:541-542` (`Loading icons`). `components/Design.tsx:397` is covered by DES-02.
  - Fix: a skeleton of the Component section (four key and value lines and a button row), two skeleton thread rows, and a skeleton block in place of each picker.
  - Also: the pending ellipsis is typed two ways. `Extracting...` (`ExtractSystemComponentDialog.tsx:516`), `Closing...` (`AnnotationRoundHeader.tsx:152`), and `Loading design data...` use three dots. `Loading…` and `Reply…` use the ellipsis character. Use `…` everywhere.

- **DES-12. Failed secondary requests have no retry, and some render as empty.**
  - Severity: medium. Confidence: high.
  - Rule: UI "States" (every failure keeps a retry, a failed secondary request never renders as zero), UI pattern 13 in reverse.
  - Locations:
    - `components/annotations/DesignAnnotationsPanel.tsx:373-377` and `components/annotations/ComponentAnnotationsPanel.tsx:378-382`: `Annotations could not be loaded.` with no reason and no retry.
    - `components/annotations/OtherBranchesSection.tsx:64-67`: `Other branches could not be listed.` with no retry.
    - `components/chrome/DesignLintFindings.tsx:20-26` and `:97`: `useDesignLint` returns only `.data`, so a failed lint request renders nothing, the same as "no system linked".
    - `components/chrome/Properties.tsx:469-475` and `:538-544`: a failed assets or icons request shows the option `No asset` or `No icon`.
    - `components/chrome/useLayerInsertion.ts:250-253` and `:408`: a failed system components request yields `[]`, so the Add layer menu drops the "Your system" group without a word.
    - `components/chrome/AttachedComponentProperties.tsx:156-162`: a failed component request shows `Published component metadata could not be loaded. Check the linked design system, or detach this instance if you need to edit it now.` It offers an irreversible detach as the remedy and no retry.
  - Fix: each gets a one-line error with a `Retry` button that calls `refetch()`. Strings: `Could not load annotations`, `Could not list other branches`, `Could not run lint`, `Could not load assets`, `Could not load icons`, `Could not load your system's components`, `Could not load {componentName}`.

- **DES-13. The extract dialog disables its submit button on field errors and never says which field is wrong.**
  - Severity: medium. Confidence: high.
  - Rule: UI "Sheets, dialogs, and forms" (validate on blur, don't disable submit on field errors), WUI "Disabled states".
  - Locations: `components/chrome/ExtractSystemComponentDialog.tsx:80-103`, `:334-341`, `:348-351`, `:508-517`.
  - Current: `disabled={!canSubmit}` covers an empty name, an invalid slug, no system chosen, and a missing revision. No field shows an error. `handleNameChange` also overwrites the slug on every name keystroke, so a slug the user typed by hand is lost when they touch the name again.
  - Fix: keep the button enabled except while pending. Validate on blur and on submit with field errors: `Enter a name.`, `Use lowercase letters, numbers, and hyphens.`, `Choose a system.` Stop deriving the slug from the name once the user has edited the slug.
  - Copy in the same dialog: label `Target system` becomes `System`. Option `Choose system` becomes `Choose a system`. Checkbox `Replace selection with attached instance` with hint `Publishes the initial version and swaps the selected layer.` becomes `Replace the layer with an instance` with hint `Publishes version 1 of the component.` Placeholders `Optional` move into the labels as `Group (optional)` and `Description (optional)`. Drop the leading `Plus` icon on `Extract component` (`:515`). Error `Component publish did not return a version.` (`:220`) becomes `Could not publish {name}. Try again.`

- **DES-14. The conflict dialog uses git jargon and a vague commit button.**
  - Severity: medium. Confidence: medium.
  - Rule: WUI pattern 3, WUI pattern 4, WUI "Disabled states", WUI "Status text" (names instead of raw ids).
  - Locations: `components/chrome/DesignConflictDialog.tsx:26-29`, `:46-56`, `:203-227`.
  - Current: segment labels `Take theirs` and `Keep mine`, bulk buttons `All theirs` and `All mine`, commit button `Apply`, disabled until every part has a choice with no hint why. `layerNames` falls back to the raw layer id when a layer has no name (`: id` on line 50). The description already calls the other side "the version on disk", so "theirs" has no referent on screen.
  - Fix: `Use disk` and `Keep mine`. Bulk: `Use disk for all` and `Keep all mine`. Commit: `Resolve conflicts`, with `Choose a version for each part.` next to it while it is disabled. Fall back to the element label from the registry (as `getDesignLayerName` does), never the id.

- **DES-15. Keyboard shortcuts and placement modifiers are hard to discover, and the list is incomplete.**
  - Severity: medium. Confidence: high.
  - Rule: UI "Interaction and keyboard" (every shortcut appears in the shortcuts overlay), WUI "Names".
  - Locations: `components/chrome/Properties.tsx:742-756` and `:791-809`, `components/chrome/Layers.tsx:283-289`, `:1057-1118`, `:1165-1201`, `components/chrome/EditorShell.tsx:108`, `:220-256`, `components/chrome/AddLayerCommandMenu.tsx:597-601`, `components/annotations/AnnotationComposer.tsx:185`, `components/annotations/AnnotationThread.tsx:135`.
  - Current: the list shows only in the inspector with nothing selected, and the inspector starts collapsed. It omits `Enter` and `Shift+Enter` (child and parent), `Cmd/Ctrl+K` (command menu), `Cmd/Ctrl+S`, `Cmd/Ctrl+Shift+Up/Down` (move layer), `Alt+1/2/3` (focus a pane), `Cmd/Ctrl+[` (back to project), `Home` and `End`. `Alt` (insert inside) and `Shift` (insert before) change where the add buttons and keys insert, and nothing on screen says so except `Insert after` in the command menu footer. The four add buttons have titles without their keys, while the panel toggles include theirs. The list prints `⌥ [` while the toggle title prints `Alt+[`. It abbreviates `Del` and `Prev layer`. Composer titles hard-code `⌘ Enter` although Ctrl works too.
  - Fix: one shortcuts overlay reachable from the toolbar and the command menu, listing every key above. Add a row `Alt + add: insert inside. Shift + add: insert before.` Put the key in each add button title (see DES-06). Use one notation per platform. Write `Delete` and `Previous layer`.

- **DES-16. Selecting on the stage needs Annotate, and only a tooltip says so.**
  - Severity: medium. Confidence: medium (the naming part is a product call).
  - Rule: WUI "Cutting text must not cut information" (essential detail can't live only in a tooltip), WUI "Names".
  - Locations: `components/chrome/WorkspaceToolbar.tsx:154-171`.
  - Current: a switch labelled `Annotate` with `aria-label="Annotation mode"` and `title` `Annotation mode (⌥ C): click the stage to select, show annotation pins` or `Leave annotation mode (⌥ C) to click and type in the boards`. With the switch off, a click on a board selects nothing, and the tooltip is the only explanation.
  - Fix: add one line to the empty inspector above the shortcut list: `Turn on Annotate to select layers on the stage.` Shorten the titles to `Select layers and show annotation pins (⌥ C)` and `Use the boards as a live page (⌥ C)`. Consider naming the switch for what it enables (`Select`).

- **DES-17. The viewport width field validates on every keystroke and shows its error only in a tooltip.**
  - Severity: medium. Confidence: high.
  - Rule: UI "Sheets, dialogs, and forms" (validate on blur), WUI "Cutting text must not cut information".
  - Locations: `components/chrome/WorkspaceToolbar.tsx:305`, `:338-345`, `:362-377`.
  - Current: `draftError` is computed on each render, so typing `3` on the way to `320` turns the text red at once. The message (`Width must be between {min}px and {max}px.`) goes to `title` and an `sr-only` span. Blur clamps the value without a message.
  - Fix: compute the error on blur and on Enter. Show it as visible text under the field, or keep the clamp and say so: `Width set to {max}px, the maximum.`

- **DES-18. Two primary buttons send the same drafts under different names.**
  - Severity: medium. Confidence: high.
  - Rule: WUI pattern 2 (repeated facts), WUI "Names", UI "Lists, tables, and cards" (one primary action).
  - Locations: `components/annotations/AnnotationRoundHeader.tsx:72-91`, `components/annotations/AnnotationPanelParts.tsx:129-144`, `components/annotations/DesignAnnotationsPanel.tsx:345-357`.
  - Current: `Send round ({n})` (filled) and directly under it `Send all drafts ({n})` (filled). With no board selected, `drafts` and `designDrafts` are the same list, so both buttons do the same thing. In the component editor both always receive the same `drafts`.
  - Fix: keep `Send round ({n})`. Show the second button only when a board is in scope and its drafts are a subset, as outlined `Send this board's drafts ({n})`.

- **DES-19. A round's progress line always shows "0 waiting on you", and closing a round asks for confirmation although nothing is lost.**
  - Severity: medium. Confidence: medium (the confirm is a judgment call).
  - Rule: UI "Chips, badges, and icons" (status at rest), UI pattern 16 (confirm the reversible), WUI pattern 2.
  - Locations: `components/annotations/AnnotationRoundHeader.tsx:116-117`, `:57-60`, `:143-155`.
  - Current: ``{` · ${counts.humanWork} waiting on you`}`` renders for zero. The dialog reads title `Close round`, description `3 annotations stay open. Close the round?`, action `Close round`. The button's own title says `Close the round. The annotations in it keep their status.`, and the next send opens a new round.
  - Fix: show the waiting count only above zero. Drop the dialog and put the fact in the toast: `Round closed, 3 annotations still open`. If the dialog stays, cut the question: `3 annotations stay open.`

- **DES-20. Thread entries show a time without a date.**
  - Severity: medium. Confidence: high.
  - Rule: WUI "Status text" (keep it true), WUI pattern 10 (lost information).
  - Locations: `components/annotations/AnnotationEntries.tsx:18-26`, `:284`.
  - Current: `Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" })`. An entry from last week reads `14:05`, the same as one from today. Annotations persist on disk across days and branches.
  - Fix: time only for today, `Mon 14:05` within a week, and `12 Nov` beyond that. Put the full timestamp in the `title` and in a `<time dateTime>` element.

- **DES-21. All-caps eyebrows and labels that restate what is under them.**
  - Severity: medium. Confidence: medium.
  - Rule: WUI pattern 8 (template chrome), WUI pattern 1 (restated UI).
  - Locations:
    - `components/chrome/WorkspaceToolbar.tsx:578-583`: an `Artifact` eyebrow (`text-[9px] ... uppercase tracking-wider`) with a decorative `▦` glyph above a menu of one or two export items.
    - `components/chrome/Layers.tsx:1214-1220`: `Layers` in `uppercase tracking-wider` above the layer tree.
    - `components/chrome/classes/ClassCompositionPanel.tsx:163-167`: an uppercase `Classes` (or `Instance`) label directly under the section title `Classes` (or `Instance classes`).
    - `components/chrome/Properties.tsx:940-945`: section `Content` holding a field labelled `Content`.
    - `components/annotations/AnnotationThread.tsx:113-137`: label `Reply`, placeholder `Reply…`, button `Reply`.
    - `components/chrome/classes/ClassField.tsx:466`: `variant` in uppercase.
  - Fix: remove the `Artifact` eyebrow and its glyph. Set `Layers` in sentence case at the section-header style used by the inspector. Label the editable class group `This layer` (or `This instance`). Label the text field `Text`. Drop the `Reply…` placeholder.

## Low

- **DES-22. Rounded corners and off-palette focus colours in a square-cornered product.**
  - Severity: low. Confidence: high.
  - Rule: project convention in `CLAUDE.md` ("square corners ... Don't soften it"), UI "Siblings share one styling".
  - Locations: `components/chrome/WorkspaceToolbar.tsx:215` (`rounded bg-white`), `:288` (`size-1.5 rounded-full bg-cyan-700` in the presets menu, while the zoom menu uses a square marker at `:486`), `components/chrome/AttachedComponentProperties.tsx:176` (`rounded border border-amber-200 bg-amber-50/80`), `components/responsive-stage-frame.tsx:379` and `:381` (`rounded`). Focus rings: `components/chrome/Properties.tsx:456` and `:525` and `components/chrome/AttachedComponentProperties.tsx:99` use `focus:inset-shadow-[0_0_0_1px_#67e8f9]`, `components/chrome/DesignSystemPicker.tsx:28` uses `focus-within:inset-shadow-cyan-200`, and every other control uses `inset-shadow-cyan-500`.
  - Fix: remove `rounded` and `rounded-full`. Use `inset-shadow-cyan-500` for all focus rings. The four hand-styled native `<select>` elements belong in one primitive in `src/components/ui/`.

- **DES-23. Icon-only controls rely on `title`, and the tree's expand button has no name.**
  - Severity: low. Confidence: medium (`title` does supply an accessible name in most browsers, but not on touch or keyboard).
  - Rule: WUI "Cutting text must not cut information" (icon-only controls keep an accessible name), WUI pattern 10.
  - Locations: `components/chrome/Layers.tsx:571-581` (the chevron button has no `aria-label`, no `title`, and no `aria-expanded`), `components/chrome/Layers.tsx:1165-1201` (four toolbar buttons, `title` only), `components/chrome/DesignHeader.tsx:162-169` (back button, `title` only), `components/chrome/DesignHeader.tsx:122-132` (rename input without a label), `components/chrome/EditorShell.tsx:162-178` (see DES-03).
  - Fix: `aria-label="Expand {name}"` or `"Collapse {name}"` with `aria-expanded` on the chevron button. Add `aria-label` equal to the title on the others. `aria-label="Design name"` on the rename input.

- **DES-24. Layer row tooltips say "Drag {name}" and use ownership jargon.**
  - Severity: low. Confidence: high.
  - Rule: WUI pattern 1, WUI pattern 3, WUI "Disabled states".
  - Locations: `components/chrome/Layers.tsx:610-618`, `components/chrome/Properties.tsx:930-933`, `components/chrome/AttachedComponentProperties.tsx:456-460`, `:585-588`.
  - Current: `Drag {name}`, `{name} is recipe-owned structure`, `{name} is component-owned structure`. Inspector: `Class editing is locked for component-owned layers. This layer has no published className override.` and `This layer is owned by {name} v{version}. Structural edits are locked; published editable fields appear in their normal tabs.` The inspector has no such tabs.
  - Fix: row title is the full `{name}`. Locked rows: `{name} is part of a recipe and can't be moved` and `{name} is part of {componentName} and can't be moved`. Inspector: `This layer belongs to {componentName}. Its classes can't be changed on an instance.` and `This layer belongs to {componentName} v{version}. You can change only the fields the component exposes.`

- **DES-25. The component section shows status at rest, a raw id, and two sections named "Component".**
  - Severity: low. Confidence: medium.
  - Rule: UI pattern 25, WUI "Status text" (names instead of raw ids), WUI "Names", WUI pattern 4.
  - Locations: `components/chrome/AttachedComponentProperties.tsx:109`, `:135-138`, `:142-146`, `:340-349`, `:357-372`, `components/chrome/Properties.tsx:1060`, `components/chrome/attached-component-inspector.ts:167-187`.
  - Current: a `Status` row that reads `Up to date` in the normal state. `Modified: 2 targets`. A text button `Open`. The option `Unselected`. `This instance references component {instance.componentId}, but that component is not available in the current design system. ...`. The registry element's property controls render under a second section titled `Component`. The warning ends `then update when ready`.
  - Fix: show the Status row only when the status is not `current`. `Overrides: 2`. `Open component`. Option `Default`. `This instance's component is missing from {systemName}. Link the system that has it, or detach the instance.` Title the second section `Element`. End the warning at `Review the migration notes below, then update.`

- **DES-26. The inspector header area changes height between selections.**
  - Severity: low. Confidence: medium.
  - Rule: UI pattern 14.
  - Locations: `components/chrome/LayerBreadcrumb.tsx:17-25`, `components/chrome/Properties.tsx:906-907`, `components/chrome/Layers.tsx:1259-1263`.
  - Current: the breadcrumb returns `null` for a root layer and uses `flex-wrap`, so the tab row sits at a different height for a board, a shallow layer, and a deep layer. The layers panel footer prints the same path a second time (`names.join(" / ")` in `text-[10px] text-slate-400`), next to a tree that already shows it.
  - Fix: one fixed-height breadcrumb line for every selection, with the middle crumbs collapsed when it runs out of room. Remove the layers panel footer.

- **DES-27. Command menu details: centred, wrong footer hint, and one disabled reason for three causes.**
  - Severity: low. Confidence: medium for the position, high for the strings.
  - Rule: UI pattern 23, WUI "Disabled states", WUI "Status text".
  - Locations: `components/chrome/AddLayerCommandMenu.tsx:72`, `:324`, `:419-420`, `:440-441`, `:460-461`, `:502-503`, `:588-591`.
  - Current: `fixed top-24 left-1/2 ... -translate-x-1/2`, also when opened from the `+` button in the layers panel. The footer shows `↵ insert` on the root page, where Enter runs a command. A system component that is disabled because no system is linked or because nothing can be inserted here shows `This recipe slot does not allow that child`. `Cannot insert here` gives no reason.
  - Fix: anchor the menu under the `+` button when the button opened it. Footer on the root page: `↵ run`. Reasons: `Select a container to insert inside it`, `{parent} doesn't take layers of its own`, `This slot doesn't accept {label}`.

- **DES-28. Toasts mix punctuation and error forms, and the extract toast never closes.**
  - Severity: low. Confidence: high.
  - Rule: WUI "Toasts", WUI "Errors", WUI pattern 9, WUI pattern 4.
  - Locations: `components/chrome/WorkspaceToolbar.tsx:531`, `:543-550`, `components/chrome/LayerContextMenu.tsx:79-82`, `components/chrome/AttachedComponentProperties.tsx:325-332`, `components/chrome/useLayerInsertion.ts:365`, `:371-375`, `components/chrome/ExtractSystemComponentDialog.tsx:138-161`, `components/chrome/EditorShell.tsx:150`, `components/annotations/annotation-actions.ts:115-119`, `components/annotations/DesignAnnotationsPanel.tsx:274`, `components/annotations/AnnotationThread.tsx:448-450`.
  - Current and fix:
    - Trailing periods on `Artifact exported.`, `Exported 3 board artifacts.`, `Export failed.`, `No board to export.`, `Updated recipe.`, `Updated {name}.`, `Component extracted.`, while the annotation toasts have none (`Round closed`, `Annotation sent`). Drop the periods from toast titles.
    - `Export failed.` logs the reason to the console only. Use `Could not export {designName}` with the reason as description.
    - `Failed to update recipe.`, `Failed to update component.`, `Failed to add the system component.`, `Save failed` become `Could not update the recipe`, `Could not update {name}`, `Could not add {name}`, `Could not save`.
    - `Artifact exported.` and `Exported 3 board artifacts.` become `Board exported` and `3 boards exported`.
    - The extract toast has `duration: Number.POSITIVE_INFINITY`, a description (`The design now has the attached instance selected.` or `The component draft is ready to edit.`), `Open editor`, and `Stay in design`. Use `Component extracted` with one action `Open component` and the default duration.
    - `Cannot revert: the layers changed since` with description `Changed since: a, b.` becomes `Could not revert` with `These layers changed after it: a, b.`
    - `Saved as a memory note` (toast) and `Saved as memory note` (button) differ by an article. Use `Saved as memory note`.

- **DES-29. Smaller annotation strings.**
  - Severity: low. Confidence: medium.
  - Rule: WUI pattern 4, WUI pattern 12, WUI "Names", UI pattern 25, UI pattern 16.
  - Locations and fixes:
    - `components/annotations/AnnotationThread.tsx:297-301`: every thread row carries a status chip, including `Open` and `Seen`, the normal states. Show the marker alone for those and the word for `Needs input`, `Addressed`, `Proposed`, `Detached`, and `Resolved by agent`. Judgment call.
    - `components/annotations/AnnotationThread.tsx:165-167`: placeholder `Why not?` is the only visible label of the dismiss reason. Use `Reason`.
    - `components/annotations/AnnotationThread.tsx:356`: `Move here` becomes `Move to this branch`.
    - `components/annotations/AnnotationThread.tsx:320-323`: `On branch none` becomes `Not on a branch`.
    - `components/annotations/AnnotationPanelParts.tsx:78-80` and `components/annotations/AnnotationComposer.tsx:171-177`: `Discard` deletes typed text at once. Label it `Discard draft` and show a toast `Draft discarded` with `Undo`.
    - `components/annotations/AnnotationComposer.tsx:185`: `Send it to the agent (⌘ Enter)` becomes `Send to the agent (⌘ Enter)`, with the platform's modifier.
    - `components/annotations/AnnotationPanelParts.tsx:166` and `components/annotations/AnnotationRoundHeader.tsx:130`: `Accept all agent-resolved ({n})` becomes `Accept all resolved by agent ({n})`, matching the state label.
    - `components/annotations/AnnotationEntries.tsx:182`: the Details list prints `{operation.operation}: ...`, for example `updateElementProps: ...`. Print the summary alone.
    - `utils/annotation-presentation.ts` `describeAnnotationActor`: `Agent 1a2b3c4d` shows a session id fragment. Use `Agent`, and add the fragment only when two agents wrote in one thread.

- **DES-30. Four names for "no system linked", and the icon picker lists ids.**
  - Severity: low. Confidence: high.
  - Rule: WUI "Names", WUI "Status text" (names instead of raw ids).
  - Locations: `components/chrome/DesignSystemPicker.tsx:16` (`No systems configured`), `:32` (`(unlinked)`), `components/chrome/DesignHeader.tsx:158` (`No design system`), `components/chrome/Properties.tsx:471` and `:540` (`No linked system`), `components/chrome/Properties.tsx:545-549` (`{icon.id}` as the option text, while the preview above prints `selectedIcon?.name` and the asset picker lists `asset.name`).
  - Fix: `No system` in the header, the picker option, and both resource pickers. `No systems in this project` for the empty picker. List `icon.name` in the icon picker.

- **DES-31. Stage strings and small layout items.**
  - Severity: low. Confidence: medium.
  - Rule: WUI pattern 3, WUI pattern 2, WUI pattern 8, UI pattern 7, UI "States", UI pattern 26.
  - Locations and fixes:
    - `components/stage/MissingRenderer.tsx:52`: `No renderer for {library}/{component}` becomes `Unknown element {library}/{component}`.
    - `components/responsive-stage-frame.tsx:373-377`: `Preview 67%` next to the width repeats the zoom that the toolbar shows as `Fit 67%`. Remove it.
    - `components/responsive-stage-frame.tsx:370`, `:460`, `:464`: one control is called `viewport width` and `responsive frame`. Use `Resize viewport width` and `Resize viewport width from the {side} edge`.
    - `components/chrome/classes/ClassField.tsx:367-369` and `components/chrome/classes/ClassCompositionPanel.tsx:75`: the fix link reads `→ {suggestion}` or `remove`. Use `Replace with {suggestion}` and `Remove`.
    - `components/chrome/WorkspaceToolbar.tsx:282`: a device icon leads every preset row. Remove it.
    - `components/chrome/WorkspaceToolbar.tsx:142`, `:235`, `:262`, `:399`, `:459`, `:566`: sibling toolbar buttons use 11px, 10px, and 9px text. Use one size.
    - `components/chrome/Layers.tsx:1223-1258` and `components/chrome/WorkspaceToolbar.tsx:218`: a design with no boards shows an empty tree and an empty stage. `No boards` appears only in responsive mode. Add an empty state: `No boards yet` with the action `Add a board`.
    - `components/chrome/Layers.tsx:678-695`: the `Resolved` toggle in the Layers header controls annotation visibility on the rail, the stage, and the Annotations tab. Label it `Resolved annotations` or move it to the Annotations tab. Judgment call.
    - Dark mode: no file in scope has a `dark:` class. `components/ui/dialog.tsx:7` and `components/ui/alert-dialog.tsx:11` do (`dark:opacity-70`). If a dark theme is planned, every colour here needs a twin. If not, remove the two stray variants in the primitives. Low confidence, product decision.

## Coverage

Read in full:

- `components/Design.tsx`, `components/EditorChannel.tsx`, `components/responsive-stage-frame.tsx`
- `components/chrome/`: `WorkspaceToolbar.tsx`, `EditorShell.tsx`, `DesignHeader.tsx`, `DesignConflictDialog.tsx`, `LayerContextMenu.tsx`, `DesignLintFindings.tsx`, `Layers.tsx`, `Properties.tsx`, `AddLayerCommandMenu.tsx`, `ExtractSystemComponentDialog.tsx`, `AttachedComponentProperties.tsx`, `useLayerInsertion.ts`, `TextareaControl.tsx`, `DesignSystemPicker.tsx`, `LayerBreadcrumb.tsx`, `attached-component-inspector.ts`, `classes/ClassCompositionPanel.tsx`, `classes/ClassField.tsx`
- `components/stage/`: `MissingRenderer.tsx`, `Artboards.tsx`, `StageAnnotationPins.tsx`, `StageChangeHighlight.tsx`, `StageFocusHighlight.tsx`, `StageSelectionLayer.tsx`, `Canvas.tsx`
- `components/annotations/`: `AnnotationThread.tsx`, `DesignAnnotationsPanel.tsx`, `ComponentAnnotationsPanel.tsx`, `annotation-actions.ts`, `AnnotationRoundHeader.tsx`, `AnnotationPanelParts.tsx`, `AnnotationComposer.tsx`, `AnnotationEntries.tsx`, `useDesignAnnotationCommands.tsx`, `VariantPinChip.tsx`, `OtherBranchesSection.tsx`
- `utils/annotation-presentation.ts`, `stores/annotation-mode-store.ts`

Searched for user-facing strings and read the matching sections only (logic files with no markup):

- `components/responsive-stage-context.ts`, `components/responsive-stage-zoom.ts`
- `components/stage/stage-annotation-pins.ts`, `stage-interaction.ts`, `stage-overlay.ts`, `stage-selection-overlay.ts`, `stage-selection-sources.ts`, `board-sizing.ts`, `class-merge-context.ts`
- `components/chrome/classes/classField.ts`, `classInventory.ts`, `components/chrome/useLayerSelectionReveal.ts`
- `components/annotations/design-annotation-navigation.ts`, `design-annotation-pins.ts`, `component-annotation-pins.ts`
- `hooks/useDesignLiveSync.ts`, `useDesignDeepLink.ts`, `useEditorFocusRequests.ts`, `useCompiledTailwind.ts`, `useAnnotationLiveSync.ts`, `useExternalChangeMarkers.ts`, `useTailwindSyncController.ts`
- all of `stores/`, `queries/design-file.ts`, `design-save.ts`, `design-lint.ts`, `design-live-events.ts`, `annotations.ts`

The toasts in those files passed: `That layer is not in this design`, `That board is not in this design`, `An agent wanted to show you another design`, `Those layers are no longer in the design`, `No open annotations in this design`, and the Tailwind module warning.

Not covered:

- Nothing was rendered. Every finding comes from the code, so contrast, truncation with long names, and narrow widths are unverified.
- The ui primitives the editor uses (`layer-tree`, `annotation-marker`, `command`, `tabs`, `alert`, `alert-dialog`, `segmented`, `chip`, `kbd`) were opened only to confirm a class or a prop. Another agent covers them.
- `components/OpenDesignTokensButton.tsx` and `preview/stage-preview-dark-mode.tsx` render inside the editor but sit outside the listed scope. I checked only their titles.
- Registry labels and descriptions for the Add layer menu: I sampled `libraries/trickroom/registry.ts` only. The `base-ui` and `charts` registries and `src/recipes/` are unread.
- Server error messages that the editor passes through verbatim (`error.message` in toasts, dialogs, and the save control) were not traced to their source.
