# Tailwind Systems And Classname Editing

Trickroom treats Tailwind as both a design-token source and an authoring language. A design can link to a configured Tailwind system, and each element stores a raw `className` string that the inspector edits as text, with autocomplete and validation from the linked system's Tailwind design system.

## Configure A System

Systems live in `.trickroom/systems/<safe-system-name>/system.json`:

```json
{
  "version": 1,
  "systemId": "sys_00000000-0000-4000-8000-000000000000",
  "systemName": "Core",
  "cssPath": "src/index.css"
}
```

Rules:

- System names and CSS paths are trimmed.
- Empty names or paths are invalid.
- CSS paths must resolve inside the project root.
- The project creation UI uses a stricter name pattern: `^[A-Za-z0-9_@-]+$`.
- Renaming updates `systemName`; the storage folder can keep the initial safe name.

The app can create an initial system during project creation. Legacy `systems` entries in config are migrated into system manifests on project open.

## Plugins And Configs

A system stylesheet can use `@plugin` (a v4 or v3-style plugin: `@tailwindcss/typography`, `@tailwindcss/forms`, a local `./plugin.js`) and `@config` (a v3-style config file). Every Tailwind entry point loads them: token sync, lint, codegen and the tailwind-merge derivation, the canonicalization worker, the canvas compile, the class catalog and class inspection, MCP diagnostics and the HTML export.

How a module loads (`src/utils/tailwind-module-loader.ts`, the `loadModule` Tailwind's `compile` takes), the way `@tailwindcss/node` (Tailwind's CLI and Vite plugin) loads it:

