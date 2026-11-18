# System editor audit: shell, tokens, assets, icons, inspector

Paths are relative to `/root/workspace/trickroom`. Rule ids: `ui-N` is `ui-design-guidelines` "Patterns to detect and fix" number N, `wr-N` is the same list in `writing-for-ui`. A section name is cited where no numbered pattern fits.

Abbreviations for files:

- `SE` = `src/components/SystemEditor.tsx`
- `TOK` = `src/components/system-editor/SystemEditorTokensPanel.tsx`
- `INS` = `src/components/system-editor/SystemEditorInspector.tsx`
- `AST` = `src/components/system-editor/SystemEditorAssetsPanel.tsx`
- `ICO` = `src/components/system-editor/SystemEditorIconsPanel.tsx`

Pattern ui-26 (missing dark twin) is not flagged per element. Only five files in `src/components` use a `dark:` variant, so the app chrome is light-only today and none of the in-scope files has a dark counterpart for any colour.

## High

- **SYS-01. The shell's error and loading states are dead ends.**
  - Severity: high. Confidence: high.
  - Rule: ui-12 (loading sentence), ui "States" ("Every failure keeps a retry"), writing-for-ui "Errors" and wr-3.
  - Locations: `SE:501-507`, `SE:509-516`, `SE:518-524`, `SE:526-532`.
  - Current: each state returns only a pill, `<div className="absolute left-3 top-3 z-30 bg-red-500 px-2 py-1 text-xs text-white">`, with `Missing system id`, `Failed to load system data: {errorMessage}`, `Loading system data...`, or `No system found for “{normalizedSystemId}”.` No rail, no back button, no retry. `systemsQueryOptions` sets `retry: false` (`src/queries/systems.ts:46`), so one failed request leaves the user on a blank screen until they use the browser's Back.
  - Fix: render the rail header (back button plus name skeleton) in all four states. Loading: a skeleton of the rail and workspace, no sentence. Load failure: `Could not load this system` with the reason under it, and a `Retry` button that calls `systemsQuery.refetch()`. Not found (covers the missing id): title `System not found`, body `No system matches "{id}".`, button `Back to project`.

- **SYS-02. "Discard suggestions" confirms the review, and both review buttons change label when either one is clicked.**
  - Severity: high. Confidence: high on the behaviour, medium on the replacement labels.
  - Rule: writing-for-ui "Buttons" ("Say what happens", "Keep the verb through the flow"), "Status text" ("Keep it true"), wr-3, wr-4.
  - Locations: `TOK:922-941`, handlers `TOK:2767-2782`, API contract `src/queries/tailwind-sync-tokens.ts:160-164`.
  - Current: `{isSaving ? "Saving..." : "Discard suggestions"}` and `{isSaving ? "Confirming..." : "Confirm changeset"}`. Both buttons call the same `saveMutation` (`saveAndConfirmTailwindTokens`, which clears `reviewRequired`). They differ only in which override list they send. So "Discard suggestions" also ends the review, and the word "suggestions" names nothing visible on the screen. Because `isSaving` is shared, clicking Confirm makes the other button read "Saving...", and clicking Discard makes Confirm read "Confirming...". "Changeset" appears nowhere else. The banner title says "Review token changes".
  - Fix: track which button started the mutation and show the pending indicator only on that button (ui "A pending state is an indicator on the apply button"). Labels: `Confirm changes` with pending `Confirming`, and `Confirm, keep current overrides` with pending `Confirming`. If the second path has no user-visible meaning, remove the button. Whoever owns the override model must confirm the second label.

- **SYS-03. The component diagnostics list silently drops everything after the eighth entry.**
  - Severity: high. Confidence: high.
  - Rule: wr-10 (lost information), ui "Popovers, menus, and tooltips" ("Fold long selections ... plus 'and N more'").
  - Locations: `INS:1401`, `INS:1582`.
  - Current: `detailQuery.data.diagnostics.slice(0, 8).map(...)` under the label `Diagnostics`, with no count and no "more" row. The row above says `Validation: Needs attention`, so a ninth error that blocks publishing is invisible.
  - Fix: render all diagnostics (the list already has `max-h-40 overflow-y-auto`), or add a last row `and {n} more` that expands the list. Put the count next to the label.
  - Note: this panel renders inside the Components workspace, so it overlaps with the Components agent's scope. The code is in the inspector file.

## Medium

- **SYS-04. Removed tokens are collapsed during review behind a header with no affordance.**
  - Severity: medium. Confidence: high on the code, medium on impact.
  - Rule: ui "Popovers, menus, and tooltips" ("A trigger ... has a hover state"), wr-10, ui "Show only what exists".
  - Locations: `TOK:1978-1993`, `TOK:2033-2037`, `TOK:2469`, same pattern at `TOK:2339-2355`.
  - Current: `ChangeSection` renders every header as `<button ... className="flex items-center gap-2 bg-slate-50 px-4 py-2.5 text-left disabled:pointer-events-none" disabled={!canToggle}>`. "Overridden" and "Added" are disabled buttons used as headings. "Removed" is the only live one, starts collapsed (`useState(true)`), and has no chevron, no hover state, and the same look as its disabled siblings. The banner above asks the user to confirm these changes. `CustomUtilitiesSection` has the same unmarked toggle and is also collapsed by default.
  - Fix: expand "Removed" by default while `reviewRequired` is true. Give collapsible headers a leading chevron and `hover:bg-slate-100` (the same pattern `TokenDomainSectionList` already uses). Render non-collapsible headers as a `div` or `h2`, not a disabled button.

