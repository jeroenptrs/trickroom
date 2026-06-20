# Tailwind Systems And Classname Editing

Trickroom treats Tailwind as both a design-token source and an authoring language. A design can link to a configured Tailwind system, and each element can store a raw `className` string that the sidebar turns into focused property controls.

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

## Classname Editing Model

The raw `className` string remains the source of truth.

The property UI works by deriving a structured model from that string:

1. Tokenize the class string.
2. Parse each class syntactically.
3. Classify recognized color utilities.
4. Group them into editable property slots.
5. Mutate the class string minimally.
6. Serialize back to `className`.

This is similar to a Tailwind-aware sidebar: the user sees property controls, but the durable data is still the class list.

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

## Visible Color Controls

The UI currently exposes three color controls:

- Background.
- Text.
- Border.

Each control reads the property model, lists resolved color tokens for the linked system, and writes back to the same raw `className` string.

The model already understands more color families than the UI displays, so future controls can use the same parser and serializer.

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

## Current Limits

- Token sync stores color tokens only.
- The visible property UI edits only background, text, and border.
- Class parsing is syntactic; it is not a full Tailwind compiler.
- Unknown utilities are preserved rather than interpreted.
- The linked-system token snapshot must exist before system colors are available in the picker.