- Resolved from the folder of the stylesheet that names it with `enhanced-resolve`: import conditions first, then require, `NODE_PATH` included, so a package resolves from the project's own `node_modules`.
- Evaluated with `jiti`, so ESM, CommonJS and TypeScript (enums included) all load. Every load evaluates the files as they are now: jiti's module cache is off, and the module's files are dropped from Node's require cache first. Top-level `await` in a plugin is not supported. Node keeps the target a symlink resolved to for the life of the process, so pointing a symlinked CommonJS file a plugin requires at another file needs a restart (editing the target does not).
- A module outside `node_modules` is scanned for the files it imports by relative path, with the same scan as `@tailwindcss/node`, each import resolved as the runtime loads it (Node's `require` resolution and jiti's: a folder's `index.json`, a package's `main`, TypeScript's `./x.js` for `x.ts`; both files when the two differ), transitively. The module and those files count as dependencies: the server's Tailwind caches stamp them, and the file watcher reports edits to them like stylesheet edits (`tailwind-source` events), so the canvas, the class catalog and lint pick up an edited plugin on the next request. A package under `node_modules` counts by its entry file only.
- `@tailwindcss/node` itself is not a dependency: importing it loads lightningcss, a native binding, and its native `import()` would run through Vite's module runner in the dev server and the tests. `jiti` and `enhanced-resolve` (the versions `@tailwindcss/node` 4.3.3 uses) are bundled into their own `dist/tailwind-module-runtime.js`, loaded on the first module.

A module that cannot be resolved, fails to evaluate, or throws when Tailwind runs it (its handler, a `plugin.withOptions` factory, a config's `plugins`) fails the load with an error naming the directive and the module:

```text
@plugin "@tailwindcss/forms": cannot find module "@tailwindcss/forms" from src; is it installed in the project?
@plugin "./brand.js" (src/brand.js) threw: …
```

The HTTP routes answer `422` with `{ error, code: "TAILWIND_MODULE_NOT_FOUND" | "TAILWIND_MODULE_FAILED", directive, module }` (sync, compile, class catalog, inspection and merge); lint fails the run with `TAILWIND_UNAVAILABLE` ([Design System Lint](lint.md)).

Reviews: a module file inside the project and outside any `node_modules` is the project's own, like its stylesheets: it is part of the stylesheet fingerprint (by path, after the stylesheets, hashed as written), so editing it, or a file it imports, asks for review. A third-party package under `node_modules` is not: it asks for review only when it changes what the project defines. The token-domain values a `@config` file, a preset or a plugin's config adds to the theme (`theme.extend.colors.brand`) are tokens of the system and part of what it defines; the rest of what plugins add to the theme (typography's `--typography-*`) is not.

The canvas: in the default compiled render mode the server compiles the system's stylesheet, so plugin utilities (`prose`) render as they do in the app. When that compile fails (a missing or failing module), the canvas falls back to the bundled `@tailwindcss/browser` runtime for the session, which compiles only the stored theme, not the stylesheet: no plugin output and no custom utilities. A notice names the directive and the module. The browser render mode (`VITE_TAILWIND_RENDER_MODE=browser`) never compiles the system's stylesheet, so it renders no plugin output either.

## Token Sync

When config loads, the React app creates a Tailwind sync controller. It syncs each configured system by calling:

```text
POST /api/trickroom/tailwind/sync-tokens
```

The request targets exactly one system:

```json
{ "systemId": "sys_00000000-0000-4000-8000-000000000000" }
```

Legacy name and CSS-path targets are still accepted:

```json
{ "systemName": "Core" }
```

or exactly one CSS path:

```json
{ "cssPath": "src/index.css" }
```

CSS-path targets must match a configured system after path normalization. If multiple systems normalize to the same path, the route reports ambiguity.

Successful sync returns:

```ts
type TailwindSyncTokensResponse = {
  status: "ok" | "updated";
  systemId: string;
  systemName: string;
  cssPath: string;
  tailwindBaselineVersion: string;
  tokens: TailwindTokensForPresentation;
  baselineDiff: TailwindColorTokenBaselineDiff;
  syncedAt: string;
  reviewRequired: boolean;
  changes: "none" | "tailwind" | "project";
  reviewChanges: TailwindTokenReviewChanges | null;
};
```

`updated` means canonical token data changed and was written. `ok` means the stored canonical data still matches the current CSS. `changes` says what the sync changed: nothing, only Tailwind's reference values, or what the project defines (see [Review](#review-and-overrides)). `reviewChanges` lists the project's changes since the last confirmed review, `null` when nothing has been confirmed yet.

## What Gets Stored

Snapshots live at:

```text
.trickroom/systems/<safe-system-name>/tokens.json
```

Token snapshots use storage version `3` with one record per Tailwind token domain (for example `color`, `spacing`, `radius`, `font`, `shadow`, `ease`, and the other namespaces defined in `tailwind-token-domains.ts`). The snapshot lives beside `system.json`, and system-owned files such as `assets.json` and `icons.json` use the same system folder.

For each domain, Trickroom extracts the matching `@theme` namespace from the linked CSS, compares it to the generated default Tailwind baseline for that domain, and stores:

- `tokens`: meaningful added or overridden entries for the domain.
- `overrides`: confirmed reset patterns when defaults were removed.
- `baselineDiff`: per-domain `added`, `overridden`, and `removed` diagnostics.

Beside `domains`, at the top level:

- `stylesheets`: the fingerprint of the project's own stylesheets (see below).
- `authored`: what the stylesheets define, Tailwind's own left out (see below): per domain the theme values as written with their `@theme` options and the `initial` resets, and under `other` the theme variables outside the fixed domains.
- `confirmed`: the project definition the user last confirmed in a review, with the fingerprint at that time, or `null`.
- Each `customUtilities` entry has a `definition`: its `@utility` blocks in the order Tailwind sees them, normalized like the fingerprint (comments and insignificant whitespace out, strings as written).

All four are optional, so an older Trickroom still reads the file (see [Files And Safety](project-files.md#design-system-storage)).

Unchanged defaults are not persisted. The sync API still returns a color-focused `baselineDiff` field for presentation compatibility, but `tokens.json` stores all synced domains under `domains`.

The diff categories apply per domain:

- `added`: present in the system but absent from Tailwind defaults.
- `overridden`: present in both, but value differs after normalization.
- `unchanged`: present in both with equivalent values.
- `removed`: present in Tailwind defaults but missing from the system.

## Review And Overrides

A snapshot mixes two things: what the project defines, and Tailwind's reference values it is compared against. Only a change to the first needs review. Two checks decide it, and either one is enough: the project's own stylesheets, and what the stylesheets define.

**The project's stylesheets.** A sync fingerprints every stylesheet the design system loads whose real path is inside the project root and not under any `node_modules`, so Tailwind and other third-party packages (installed fonts, for example) are left out. Symlinks are resolved first, so a workspace package linked into `node_modules` counts by its source folder. The files are listed in the order Tailwind inlines them: depth first along `@import`/`@reference` in source order, nested ones (inside `@layer`) included, never the order their loads complete in. Each is hashed after normalizing its text token by token (postcss's tokenizer): comments are dropped without leaving anything in their place (a comment is not whitespace: `&/**/:hover` is `&:hover`, not `& :hover`; where dropping one would join two words, a bare `/**/` stays), runs of whitespace become one space, whitespace next to `{`, `}` or `;` is dropped, and strings, unquoted `url(…)` and whitespace after a backslash escape stay as written. The `@import` conditions are part of the importing file's text. Confirming a review records the fingerprint in `confirmed.stylesheets`.

**What the stylesheets define.** The theme entries every stylesheet but Tailwind's own defines (so the project's files, its packages, and anything imported from outside the project, by path or through a symlink), with their values as written and their `@theme` options, the `initial` resets in their `@theme` blocks, the custom properties and the custom utilities by definition. None of it depends on Tailwind's defaults.

From the confirmation on:

- Both unchanged: no review, whatever Tailwind's reference values did (`changes: "tailwind"` for an upgrade, `"none"` otherwise). Comment and whitespace edits to a project stylesheet usually change neither. The normalization only removes what it can tell is insignificant, so a few edits that cannot change the CSS still ask for review (a comment in `.a/**/.b` or `!/**/important`, spaces inside brackets such as `( min-width: 40rem )`).
- Either changed: review required (`changes: "project"`), until both match the confirmation again (reverting clears it) or the user confirms. A project stylesheet edit that defines nothing still requires review; so does a token value changed in an import from outside the project, which the fingerprint does not cover.

A confirmed state without a fingerprint (confirmed before fingerprints were recorded) is checked on what the stylesheets define alone until the next confirmation records one. A system without a confirmed state requires review on its first sync and on any change, and a pending review stays pending.

Syncs and confirmations of one system run one at a time, in arrival order, from reading the stylesheets to writing the snapshot, so a slower sync of older stylesheets cannot overwrite a newer one (and clear the review it required).

**The explanation: the delta.** The review lists what changed since the confirmation:

- Theme entries (as above): added, changed (confirmed value → incoming value, and `@theme` options (`inline`, `reference`, `default`, `static`) when they changed) and removed. A project's own `@theme default` counts; Tailwind's does not. Entries outside the fixed domains (`--app-color`) are listed with the custom properties.
- The `initial` resets, read from the CSS as postcss parses it (a commented-out reset is not one; a reset in a reset-only import is), as patterns.
- Custom properties and custom utilities, a utility by its definition.
- The changed stylesheets. When the fingerprint changed but no token-level change was found, the panel says so: "Theme files changed (files: …); no token-level change detected", and the user can still confirm.

Not part of it, Tailwind's reference values: `tailwindBaselineVersion`, the `defaultValue` of overridden and removed entries, which defaults exist (a default added or removed beneath an unchanged `--color-*: initial`), whether an authored value happens to equal a default, the baseline tokens the theme leaves alone, and the completion values and inferred domains of custom utilities. Overrides are not part of it either: a sync keeps the stored overrides, and only confirming a review changes them.

Snapshots synced before the authored theme and utility definitions were recorded compare the theme as resolved against the defaults (the added and overridden values and the removed default names; tokens equal to today's default and names Tailwind no longer has are left out) and utilities by what was recorded. A sync that finds the project unchanged that way records the authored data, in the snapshot and in its confirmed state. In that fallback a default Tailwind adds beneath a reset still counts as removed by the project, so a Tailwind upgrade in the first sync of an older snapshot can ask for one review; after that confirmation the authored data and the fingerprint decide.

The banner, the tokens panel, the systems list and the system pane show the same counts (`getTokenReviewCounts`): a reset added counts as removed, one removed as added, and changed stylesheets are counted apart. The full theme-vs-Tailwind diff stays available as the secondary "Theme vs Tailwind" view. A snapshot pending review without a confirmed state shows the full diff, labelled as a first review. A sync that changed only Tailwind's reference values shows a note in the tokens panel ("Tailwind defaults updated to 4.3.3; your tokens are unchanged").

If a system removes default Tailwind color tokens, the systems dialog can suggest reset patterns so the iframe theme matches the intended system more closely.

Examples:

- One removed token: `--color-red-500`
- A removed family: `--color-red-*`
- Every default removed: `--color-*`

Saving the review writes confirmed overrides, records the confirmed project definition and clears `reviewRequired`:

```text
POST /api/trickroom/tailwind/systems/:systemName/tokens
```

Request:

```json
{
  "domains": {
    "color": {
      "overrides": ["--color-red-*", "--color-black"]
    }
  }
}
```

The route accepts override strings matching:

```text
^--color-[a-z0-9\-*]+$
```

## Theme Injection

When a design links to a system, the editor reads the stored token snapshot and injects a managed Tailwind theme style into the design iframe:

```html
<style
  id="trickroom-system-theme"
  type="text/tailwindcss"
  data-trickroom-managed="system-theme"
>
  @theme {
    --color-brand-500: #2563eb;
  }
</style>
```

If the design is unlinked or no stored tokens exist, the managed style becomes:

```css
@theme {}
```

The hook manages the DOM injection. Tailwind browser compilation behavior is separate and may not reprocess every dynamically inserted style in every case.

## Classname Editing

The raw `className` string is the source of truth, and the inspector edits it as text. It does not derive visual controls from it.

The class field's autocomplete and validation come from Tailwind itself, not from a list Trickroom maintains:

- `GET /api/trickroom/tailwind/class-catalog?systemId=` loads the system's CSS the same way the canvas compile does (`@import "tailwindcss"` added when missing, stored theme tokens appended), runs Tailwind's `__unstable__loadDesignSystem`, and returns `getClassList()` names plus the expanded `getVariants()` names. Without `systemId` it returns baseline Tailwind. The server caches the loaded design system per CSS entry until the theme or any imported file changes. The browser caches the response and filters it locally on each keystroke.
- `POST /api/trickroom/tailwind/class-inspect` checks classes the catalog cannot settle alone (arbitrary values, opacity modifiers, unknown variants, typos) with `parseCandidate`/`candidatesToCss`. Unsupported classes come back with the same nearest-match suggestions MCP diagnostics use.

Parsing and classification below still drive class resolution (which inherited class a later class overrides), MCP diagnostics, and export.

## Parsing

`parseClassName()` is intentionally syntactic and round-trip oriented. It preserves:

- Original raw token.
- Mode prefixes, defaulting to `dark`.
- Non-mode variants such as `hover` or `md`.
- Important suffix, for example `bg-red-500!`.
- Negative prefix, for example `-mt-4`.
- Utility body.
- Utility prefix and value.
- Arbitrary values in brackets.
- Opacity modifiers after `/`.

It does not decide whether a class is a real Tailwind utility. That belongs to classification.

The tokenizer keeps bracketed and parenthesized content together, so values like `bg-[color:var(--brand)]` do not split incorrectly.

## Classification

`classifyParsedClass()` recognizes color, spacing, and style utility domains. Unrecognized classes remain `unknown` and may be checked against the linked Tailwind design system during MCP validation.

Recognized color property families include:

- `background`
- `text`
- `border`
- `ring`
- `outline`
- `fill`
- `stroke`
- `accent`
- `caret`
- `placeholder`
- `decoration`
- `divide`
- `shadow`
- `inset-shadow`
- `gradient-from`
- `gradient-via`
- `gradient-to`

The classifier avoids common false positives. For example, `text-sm`, `border-2`, `border-solid`, `bg-cover`, `ring-4`, `shadow-lg`, and gradient stop percentages are not treated as color choices.

Universal color keywords:

- `inherit`
- `current`
- `transparent`

`black` and `white` are treated as tokens, not universal keywords.

## Property Model

`buildPropertyModel()` groups recognized color classes by:

```text
(mode, property, variant chain)
```

Examples:

- `bg-red-500` belongs to default mode, background, default variant slot.
- `hover:bg-red-500` belongs to default mode, background, `hover`.
- `dark:hover:bg-red-500` belongs to `dark` mode, background, `hover`.

Tailwind's "later wins" behavior is preserved: if multiple classes occupy the same property slot, the last one wins in the model.

Unknown classes stay in the original ordered token list and are preserved during serialization.

## Mutations

Setting a color:

- Replaces the existing class in the same `(mode, property, variants)` slot when one exists.
- Appends a new class when the slot is empty.
- Rebuilds the model from the new string.

Clearing a color:

- Removes the class in the target slot.
- Does nothing when the slot is empty.
- Preserves unknown and unrelated classes.

Serialization:

- Emits `model.original.map((p) => p.raw).join(" ")`.
- Keeps order stable except for the exact class being replaced, appended, or removed.

## Resolved Colors

Resolved editor color tokens are based on:

```text
(Tailwind defaults - removed tokens) + meaningful stored tokens
```

This means:

- Defaults remain available unless the system removed them.
- Added tokens become available.
- Overridden defaults replace baseline values.
- Confirmed overrides help reset removed defaults in injected theme CSS.

## Merging

`deriveTwMergeConfig` (`src/utils/tailwind-merge-derive.ts`) turns a loaded system into a [tailwind-merge](https://github.com/dcastil/tailwind-merge) config: the keys of each theme namespace under the tailwind-merge theme key of the same name, each custom `@utility` that every sampled member of a stock class group can replace losslessly (and the other way round) in that group, every other one in a group of its own, and one-directional conflicts from those groups to the groups they fully override. The rules are in [Component Codegen](codegen.md#the-tailwind-merge-config). It is a plain JSON-serialisable object (`TwMergeConfig` in `src/utils/tailwind-merge-config.ts`, with `createTwMerge` to build the merge function), cached per compiled design system. Codegen writes it as `tw-merge.ts` with `codegen.twMerge` ([Component Codegen](codegen.md#the-tailwind-merge-config)) and, with that on, `code.redundant-class` merges with it ([Design System Lint](lint.md)). The design canvas merges component classes the same way, see [Canvas Class Merging](#canvas-class-merging).

## Canvas Class Merging

In code, a Component's classes are merged: its generated `tv()` variants merge the template, variant and compound classes, and the wrapper merges the instance's `className` over them (`twMerge(variants(…), className)`), so the last class wins. The canvas resolves an instance's classes the same way, instead of leaving conflicting classes to stylesheet order.

What merges, and how:

- Every node of a Component instance. Its classes are not read from its stored `className` but resolved from the Component version the instance records and the instance root's variant values and overrides: the registry Element's base classes, the template's classes for the node's path, the classes of the selected variant values (axes in codegen's layering order) and of the matching compound variants, then the override for the path. They merge in two passes, like the wrapper: `twMerge(twMerge(base + component classes), override)` (`renderComponentClassName` in `src/utils/class-merge.ts`).
- The registry Element's base classes (a Base UI Separator's `data-[orientation=horizontal]:w-full`) are the lowest layer of that merge, as in a wrapper that passes its Element's defaults to `twMerge` ahead of the variants (`twMerge("data-[orientation=horizontal]:w-full …", separatorVariants(), className)`), and as in code whose Element has no such default. A Component or override class that conflicts with a base class replaces it: an override `data-[orientation=horizontal]:w-[calc(100%+1.5rem)]` removes the base `data-[orientation=horizontal]:w-full`, without `!`. Base classes nothing conflicts with stay first. A Component class equal to a base class is kept: an override `data-[orientation=horizontal]:w-full` still beats the template's `data-[orientation=horizontal]:w-8`.
- This is the one order the canvas supports: Element defaults, then the Component's classes, then the override. A wrapper that should render like the canvas puts the library defaults first. A wrapper that puts them after its variants (`twMerge(separatorVariants(), defaults, className)`) lets a default win over a variant class it conflicts with: in code its `data-[orientation=vertical]:self-stretch` beats a variant's `data-[orientation=vertical]:self-center`, while the canvas renders `self-center`. The override comes last in both orders, so it beats the defaults either way. When no default conflicts with a Component class, both orders give the same result.
- In the System editor, the draft stage's preview of the template, variant and compound classes (no override there).
- Not raw elements, slot content or Recipe instances: code does not merge them either, so they render their base classes followed by their `className` as written.
- An instance whose version the system no longer has, or of another system, renders its stored `className`, unmerged.

What it merges with, decided per design by its system (`resolveClassMergeSettings` in `src/utils/class-merge-settings.ts`):

| Design | Merge |
| --- | --- |
| Linked to a system that `codegen.twMerge` generates the config for | The derived config, with `mergeGroups` |
| Linked to any other system | Stock tailwind-merge, which `tv()` uses without a config |
| No system, or one that does not resolve | None: classes resolve by stylesheet order |
| `codegen.twMerge` on, but the config cannot be derived | None, with an `error` |

`GET /api/trickroom/tailwind/class-merge?systemId=` returns that decision, `{ systemId, mode: "none" | "stock" | "derived", config?, error? }`, and, when classes merge, `components: { systemId, table }`: per Component and version (published versions and the draft), the template paths and classes, variants and override targets class resolution reads (`ComponentClassTable`). The derived config comes from the same cache as codegen and lint, so it is derived once per compiled design system and again only when the system's CSS changes.

The design route, the capture route and the System editor's draft stage load it (`useClassMerge`) and share it through `ClassMergeContext`. The boards render once it has loaded, so the canvas never paints unmerged classes first, and a capture is ready only after it. The request runs even when the browser reports itself offline (`networkMode: "always"`, the endpoint is local; so does the stored-theme query compiled canvas styles append) and times out after 8 seconds; a timeout or an error renders unmerged. When classes merge but the system's component manifest cannot be read, the response has no `components` and says why in `componentsError` (the server and the browser console warn); instances then render their stored `className`. A `mode: "none"` response is intentional and not reported.

It stays current while a design is open. The server's file events report `.trickroom/config.json` (a change to `codegen.twMerge` or `mergeGroups`), changes under `.trickroom/systems/` (components, tokens) and, as `tailwind-source` events, edits to the stylesheets the system's Tailwind CSS reads: its entry and every file it imports. The server's Tailwind caches register each file before reading it, so a load that fails (an `@import` of a missing file) is watched too: creating the missing file, or its folder, or repairing the entry reports an event, and the next request recovers. A missing folder is followed through its nearest existing parent folder only while a file waits for it. Each event refetches the merge settings, and a stylesheet edit also recompiles the canvas styles. Not watched: stylesheets outside the project and installed packages under `node_modules`. Imports resolve to real paths, so a workspace design-system package linked into `node_modules` is watched when it lives inside the project and not when it lives outside it (a shared package elsewhere in a monorepo, with the project in a subfolder). Edits to unwatched stylesheets show on the next refetch once the data is stale (after five minutes, when something triggers a refetch, such as focusing the window or opening the design again), or after a reload; nothing refetches on a timer.

Resolved classNames are cached per merge function and component table, by Component, version, path, base classes and the instance root's raw markers, so a board resolves each distinct instance state once. An internal node finds its instance root by walking up its parents (`useInstanceRootMarkers` in the design store), and re-renders when the root's variant values or overrides change.

`!important` classes are never removed by a class without `!`, and do not remove one: `flex !hidden` stays `flex !hidden`, so designs that use `!` to beat a Component's classes render as before. The workaround is no longer needed: `hidden` in an override now removes the Component's `flex`.

The HTML export resolves instances the same way (`exportDesignBoards` loads the settings and the component table for the design's system), so an exported board matches the canvas. Detaching an instance (inspector or `detachSystemComponent` over MCP) writes each detached layer's className exactly as it renders, through the same function as the canvas (`getRenderedClassName`) with the same component class source: resolved and merged when the canvas resolves it, the stored `className` when the canvas falls back to it (no merging, no component data, a version missing from it). The className includes the Element's base classes that survive the merge and is marked materialized, so the plain layers look as they did; nested instances and slot content keep their props. Persisted `className` strings of attached instances are not changed: they are what materialization writes, and they are only rendered when an instance cannot be resolved.

The inspector strikes through the inherited classes that merging removes ("Removed when the classes merge"), with the same two passes and the Element's base classes as the lowest layer (listed as **Element**), and the hint below the class field says the same for the instance's own classes.

## Current Limits

- Token sync stores color tokens only.
- Class parsing is syntactic; it is not a full Tailwind compiler. The inspector's unknown-class check asks the loaded Tailwind design system instead.
- Unknown utilities are preserved rather than interpreted.
- The linked-system token snapshot must exist before system colors are available in the picker.