- **SYS-05. The icon folders rail shows an empty state and "0 icons" when the request failed.**
  - Severity: medium. Confidence: high.
  - Rule: ui "States" ("A failed secondary request ... never renders as zero"), the inverse of ui-13, wr-2.
  - Locations: `ICO:341-345`, `ICO:408-415`, `ICO:322-324`, `ICO:555-557`.
  - Current: the count is `iconsQuery.isPending ? "Loading" : `${icons.length.toLocaleString()} icons``, and the list falls through to `No icon folders configured.` because `folders` is `[]` when `data` is undefined. The same error message then shows twice: once in the rail card (`iconFolderError`) and once in the workspace (`Failed to load icons: ...`).
  - Fix: branch on `iconsQuery.isError` in the rail. Hide the count and the empty line, and show one error with a `Retry` button. Keep the error in the workspace only.

- **SYS-06. The tokens masthead prints invented values while loading and on error.**
  - Severity: medium. Confidence: high.
  - Rule: ui "Show only what exists" ("Leave a row out when its source is missing, instead of inventing a value", "Unknown shows as unknown"), ui "States".
  - Locations: `TOK:2807-2829`, `TOK:2832-2849`, `TOK:2715-2719`, `TOK:619`, `TOK:651-654`.
  - Current: both early returns pass `tokenCount={0}` and `domainCount={0}`, so the masthead reads `0 tokens · 0 domains` while the request is in flight and after it fails. `cssPath` falls back to the literal `"./src/index.css"`, and `syncedAt` null prints `synced never`.
  - Fix: make the counts, path, and sync time optional in `TokenMasthead` and omit each one when unknown. Replace `synced never` with `Not synced yet`.

- **SYS-07. Loading sentences instead of skeletons, and live buttons beside a skeleton.**
  - Severity: medium. Confidence: high.
  - Rule: ui-12.
  - Locations: `SE:521` (`Loading system data...`), `TOK:2826` (`Loading token snapshot...`), `ICO:410` (`Loading icon folders...`), `ICO:538` (`Loading icons...`), `INS:1137` (`Loading component details...`), `INS:1612` (`Loading asset details...`), `INS:1664` (`Loading icon details...`), count chips `AST:331-332`, `ICO:343`, `ICO:499-500` (`"Loading"`), `INS:1176-1177` and `INS:1189-1190` (`"Checking..."`, `"Checking attached instances"`).
  - Current: the assets panel is the only one with a skeleton (`AST:439-452`), and it renders the live `Add asset` and `Group folders` buttons next to it. Its skeleton cards are `aspect-square`, while real cards are 4:3 plus a 60px footer (`AST:111-112`), so the grid jumps when data arrives.
  - Fix: draw a skeleton of the final layout in each place (grid cards for icons, rows for the folder rail, field rows for the inspector, section blocks for tokens). Turn toolbar buttons and count chips into skeleton blocks while pending. Match the asset skeleton to the real card ratio.

- **SYS-08. Failed requests have no retry.**
  - Severity: medium. Confidence: high.
  - Rule: ui "States" ("Every failure keeps a retry").
  - Locations: `AST:470-472`, `ICO:555-557`, `TOK:2850-2864`, `INS:1140-1144`, `INS:1615-1619`, `INS:1667-1671`, `INS:1178-1179` and `INS:1191-1192` (usage query failure shown as the plain values `Unavailable` and `Usage diagnostics unavailable`).
  - Current: every in-scope query sets `retry: false` (`src/queries/system-assets.ts:74`, `system-icons.ts:119`, `systems.ts:46`), and none of these error states has a button. The tokens masthead offers `Re-sync`, which is a different action.
  - Fix: add a `Retry` button that calls `refetch()` to each error card. In the inspector, show the error with the name of what failed, for example `Could not load this asset`, and a `Retry` button.

- **SYS-09. Errors show a raw message with no subject, and the fallbacks are vague.**
  - Severity: medium. Confidence: high.
  - Rule: writing-for-ui "Errors" ("Say what happened and how to fix it"), wr-5.
  - Locations: `TOK:2917-2926` (sync error strip shows only `{syncError}`), `INS:1142`, `INS:1617`, `INS:1669`, `ICO:361-370`, `ICO:277` (`"Icon folder action failed."`), `AST:366` (`"Failed to add asset."`), `src/hooks/useTailwindSyncController.ts:201` (`"Failed to sync system"`). The server-less fallback is `Request failed with status ${response.status}` from `src/utils/readJsonOrThrow.ts:21`, which is outside this scope but is what these places print.
  - Current: a failed sync can render a red strip that reads only `Request failed with status 500`. "Icon folder action failed." covers add, remove, and re-index.
  - Fix: prefix each with what was attempted and keep the reason as the second part. `Could not sync {systemName}: {reason}`. `Could not add the asset: {reason}`. Split the icon rail fallback per mutation: `Could not add the icon folder.`, `Could not remove the icon folder.`, `Could not re-index the icons.` Hook fallback: `Could not sync the system`.

