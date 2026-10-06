# Design System Lint

`trickroom lint` checks that a design system is used correctly on both sides of the code/design boundary: the React app that consumes the generated variants files (code side) and the Designs that place its components (design side). Rules are shipped code; which ones run, at which severity, is data in the system's `lint.json`. Every run writes one report per system, `lint-report.json`, which is committed and acts as the ratchet baseline for the next run. The dashboard in the System editor reads that report and computes nothing itself.

This page is the specification the lint work packages implement against (see [the analysis](proposals/design-system-lint.md) and [the work plan](proposals/design-system-lint-workplan.md)). Shapes marked **planned** are reserved for later packages and not yet produced.

## Architecture

Everything lives in `src/lint/`. Pure modules take data and return data; one filesystem adapter connects them to a project, the same split as `src/codegen/` (`generate.ts` versus `run-codegen.ts`).

| Module | Role |
| --- | --- |
| `contract.ts` | `SystemContract` and `buildSystemContract`: the system as serialisable data rules check against. |
| `config.ts` | `lint.json`: shape, issues, normalisation, defaults, `resolveLintConfig`. |
| `report.ts` | `LintReport` and `LintFinding`: stable ordering, validation, reader, atomic writer. |
| `ratchet.ts` | Tracked numbers, comparison with the baseline and the thresholds. |
| `rules/` | The rule kind interface (`types.ts`), the registry (`registry.ts`), the shipped kinds (`index.ts`, `code/`, later `design/`). |
| `source/` | The syntactic source model: `glob.ts`, `walk.ts` (file walker), `parse.ts` (`oxc-parser` module model), `index.ts` (project index and component identity), `locations.ts`. |
| `run-lint.ts` | The filesystem adapter: reads the project, builds the contract, indexes sources, runs the rules, ratchets, writes the report. |

Entry points: `src/cli/lint.ts` (`trickroom lint`, bundled by `vite.lint.config.ts` into `dist/lint.js`), `src/mcp/tools/lint.ts` (the `lint` MCP tool), `src/routes/system-lint.ts` (the Hono routes) and `src/queries/system-lint.ts` (the browser queries). All four call `runLint`; nothing else computes findings.

`oxc-parser` is the only dependency added. It is a native (napi) package, so every Vite SSR bundle keeps it external (`nativeRuntimeDependencies` in the `vite.*.config.ts` files, next to the optional `playwright-core`).

### A run

`runLint({ projectRoot, system?, check?, write? })`:

