# Tailwind className model

Lossless parser (`parse.ts`) plus semantic utility domains that power the Style
inspector. Unknown classes are preserved in original order and round-trip
unchanged.

## Persisted output policy

Class resolution is render-composition and explanation metadata. It may mark
tokens as shadowed, but storage and mutation paths must keep user-authored
`className` strings in their authored order, including unknown tokens. Do not use
resolver output to normalize persisted strings until an explicit migration or
editor policy exists. The exported policy lives in `src/utils/class-layers.ts`.

## Slot identity

Every recognised utility occupies one slot keyed by:

- **mode** — `parsed.modes` joined with `:`, or `""` for the default bucket
- **property** — domain-specific semantic key (`background`, `padding-x`, …)
- **variant** — `parsed.variants` joined with `:`, or `""` for the default slot

Mutations replace only the exact `(mode, property, variant)` slot. Shared helpers
live in `slots.ts` (`resolveSlotTarget`, `formatWithVariantChain`,
`replaceOrAppendRaw`, `removeRawAtIndex`).

## Conflict Scope

The shared resolver foundation treats a known utility's conflict identity as:

- **utility group** — the classified semantic property, prefixed by intent kind
  (for example `style:size.height`)
- **modifier chain** — every Tailwind modifier before the utility body in source
  order, joined with `:`

Two utilities may shadow each other only when both the utility group and modifier
chain match. Scoped utilities do not shadow unscoped utilities unless a future
resolver rule explicitly models that relationship. For example,
`data-[orientation=horizontal]:h-px` and `h-2` are distinct scopes, while
`data-[orientation=horizontal]:h-px` and
`data-[orientation=horizontal]:h-2` share one height scope.

## Adding a new utility domain

1. **Domain module** — add `src/utils/tailwind-classname/<domain>.ts` with:
   - `<Domain>Property` union
   - `<Domain>Intent` (`kind: "<domain>"`, `property`, typed `value`, …)
   - `classify<Domain>ParsedClass(parsed): <Domain>Intent | null`
   - `PROPERTY_TO_PREFIX` map for serialization
   - value formatter used by `set<Domain>` (arbitrary brackets, keywords, etc.)

2. **Registry** — append to `UTILITY_DOMAINS` in `domains/index.ts`. Order
   matters when prefixes overlap; more specific disambiguation should run first.

3. **Union types** — extend `KnownUtilityIntent` and `PropertyKey` in
   `domains/types.ts` and `model.ts`.

4. **Mutations** — add `set<Domain>` / `clear<Domain>` in `model.ts` using
   `applyPropertyMutation` / `clearPropertyMutation` (or the same slot helpers).

5. **Exports** — re-export public types from `index.ts`.

6. **Tests** — domain classifier cases in `<domain>.test.ts` or `classify.test.ts`;
   slot grouping and mutation tests in `model.test.ts`; assert unknown classes
   still serialize unchanged after edits.

Do **not** put Tailwind-specific rules in `parse.ts`. The parser stays syntactic.

## File map

| File | Role |
|------|------|
| `parse.ts` | Lossless tokenization (modes, variants, important, arbitrary) |
| `slots.ts` | Shared slot keys and className splice helpers |
| `scope.ts` | Modifier-chain and utility-group conflict identity helpers |
| `domains/index.ts` | Ordered domain registry and `classifyKnownUtility` |
| `color.ts` | Color classifier |
| `registry.ts` | Color prefix registry and non-color sibling rules |
| `spacing.ts` | Spacing classifier and prefix map |
| `classify.ts` | Public classify API |
| `model.ts` | `PropertyModel`, build, serialize, mutations |