- **SYS-10. Removing an icon folder is a one-click destructive row action with no undo.**
  - Severity: medium. Confidence: high on the code, medium on the fix.
  - Rule: ui "Lists, tables, and cards" ("A destructive action never sits in a row"), ui-16 and writing-for-ui "Destructive actions" ("For a reversible action, offer undo").
  - Location: `ICO:436-447`.
  - Current: `<Button variant="block" flavor="warning" ... title={`Remove ${folder}`} onClick={() => removeIconFolderMutation.mutate(folder)}>` with a `Trash2` icon. One click removes the folder and all of its icons from the system. The folder stays on disk, so the action is reversible only by retyping the path.
  - Fix: keep the action, and after it succeeds show `Removed {folder}` with an `Undo` button that calls `addIconFolderMutation.mutate(folder)`. No confirm dialog is needed.

- **SYS-11. "Tailwind baseline" and "Tailwind defaults" name the same thing.**
  - Severity: medium. Confidence: high.
  - Rule: writing-for-ui "Names" ("Keep one name for one thing everywhere"), wr-3.
  - Locations, "baseline": `TOK:155` (`Tailwind baseline tokens available to this system.`), `TOK:479` (`Value differs from Tailwind baseline`), `TOK:1940` (`"BASELINE"`). "defaults": `TOK:160` (`Tailwind defaults replaced by the project theme.`), `TOK:497` (`Default token missing from the project theme`), `TOK:808` (`Hide defaults`), `TOK:897` (`{tailwindLabel} defaults`), `TOK:2212`, `TOK:2218`, `TOK:2898` (`Tailwind defaults updated to ...`). Segment label `TOK:824` (`Theme vs Tailwind`).
  - Fix: use "Tailwind default" everywhere. `TOK:155` and `TOK:479` are deleted by SYS-13. `TOK:1940`: `Tailwind default`.

- **SYS-12. One change type has two names in one view: section "Overridden", card tag "CHANGED".**
  - Severity: medium. Confidence: high.
  - Rule: writing-for-ui "Names", wr-2.
  - Locations: `TOK:191-193` (`label: "Overridden", tag: "CHANGED"`), rendered at `TOK:1921` and `TOK:1988`, chips `src/components/project/SystemDiffChips.tsx:5` (`overridden`).
  - Current: in the "Theme vs Tailwind" view the section header and the chips say "Overridden" and every card inside is tagged "CHANGED". In the "Since last review" view the header is switched to "Changed" (`TOK:2981`), so only that view is consistent.
  - Fix: pass the resolved label into `TokenChangeCard` and use it for the tag: `Overridden` against Tailwind, `Changed` since the last review.

- **SYS-13. Descriptions that restate their heading, on every token section.**
  - Severity: medium. Confidence: high.
  - Rule: wr-1 (restated UI), wr-2.
  - Locations and current text:
    - `TOK:1052` `Resolved color tokens with their project values.` under "Color".
    - `TOK:1517` `Font, size, weight, leading, and tracking tokens.` under "Type", directly above subgroups with those names.
    - `TOK:1523` `Project font stacks.`, `TOK:1530` `Size tokens paired with their line-height metadata.`, `TOK:1537` `Numeric weight scale.`, `TOK:1545` `Line-height tokens.`, `TOK:1552` `Letter-spacing tokens.`
    - `TOK:1768` `Spacing rhythm, breakpoints, containers, radii, and shadows.`, `TOK:1775` `Base spacing scale.`, `TOK:1782` `Responsive viewport thresholds.`, `TOK:1792` `Layout container widths.`, `TOK:1800` `Corner radius tokens.`, `TOK:1807` `Outer, inset, drop, and text shadows.`
    - `TOK:1697-1702` `Outer box shadows.`, `Inset box shadows.`, `Filter drop shadows.`, `Text shadows.`
    - `TOK:2349-2351` `@utility definitions grouped by the domain they affect`.
    - `TOK:479`, `TOK:488`, `TOK:497`, `TOK:529-531`: per-card summaries `Value differs from Tailwind baseline`, `Custom token in the project theme`, `Default token missing from the project theme`, `Changed since last review`, `New since last review`, `Removed since last review`. Every card in a section carries the same sentence, next to a tag that already says it.
    - `TOK:1012` group labels `Color Slate`, `Color Red` inside the "Color" section.
    - `INS:1246-1251` title `No draft variants to edit.` plus body, `INS:1317-1323` `No draft available to publish.` plus body.
  - Fix: delete all of the descriptions and constant summaries. Keep a card summary only when it carries the `@theme` option change (see SYS-22). Keep `Leading` and `Tracking` descriptions only if user testing shows the Tailwind terms are not understood (judgment call). `TOK:1012`: return `formatDomainLabel(group)` so the label is `Slate`.