1. Reads `.trickroom/config.json` read-only (an invalid config, including an invalid `codegen` block, is an error).
2. Selects the system: the `system` option, else the `codegen` block's system, else the project's `defaultSystemId`, else the only system there is. Several systems and no selection is `NO_SYSTEM`.
3. Reads `components.json` and `tokens.json` read-only (nothing is migrated), then `lint.json` (an invalid one is an error, naming every problem).
4. Builds the `SystemContract`.
5. Runs the codegen check (`runCodegen` in check mode) when the project has a `codegen` block for this system. This runs the configured formatter command, as `trickroom codegen --check` does.
6. Walks the source globs, parses every file with `oxc-parser` and builds the project index (component identity, usages).
7. Runs every enabled rule kind of the registry and collects findings.
8. Builds the report, reads the committed report, computes the ratchet.
9. Writes the report according to the write mode (see [Ratchet](#ratchet)).

Design-side inputs (`designs` in the rule context) are null until WP4 wires them.

## Files

Both files live next to `system.json` in `.trickroom/systems/<key>/` and are committed. Both carry `version: 1` and are migrated like the other persisted shapes when the version moves. The file watcher reports changes to them as system files, so the browser refreshes the `trickroom-system-lint` query family; temporary `.tmp` siblings of the atomic writes are ignored.

### `lint.json`

Rule instances are data, one per rule kind, keyed by the rule kind id. One instance per kind keeps the file a plain object that diffs well and makes "the config of rule X" one lookup; a kind that needs different settings per component takes that in its `options` (for example an `only` or `except` list of slugs) rather than a second instance. Nothing in the engine prevents a list shape later, but no planned rule needs it.

```ts
type LintConfig = {
  version: 1;
  rules?: {
    [ruleKindId: string]: {
      enabled?: boolean;                     // default true
      severity?: "error" | "warning" | "info"; // default: the kind's defaultSeverity
      options?: Record<string, unknown>;     // kind-specific, documented per kind
    };
  };
  components?: {
    [slug: string]: {
      module?: string | string[];            // bound wrapper module(s), project-relative
    };
  };
  source?: {
    include?: string[];   // globs, project-relative; see defaults below
    exclude?: string[];   // globs; default ["**/*.d.ts"]
    classCalls?: string[]; // default ["tv","cn","clsx","cva","cx","twMerge","twJoin"]
  };
  thresholds?: {
    code?: { errors?: number; warnings?: number };    // maxima
    design?: { errors?: number; warnings?: number };  // maxima
    rules?: { [ruleKindId: string]: number };         // maximum findings per kind
    coverage?: {                                      // minima, in components
      published?: number; generated?: number; bound?: number;
      usedInApp?: number; usedInDesigns?: number;
    };
  };
};
```

Example:

```json
{
	"version": 1,
	"rules": {
		"code.variants-file-orphaned": { "enabled": false },
		"code.variants-file-stale": { "severity": "warning" }
	},
	"components": {
		"button": { "module": "src/components/ui/button.tsx" }
	},
	"source": {
		"include": ["src/**/*.{ts,tsx}"],
		"exclude": ["**/*.d.ts", "**/*.test.tsx"]
	},
	"thresholds": {
		"code": { "errors": 0 },
		"coverage": { "bound": 12 }
	}
}
```

Rules:

- Unknown keys, unknown rule kind ids (in `rules` and `thresholds.rules`), severities outside the three, non-integer or negative thresholds, absolute or `..` module paths are errors. A typo fails the run instead of being ignored, as with the `codegen` block.
- A planned rule kind cannot be configured before it ships: its id is unknown until then.
- Absent file: every shipped kind enabled at its default severity, the default globs, no thresholds. The report records `config.present: false`.
- `normalizeLintConfig` sorts the maps and trims strings; `serializeLintConfig` is the text the server and the dashboard (WP5) write. Defaults are applied in memory by `resolveLintConfig` and never written back.

**Default source globs.** The walker starts at the source-like root that contains the codegen `outDir`: the path up to and including the first segment named `src`, `app`, `lib`, `source` or `packages`, else the top-most segment. `src/components/ui` scans `src/**`, `packages/ui/src/variants` scans `packages/**`, `design-system/variants` scans `design-system/**`. Without a `codegen` block the default is `src/**`. Extensions: `ts, tsx, js, jsx, mjs, cjs`. `node_modules`, `dist`, `.trickroom` and every dot folder are never entered, and symlinks are skipped, whatever the globs say. The walk stops at 50,000 files with a `SOURCES_TRUNCATED` warning.

### `lint-report.json`

```ts
type LintReport = {
  version: 1;
  generatedAt: string;                      // ISO timestamp of the run
  system: { id: string; name: string };
  contract: { hash: string; components: number }; // what the run checked against
  config: { present: boolean };             // whether lint.json existed
  status: "pass" | "fail";                  // the ratchet outcome of this run
  summary: {
    code: LintSideSummary;
    design: LintSideSummary | null;         // null until WP4
  };
  findings: LintFinding[];
  components: LintComponentCoverage[];
  files: LintFileStats[];
  designs: LintDesignStats[] | null;        // null until WP4
  ratchet: LintRatchetResult;               // this run's comparison, see Ratchet
  ratchetBaseline: {
    generatedAt: string;                    // the passing run the numbers come from
    numbers: Record<string, number>;        // tracked numbers, see Ratchet
  };
};

type LintRatchetResult = {
  status: "pass" | "fail";
  baseline: { generatedAt: string; numbers: Record<string, number> } | null; // what this run compared against
  regressions: Array<{ metric: string; baseline: number; current: number }>;
  breaches: Array<{ metric: string; kind: "max" | "min"; limit: number; current: number }>;
  numbers: Record<string, number>;          // this run's tracked numbers
};

type LintSideSummary = {
  findings: { errors: number; warnings: number; info: number };
  rules: { [ruleKindId: string]: { errors: number; warnings: number; info: number } }; // every enabled kind of the side
  scanned: number;                          // code: source files; design: design files
};

type LintFinding = {
  rule: string;                             // rule kind id
  severity: "error" | "warning" | "info";
  side: "code" | "design";
  message: string;
  component?: string;                       // slug, when known
  location:
    | { kind: "code"; file: string; line?: number; column?: number }   // 1-based
    | { kind: "design"; design: string; board?: string; element?: string; path?: string }
    | null;
};

type LintComponentCoverage = {
  slug: string; componentId: string; name: string;
  published: boolean;                       // has a published version
  generated: boolean | null;                // variants file on disk and current; null without codegen
  bound: boolean | null;                    // a scanned module binds its variants file; null when nothing was scanned
  usedInApp: boolean | null;                // rendered by JSX in the scanned sources; null as above
  usedInDesigns: boolean | null;            // null until WP4
  wrappers: string[];                       // bound wrapper modules
  usages: number;                           // JSX usages in the scanned sources
};

type LintFileStats = {
  file: string;                             // project-relative, "/" separators
  role: "generated" | "wrapper" | null;
  component: string | null;                 // slug for generated and wrapper files
  usages: number;
  findings: { errors: number; warnings: number; info: number };
};

type LintDesignStats = {                    // planned (WP4)
  design: string; board: string | null;
  usages: number;
  findings: { errors: number; warnings: number; info: number };
};
```

Example (one stale file, one component used twice):

```json
{
	"version": 1,
	"generatedAt": "2026-03-01T10:00:00.000Z",
	"system": { "id": "sys_…", "name": "Core" },
	"contract": { "hash": "sha256:…", "components": 2 },
	"config": { "present": false },
	"status": "pass",
	"summary": {
		"code": {
			"findings": { "errors": 1, "warnings": 0, "info": 0 },
			"rules": {
				"code.variants-file-orphaned": { "errors": 0, "warnings": 0, "info": 0 },
				"code.variants-file-stale": { "errors": 1, "warnings": 0, "info": 0 }
			},
			"scanned": 4
		},
		"design": null
	},
	"findings": [
		{
			"rule": "code.variants-file-stale",
			"severity": "error",
			"side": "code",
			"component": "badge",
			"message": "Component \"badge\" is stale: the file body was edited or reformatted (…). Run \"trickroom codegen\" to regenerate.",
			"location": { "kind": "code", "file": "src/ui/badge.variants.ts", "line": 1, "column": 1 }
		}
	],
	"components": [
		{ "slug": "badge", "componentId": "cmp_…", "name": "badge", "published": true, "generated": false, "bound": false, "usedInApp": false, "usedInDesigns": null, "wrappers": [], "usages": 0 },
		{ "slug": "button", "componentId": "cmp_…", "name": "button", "published": true, "generated": true, "bound": true, "usedInApp": true, "usedInDesigns": null, "wrappers": ["src/ui/button.tsx"], "usages": 2 }
	],
	"files": [
		{ "file": "src/app.tsx", "role": null, "component": null, "usages": 2, "findings": { "errors": 0, "warnings": 0, "info": 0 } },
		{ "file": "src/ui/badge.variants.ts", "role": "generated", "component": "badge", "usages": 0, "findings": { "errors": 1, "warnings": 0, "info": 0 } },
		{ "file": "src/ui/button.tsx", "role": "wrapper", "component": "button", "usages": 0, "findings": { "errors": 0, "warnings": 0, "info": 0 } },
		{ "file": "src/ui/button.variants.ts", "role": "generated", "component": "button", "usages": 0, "findings": { "errors": 0, "warnings": 0, "info": 0 } }
	],
	"designs": null,
	"ratchet": {
		"status": "pass",
		"baseline": null,
		"regressions": [],
		"breaches": [],
		"numbers": { "code.errors": 1, "code.warnings": 0, "coverage.bound": 1, "…": 0 }
	},
	"ratchetBaseline": {
		"generatedAt": "2026-03-01T10:00:00.000Z",
		"numbers": { "code.errors": 1, "code.warnings": 0, "coverage.bound": 1, "…": 0 }
	}
}
```

Ordering, so the committed file diffs cleanly: findings by side, rule, location (file, line, column; design, board, element, path), severity, component, message; components by slug; files by file; designs by design then board; regressions and breaches by metric; every map by key. `files` lists only files that have a role, a usage or a finding; `summary.code.scanned` counts the rest. `writeLintReport` writes through a temp file and a rename, and only into a folder that resolves (symlinks followed) to a direct child of `.trickroom/systems`.

## The system contract

`buildSystemContract({ system, manifest, tokens, codegen })` turns the system manifest, the component manifest, the token snapshot and the resolved `codegen` block into one plain object. Rules read it; nothing in `src/lint/` touches a store. It is hashed (`sha256:` over a stable serialisation) so a report can say what it checked against.

```ts
type SystemContract = {
  version: 1;
  system: { id: string; name: string; cssPath: string | null };
  codegen: {
    configured: boolean;
    outDir: string | null;           // project-relative; null when unconfigured
    fileName: string;                // pattern, default "{slug}.variants.ts"
    tvImport: string;
    shape: "auto" | "slots";
  };
  components: SystemContractComponent[];   // sorted by slug
  tokens: {
    domains: Record<TailwindTokenDomain, string[]>; // resolved names: defaults minus removed, plus added
    customUtilities: Array<{ root: string; kind: "functional" | "static" }>;
    snapshot: { syncedAt: string; reviewRequired: boolean } | null;
  };
  hash: string;
};

type SystemContractComponent = {
  componentId: string; slug: string; name: string;
  publishedVersion: string | null;   // drafts are never linted
  fileName: string;                  // from the codegen pattern (src/codegen/names.ts)
  exportName: string;                // e.g. otpFieldVariants
  shape: "flat" | "slots" | null;    // null: unpublished or invalid codegen model
  slots: Array<{ key: string; path: string; className: string }>;
  axes: Array<{
    key: string; typeAlias: string; boolean: boolean;
    values: Array<{ key: string; classes: Array<[slotKey: string, className: string]> }>;
    default: string | boolean | null;
    required: boolean;               // no default and not boolean
  }>;
  compounds: Array<{ when: Array<[axisKey, value | value[]]>; classes: Array<[slotKey, className]> }>;
  designOnlyPaths: string[];         // template paths flagged design-only, descendants included
  codegen: { selected: boolean; issues: string[] }; // selected by include/exclude and valid
};
```

Slots, axes, compounds and the shape come from `src/codegen/model.ts`, so a rule sees exactly what the generated file contains. The axis order is codegen's layering order. Without a `codegen` block the codegen defaults apply so `fileName` and `exportName` are still meaningful. Design-only paths are read from the optional `designOnly` flag on template nodes (WP1), inherited by descendants.

**What stays out of the contract.** The compiled Tailwind design system (the utility inspector that answers "is `text-brand-500` a real utility here") is heavy to load and not serialisable, so it is not part of the contract. The rule context provides it lazily: `context.tailwind.inspector()` compiles the system's `cssPath` on first use, once per run, and returns null when there is no CSS or it fails to compile. Token names per domain are in the contract, so token-membership checks need no inspector.

## Rule kinds

A rule kind is an object in `src/lint/rules/`:

```ts
type LintRuleKind = {
  id: string;                        // "<side>.<kebab-name>", the key in lint.json and the report
  side: "code" | "design";
  defaultSeverity: "error" | "warning" | "info";
  description: string;
  run: (context: LintRuleContext) => LintRuleFinding[] | Promise<LintRuleFinding[]>;
};

type LintRuleContext = {
  projectRoot: string;
  contract: SystemContract;
  config: ResolvedLintConfig;        // every rule instance, the source config, thresholds
  rule: ResolvedLintRule;            // this instance: enabled, severity, options
  codegen: CodegenRunResult | null;  // the check-mode result; null without a codegen block
  sources: SourceIndex;              // parsed modules, generated files, identities, usages
  designs: null;                     // WP4
  tailwind: { inspector: () => Promise<{ inspect(candidate: string): TailwindUtilityInspection } | null> };
};

type LintRuleFinding = {
  message: string;
  location: LintLocation | null;
  component?: string;                // slug
  severity?: "info";                 // only for notes that are not violations
};
```

The runner stamps `rule` and `side` on each finding and gives it the instance's severity; a finding may only lower itself to `info` (for example "codegen not configured, skipped"). A rule that throws fails the run (`RULE_FAILED`, exit 2) rather than silently passing. Kinds are registered in `src/lint/rules/index.ts` (`LINT_RULE_KINDS`, catalogue order); the registry rejects malformed or duplicate ids. Each kind has tests next to it on fixture input.

### Catalogue

Code side:

| Id | Default | Status | Checks |
| --- | --- | --- | --- |
| `code.variants-file-stale` | error | shipped (WP2) | A published component's variants file is missing, stale (`source-changed`, `body-edited`, `not-generated`) or could not be checked; codegen errors (formatter, paths). Without a `codegen` block: one `info` finding, no violations. |
| `code.variants-file-orphaned` | warning | shipped (WP2) | A file in `outDir` carries this system's header but no selected component generates it. |
| `code.wrapper-missing-variants-call` | error | shipped (WP3) | A bound wrapper never calls its component's variants export (directly, through an alias or namespace, or a slot of its result). |
| `code.slot-not-called` | warning | shipped (WP3) | A slot the generated file exports is never invoked in any wrapper of the component. |
| `code.unknown-variant-value` | error | shipped (WP3) | A JSX attribute, or a literal object passed to the variants export or a slot, gives an axis a literal value it does not have. |
| `code.required-axis-missing` | error | shipped (WP3) | A usage or a variants call omits an axis without a default. |
| `code.unknown-class-token` | warning | shipped (WP3) | A class string uses a token or utility the system does not define. Options: `allow`, `scope`. |
| `code.redundant-class` | warning | shipped (WP3) | A usage's `className` repeats a class the component's base or selected variants already provide. |
| `code.variants-imported-outside-component` | error | shipped (WP3) | A module other than the wrapper imports the variants file directly (re-exports from the wrapper are the sanctioned way). |
| `code.component-styling-restricted` | warning | shipped (WP3) | Configurable: styling of component X is allowed only in X's wrapper and the files its options allow. Options: `components`. Does nothing until configured. |

Design side (planned, WP4; run by the engine and by `design_validate`):

| Id | Default | Checks |
| --- | --- | --- |
| `design.unknown-class-token` | warning | The class and token checks of `getDesignDiagnostics`, configurable per system. |
| `design.design-only-class-target` | error | A variant or compound class entry targets a design-only node. |
| `design.unknown-variant-value` | error | An instance passes a variant value the axis does not have. |

Options are documented per kind when it ships. Ids are stable once shipped: they are keys in committed files.

### Code-side kinds (WP3)

The kinds after the codegen pair live in `src/lint/rules/code/` and share `analysis.ts`, computed once per run: for every module, where a component's variants export is in scope (an import from the generated file, or any import that resolves to it through re-exports, barrels and `import { x } from; export { x }`), the calls of it, and the slot calls on its result (`traceCallOrigin` with a one-element path naming a contract slot). A name counts only when it resolves to an import binding at the call, so shadowing parameters and locals are not variants calls. Generated files are never checked.

Shared behaviour:

- Every finding carries the component slug when there is one and a 1-based code location from the source model. A rule that cannot decide skips; invalid options become one `info` finding naming the problem, never a failure.
- **Shadowing.** A JSX usage counts only when its element name (`Button`, or `UI` for `<UI.Button>`) resolves at the element, through the scope tree, to the import binding. `<Button>` inside `(Button) => …` or after a local `const UI = …` is something else and is skipped.
- **Wrapper modules.** The rules check the modules that implement a component: the index's `wrappers`, except that a configured `components[slug].module` that does not import the generated file itself (a barrel) is followed through its re-exports (`export { x } from`, `export * from`, and `import { x }; export { x }`) to the importers of the generated file it reaches. The index binds usages through the barrel (the `resolveExport` chain); the rules look from the barrel down to the code. A configured module that reaches no importer is checked as it is.
- **The component's own export.** JSX checks (`unknown-variant-value`, `required-axis-missing`, `redundant-class`) apply to usages that render the component itself, not every export of its wrapper: the export named after the slug or the name in PascalCase (`Button`, `OtpField`) or the default export. A member element (`<Card.Title>`) never counts. A wrapper that exports none of those names has no recognisable main export, and every export counts.
- **Literal values.** A string, number or boolean literal (`variant="x"`, `variant={"x"}`, `size={2}`, a bare attribute as `true`) is judged; anything else (identifiers, expressions, `null`) is skipped. A literal JSX attribute followed by a `{...spread}` in source order may be overridden at runtime and is skipped like a dynamic value; a spread before it does not matter. The same holds for literal object properties followed by a spread.

Per kind:

- `code.wrapper-missing-variants-call`: every module in `wrappers` (configured, else the importers) must call the variants export. A module that imports the export only to pass it on (`export { buttonVariants }`) is still an importer, so it is reported with the hint to use `export { … } from` instead. A configured wrapper that does not import the export at all is reported too.
- `code.slot-not-called`: slots shape only. The slot calls of every wrapper of the component are pooled; a slot that is referenced (`styles.title`) but never invoked does not count. Nothing is reported for a component whose wrappers never call the variants export (that is the previous kind's finding). The location is the first variants call.
- `code.unknown-variant-value`: JSX attributes named like an axis, and literal-keyed properties of a literal object passed as the first argument of the variants export or a slot function. A property a later spread may override is skipped. Boolean axes accept `true` and `false`, as literals, strings or a bare attribute. Attributes that are not axes are ignored.
- `code.required-axis-missing`: axes with `required: true`. JSX: a usage with a spread is skipped. Calls: only calls of the variants export itself (slot calls take overrides, not the full set); no argument at all counts as missing, a non-literal argument (`buttonVariants(props)`) or an object with a spread or a computed key is skipped. One finding per missing axis.
- `code.unknown-class-token`: every complete class string (`classStrings`, through `className` and the configured class calls; template fragments are skipped) runs through `src/utils/class-token-diagnostics.ts`, the pipeline the design diagnostics use: theme tokens per domain from the contract (`tokens.domains`; tokens removed from the Tailwind defaults stay unavailable), arbitrary values in token domains (`bg-[#fff]`), and `context.tailwind.inspector()` for classes the token tables cannot decide (`UNKNOWN_TAILWIND_UTILITY`). Without a token snapshot only the inspector check runs; without both, one `info` finding. Options:
  - `allow: string[]`: class globs (`*` any run, `?` one character) or exact classes never reported. Matched against the class as written and without its variants, so `"prose"` also allows `md:prose`.
  - `scope: "wrappers" | "usages" | "all"` (default `"all"`): `wrappers` checks the wrapper modules only, `usages` the modules that render a bound component, `all` every scanned module (the app is where the system's tokens are used, bound or not).
- `code.redundant-class`: the classes a usage's `className` repeats from the component's root slot: its base classes and the root classes of the variant value each axis selects. A literal attribute selects its value unless a later spread may override it; an absent attribute selects the axis default unless the element has a spread; a dynamic value selects nothing. A `className` followed by a spread is skipped. Compound variants are not considered. Exact class matches only (`p-2` next to a base `p-4` is an override, not a repeat).
- `code.variants-imported-outside-component`: with `components[slug].module` configured, every module with a value import of the generated file other than the component's wrapper modules (a configured barrel counts through the modules it re-exports, see above). Without it, nothing is reported for a single importer; with several, the importer named like the component (`button.tsx` or `button/index.tsx` for slug `button`, or the generated file's stem) is the component and the others are findings; when no importer or several are named like that, each importer is reported, asking for `components[slug].module`. Type-only imports and re-exports never count.
- `code.component-styling-restricted`: options `{ components: { [slug]: { allowIn: string[] } } }` with project-relative file globs. A module outside `allowIn` that calls the component's variants export or a slot function, or imports the export without calling it, gets one finding per component at its first call (or the import). The component's own wrapper is always allowed: the configured module, else the only importer, else the importer named like the component (as above). Unknown slugs and malformed entries are noted as `info`. Without options the kind produces nothing.

## The source model

`src/lint/source/` is syntactic: `oxc-parser` parses each file (TypeScript and JSX supported, no type checker, no evaluation), and `parseSourceModule` reduces it to:

- `imports`: specifier, imported and local names (`default`, `*` for namespaces), type-only flag, and `resolved` (filled by the index).
- `exports` and `reexports` (`export { x } from`, `export * from`, `export * as ns from`). A re-export carries a type-only flag per name, so `export { type Props, Button } from "./button"` keeps `Button` a value; the statement-level `type` is true only when every name is a type.
- `jsx`: every element with its name (`Button`, `UI.Button`, `svg:path`), attributes whose values are string or primitive literals (`variant="danger"`, `variant={"danger"}`, bare attributes as `true`), `unknown` for anything else, whether a spread is present (`spread`) and where each spread starts (`spreads`, source order; added by WP3), so a rule can tell a literal a later spread may override from one after the spread.
- `classStrings`: every string literal under a `className` attribute or a class call (`tv`, `cn`, `clsx`, `cva`, `cx`, `twMerge`, `twJoin`; configurable), through conditionals, logical expressions, arrays, templates and nested calls. `tv`/`cva` configs are walked by their keys (`base`, `slots`, `variants`, `compoundVariants`, `compoundSlots`; conditions and defaults are not classes); `clsx`-style object keys are classes. `complete` is false for a template fragment; `mixed` is true when the enclosing expression also had non-literal parts.
- `calls`: every call with its callee path (`buttonVariants`, `styles.root`) and its arguments. A call on another call's result (`buttonVariants().root()`, `(await load()).title()`) is recorded too, with `callee` written as `buttonVariants().root`, `root` the inner call's root, `members` the path after the inner call, and `receiver: { call, path }` naming that inner call; `receiver` is null when the callee starts with an identifier. `calls` is in traversal order: a call on a call result comes before its receiver call, which starts at the same position. A literal object argument is `{ kind: "object", properties, keys, members, hasSpread, hasComputed }`: `properties` maps literal keys to literal values (or `unknown`), `keys` lists them in source order, `members` lists every member in order as `{ kind: "property", key }`, `{ kind: "spread" }` or `{ kind: "computed" }`, so a rule can tell a missing axis from one a spread may supply and see what a later spread can override. Other arguments are literals or `unknown`.
- `scopes`: the lexical scope tree. Scope 0 is the module; every function or arrow (parameters live there), block, `for` head, `catch` clause and class body nests under its `parent`, with the `start`/`end` positions it covers and its `bindings` in source order: `{ name, kind, position, origin }` with `kind` one of `const`, `let`, `var` (hoisted to the nearest function or module scope), `function` (hoisted, declared in the enclosing scope; a named function expression binds inside itself), `class`, `parameter` (including destructured and default parameters), `catch`, `import`, `enum`, `namespace`. `origin` is `{ call: { callee, root, members, position }, path }` when the value comes from a call, else null: `[]` for `const s = buttonVariants()`, `["root"]` for `const r = buttonVariants().root` and `const { root: r } = buttonVariants()`, `["0"]` for `const [a] = f()`; `await f()` is `f()`; a `...rest` binding has no origin.
- `callResultUses`: every member access taken directly off a call result, `{ call, path, invoked, position }`: `buttonVariants().root;` is `invoked: false`, `buttonVariants().root()` is `invoked: true` (and that call is also in `calls` with its `receiver`). Only the outermost access of a chain is recorded (`f().a.b` is one use with path `["a", "b"]`), so `buttonVariants().root()` and `buttonVariants().root;` are different modules: a rule can tell an invoked slot from a referenced function.
- `declarations`: the bindings with an origin, flattened in source order as `{ name, call, path, scope, position }` (`scope` indexes `scopes`), for rules that list every `const s = buttonVariants()` without walking the tree.
- `traceCallOrigin(module, call)` resolves a call site's receiver with the language's rule: `resolveBinding` finds the innermost scope containing the call (`scopeAt`), walks outward to the first scope declaring the name, and takes that binding (within one scope, the last declaration before the use, else the first, for hoisted functions). For `s.title()` after `const s = buttonVariants()` it returns the `buttonVariants` call and the full path `["title"]`; an inner `const s`, parameter, catch or destructured name shadows the outer binding, and a binding without an origin (a parameter, `const s = 1`) yields null. A call with a `receiver` is followed through it: `buttonVariants().root()` gives the `buttonVariants` call and `["root"]`, `s.root().x()` gives `buttonVariants` and `["root", "x"]`, `f().a().b()` gives `f` and `["a", "b"]`. Assignments after declaration (`s = other()`) are not followed.
- `codegenHeader`: the Trickroom header when the file is a generated variants file.

`buildSourceIndex` resolves relative specifiers against the scanned files (extensions, `.js` to `.ts`, index files; bare and aliased specifiers stay unresolved), finds the generated files of the system by header, and derives component identity:

- The modules with a value import of a component's generated file are its `importers`; the `wrappers` are the configured `components[slug].module` entries when set, else the importers. A configured module that was not scanned is listed in `missingConfiguredWrappers`, reported by the run as a `WRAPPER_MODULE_NOT_SCANNED` warning and never counts as a wrapper, so the component is unbound rather than silently bound (or silently handed back to the importers). Re-exporting modules are `reexporters`: they borrow the styling and do not bind. Importers and re-exporters come from reverse indexes built once over the modules, so identity costs the size of the sources, not components times files.
- `bindings` map, per module, local names to component slugs by following imports through barrels (`export * from`, `export { Badge as Pill } from`) to a wrapper. Every module on the way is checked, nearest to the importer first, so a configured barrel (`components.button.module = "src/ui/index.ts"`) binds what it re-exports; any value exported by a wrapper counts as that component. `resolveExport` returns the defining module, the name there and the `chain` of modules visited.
- `usages` are the JSX elements whose name resolves to a bound component, including namespace members (`<UI.Button>`).

These feed the coverage rows (`bound`, `usedInApp`, `usages`) and the heat map (`files`). WP3's rules build on the same index.

## Ratchet

A run compares its tracked numbers with the committed report's `ratchetBaseline.numbers` and with the thresholds in `lint.json`. It fails when any tracked number got worse, or any threshold is broken.

Tracked numbers:

| Metric | Direction |
| --- | --- |
| `code.errors`, `code.warnings`, `design.errors`, `design.warnings` | lower is better |
| `rule.<kind id>`: errors plus warnings of that kind | lower is better |
| `coverage.published`, `coverage.generated`, `coverage.bound`, `coverage.usedInApp`, `coverage.usedInDesigns`: components in that state | higher is better |

`info` findings are not tracked. A number missing on either side counts as 0, so switching a kind off or a kind that has not shipped never fails a run; a null coverage state counts as 0. Thresholds are maxima for errors, warnings and per-kind counts, minima for coverage.

Two blocks of the report carry the ratchet, with different jobs:

- `ratchet` is **this run's comparison**: the baseline it compared against (with that baseline's numbers), the regressions, the breaches and this run's numbers. It is what the dashboard shows as the delta against the committed baseline. On a passing improvement from one error to zero, `ratchet.baseline.numbers["code.errors"]` is still 1 and `ratchet.numbers["code.errors"]` is 0.
- `ratchetBaseline` is **the forward-looking baseline**: what the next run compares against.

Outcome and the baseline:

- **First run** (no committed report): passes with `ratchet.baseline: null`, and its numbers become the baseline.
- **Pass**: the report is written with `ratchetBaseline` set to this run's numbers.
- **Fail**: `trickroom lint` and the `lint` tool write nothing, so the committed baseline stands. The dashboard's `POST` runs with `write: "always"`: the failing report is written (so the UI can show it) but its `ratchetBaseline` is carried over from the previous report. The next run still ratchets against the last passing numbers; a failing report never lowers the bar. The working tree then shows a modified `lint-report.json` with `status: "fail"` that should not be committed as-is.
- `--check` never writes, whatever the outcome.
- An unreadable committed report (invalid JSON, unsupported version, a folder or a permission problem in its place) is reported as `INVALID_BASELINE` and the run starts a new baseline.

`LintRatchetResult`, returned by every entry point and stored as the report's `ratchet`: `{ status, baseline: { generatedAt, numbers } | null, regressions: [{ metric, baseline, current }], breaches: [{ metric, kind: "max" | "min", limit, current }], numbers }`.

## CLI

```sh
trickroom lint [project] [--check] [--json] [--system <id|name>]
```

| Flag | Meaning |
| --- | --- |
| `--check` | Compare and report, write nothing. For CI and pre-commit. |
| `--json` | Print the `LintRunResult` alone on stdout: `status`, `mode`, `system`, `report`, `ratchet`, `baseline` (`absent`, `invalid`, `present`), `reportPath`, `written`, `diagnostics`. |
| `--system` | Select a system by id, name or storage key. |

Exit codes: 0 pass, 1 ratchet failure, 2 error (no project, invalid config or `lint.json`, unknown or ambiguous system, a crashed rule, a refused write, or anything the engine did not foresee, reported as `RUN_FAILED`). An error never escapes `runLint` as an exception, so `--json` output stays valid. Human output lists each side's counts, then findings grouped by rule kind with their location, then every number that got worse and every threshold broken, then one closing line.

`pnpm build:lint` builds `dist/lint.js`; `pnpm build` includes it.

## MCP

The `lint` tool (`src/mcp/tools/lint.ts`, group `designValidation`) takes `check`, `system` and `response` (`"summary"` default, `"full"` adds the whole report) plus the usual `project` override, and returns `{ status: "success", project, lint }` where `lint` is the run result without the report (`status`, `mode`, `system`, `ratchet`, `baseline`, `reportPath`, `written`, `diagnostics`, `generatedAt`, `summary`) and, with `response: "full"`, the `report`. A run that cannot complete is a tool error `LINT_FAILED` with the diagnostics. It needs read-write mode in every case, like `design_export`, because the codegen check runs the project's formatter and a non-check run writes the report.

## HTTP

| Route | Behaviour |
| --- | --- |
| `GET /api/trickroom/systems/:systemHandle/lint` | `{ systemId, systemName, report }`; 404 `{ error, code: "LINT_REPORT_NOT_FOUND" }` before the first run; 409 `LINT_REPORT_INVALID` when the file cannot be read. |
| `POST /api/trickroom/systems/:systemHandle/lint` | Runs the engine for that system with `write: "always"` and returns `{ systemId, systemName, status, report, ratchet, written, diagnostics }`; 500 `LINT_FAILED` with `diagnostics` when the run cannot complete. |

Browser side, `src/queries/system-lint.ts`: `systemLintQueryOptions(systemId, projectScope)` (key prefix `trickroom-system-lint`, refreshed by file events on `lint.json` and `lint-report.json`), `runSystemLint(systemId)` for a mutation, `invalidateSystemLint`.

## For the later packages

- **WP3 (code-side rules)**: add kinds under `src/lint/rules/code/` and append them to `LINT_RULE_KINDS`. Use `context.sources` for identity (`components[].wrappers`, `importers`, `reexporters`), bindings and usages, `context.contract` for axes, slots and tokens, and `context.tailwind.inspector()` for utility checks. Locations come from `SourceModule` positions (1-based line and column). Document each kind's options in the catalogue above.
- **WP4 (design-side rules)**: add kinds under `src/lint/rules/design/`, replace `designs: null` in the context with the design inputs, fill `summary.design`, `designs` and `usedInDesigns` in `run-lint.ts`, and call the same kinds from `design_validate` with the system's resolved config. Design locations use `{ kind: "design", design, board, element, path }`.
- **WP5 (dashboard)**: read `systemLintQueryOptions`; run with `runSystemLint`; edit `lint.json` through the server with `serializeLintConfig`. Adherence comes from `summary` and the report's `ratchet` block: `ratchet.numbers` against `ratchet.baseline.numbers` is the delta against the committed baseline, `regressions` and `breaches` are what to flag, and the thresholds themselves are in `lint.json` (`breaches` carry each broken limit). `ratchetBaseline` is only what the next run will compare against. Coverage comes from `components`, the heat map from `files` (and `designs` once WP4 fills it).
