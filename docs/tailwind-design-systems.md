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
};
```

`updated` means canonical token data changed and was written. `ok` means the stored canonical data still matches the current CSS.

## What Gets Stored

Snapshots live at:

```text
.trickroom/systems/<safe-system-name>/tokens.json
```

Token snapshots use storage version `2` with one record per Tailwind token domain (for example `color`, `spacing`, `radius`, `font`, `shadow`, `ease`, and the other namespaces defined in `tailwind-token-domains.ts`). The snapshot lives beside `system.json`, and system-owned files such as `assets.json` and `icons.json` use the same system folder.

For each domain, Trickroom extracts the matching `@theme` namespace from the linked CSS, compares it to the generated default Tailwind baseline for that domain, and stores:

- `tokens`: meaningful added or overridden entries for the domain.
- `overrides`: confirmed reset patterns when defaults were removed.
- `baselineDiff`: per-domain `added`, `overridden`, and `removed` diagnostics.

Unchanged defaults are not persisted. The sync API still returns a color-focused `baselineDiff` field for presentation compatibility, but `tokens.json` stores all synced domains under `domains`.

The diff categories apply per domain:

- `added`: present in the system but absent from Tailwind defaults.
- `overridden`: present in both, but value differs after normalization.
- `unchanged`: present in both with equivalent values.
- `removed`: present in Tailwind defaults but missing from the system.

## Review And Overrides

If a system removes default Tailwind color tokens, the systems dialog can suggest reset patterns so the iframe theme matches the intended system more closely.

Examples:

- One removed token: `--color-red-500`
- A removed family: `--color-red-*`
- Every default removed: `--color-*`

Saving the review writes confirmed overrides and clears `reviewRequired`:

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

`deriveTwMergeConfig` (`src/utils/tailwind-merge-derive.ts`) turns a loaded system into a [tailwind-merge](https://github.com/dcastil/tailwind-merge) config: the keys of each theme namespace under the tailwind-merge theme key of the same name, and each custom `@utility` in the class group whose stock utility generates the same declarations. It is a plain JSON-serialisable object (`TwMergeConfig` in `src/utils/tailwind-merge-config.ts`, with `createTwMerge` to build the merge function), cached per compiled design system. Codegen writes it as `tw-merge.ts` with `codegen.twMerge` ([Component Codegen](codegen.md#the-tailwind-merge-config)) and `code.redundant-class` merges with it ([Design System Lint](lint.md)). The design canvas does not merge class layers yet: `flattenClassLayers` concatenates them.

## Current Limits

- Token sync stores color tokens only.
- Class parsing is syntactic; it is not a full Tailwind compiler. The inspector's unknown-class check asks the loaded Tailwind design system instead.
- Unknown utilities are preserved rather than interpreted.
- The linked-system token snapshot must exist before system colors are available in the picker.