- **SYS-14. Section labels built from a sentence, and `·` used as a separator.**
  - Severity: medium. Confidence: high.
  - Rule: wr-6 (separators), wr-1.
  - Locations: `TOK:640` (`{getCssBasename(cssPath)} · {versionLabel} · synced {syncLabel}`), `TOK:652-653` (`{n} tokens ·{" "}{n} domains`), `TOK:2157` (`label: `${config.label} · ${config.description}``), `TOK:2376-2379` (tooltip joined with `" · "` and `"  •  "`), decorative dot `src/components/project/SystemTokenRows.tsx:356-359` (`size-1 rounded-full bg-slate-300`, a round shape in a square-corner language, fix belongs in that shared component).
  - Current: in "Group by Status" the section header renders in the uppercase mono `section-divider` variant as `DEFAULT · TAILWIND BASELINE TOKENS AVAILABLE TO THIS SYSTEM.`
  - Fix: `TOK:2157`: `label: config.label`. Masthead: separate spans with a gap or a `Separator`. Tooltip: one fact per line, namespaces on the first line and values comma separated on the second. Remove the dot and rely on the gap.

- **SYS-15. The sync state is stated three times, with a status badge at rest.**
  - Severity: medium. Confidence: high.
  - Rule: ui-25 (status badge at rest), wr-2 (repeated facts), ui "Keep headers lean".
  - Locations: `SE:151` (badge in the rail header), `TOK:636` (same badge next to the tokens title), `TOK:640` (`synced {syncLabel}`), badge source `src/components/project/SystemStatusBadge.tsx:16-20` (`Synced`, `Not synced`, `Review required`, `Syncing`, `Error`).
  - Current: on the Tokens tab a healthy system shows `Synced` in the rail, `Synced` in the masthead, and `synced 5m ago` under the title. In the `review` and `error` states the rail badge is plain text. It does not lead to the Tokens tab, which is the only place that explains the error or holds the review.
  - Fix: remove the masthead badge. In `SystemStatusBadge` (shared component, owned by the project-screens audit) show only the dot when synced and a word for `Review required`, `Syncing`, and `Could not sync`. In the rail, make the non-rest badge a link to `?tab=tokens`.

