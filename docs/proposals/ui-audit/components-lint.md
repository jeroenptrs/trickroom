# Findings: component authoring and lint dashboard

Scope: `src/components/system-editor/` component authoring files, `SystemEditorLintPanel.tsx`, `lint/`, and the strings they surface from queries, stores, and `src/lint/`.
Rules cited as `ui` (ui-design-guidelines) or `writing` (writing-for-ui) plus the pattern number or section name.
Paths are relative to `/root/workspace/trickroom`.

Not flagged on purpose: square corners where they exist, the slate and cyan palette, mono for slugs, paths, rule ids, class names, hashes, and numbers. The app has no dark theme (6 `dark:` classes in all of `src`), so `ui` 26 (missing dark twin) does not apply to this scope.

## High

- **CMP-01. A draft conflict leaves no way forward except discarding.**
  - Severity: high. Confidence: high.
  - Rule: `ui` "Show only what exists" (never let the UI claim something the system does not do), `writing` "Errors" (say how to fix it), `writing` "Disabled states".
  - Locations: `src/components/system-editor/useSaveComponentDraft.ts:233-238` (`canSave` is false whenever `draftConflict` is set), `src/components/system-editor/useSaveComponentDraft.ts:129-131` (dead branch that would have allowed a variants-only save), `src/components/system-editor/SystemEditorComponentsPanel.tsx:330-331`, `src/components/system-editor/useGuardedComponentLocation.tsx:181`. The message itself is set in `src/components/system-editor/SystemEditorInspector.tsx:913` and `:1066` (other agent's file).
  - Current: status line `"Server draft changed"`; message `"Component draft changed on the server while local edits are unsaved. Save or reload before continuing."`
  - Problem: the message tells the user to save or reload. **Save draft** is disabled in that state, Mod+S is blocked, the guard dialog's **Save** is disabled, and there is no reload control anywhere in the system editor (`grep -i reload` finds only the two strings). The only exit is to navigate away and choose **Discard changes**. An agent editing the same draft over MCP triggers this, which is a core workflow.
  - Fix: add a **Reload draft** button next to the message that discards local edits and rehydrates from disk. Let `canSave` stay true when only variants are dirty, as line 129 intends. Replace the strings with `"Draft changed on disk"` (status line) and `"This draft changed on disk while you were editing. Reload it to drop your edits."` Trickroom is local-first, so "server" is an implementation noun (`writing` 3).

- **CMP-02. The unsaved-draft guard asks about discarding but its primary button saves.**
  - Severity: high. Confidence: high.
  - Rule: `writing` "Destructive actions" (confirm buttons name the action), `writing` 4, `ui` "Sheets, dialogs, and forms" (mutually exclusive actions sit side by side as one choice), `writing` "Disabled states".
  - Location: `src/components/system-editor/useGuardedComponentLocation.tsx:176-215`.
  - Current: `title="Discard unsaved changes?"`, `description="The open component has changes that are not saved. Save them before leaving it, discard them, or stay here."`, `actionLabel` `"Save"`, default cancel label `"Cancel"`, and a separate **Discard changes** button rendered in the body above the footer.
  - Problem: a user who reads the title and clicks the filled button saves, which is the opposite of what the title asks. The three choices are split over two rows. When `canSave` is false (invalid variants, missing root layer, conflict) **Save** is disabled with no reason shown.
  - Fix: title `"Save changes before leaving?"`, description `"This component has unsaved changes."`, footer with three buttons in one row: `"Keep editing"` (cancel), `"Discard changes"` (warning), `"Save draft"` (primary, pending label `"Saving"`). When `canSave` is false, show the reason above the footer, for example `"Fix the variant errors to save."` The fix needs a third footer slot in `ConfirmationDialog` (`src/components/ui/alert-dialog.tsx`), so part of it belongs in the primitive.

- **CMP-03. The Design map and finding locations show boards and elements by raw id.**
  - Severity: high. Confidence: high (the report type documents `board` as "Board id"; `docs/lint.md` shows `board 2c52f606-…`).
  - Rule: `writing` "Status text" (show names instead of raw ids), `ui` "Show only what exists".
  - Locations: `src/components/system-editor/lint/lint-dashboard-model.ts:436-437` (`name: entry.board`), `:635-642` (`formatFindingLocation`), `src/components/system-editor/lint/LintFindingsView.tsx:239` (filter chip), `src/components/system-editor/lint/LintRailAndInspector.tsx:305-313` (Board, Element, Path fields), `:563-566`, `src/components/system-editor/lint/LintRailAndInspector.tsx:462` (`{component.slug} · {component.componentId}`).
  - Current: design ids are resolved to names through `useDesignNames`, but each board row in the heat map is labelled with its UUID, and a finding location reads `Design name › <board uuid> › <element uuid> › boards[2].children[2]…`.
  - Fix: resolve board names (and layer names for elements) the way design names are resolved, or write them into the report rows. Keep the ids in the `title` only. Drop `componentId` from the component inspector subtitle (`ui` 19, nobody pastes it).

- **CMP-04. Deleting a layer removes its whole subtree with no undo and no confirmation.**
  - Severity: high. Confidence: medium (no undo or history exists in `src/stores/component-draft-store.ts`; I did not run the app).
  - Rule: `ui` "Lists, tables, and cards" (a destructive action never sits in a row or card menu), `writing` "Destructive actions" (for a reversible action, offer undo).
  - Locations: `src/components/system-editor/DraftLayerContextMenu.tsx:26-31`, `src/components/system-editor/ComponentDraftLayers.tsx:1019-1024` (Backspace and Delete).
  - Current: the context menu's only item is `Delete`. Backspace on a selected layer does the same. The only recovery is discarding every unsaved change of the draft.
  - Fix: add undo to the draft store and bind Mod+Z, then keep the delete unconfirmed. Label the item `"Delete layer"`. A context menu with one destructive item should also carry the safe actions (rename, add inside).

## Medium

- **CMP-05. Delete component is a one-click row action behind `window.confirm`.**
  - Severity: medium. Confidence: high.
  - Rule: `ui` "Lists, tables, and cards" (destructive action in a row; rows keep at most one inline action), `writing` 4 (the native dialog's buttons are OK and Cancel), `writing` "Destructive actions".
  - Locations: `src/components/system-editor/SystemEditorComponentsPanel.tsx:858-862`, `:931-945`.
  - Current: `` `Delete "${component.name}" and all published versions? This cannot be undone.` `` and `` `Delete "${component.name}"? This cannot be undone.` ``
  - Problem: every row carries a trash button. The confirm does not say how many Instances in Designs use the component, although `usageByComponent` already holds the count.
  - Fix: move delete to the component's Settings tab as a danger zone. Use `ConfirmationDialog` with `tone="destructive"`, title `` `Delete ${name}?` ``, body `` `${n} instances in designs use this component. Deleting it removes all published versions and can't be undone.` `` (omit the first sentence when `n` is 0), confirm button `"Delete component"`.

- **CMP-06. Component rows carry two status badges at rest, with rounded corners and hand-rolled styling.**
  - Severity: medium. Confidence: high.
  - Rule: `ui` 25 (status badge at rest), `ui` "Chips, badges, and icons" (keep chip metrics identical, pick appearance by meaning), project convention (square corners, variants live in `src/components/ui/`).
  - Locations: `src/components/system-editor/SystemEditorComponentsPanel.tsx:125`, `:133`, `:141`, `:150`, `:158`, `:166`, `:174`, `:181`, `:397`, `:405`, `:412`; rendered at `:905-913` and in the header at `:461`.
  - Current: eleven copies of `<span className="rounded bg-…-100 px-1.5 py-0.5 text-[10px] font-medium text-…">`. A healthy component shows `3 current` (emerald) and `Published v2` (sky). Sky is outside the slate and cyan palette.
  - Fix: use the `Badge` primitive (`edge="stamped"`, square). Show a badge only for the abnormal states: unpublished, stale instances, broken instances, a draft ahead of the published version. Render the normal case as plain meta text, for example `v2, 3 instances`.

- **CMP-07. Usage badge wording misleads.**
  - Severity: medium. Confidence: medium (judgment on what `hasDiagnosticsMissing` means to a user).
  - Rule: `writing` 3 (implementation nouns), `writing` "Status text" (keep it true), `ui` 12.
  - Locations: `src/components/system-editor/SystemEditorComponentsPanel.tsx:134`, `:142`, `:151`, `:159`, `:167`, `:175`, `:182`, `:398`, `:413`.
  - Current: `"Diagnostics missing"` (set when an instance points at an unknown component or version, has a malformed marker, or its design could not be read, lines 641-661), `"{n} review"`, `"{n} stale"`, `"{n} current"`, `"Checking usage"`, `"Usage unavailable"`, `"No usages"`, `"Draft over v2"`, `"Draft only"`.
  - Fix: `"Diagnostics missing"` becomes `"Broken instances"`. `"{n} review"` becomes `"{n} changed"` (hash mismatch). `"{n} stale"` becomes `"{n} outdated"`. `"No usages"` becomes `"Unused"`. `"Draft over v2"` becomes `"Draft, v2 published"`. `"Draft only"` becomes `"Not published"` and the separate `"Not published"` usage badge at line 126 goes (the same fact twice on one row, `writing` 2). Replace `"Checking usage"` with a skeleton chip. `"Usage unavailable"` needs a retry (see CMP-10).

- **CMP-08. Two stage states name an action the screen does not offer.**
  - Severity: medium. Confidence: high.
  - Rule: `writing` "Empty states" (point to the next action), `writing` "Errors".
  - Locations: `src/components/system-editor/ComponentDraftStage.tsx:368-374`, `:376-387`, `src/components/system-editor/ComponentDraftLayers.tsx:1088`, `src/components/system-editor/SystemEditorComponentsPanel.tsx:341`.
  - Current: `"This component does not have a draft."` with footer status `"No draft available"`. The action that fixes it (**Create draft from published version**) exists only as a pencil icon in the list the user just left. Second state: `"Unsaved draft is still open"` and `"Save or reload the current draft before editing this component."` with no button, and `"Unsaved draft open."` in the Layers tab.
  - Fix: first state `` `Published as v${version}. No draft yet.` `` with a `"Create draft"` button that runs `copyPublishedMutation`. Second state `"Another component has unsaved changes."` with buttons `"Go to that component"` and `"Discard its changes"`.

- **CMP-09. Loading sentences instead of skeletons.**
  - Severity: medium. Confidence: high.
  - Rule: `ui` 12.
  - Locations: `src/components/system-editor/SystemEditorComponentsPanel.tsx:992` (`"Loading components..."`), `:339-340` (`"Loading draft"`), `src/components/system-editor/ComponentDraftStage.tsx:348` (`"Loading component draft..."`), `src/components/system-editor/SystemEditorLintPanel.tsx:239` (`"Loading lint.json…"`), `:242` (`"Loading the lint report…"`), `src/components/system-editor/lint/LintRailAndInspector.tsx:123` (`"Loading…"`), `src/components/system-editor/ComponentDraftProperties.tsx:196`, `:241` (`"Loading assets"`, `"Loading icons"` as select options).
  - Problem: the lint header also renders a live **Run lint** button beside the loading sentence, and the rail renders live nav rows with empty counts.
  - Fix: skeleton rows for the component list, a skeleton board on the stage, skeleton metric cards and table rows for the lint views, and a skeleton in place of the run button until the report query settles.

- **CMP-10. Failures without a retry, and one that hides the component list.**
  - Severity: medium. Confidence: high.
  - Rule: `ui` "States" (every failure keeps a retry; a failed secondary request never hides the main content), `writing` 5.
  - Locations: `src/components/system-editor/SystemEditorComponentsPanel.tsx:997-1010` (`"Failed to load components"`), `:139-145` (`"Usage unavailable"` on every row), `src/components/system-editor/ComponentDraftStage.tsx:353-366` (`"Failed to load component draft"`), `src/components/system-editor/SystemEditorLintPanel.tsx:236-237` (bare `{error.message}` for the config view).
  - Fix: add a `"Retry"` button calling `refetch()` to each. Strings: `"Could not load components"`, `"Could not load this draft"`, `"Could not load lint.json"` followed by the reason. Show the usage failure once above the list with its retry, not as a badge on every row.

- **CMP-11. The inspector calls a Layer a "node".**
  - Severity: medium. Confidence: high.
  - Rule: `writing` "Names" (one name for one thing), `writing` 3, glossary (Layer, Slot).
  - Locations: `src/components/system-editor/ComponentDraftProperties.tsx:795` (`"Node"`), `:799` (`"Select a layer or stage node to edit its properties."`), `:581`, `:588-590`, `:595-596`, `:601`, `:660` (`"This node is not a slot host."`), `:647` (`"Host path: {slot.hostPath}"`), `:763` (`"This node is not an override target."`), `:685` (`"Target id"`), `:704` (`"Capabilities"`), `:712` (`"Registry props"`). The layer tree's own badge at `src/components/system-editor/ComponentDraftLayers.tsx:635` says "this layer".
  - Fix: header `"Layer"`; empty text `"Select a layer to edit it."`; `"Keep this layer and its children out of generated code"`; `"Shown in designs. Left out of generated code, with its children."`; `"Turn on for layers that exist only in designs."`; `"Also set on this layer."`; `"Not a slot."` with button `"Make slot"`; `"Not an override target."` with button `"Make override target"`; `"Registry props"` becomes `"Overridable props"`. Remove the `Host path` line or move it to a tooltip (`ui` "an identifier earns a row only when people paste it").

- **CMP-12. The layer picker calls library Elements "components" and shows registry internals.**
  - Severity: medium. Confidence: high.
  - Rule: `writing` "Names", `writing` 3, glossary (Library, Element versus Component).
  - Locations: `src/components/system-editor/ComponentDraftLayers.tsx:1142` (`title="Add component"`), `:1163` (`placeholder="Search components"`, identical to the component list search at `SystemEditorComponentsPanel.tsx:1124`), `:1167` (`Insert {after|before|inside|root}` in mono), `:1180` (raw registry id as the library label), `:1186` (`"Components"`), `:1218` (`{item.role}`, values such as `leaf`), `:1153` (`"Repeat last added item"`), `src/components/system-editor/ComponentDraftProperties.tsx:902` (section `"Component"` for an Element's props).
  - Fix: `"Add element"`, `"Search elements"`, heading `"Elements"`, `"Repeat last layer"`. Show `item.description` under the label and drop `item.role`. Placement line in the body font: `"Adds after the selection"`, `"Adds before the selection"`, `"Adds inside the selection"`, `"Adds as the root layer"`. Section title `"Props"`.

- **CMP-13. The lint page has the same six views in the rail and in a tab bar, under the system editor's own tabs.**
  - Severity: medium. Confidence: high.
  - Rule: `ui` 24 (stacked navigation), `writing` 2.
  - Locations: `src/components/system-editor/lint/LintRailAndInspector.tsx:83-99`, `src/components/system-editor/SystemEditorLintPanel.tsx:367-392` (both `aria-label="Lint views"`), with the shell tabs at `src/components/SystemEditor.tsx:190-202` directly above the rail list.
  - Fix: keep the rail list as the only navigation and drop the tab bar, or keep the tabs and use the rail for the report summary only. The counts then appear once.

- **CMP-14. The lint header carries an eyebrow, a metadata line, and status badges that repeat elsewhere.**
  - Severity: medium. Confidence: high.
  - Rule: `ui` "Keep headers lean", `ui` 25, `ui` 19, `writing` 6, `writing` 8, `writing` 2.
  - Locations: `src/components/system-editor/SystemEditorLintPanel.tsx:326-328` (eyebrow `"Design system"`, dimmed to `text-slate-400`), `:331` (`{systemName} Lint`), `:334-340` (badge `pass`), `:342-350` and `:395-401` (Stale badge plus stale alert), `:352-363`; `src/components/system-editor/lint/LintRailAndInspector.tsx:101-120` (pass badge, Stale badge, `generated …` again); `src/components/system-editor/lint/LintAdherenceView.tsx:36-41` (`Ratchet pass`).
  - Current: `generated 3h ago · 34 components · 484 files scanned · lint.json · sha256:abcdef0…`
  - Problem: on a passing report the Adherence view shows `pass` three times. A stale report says so three times. The meta line uses `·`, sets words in mono, and shows a truncated hash nobody pastes. "484 files scanned" repeats on the Code card (`LintAdherenceView.tsx:147-150`).
  - Fix: remove the eyebrow. Title `` `${systemName} lint` ``. Show a badge only for `Failed`; keep the stale alert (it carries the action) and drop both Stale badges. Reduce the meta line to `` `Run ${relativeTime}` `` in the body font and move the rest behind an info button. Remove the rail's report block. Show the ratchet card only when it failed or on the first run.

- **CMP-15. Words set in the mono font across the lint dashboard and the draft footer.**
  - Severity: medium. Confidence: medium. Mono section headers are baked into the `Text` primitive (`src/components/ui/text.tsx:41-43`, variants `eyebrow` and `section-header`: `font-mono … lowercase`), so this may be deliberate house style. The fix belongs in the primitive.
  - Rule: `ui` 20, `ui` "Build hierarchy with size, not colour" (siblings share one styling).
  - Locations: section headings through `SectionHeading` (`src/components/system-editor/lint/LintParts.tsx:121`, `:146`); table heads `src/components/system-editor/lint/LintCoverageView.tsx:190`, `src/components/system-editor/lint/LintAdherenceView.tsx:228`, `src/components/system-editor/lint/LintHeatMapView.tsx:286`; word values `LintAdherenceView.tsx:113-115` (`not tracked`), `:276-278` (`clean`), `:305-307` (`disabled in lint.json`), `LintCoverageView.tsx:123-125` (`unknown`), `:175-188` (legend), `:243-245` (`none`); `LintRailAndInspector.tsx:117-119`, `:236`; `src/components/system-editor/lint/LintFindingsView.tsx:94`; `src/components/system-editor/SystemEditorLintPanel.tsx:122`; `src/components/system-editor/SystemEditorComponentsPanel.tsx:328` (`"Unsaved changes"`, `"Draft saved"` and the other status words); `src/components/system-editor/ComponentDraftLayers.tsx:1166`. The `Badge` primitive is mono too (`src/components/ui/badge.tsx`), which sets `Not published`, `Design only`, and `Regressed` in mono.
  - Problem: the component editor uses sans, uppercase, dimmed labels for the same role (`ComponentDraftLayers.tsx:1084`, `:1098`, `ComponentDraftProperties.tsx:425`, `:510`, `AuthoredCompoundsList.tsx:81`, `SystemEditorComponentsPanel.tsx:961`), so the two halves of one editor disagree.
  - Fix: one section-label style in the body font for both. Keep mono for rule ids, slugs, paths, metric keys, and numbers.

- **CMP-16. `text-slate-400` on white for text that carries information.**
  - Severity: medium. Confidence: high. The `Text` primitive's own doc comment reserves slate-400 for dark surfaces and names slate-500 the quietest readable tone (`src/components/ui/text.tsx:17-24`).
  - Rule: `ui` 3 (only labels and meta may dim).
  - Locations: `src/components/system-editor/SystemEditorComponentsPanel.tsx:456` (slug under the name), `src/components/system-editor/ComponentDraftProperties.tsx:542` (inspector subtitle), `:510`, `src/components/system-editor/ComponentDraftLayers.tsx:1084`, `:1098`, `:1185`, `:1189` (`No matches`), `src/components/system-editor/SystemEditorLintPanel.tsx:326`, `src/components/system-editor/lint/LintParts.tsx:171-177` (zero counts), `src/components/system-editor/lint/LintAdherenceView.tsx:113`, `:276`, `:302-306`, `src/components/system-editor/lint/LintCoverageView.tsx:123`, `:243`, `src/components/system-editor/lint/LintHeatMapView.tsx:112`, `:128`, `src/components/system-editor/lint/LintConfigEditor.tsx:333`, `:371`.
  - Fix: `text-slate-500` for meta, default ink for values. A zero count is a value, so it keeps the default colour. Also `LintAdherenceView.tsx:267` dims a severity badge with `opacity-50`; use the neutral badge tone.

- **CMP-17. The coverage table repeats each row's state as up to five warning badges.**
  - Severity: medium. Confidence: high.
  - Rule: `ui` 6 (badge city), `writing` 2.
  - Location: `src/components/system-editor/lint/LintCoverageView.tsx:238-257`.
  - Current: the `states` column shows the five `P G B A D` cells, each with a tooltip. The `gaps` column then repeats every gap as a badge (`Not published`, `Not generated`, `Unbound`, `Unused in app`, `Unused in designs`), in a 14rem column that wraps.
  - Fix: drop the gaps column. The strip encodes it, the filter isolates it, and the inspector explains it with the hint.

- **CMP-18. Rule toggles are switches inside a form that needs Save.**
  - Severity: medium. Confidence: high for the lint config, low for the second location.
  - Rule: `ui` "Sheets, dialogs, and forms" (a switch applies at once; a checkbox submits with the form).
  - Locations: `src/components/system-editor/lint/LintConfigEditor.tsx:363-369`; also `src/components/system-editor/ComponentDraftProperties.tsx:571-584` (Design only, persisted by **Save draft**).
  - Fix: use a checkbox for `Enable {rule}` in the lint config.

- **CMP-19. Error strings use "Failed to" and internal nouns.**
  - Severity: medium. Confidence: high.
  - Rule: `writing` "Errors", `writing` 3.
  - Locations and replacements:
    - `src/components/system-editor/SystemEditorComponentsPanel.tsx:737`, `:776`, `:819` `"Component manifest revision is not loaded yet."` becomes `"Components are still loading. Try again."`
    - `:252` `"Select a component draft before publishing."` becomes `"Open a draft to publish."`
    - `:255` `"Save the draft before publishing this version."` becomes `"Save the draft before publishing."`
    - `:258` `"There are no draft changes to publish."` becomes `"Nothing to publish."`
    - `:261` `"Resolve variant diagnostics before publishing."` becomes `"Fix the variant errors before publishing."`
    - `:266` `"Resolve validation diagnostics before publishing."` becomes `"Fix the draft's errors before publishing."`
    - `:279` `"Failed to publish component draft."` becomes `"Could not publish the draft."`
    - `:756` `"Failed to create component draft."` becomes `"Could not create the component."`
    - `:780` `` `Component "${component.name}" already has a draft. Select the draft instead.` `` becomes `` `${component.name} already has a draft. Open it instead.` ``
    - `:800` `"Failed to create draft from published version."` becomes `"Could not create the draft."`
    - `:829` `"Failed to delete component."` becomes `"Could not delete the component."`
    - `src/components/system-editor/useSaveComponentDraft.ts:73` `"Select a component draft before saving."` becomes `"Open a draft to save."`
    - `:81` `"Component name is required."` becomes `"Enter a component name."`
    - `:85` `"Component slug is required."` becomes `"Enter a slug."`
    - `:89` `"Component slug must use lowercase alphanumeric segments separated by hyphens."` becomes `"Use lowercase letters, numbers, and hyphens in the slug."`
    - `:93` `"Resolve variant diagnostics before saving."` becomes `"Fix the variant errors before saving."`
    - `:99` `"The open draft no longer matches the selected component. Reload the component before saving."` becomes `"The open draft belongs to another component. Open that component to save it."`
    - `:181` `"Failed to save component draft."` becomes `"Could not save the draft."`
    - `src/stores/component-draft-store.ts:212`, `:259` (`"Cannot serialize missing component draft node: …"`, `"Cannot serialize component draft without a root template."`) reach the save error card verbatim; map them to `"Add a root layer before saving the draft."`
  - Also: name and slug errors appear only in the footer card far from the fields (Settings tab). Show them on the field, on blur.

- **CMP-20. Controls without a usable accessible name or state.**
  - Severity: medium. Confidence: high.
  - Rule: `writing` 10 and "icon-only controls keep an accessible name".
  - Locations:
    - `src/components/system-editor/ComponentDraftLayers.tsx:585-596`: the expand toggle has no name and no `aria-expanded`. Add `` aria-label={`${open ? "Collapse" : "Expand"} ${layer.name}`} `` and `aria-expanded={open}`.
    - `src/components/system-editor/ComponentDraftLayers.tsx:1103-1156`, `src/components/system-editor/AuthoredCompoundsList.tsx:111-120`, `:143-152`, `src/components/system-editor/lint/LintConfigEditor.tsx:187-198`, `:501-509`, `src/components/system-editor/SystemEditorComponentsPanel.tsx:440-448`: icon-only buttons named through `title` only. Add `aria-label` (and use the project tooltip).
    - `src/components/system-editor/SystemEditorComponentsPanel.tsx:921-928`, `:937-944`: `aria-label` overrides the `sr-only` text, so `"Creating draft"`, `"Edit draft"`, and `"Deleting"` are never announced, and `"Edit draft"` contradicts `"Create draft from published version"`. Remove the `sr-only` spans and set `aria-busy`.
    - `src/components/system-editor/ComponentDraftLayers.tsx:605`: `` title={`Drag ${layer.name}`} `` on every row is noise; remove it.
    - `src/components/system-editor/ComponentDraftLayers.tsx:1160-1165`, `src/components/system-editor/SystemEditorComponentsPanel.tsx:1130-1142`: inputs named by placeholder only. Add `aria-label="Search elements"` and `aria-label="New component name"`.
    - `src/components/system-editor/ComponentDraftProperties.tsx:89-101`: the selected option is shown by colour only. Add `aria-pressed`.
    - `src/components/system-editor/lint/LintHeatMapView.tsx:297`: `role="tree"` wraps plain buttons with no `treeitem` or `aria-level`. Add them or drop the role.

- **CMP-21. Copy announces design-side lint as a future feature.**
  - Severity: medium. Confidence: medium (`docs/lint.md` documents shipped design rules; `summary.design` is null only for reports written without them).
  - Rule: `ui` "Show only what exists" (no placeholder cards, no claims the system does not match), `ui` 1.
  - Locations: `src/components/system-editor/lint/LintAdherenceView.tsx:180-190` (`"Not available yet"`, `"This report has no design-side results. They appear here once design rules run as part of lint."`), `src/components/system-editor/lint/LintHeatMapView.tsx:423-427` (`"No design-side results yet"`, `"This report covers the code side only. Per Design and board usage and findings appear here once design rules run as part of lint."`), `src/components/system-editor/lint/lint-dashboard-model.ts:228` (`"This report has no design-side results yet."`), `src/components/system-editor/lint/LintConfigEditor.tsx:704` (`"No rule kinds ship for this side yet."`), `LintRailAndInspector.tsx:74` (`"n/a"`).
  - Fix: hide the Design card and the Design map entry when the report has no design side, or say what to do: title `"No design results in this report"`, description `"Run lint to include designs."` Remove the empty `design rules` section instead of the "yet" line.

- **CMP-22. Severity counts are abbreviated to `3E 12W 1I` with no expansion.**
  - Severity: medium. Confidence: medium.
  - Rule: `writing` 10 (lost information), `ui` 3.
  - Locations: `src/components/system-editor/lint/LintParts.tsx:160-182` (used in rule rows and inspector fields), `src/components/system-editor/lint/LintRailAndInspector.tsx:65` (`` `${total.errors}E ${total.warnings}W` ``), `src/components/system-editor/lint/LintHeatMapView.tsx:130-134` (`12+3i`).
  - Fix: add `` title and aria-label `${errors} errors, ${warnings} warnings, ${info} info` `` in `CountTriplet`, or write `3 errors, 12 warnings` where the column has room. The rail detail becomes `` `${errors} errors` `` only when errors exist.

## Low

- **CMP-23. `·`, `→`, and `—` in strings.**
  - Severity: low. Confidence: high.
  - Rule: `writing` 6, `writing` 8, `ui` 20 (an empty placeholder renders in the body font).
  - Locations: `·` at `src/components/system-editor/ComponentDraftProperties.tsx:323`, `:827`, `src/components/system-editor/lint/LintHeatMapView.tsx:108`, `src/components/system-editor/lint/LintRailAndInspector.tsx:462`, `src/components/system-editor/SystemEditorLintPanel.tsx:354-358`. `→` at `src/components/system-editor/SystemEditorLintPanel.tsx:109`, `src/components/system-editor/lint/LintAdherenceView.tsx:56`, `:76`. `—` as an empty value at `src/components/system-editor/lint/LintCoverageView.tsx:119`, `:262`, `src/components/system-editor/lint/LintAdherenceView.tsx:287`, `src/components/system-editor/lint/LintConfigEditor.tsx:109`.
  - Fix: `` `${library}/${component}` `` with the role dropped; `"Size: sm, Tone: danger"` for compounds; spacing for the heat row. `` `${metric}: ${baseline} to ${current}` ``. Leave an empty threshold cell empty and use `placeholder="None"`; the all-unknown coverage card shows `"Unknown"` as its value.

- **CMP-24. The report read error doubles its period and falls back to "unknown error".**
  - Severity: low. Confidence: high.
  - Rule: `writing` "Errors", `writing` 5.
  - Location: `src/components/system-editor/SystemEditorLintPanel.tsx:260-264`; messages come from `src/lint/report.ts:485`, `:494`, `:527`, which already end in a period.
  - Current: `The lint report could not be read: lint-report.json must be a JSON object.. Run lint to write a new one.`
  - Fix: render `"Could not read the lint report."`, then the reason as its own sentence, then `"Run lint to write a new one."` Drop the `"unknown error"` fallback.

- **CMP-25. Trailing chevron and external-link glyph on in-app navigation.**
  - Severity: low. Confidence: medium.
  - Rule: `ui` 5, `ui` "a trailing chevron means a child page; a trailing arrow means navigation elsewhere".
  - Locations: `src/components/system-editor/lint/LintAdherenceView.tsx:289-292` (rule rows switch to the Findings view with a filter), `src/components/system-editor/lint/LintRailAndInspector.tsx:206` (`ExternalLink` icon on `Open in editor`, an in-app route).
  - Fix: replace the chevron with an arrow, or remove it. Use an arrow glyph on `Open in editor` and name the target: `"Open design"`.

- **CMP-26. One thing, several names, across the lint views.**
  - Severity: low. Confidence: high.
  - Rule: `writing` "Names".
  - Locations: tab `"Rules"` (`src/stores/lint-dashboard-store.ts:25`) opens a form that also holds thresholds, wrappers, and sources and saves with `"Save lint.json"` (`LintConfigEditor.tsx:887`); `"rule kind"` (`LintAdherenceView.tsx:225`, `:229`, `:238`, `:70`) versus `"Rule"`, `"All rules"`, `"All findings of this rule"`, `"code rules"` (`LintFindingsView.tsx:192`, `LintRailAndInspector.tsx:284`, `:343`); `"Code map"` and `"Design map"` (`lint-dashboard-store.ts:22-23`) versus headings `"codebase"` and `"designs"` and aria-labels `"Code heat map"`, `"Design heat map"` (`LintHeatMapView.tsx:298`, `:346`, `:436`); sort option `"Usage"` versus column `"usages"` (`LintHeatMapView.tsx:44`, `:290`); `"wrapper"`, `"Wrappers"`, `"wrapper modules"`, `"bound wrapper"` (`LintCoverageView.tsx:194`, `LintRailAndInspector.tsx:499`, `LintConfigEditor.tsx:772-773`); `"Design system"` (`SystemEditorLintPanel.tsx:327`) versus the glossary's System; `"compound"` (`AuthoredCompoundsList.tsx:82-86`, `:105`, `:141`, `ComponentDraftProperties.tsx:361`, `:469`) versus the glossary's Compound Variant; `"component draft"` (`ComponentDraftStage.tsx:339-340`) for a list of components.
  - Fix: `"Config"` for the tab; `"rule"` everywhere in the UI; `"Code map"` and `"Design map"` as headings and aria-labels; `"Usages"`; `"wrapper"`; `"Compound variants"`; `"Select a component to edit it."` and `"Expand the sidebar (Alt+[) to pick a component."`

- **CMP-27. Empty states that do not point to the next action, or name internals.**
  - Severity: low. Confidence: high.
  - Rule: `writing` "Empty states", `writing` 3, `ui` "States" (no results use the compact variant).
  - Locations and replacements:
    - `src/components/system-editor/SystemEditorComponentsPanel.tsx:535-539` `"Create a draft to start building the first system component in this manifest."` becomes `"Name a component above to create it."`
    - `:547` `"No components match the current search."` becomes `"No components match."`
    - `src/components/system-editor/ComponentDraftLayers.tsx:1235` `"No root layer"` becomes `"Add a container to start."`
    - `src/components/system-editor/lint/LintCoverageView.tsx:200` `"The system has no published components in this report."` becomes `"No published components. Publish one, then run lint."`
    - `src/components/system-editor/lint/LintRailAndInspector.tsx:156` `"No findings."` becomes `"No findings"`.
    - `src/components/system-editor/SystemEditorLintPanel.tsx:248` becomes `"Lint checks how the app and your designs use this system. The first run sets the baseline."`

- **CMP-28. Buttons that do not say what they act on.**
  - Severity: low. Confidence: high.
  - Rule: `writing` 4, `writing` "Buttons" (keep the verb through the flow).
  - Locations and replacements: `src/components/system-editor/SystemEditorComponentsPanel.tsx:1151` `"New"` becomes `"Create"`; `src/components/system-editor/ComponentDraftProperties.tsx:654` `"Remove"` becomes `"Remove slot"`; `:607` `"Clear"` becomes `"Turn off here"`; `:771` `"Make target"` becomes `"Make override target"`; `src/components/system-editor/lint/LintConfigEditor.tsx:828` `"Overwrite"` becomes `"Overwrite lint.json"`; `:873` `"Discard"` becomes `"Discard changes"`; `src/components/system-editor/SystemEditorLintPanel.tsx:87` badge `Run pass` or `Run fail` becomes `"Passed"` or `"Failed"`; `src/components/system-editor/SystemEditorComponentsPanel.tsx:371` `"Publish draft"` should read `` `Publish v${next}` `` if the next version is known.

- **CMP-29. Run outcome text is long, uses semicolons, and misnames minimum breaches.**
  - Severity: low. Confidence: medium.
  - Rule: `writing` "Status text", `writing` "Toasts".
  - Locations: `src/components/system-editor/SystemEditorLintPanel.tsx:90-94`, `src/components/system-editor/lint/LintAdherenceView.tsx:44-49`, `src/components/system-editor/lint/LintCoverageView.tsx:150`.
  - Current: `"Nothing got worse than the baseline; the report is the new baseline."`, `"First run: the report is the baseline."`, and `` `${n} regressed, ${m} over a threshold. The failing report was written so you can inspect it; its baseline was kept, so do not commit lint-report.json as it is.` `` A breach of a coverage minimum is "below min", not "over a threshold". Coverage adds `"A gap is a step to take, not an error."`
  - Fix: `"No number got worse. This report is the new baseline."`, `"First run. This report is the baseline."`, `` `${n} regressed, ${m} past a threshold. The old baseline was kept. Do not commit lint-report.json.` `` Delete the coverage aside.

- **CMP-30. Descriptions that restate the control or repeat a fact.**
  - Severity: low. Confidence: medium.
  - Rule: `writing` 1, `writing` 2.
  - Locations: `src/components/system-editor/lint/LintAdherenceView.tsx:225` (the same sentence under both rule tables: `"Findings per rule kind in this report, with the change against the baseline. Select a rule to see its findings."`); `src/components/system-editor/lint/LintFindingsView.tsx:155` (`"N of M findings"` beside the tab count and the rail count); `src/components/system-editor/AuthoredCompoundsList.tsx:84-87` (`"Compounds with painted classes appear here. Select a row to edit them with the Compound style target on the right."`); `src/components/system-editor/ComponentDraftProperties.tsx:578-582` and `:585-598` (the switch tooltip and the paragraph say the same thing); `:854-858` (section `"Content"` with a field labelled `"Content"`); `src/components/system-editor/lint/LintConfigEditor.tsx:668`.
  - Fix: delete the rule table detail; show the findings count only when a filter is active (`"12 of 340"`); cut the compounds description to `"Select one to edit its classes."`; keep the design-only paragraph and drop the tooltip; label the text field `"Text"`.

- **CMP-31. Disabled controls that do not say why.**
  - Severity: low. Confidence: high.
  - Rule: `writing` "Disabled states", `ui` "Show only what exists" (disable with a tooltip that says why).
  - Locations: `src/components/system-editor/ComponentDraftLayers.tsx:1107`, `:1122`, `:1137`, `:1151`, `:1197` (add buttons when the selection cannot take the layer); `src/components/system-editor/ComponentDraftProperties.tsx:434` (Base); `src/components/system-editor/SystemEditorComponentsPanel.tsx:363-367` (Publish draft; the mono status line above is the only hint).
  - Fix: tooltips `"Select a container to add inside it."`, `"Select a variant value to turn Base off."`, and for Publish the first failing condition, for example `"Save the draft first."`

- **CMP-32. Compound rows: the name is the click target and delete sits in the row.**
  - Severity: low. Confidence: medium.
  - Rule: `ui` 4, `ui` "Lists, tables, and cards" (destructive action in a row).
  - Location: `src/components/system-editor/AuthoredCompoundsList.tsx:128-153` (`hover:text-cyan-800` on the label, no row hover), `:111-120`.
  - Fix: make the row the button with `hover:bg-slate-50`; keep the trash as the one fixed inline action only once the draft has undo (CMP-04).

- **CMP-33. Hand-rolled controls and a variant function outside `src/components/ui/`.**
  - Severity: low. Confidence: high.
  - Rule: project conventions (variants live in `ui/`, prefer flexbox), `ui` "A compound control looks like one control".
  - Locations: `src/components/system-editor/ComponentDraftProperties.tsx:370-376` (`styleTargetButtonClass`, a variant function as a template string), `:89-101`, `:147-153`, `:184-203`, `:229-248`, `:448-461`, `:602-608`, `:649-655`, `:661-667`, `:722-736`, `:765-772` (raw `<button>`, `<select>`, `<input type="checkbox">`); `src/components/system-editor/lint/LintFindingsView.tsx:40-41` and `src/components/system-editor/lint/LintConfigEditor.tsx:58-62` (duplicated select and textarea classes with raw hex `#e2e8f0`, `#06b6d4`); CSS grid for one-dimensional layouts at `src/components/system-editor/SystemEditorComponentsPanel.tsx:344`, `src/components/system-editor/ComponentDraftProperties.tsx:442`, `src/components/system-editor/ComponentDraftLayers.tsx:1169`.
  - Fix: use `Button`, `Segmented`, and a shared select and checkbox primitive; add the missing primitives to `ui/`. Use flex for the two-button footer.

- **CMP-34. Heat map rows: an icon on every row, and disabled rules listed greyed out.**
  - Severity: low. Confidence: low (judgment: a file tree conventionally shows folder and file icons, and a disabled rule is real config).
  - Rule: `ui` 7, `ui` 2.
  - Locations: `src/components/system-editor/lint/LintHeatMapView.tsx:77-83`, `:99`; `src/components/system-editor/lint/LintAdherenceView.tsx:296-309`.
  - Fix: the chevron already marks folders, so drop the leading icon. Replace the greyed rule rows with one line under the table: `"2 rules disabled"` linking to the config view.

- **CMP-35. Lint config footer and file card show state as resting text and badges.**
  - Severity: low. Confidence: medium.
  - Rule: `ui` "a pending state is an indicator on the apply button", `ui` 25.
  - Locations: `src/components/system-editor/lint/LintConfigEditor.tsx:854-862` (`"Saving…"`, `"Unsaved changes"`, `"Saved"`, `"No changes"`), `:656-664` (badges `present`, `defaults`).
  - Fix: put the pending state on the button (`"Saving"`, as **Save draft** does at `SystemEditorComponentsPanel.tsx:357`), keep `"Unsaved changes"`, drop `"No changes"`. Drop the `present` badge; show `"Not created yet"` as text only when the file is absent.

## Coverage

Read in full:

- `src/components/system-editor/SystemEditorComponentsPanel.tsx`, `ComponentDraftLayers.tsx`, `ComponentDraftProperties.tsx`, `ComponentDraftStage.tsx`, `DraftLayerContextMenu.tsx`, `AuthoredCompoundsList.tsx`, `component-catalog.ts`, `component-draft-inspector.ts`, `useGuardedComponentLocation.tsx`, `useSaveComponentDraft.ts`, `SystemEditorLintPanel.tsx`
- `src/components/system-editor/lint/LintAdherenceView.tsx`, `LintCoverageView.tsx`, `LintFindingsView.tsx`, `LintHeatMapView.tsx`, `LintParts.tsx`, `LintRailAndInspector.tsx`, `LintConfigEditor.tsx`, `lint-dashboard-model.ts`, `useVirtualRows.ts`
- `src/queries/system-lint.ts`, `system-component-usage.ts`, `system-used-by.ts`, `src/stores/lint-dashboard-store.ts`, `component-editor-session-store.ts`, `src/lint/component-location.ts`, `src/lint/rule-catalogue.ts`
- Primitives read for root causes: `src/components/ui/text.tsx`, `empty-state.tsx`, `alert-dialog.tsx`, `alert.tsx`, `card.tsx`, `badge.tsx`

Searched for strings, not read in full:

- `src/stores/component-draft-store.ts` (1,906 lines; two thrown strings found, no undo or history).
- `src/queries/system-components.ts` (no user-facing strings beyond server errors passed through).
- `src/lint/` rule files: every rule `description`, option `label`, `description`, and `placeholder`, and the finding `message` templates in `rules/code/variant-values.ts`, `variants-import.ts`, `variants-file.ts`, `canonical-classes.ts`, `analysis.ts`, `report.ts`, `design-lint.ts`, `run-lint.ts`. They are full sentences that say what is wrong and what to do. No finding raised. I did not read `source/parse.ts`, `source/index.ts`, `designs.ts`, `config.ts`, `ratchet.ts`, or the remaining rule bodies line by line, so a message assembled there could have been missed.
- `src/components/system-editor/lint/lint-config-draft.ts` (first 60 lines and a string search) and `lint-report-fixtures.ts` (test fixtures).
- `docs/lint.md`: first 140 lines.

Not done: nothing was rendered, so layout claims (wrapping, the one-frame flash of the "Unsaved draft is still open" card before hydration, contrast as seen) come from the classes, not from a screenshot. The Settings, Variants, and Publish tab bodies live in `SystemEditorInspector.tsx`, which another agent covers.
