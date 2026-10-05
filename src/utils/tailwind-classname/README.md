# Tailwind className classification

Lossless parser (`parse.ts`) plus semantic utility domains. The class
composition panel, class resolution and MCP class diagnostics use them to
explain a className string. Nothing here rewrites className strings.

## Persisted output policy

Class resolution is render-composition and explanation metadata. It may mark
tokens as shadowed, but storage and mutation paths must keep user-authored
`className` strings in their authored order, including unknown tokens. Do not use
resolver output to normalize persisted strings until an explicit migration or
editor policy exists. The exported policy lives in `src/utils/class-layers.ts`.

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

2. **Registry** — append to `UTILITY_DOMAINS` in `domains/index.ts`. Order
   matters when prefixes overlap; more specific disambiguation should run first.

3. **Union types** — extend `KnownUtilityIntent` in `domains/types.ts`.

4. **Exports** — re-export public types from `index.ts`.

5. **Tests** — domain classifier cases in `<domain>.test.ts` or
   `classify.test.ts`.

Do **not** put Tailwind-specific rules in `parse.ts`. The parser stays syntactic.

## File map

| File | Role |
|------|------|
| `parse.ts` | Lossless tokenization (modes, variants, important, arbitrary) |
| `scope.ts` | Modifier-chain and utility-group conflict identity helpers |
| `domains/index.ts` | Ordered domain registry and `classifyKnownUtility` |
| `color.ts` | Color classifier |
| `registry.ts` | Color prefix registry and non-color sibling rules |
| `spacing.ts` | Spacing classifier |
| `classify.ts` | Public classify API |