- **SYS-16. The tokens header does not match its sibling tabs and carries template chrome.**
  - Severity: medium. Confidence: high.
  - Rule: ui-14 (jumping header), wr-8 (eyebrow), wr-2, writing-for-ui "Names", ui "Build hierarchy with size, not colour" ("Siblings share one styling").
  - Locations: `TOK:626-687`, compare `AST:194-213` and `ICO:199-218`.
  - Current: `<Text variant="eyebrow" className="text-slate-400">Design system</Text>` above `<h1 className="... text-2xl font-semibold ...">{systemName} Tokens</h1>`. Assets and Icons use `<h1 className="truncate text-[15px] font-semibold text-slate-900">Assets</h1>` in a compact toolbar. The glossary noun is "System", not "Design system". The system name is already in the rail header and the tab already says Tokens. "Tokens" is title case after the name. The token count at `TOK:651-654` is repeated by the toolbar count at `TOK:782-786`. `Export HTML` carries `title="Export static HTML"` (`TOK:660`), which restates the label.
  - Fix: delete the eyebrow. Title: `Tokens` at the same size and position as the Assets and Icons titles. Keep one count (the toolbar's). Remove the `title` attribute on the export link.

- **SYS-17. Counts and labels ranked by colour, at contrast that fails on white.**
  - Severity: medium. Confidence: high.
  - Rule: ui-3 (rank by colour; "A running count on a column header ... corrected back to the default colour").
  - Locations: `text-slate-400` on counts at `TOK:566`, `TOK:651`, `TOK:1062`, `TOK:1289`, `TOK:1990`, `TOK:2352`; on labels and words at `TOK:629`, `TOK:704`, `TOK:1430`, `TOK:1891` (9px), `TOK:1902`, `TOK:2139`; `text-slate-300` at `TOK:561` and `TOK:2345`; dimmed title-level text at `TOK:565`, `TOK:2349`; icon tone mismatch between siblings at `SE:141` and `INS:1858` (`text-slate-500`) versus `SystemPanelToggle.tsx:79` (`text-slate-900`).
  - Current: slate-400 on white is about 2.6:1 and slate-300 about 1.5:1. The `Text` primitive documents slate-500 as the "quietest readable" tone (`src/components/ui/text.tsx:19`).
  - Fix: counts take the default ink at the small size. Labels attached to a control may stay dim, at slate-500 or darker. Give the three header icon buttons one tone.

- **SYS-18. Review changes are bordered cards inside a bordered card.**
  - Severity: medium. Confidence: high.
  - Rule: ui-8 (card in card), ui "Surfaces" ("Related rows are one surface with dividers").
  - Locations: `TOK:1978` (`<section className="flex flex-col border border-slate-200 bg-white">`) wrapping `TOK:1914` (`<div className={`border bg-white ${config.borderClassName}`}>`), which contains a tinted header with its own `border-b` (`TOK:1916`). Similar stacking of one bordered card per token row at `TOK:1590` (`LengthScaleList`) and `TOK:1478`.
  - Fix: put the section heading on the page background and keep the change cards as the only surface, or make each section one surface with rows split by dividers. `LengthScaleList` rows: one bordered list with dividers (judgment call, low confidence for that part).

- **SYS-19. A reset that was added is tagged "REMOVED", and the reverse.**
  - Severity: medium. Confidence: medium (the tone may be intended to describe the effect).
  - Rule: writing-for-ui "Status text" ("Keep it true"), ui-20.
  - Locations: `TOK:2208-2219`, row markup `TOK:2270-2287`.
  - Current: `changes.resets.added` maps to `tone: "removed"`, `name: `${entry.pattern}: initial``, `detail: "Tailwind defaults removed"`. The row reads `REMOVED  --color-*: initial  Tailwind defaults removed`, which says the reset line was removed. `resets.removed` reads `ADDED  --color-*: initial  reset dropped, Tailwind defaults restored`. The detail sentences render in `font-mono` and differ in capitalisation.
  - Fix: tag the line by what happened to it and let the detail state the effect. `ADDED  --color-*: initial` with detail `Removes the Tailwind defaults`. `REMOVED  --color-*: initial` with detail `Restores the Tailwind defaults`. Render the detail in the body font.

- **SYS-20. Implementation nouns in empty, missing, and status text.**
  - Severity: medium. Confidence: high on the violation, medium on each replacement.
  - Rule: wr-3 (implementation nouns), writing-for-ui "Empty states" ("Point to the next action"), "Names".
  - Locations, current text, and replacement:
    - `TOK:2929-2930` `No stored tokens` / `Sync this system to populate the design-token snapshot.` becomes `No tokens yet` / `Sync to read the tokens from {cssPath}.`
    - `TOK:2826` `Loading token snapshot...` is removed by SYS-07.
    - `TOK:2168` `No token status records match the current filters.` becomes `No tokens match the current filters.`
    - `TOK:1943` `"not defined"` and `"not stored"`, `TOK:1949` `"removed"` and `"unchanged"` (mono, slate-400) become `None`, `None`, `Removed`, `Unchanged` in the body font.
    - `AST:502-508` `No assets registered` / `Register raster image assets to make them available to linked designs.` becomes `No assets yet` / `Add an image by its path to use it in designs linked to this system.` The button on the same screen says "Add asset", not "Register".
    - `AST:296-297` `The image stays where it is; Trickroom records the path in this system's asset manifest.` becomes `The file is not moved or copied.` Keep `Relative to the project root.`
    - `AST:462` `Asset catalog unavailable` and `ICO:548` `Icon index unavailable` (screen-reader text) become `Assets could not be loaded` and `Icons could not be loaded`.
    - `INS:1623` `Asset not found in the current catalog.` becomes `This asset no longer exists.` `INS:1675` `Icon not found in the current index.` becomes `This icon no longer exists.`
    - `ICO:574-576` `No icons indexed for this system.` becomes title `No icons yet`, body `Add an icon folder in the sidebar to list its SVGs.`, in the same centred layout as the no-results state.
    - `ICO:414` `No icon folders configured.` becomes `No icon folders yet.`
    - `ICO:358` `Re-index` next to the tokens `Re-sync` (`TOK:681`): two verbs for "read the files again". Use `Re-sync` for both, or `Refresh` for both.
    - `INS:1639` label `MIME` with value `image/png` becomes label `Type` with the same `PNG` the card shows (`AST:53`).
    - `INS:913`, `INS:1066` `Component draft changed on the server while local edits are unsaved. Save or reload before continuing.` and `INS:1197`, `INS:1530` `Server draft changed`. Trickroom is local-first, so "the server" is the project files. Replace with `This draft changed on disk while you have unsaved edits. Save to keep your version, or reload to take the new one.` and `Draft changed on disk`.

- **SYS-21. The variant editor validates on every keystroke and shows errors before the user types.**
  - Severity: medium. Confidence: high.
  - Rule: ui "Sheets, dialogs, and forms" ("Validate on blur, not per keystroke").
  - Locations: `INS:1103-1106`, `INS:811-826`, add-axis handler `INS:607-619`.
  - Current: `validateVariantDrafts` runs on every render of the current drafts. Clicking `Axis` adds an empty axis and the alert card immediately lists `Variant axis 1 must include an axis key.`, `Variant axis "axis 1" must include a label.`, and `Variant value "value 1" on axis "axis 1" must include a key.` The errors sit at the bottom of the section, away from the field.
  - Fix: track touched fields and show a field's error after blur, under that field. Show the full list only after a save attempt.
  - Note: overlaps with the Components agent's scope.

- **SYS-22. `→` inside strings and as a text glyph.**
  - Severity: medium. Confidence: high.
  - Rule: wr-8 (`→` in text).
  - Locations: `TOK:524` (`` `${formatThemeOptions(entry.previousOptions)} → ${formatThemeOptions(entry.options)}` ``), `TOK:2225-2226` (`` `${entry.previousValue} → ${entry.value} (...)` ``), `TOK:2139` (`<span className="shrink-0 text-slate-400">→</span>`).
  - Fix: render the two values as separate spans with an `ArrowRight` icon (`aria-hidden`) between them and a screen-reader `to`. For the string at `TOK:524`, the card already has Previous and Incoming columns, so write `@theme options changed` and show the two option lists in those columns.

- **SYS-23. Icon index diagnostics are returned by the API and never shown in the editor.**
  - Severity: medium. Confidence: medium (not checked against what the server emits).
  - Rule: wr-10 (lost information), ui "States" (partial).
  - Locations: type `src/queries/system-icons.ts:20-26` (`diagnostics: { code, message, iconId?, sourcePath?, keptSourcePath? }[]`), no reference to `diagnostics` anywhere in `ICO`. The project screen counts them (`src/components/project/SystemDetailPane.tsx:332`).
  - Current: when the index skips a file (the `keptSourcePath` field implies duplicate names), the Icons tab shows a smaller grid and no reason.
  - Fix: show a compact notice above the grid, `{n} files were skipped`, that opens the list of messages.

- **SYS-24. "Custom utilities" also holds CSS variables, and its count ignores them.**
  - Severity: medium. Confidence: high.
  - Rule: writing-for-ui "Status text" ("Keep it true"), "Names".
  - Locations: `TOK:2312`, `TOK:2346-2354`, `TOK:2399-2403`.
  - Current: the section renders when either list is non-empty, the header count is `utilities.length`, and the variables appear only inside under `Custom CSS variables ({n})`. A system with variables and no utilities shows `Custom utilities 0`. Inner counts use `({n})` while every other count on the page is a bare number on the right. The leading `＊` (`TOK:2345`) and the `01`, `02` indices (`TOK:561`) are decoration.
  - Fix: split into two sections, `Custom utilities` and `Custom properties` (the name `CustomReviewChanges` already uses at `TOK:2264`), each with its own count in the page's count format. Remove the index glyphs.

## Low

- **SYS-25. All-caps written into strings, and uppercase eyebrow labels.**
  - Severity: low. Confidence: high for the hard-coded strings, low for the class-based labels (the uppercase label may be the intended house style; `text.tsx:45` marks the uppercase `section-divider` variant as deprecated in favour of a lowercase one).
  - Rule: wr-8 (all-caps eyebrow labels).
  - Locations, hard-coded: `TOK:184`, `TOK:193`, `TOK:202` (`"ADDED"`, `"CHANGED"`, `"REMOVED"`), `TOK:522` (`"CONFIRMED"`), `TOK:705` (`GROUP BY`), `TOK:1940` (`"PREVIOUS"`, `"BASELINE"`), `TOK:1947` (`"INCOMING"`). Class-based `uppercase tracking-wider`: `AST:259`, `ICO:374`, `INS:600`, `INS:637`, `INS:654`, `INS:682`, `INS:701`, `INS:724`, `INS:1283`, `INS:1329`, `INS:1359`, `INS:1397`, `INS:1433-1513`, `INS:1566`, `INS:1578`.
  - Fix: write the strings in sentence case (`Added`, `Changed`, `Removed`, `Confirmed`, `Group by`, `Previous`, `Tailwind default`, `Incoming`). A screen reader can spell out capitals. Decide once whether field labels are uppercase and move that into the `Text` primitive.

- **SYS-26. Monospace used for words.**
  - Severity: low. Confidence: high.
  - Rule: ui-20.
  - Locations: `AST:200` and `ICO:205` (count chip `12 assets`, also `Loading` and `Unavailable`), `ICO:341` (`1,204 icons`), `TOK:640` (`synced 5m ago`), `TOK:651` (`N tokens · N domains`), `TOK:782-785` (`N tokens`), `TOK:1430` (`leading 1.5`), `TOK:1902` (`not stored`), `TOK:2272` (whole row, including the detail sentence), `src/components/system-editor/path-segments.ts:5` (`"(root)"`, rendered in mono at `AST:85` and `AST:526`), `TOK:629` (`eyebrow` variant is `font-mono`, fix belongs in the `Text` primitive).
  - Fix: body font for the noun and the sentence, mono only for the number, path, or value. `(root)` becomes `Project root` in the body font.

- **SYS-27. The count chip repeats the title's noun, and the icon count shows twice.**
  - Severity: low. Confidence: high.
  - Rule: wr-2.
  - Locations: `AST:197-202` (`Assets` followed by a chip `12 assets`), `ICO:202-207`, `ICO:338-345` (rail shows `1,204 icons` while the workspace header shows the same).
  - Fix: chip text is the number only. Drop the count under "Icon folders", since each folder row already has its own count.

- **SYS-28. Plurals and pending labels are inconsistent.**
  - Severity: low. Confidence: high.
  - Rule: writing-for-ui "Fit" (plurals), "Follow the product first" (punctuation).
  - Locations: `ICO:344` (`${n} icons`, prints `1 icons`), `TOK:784` (`${n} tokens`, prints `1 tokens`). Pending labels: `AST:292` `Adding`, `TOK:678` `Syncing...`, `TOK:930` `Saving...`, `TOK:940` `Confirming...`, `INS:1177` `Checking...`. Ellipsis: `Filter by name or path...` (`AST:226`, `ICO:230`) versus `Filter tokens…` (`SystemTokenRows.tsx:202`).
  - Fix: use the existing `pluralize` helper. Pick one pending form (the spinner is already on the button, so `Adding`, `Syncing`, `Confirming` without dots) and one ellipsis character.

- **SYS-29. "Group folders" reads as "group the folders", and "Add asset" has an upload icon.**
  - Severity: low. Confidence: medium.
  - Rule: writing-for-ui "Buttons" ("Say what happens"), wr-4.
  - Locations: `AST:204-213`, `ICO:209-218` (`Group folders`), `AST:242-243` (`<Upload />` on a button that records a path and uploads nothing), `ICO:402` (`Add` next to a field labelled `Icon folder path` under the heading `Icon folders`), `INS:622` and `INS:752` (`Axis`, `Value` with a plus icon).
  - Fix: `Group by folder`. Use the `Plus` icon on `Add asset`. Icon rail: remove the visible label, keep it as `aria-label="Icon folder path"`, and label the button `Add folder`. Variant editor: `Add axis`, `Add value`.

- **SYS-30. Review banner sentences are fragments joined by a colon or semicolon.**
  - Severity: low. Confidence: medium on the replacements.
  - Rule: writing-for-ui "Status text", `writing-for-devs` sentence rules that the skill inherits.
  - Locations: `TOK:880-882` (`Theme files changed (files: {list}); no token-level change detected.`), `TOK:896-898` (`Nothing confirmed yet: the full theme diff against {tailwindLabel} defaults, {n} entries.`), `TOK:2687` (`No token-level change detected. Theme files changed: {list}.`), `TOK:2898-2899` (`Tailwind defaults updated to {version}; your tokens are unchanged.`), `TOK:905` (`ariaLabel="Review view"`).
  - Fix: `Theme files changed, but no token changed: {list}.` / `No review confirmed yet. Showing all {n} differences from the {tailwindLabel} defaults.` / `No token changed. Theme files changed: {list}.` / `Tailwind defaults updated to {version}. Your tokens are unchanged.` / `ariaLabel="Compare against"`.

- **SYS-31. Two segmented controls on one screen use different components and styling.**
  - Severity: low. Confidence: high.
  - Rule: ui "Build hierarchy with size, not colour" ("Siblings share one styling"), project convention (variants live in `src/components/ui/`).
  - Locations: `TOK:690-726` (hand-built `TokenGroupModeControl`) versus `TOK:903-913` (`Segmented` primitive). Other hand-styled controls: export link `TOK:657-665`, native `<select>` with hex shadows `INS:685-686` and `INS:704-705`, `textarea` `INS:1465-1466`, amber overrides on `Button` `TOK:925` and `TOK:935`.
  - Fix: use `Segmented` for Group by. Move the link-button, select, and textarea styles into ui primitives.

- **SYS-32. Toggle labels that also change with state.**
  - Severity: low. Confidence: medium.
  - Rule: writing-for-ui "Names" ("Keep one name for one thing"), wr-10 (accessible name).
  - Locations: `TOK:796-809` (`aria-pressed` plus label flipping between `Hide defaults` and `Defaults hidden`, announced as "Defaults hidden, pressed"), `SystemTokenRows.tsx:294` (`More {n}` and `Less`), `SystemTokenRows.tsx:227-235` and `:273-279` (with no filter set, every pill is `aria-pressed="true"` and dark, the same as `All`, so clicking a "pressed" pill selects only that pill).
  - Fix: constant label `Hide defaults`. `{n} more` and `Show fewer`. With no domain filter, only `All` is pressed. The last two belong in the shared `SystemTokenRows` component.

- **SYS-33. Inspector field rows truncate paths and hashes, and list ids nobody pastes.**
  - Severity: low. Confidence: medium (judgment call on which ids earn a row; agents use ids over MCP).
  - Rule: ui-19 (copyable id row), ui-20 inverse (values not in mono), ui "Popovers, menus, and tooltips" (essential detail only in a `title`).
  - Locations: `INS:80-92` (`truncate` with the full value only in `title`), `INS:1638` and `INS:1690` (`Path`, where truncation hides the filename), `INS:1637` (`Asset id`), `INS:1689` (`Icon id`), `INS:1548` (`Component id`), `INS:1294-1303`, `INS:1347-1353`, `INS:1383-1385` (`Template hash`, `Variant schema hash`, shown in three places), `INS:1290` (`Generated version`), `INS:1330` (`Current published`), `INS:1279-1280` and `INS:1549-1550` (`Usage status` and `Design usage`, two rows for one fact, with values such as `2 hash mismatches`), `INS:1691` (`Paint` with the raw enum `unknown`).
  - Fix: let path values wrap (`break-all`) in mono. Remove the hash rows, or move them behind one info button. `Next version`, `Published version`. Merge usage into one row, `Used in {n} designs`, and show the review count only when it is not zero. Show `Paint` as `Fill`, `Stroke`, `Mixed`, and omit the row when unknown.
  - Note: the component rows overlap with the Components agent's scope.

- **SYS-34. Unreachable inspector copy, one branch with rounded corners.**
  - Severity: low. Confidence: high.
  - Rule: ui "Show only what exists", project convention (square corners).
  - Locations: `INS:1821-1827` (`Browse token domains in the workspace. Domain sections can be collapsed; filtering is available in the main pane.`), `INS:1829-1833` (`<div className="rounded border border-dashed ...">Select an item on the {page} page to update this pane.</div>`), guard at `SE:383-387` and `SE:661`.
  - Current: the inspector mounts only when `hasInspectorContext` is true, which is never the case on the Tokens tab or with nothing selected. Both strings are dead, and both restate the UI.
  - Fix: delete both branches.

- **SYS-35. Two adjacent header buttons hide the inspector, and "Close inspector" clears the selection.**
  - Severity: low. Confidence: medium.
  - Rule: writing-for-ui "Buttons" ("Say what happens"), ui "Keep headers lean".
  - Locations: `INS:1849-1861`, handler `SE:388-404`.
  - Current: `Collapse inspector (Alt+])` sits next to an `X` titled `Close inspector`. The `X` deselects the asset, icon, layer, or lint item, which also removes the pane. Escape does the same.
  - Fix: remove the `X` and keep the collapse toggle and Escape, or keep it with the name `Clear selection`.

- **SYS-36. Icon-only buttons named only by `title`, and image alt text that repeats the visible name.**
  - Severity: low. Confidence: high.
  - Rule: writing-for-ui "Decide whether the text should exist" ("Icon-only controls keep an accessible name"), wr-10.
  - Locations: `SE:134-142` (`title="Back to project"`, icon not `aria-hidden`), `INS:667-678` (`title="Remove axis"`), `INS:782-804` (`title="Remove value"`, identical for every row), `ICO:63` and `INS:1683` (`alt={`${name} preview`}` beside the name), `AST:74` (`alt={asset.alt || asset.name}` inside a button that also prints the name).
  - Fix: add `aria-label` (`Back to project`, `Remove axis {key}`, `Remove value {key}`) and `aria-hidden` on the icons. Use `alt=""` for the icon previews and for asset thumbnails that have no authored alt text.

- **SYS-37. Empty states drawn as dashed boxes read as drop zones.**
  - Severity: low. Confidence: low (judgment call).
  - Rule: ui "Sheets, dialogs, and forms" (the dashed border is the drop-zone signal), ui-22.
  - Locations: `AST:500`, `AST:511`, `ICO:574`, `ICO:578`, `TOK:581` (`border border-dashed border-slate-300 bg-white`).
  - Current: the assets empty state looks like a place to drop an image, and the panel accepts only a typed path.
  - Fix: use a solid border or no border for empty states. Reserve dashed for a real drop target.

- **SYS-38. Removed tokens are struck through and dimmed in addition to the tag.**
  - Severity: low. Confidence: medium.
  - Rule: ui "Lists, tables, and cards" ("not a strikethrough"), ui-3.
  - Location: `TOK:1923-1929` (`"text-slate-500 line-through"`).
  - Fix: keep the default ink and rely on the `Removed` tag.

- **SYS-39. Remaining separator and name slips in the inspector.**
  - Severity: low. Confidence: high.
  - Rule: wr-6, writing-for-ui "Names".
  - Locations: `INS:1495` (`No matching folders — your text becomes a new one.` on a field labelled `Group`), `INS:1490` (`placeholder="e.g. atoms/typography"`), `INS:680-702` (`Axis default` and `Schema default`, two defaults the labels do not distinguish), `INS:316` (`compound 1` in messages, where the glossary term is "Compound Variant"), `ICO:423-426` (a `Folder` icon on every folder row, ui-7).
  - Fix: `No matching group. Your text creates a new one.` Placeholder `atoms/typography`. Give the two defaults labels that say what each one affects, or one hint line under the pair (needs the owner's wording). `Compound variant 1`. Drop the per-row folder icon.

## Coverage

Read in full:

- `src/components/SystemEditor.tsx`
- `src/components/system-editor/SystemEditorTokensPanel.tsx` (all 3006 lines)
- `src/components/system-editor/SystemEditorInspector.tsx`
- `src/components/system-editor/SystemEditorAssetsPanel.tsx`
- `src/components/system-editor/SystemEditorIconsPanel.tsx`
- `src/components/system-editor/SystemPanelToggle.tsx`, `path-segments.ts`, `types.ts`, `useVirtualGrid.ts`
- `src/queries/systems.ts`, `system-assets.ts`, `system-fonts.ts`, `system-icons.ts`, `tailwind-sources.ts`, `tailwind-sync-tokens.ts`
- `src/hooks/useTailwindSyncController.ts`
- Supporting files read because the panels render them: `src/components/project/SystemStatusBadge.tsx`, `SystemDiffChips.tsx`, `SystemTokenRows.tsx`, `src/utils/readJsonOrThrow.ts`, and the variant table of `src/components/ui/text.tsx`.

Not covered or only partly covered:

- `docs/tailwind-design-systems.md` was read to line 80 only.
- Nothing was rendered. Every finding comes from the code, so contrast figures are computed from the Tailwind palette and layout jumps are inferred from class names.
- Server-authored strings (API `error` bodies, component and icon diagnostic messages) were not audited. The UI prints them verbatim.
- `system-fonts.ts` and `tailwind-sources.ts` surface no user-facing strings in the in-scope components.
- `ComponentDraftProperties`, `AuthoredCompoundsList`, `ComponentAnnotationsPanel`, and `SystemEditorLintInspector`, which the inspector mounts, were left to the other agents.
- No finding was raised for load-more footers, stacked tabs, hover-revealed actions, confirm dialogs, toasts, or drag-only workflows. The in-scope files contain none of them. Both grids are virtualized.
