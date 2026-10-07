# Design System Lint

`trickroom lint` checks that a design system is used correctly on both sides of the code/design boundary: the React app that consumes the generated variants files (code side) and the Designs that place its components (design side). Rules are shipped code; which ones run, at which severity, is data in the system's `lint.json`. Every run writes one report per system, `lint-report.json`, which is committed and acts as the ratchet baseline for the next run. The dashboard in the System editor reads that report and computes nothing itself.

This page is the reference for the engine, its two files and its entry points. Why it is built this way is in [the analysis](proposals/design-system-lint.md); how it was built is in [the work plan](proposals/design-system-lint-workplan.md).

## Getting started

1. **Configure.** Create `.trickroom/systems/<key>/lint.json` next to `system.json` with the source globs of your app. Without the file every rule kind runs at its default severity over the default source globs: `src/**` when the project has no `codegen` block, otherwise the source root that contains `codegen.outDir` (see [Default source globs](#lintjson)). This repository's own:

   ```json
   {
   	"version": 1,
   	"source": {
   		"include": ["src/**"],
   		"exclude": ["**/*.d.ts", "**/*.test.ts", "**/*.test.tsx", "src/test-utils/**"]
   	}
   }
   ```

   The class rules work on any React and Tailwind codebase. The component rules (wrappers, variant values, imports) find components through their generated variants files, so they need a `codegen` block (see [Codegen](codegen.md)) and wrappers that import those files.
2. **Record a baseline.** Run `trickroom lint`, or "Run lint" on the Lint page of the System editor. The first run passes and writes `lint-report.json` next to `lint.json`; commit both. A large count is fine: the committed report is the bar, and later runs may only improve on it.
3. **Check in CI.** Run `trickroom lint --check`. It writes nothing and exits 0 when no tracked number got worse, 1 when one did (naming the metric), 2 when the run could not complete. When a change improves the numbers, run `trickroom lint` without `--check` and commit the new report so the bar moves with it.

```text
$ trickroom lint --check
Code (484 files scanned): 0 errors, 299 warnings, 1 info
  code.unknown-class-token
    warning src/components/CreateProjectPanel.tsx:135:96  Class "text-[10px]" uses arbitrary text value [10px]. Use a token of the system, or add "text-[10px]" to this rule's allow list if it is intended.
    …
  code.variants-file-stale
    info    Codegen is not configured for this project, so variants files were not checked. …
Designs (4 designs scanned): 0 errors, 238 warnings
  design.unknown-class-token
    warning design 5ed7a853-… board 2c52f606-… #8eee7ca4-… path boards[2].children[2]….props.className  Class "text-[10px]" uses arbitrary text value [10px].
    …
Lint passed for system "Trickroom" against the baseline of 2026-10-06T20:48:08.434Z. Nothing written (--check).
```

One unknown class added to a design board fails it:

```text
worse: design.warnings 238 -> 239
worse: rule.design.unknown-class-token 238 -> 239
Lint failed for system "Trickroom": 2 numbers worse than the baseline of 2026-10-06T20:48:08.434Z, 0 thresholds broken.
```

## Architecture

Everything lives in `src/lint/`. Pure modules take data and return data; one filesystem adapter connects them to a project, the same split as `src/codegen/` (`generate.ts` versus `run-codegen.ts`).

| Module | Role |
| --- | --- |
| `contract.ts` | `SystemContract` and `buildSystemContract`: the system as serialisable data rules check against. |
| `config.ts` | `lint.json`: shape, issues, normalisation, defaults, `resolveLintConfig`. |
| `config-file.ts` | `lint.json` on disk: `readLintConfigFile` (with issues and a revision hash) and `saveLintConfigFile` for the dashboard (the revision check, then an atomic write). |
| `system-file.ts` | `writeSystemFileAtomic`: the temp-file-and-rename writer both lint files use, refusing anything but a direct child of `.trickroom/systems`. |
| `current-contract.ts` | `readCurrentContractHash`: the contract hash a run would check against now, for the dashboard's stale flag. |
| `rule-catalogue.ts` | The rule kinds as plain data for the browser, with `LINT_RULE_OPTION_SPECS`, the documented options per kind. |
| `report.ts` | `LintReport` and `LintFinding`: stable ordering, validation, reader, atomic writer. |
| `ratchet.ts` | Tracked numbers, comparison with the baseline and the thresholds. |
| `rules/` | The rule kind interface (`types.ts`), the registry (`registry.ts`), the shipped kinds (`index.ts`, `code/`, `design/`). |
| `run-rules.ts` | The rule runner `runLint` and the design validation share: enabled kinds, severities, option checks, failures. |
| `designs.ts` | `LintDesignIndex` and `buildLintDesignIndex`: the linked Designs as the design rules see them. |
| `source/` | The syntactic source model: `glob.ts`, `walk.ts` (file walker), `parse.ts` (`oxc-parser` module model), `index.ts` (project index and component identity), `locations.ts`. |
| `run-lint.ts` | The filesystem adapter: reads the project, builds the contract, indexes sources and designs, runs the rules, ratchets, writes the report. |
| `design-lint.ts` | The design rules on one design, for `design_validate` and the editor (see [Design validation](#design-validation)). |

Entry points: `src/cli/lint.ts` (`trickroom lint`, bundled by `vite.lint.config.ts` into `dist/lint.js`), `src/mcp/tools/lint.ts` (the `lint` MCP tool), `src/routes/system-lint.ts` (the Hono routes) and `src/queries/system-lint.ts` (the browser queries). All four call `runLint`. The design-side kinds also run on a single design through `design-lint.ts`, for `design_validate` and the editor's `GET /api/trickroom/design/lint`; both use the same registry, runner and `lint.json`. Nothing else computes findings.

`oxc-parser` is the only dependency added. It is a native (napi) package, so every Vite SSR bundle keeps it external (`nativeRuntimeDependencies` in the `vite.*.config.ts` files, next to the optional `playwright-core`).

### A run

`runLint({ projectRoot, system?, check?, write? })`:

1. Reads `.trickroom/config.json` read-only (an invalid config, including an invalid `codegen` block, is an error).
2. Selects the system: the `system` option, else the `codegen` block's system, else the project's `defaultSystemId`, else the only system there is. Several systems and no selection is `NO_SYSTEM`.
3. Reads `components.json` and `tokens.json` read-only (nothing is migrated), then `lint.json` (an invalid one is an error, naming every problem).
4. Builds the `SystemContract`.
5. Runs the codegen check (`runCodegen` in check mode) when the project has a `codegen` block for this system. This runs the configured formatter command, as `trickroom codegen --check` does.
6. Walks the source globs, parses every file with `oxc-parser` and builds the project index (component identity, usages). A source folder or file that cannot be read fails the run with `SOURCES_UNREADABLE` (see below).
7. Reads the Designs linked to the system and builds the design index (see [The design index](#the-design-index)). A design that cannot be read is a `DESIGN_UNREADABLE` warning and is skipped; a designs folder that cannot be listed fails the run with `DESIGNS_UNREADABLE`.
8. Runs every enabled rule kind of the registry and collects findings. Invalid `options` of a kind are `INVALID_LINT_CONFIG`, checked right after `lint.json` is read.
9. Builds the report, reads the committed report, computes the ratchet.
10. Writes the report according to the write mode (see [Ratchet](#ratchet)).

## Files

Both files live next to `system.json` in `.trickroom/systems/<key>/` and are committed. Both carry `version: 1` and are migrated like the other persisted shapes when the version moves. The file watcher reports changes to them as system files, so the browser refreshes the `trickroom-system-lint` query family; temporary `.tmp` siblings of the atomic writes are ignored.

### `lint.json`

Rule instances are data, one per rule kind, keyed by the rule kind id. One instance per kind keeps the file a plain object that diffs well and makes "the config of rule X" one lookup; a kind that needs different settings per component takes that in its `options` (for example an `only` or `except` list of slugs) rather than a second instance. Nothing in the engine prevents a list shape later, but no rule kind needs it.

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
- A rule kind this version of Trickroom does not ship cannot be configured: its id is unknown.
- Absent file: every shipped kind enabled at its default severity, the default globs, no thresholds. The report records `config.present: false`.
- `normalizeLintConfig` sorts the maps and trims strings; `serializeLintConfig` is the text the server and the dashboard write, so a save that changes nothing leaves the file byte for byte as it was. Defaults are applied in memory by `resolveLintConfig` and never written back.

**Default source globs.** The walker starts at the source-like root that contains the codegen `outDir`: the path up to and including the first segment named `src`, `app`, `lib`, `source` or `packages`, else the top-most segment. `src/components/ui` scans `src/**`, `packages/ui/src/variants` scans `packages/**`, `design-system/variants` scans `design-system/**`. Without a `codegen` block the default is `src/**`. Extensions: `ts, tsx, js, jsx, mjs, cjs`; only files with these extensions are walked, whatever the globs say, so `src/**` takes the sources under `src` and not the CSS or Markdown next to them. `node_modules`, `dist`, `.trickroom` and every dot folder are never entered, and symlinks are skipped, whatever the globs say. The walk stops at 50,000 files with a `SOURCES_TRUNCATED` warning.

**Unreadable sources.** A folder the walk cannot read (a permission problem, a folder removed mid-walk) or a source file that cannot be read fails the run: a `SOURCES_UNREADABLE` error naming the path, exit 2, nothing written. Fewer files means fewer findings, which the ratchet would take for an improvement and record as the new baseline. Only an include root that does not exist is harmless: when `lint.json` sets `source.include`, the static folder of each glob (`packages/app/src` for `packages/app/src/**`) that is not there is a `SOURCE_ROOT_MISSING` warning. The default globs are not reported, so a project without sources lints its designs quietly.

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
    design: LintSideSummary | null;         // null when every design-side kind is disabled
  };
  findings: LintFinding[];
  components: LintComponentCoverage[];
  files: LintFileStats[];
  designs: LintDesignStats[] | null;        // one row per board, plus a board: null row per linked design; null in reports from before the design side
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
  usedInDesigns: boolean | null;            // placed in a linked Design
  wrappers: string[];                       // bound wrapper modules
  usages: number;                           // JSX usages in the scanned sources
  designUsages?: number;                    // instances placed in the linked Designs; always written, read as 0 from older reports
};

type LintFileStats = {
  file: string;                             // project-relative, "/" separators
  role: "generated" | "wrapper" | null;
  component: string | null;                 // slug for generated and wrapper files
  usages: number;
  findings: { errors: number; warnings: number; info: number };
};

type LintDesignStats = {
  design: string;                           // design file id
  board: string | null;                     // null: what is on no board (not a total; a design's total is the sum of its rows)
  usages: number;                           // instances of the system's components placed there
  findings: { errors: number; warnings: number; info: number }; // findings located there
};
```

Example, cut from this repository's own report (no `codegen` block, so `generated` is null and nothing is bound; `…` marks what was cut):

```json
{
	"version": 1,
	"generatedAt": "2026-10-06T20:48:08.434Z",
	"system": { "id": "sys_eb1ff359-…", "name": "Trickroom" },
	"contract": { "hash": "sha256:6b9e971d…", "components": 16 },
	"config": { "present": true },
	"status": "pass",
	"summary": {
		"code": {
			"findings": { "errors": 0, "warnings": 299, "info": 1 },
			"rules": {
				"code.unknown-class-token": { "errors": 0, "warnings": 299, "info": 0 },
				"code.variants-file-stale": { "errors": 0, "warnings": 0, "info": 1 },
				"…": { "errors": 0, "warnings": 0, "info": 0 }
			},
			"scanned": 484
		},
		"design": {
			"findings": { "errors": 0, "warnings": 238, "info": 0 },
			"rules": {
				"design.design-only-class-target": { "errors": 0, "warnings": 0, "info": 0 },
				"design.unknown-class-token": { "errors": 0, "warnings": 238, "info": 0 },
				"design.unknown-variant-value": { "errors": 0, "warnings": 0, "info": 0 }
			},
			"scanned": 4
		}
	},
	"findings": [
		{ "rule": "code.unknown-class-token", "severity": "warning", "side": "code", "message": "Class \"text-[10px]\" uses arbitrary text value [10px]. Use a token of the system, or add \"text-[10px]\" to this rule's allow list if it is intended.", "location": { "kind": "code", "file": "src/components/CreateProjectPanel.tsx", "line": 135, "column": 96 } },
		{ "rule": "code.variants-file-stale", "severity": "info", "side": "code", "message": "Codegen is not configured for this project, so variants files were not checked. …", "location": null },
		{ "rule": "design.unknown-class-token", "severity": "warning", "side": "design", "message": "Class \"text-[10px]\" uses arbitrary text value [10px].", "location": { "kind": "design", "design": "5ed7a853-…", "board": "2c52f606-…", "element": "8eee7ca4-…", "path": "boards[2].children[2].children[0].children[0].children[0].children[0].props.className" } },
		"…"
	],
	"components": [
		{ "slug": "alert", "componentId": "cmp_49642f54-…", "name": "Alert", "published": true, "generated": null, "bound": false, "usedInApp": false, "usedInDesigns": false, "wrappers": [], "usages": 0, "designUsages": 0 },
		{ "slug": "button", "componentId": "cmp_3008724f-…", "name": "Button", "published": true, "generated": null, "bound": false, "usedInApp": false, "usedInDesigns": true, "wrappers": [], "usages": 0, "designUsages": 18 },
		"…"
	],
	"files": [
		{ "file": "src/components/CreateProjectPanel.tsx", "role": null, "component": null, "usages": 0, "findings": { "errors": 0, "warnings": 6, "info": 0 } },
		"…"
	],
	"designs": [
		{ "design": "5ed7a853-…", "board": null, "usages": 0, "findings": { "errors": 0, "warnings": 0, "info": 0 } },
		{ "design": "5ed7a853-…", "board": "2c52f606-…", "usages": 8, "findings": { "errors": 0, "warnings": 7, "info": 0 } },
		"…"
	],
	"ratchet": {
		"status": "pass",
		"baseline": null,
		"regressions": [],
		"breaches": [],
		"numbers": { "code.errors": 0, "code.warnings": 299, "coverage.published": 16, "coverage.usedInDesigns": 5, "design.warnings": 238, "…": 0 }
	},
	"ratchetBaseline": {
		"generatedAt": "2026-10-06T20:48:08.434Z",
		"numbers": { "code.errors": 0, "code.warnings": 299, "coverage.published": 16, "coverage.usedInDesigns": 5, "design.warnings": 238, "…": 0 }
	}
}
```

Ordering, so the committed file diffs cleanly: findings by side, rule, location (file, line, column; design, board, element, path), severity, component, message; components by slug; files by file; designs by design then board (the `board: null` row first); regressions and breaches by metric; every map by key. `files` lists only files that have a role, a usage or a finding; `summary.code.scanned` counts the rest. `designs` lists every board of every linked design, clean or not, and one `board: null` row per design for what is on no board (always zero today: usages and design findings sit on a board), so a design without boards is still listed; `summary.design.scanned` counts the linked designs read. `writeLintReport` writes through a temp file and a rename, and only into a folder that resolves (symlinks followed) to a direct child of `.trickroom/systems`.

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
  versions: Array<{                  // every published version, sorted by version
    version: string;
    axes: Array<{ key: string; values: string[] }>; // from the variant schema
  }>;
  classTargets: Array<{              // variant and compound class entries of the current version
    axis: string | null; value: string | null; compound: number | null; path: string;
  }>;
  codegen: { selected: boolean; issues: string[] }; // selected by include/exclude and valid
};
```

Slots, axes, compounds and the shape come from `src/codegen/model.ts`, so a rule sees exactly what the generated file contains. The axis order is codegen's layering order. Without a `codegen` block the codegen defaults apply so `fileName` and `exportName` are still meaningful. Design-only paths are read from the optional `designOnly` flag on template nodes, inherited by descendants and by the default children of a slot hosted on a design-only node (the same set codegen uses). `versions` and `classTargets` come from the variant schema, not the codegen model: a component whose model is invalid (a design-only class target is a codegen error) or that is design-only has no `axes`, but its instances in Designs still have values to check.

**What stays out of the contract.** The compiled Tailwind design system (the utility inspector that answers "is `text-brand-500` a real utility here") is heavy to load and not serialisable, so it is not part of the contract. The rule context provides it lazily: `context.tailwind.inspector()` compiles the system's `cssPath` on first use, once per run, and returns null when there is no CSS or it fails to compile. Token names per domain are in the contract, so token-membership checks need no inspector.

## Rule kinds

A rule kind is an object in `src/lint/rules/`:

```ts
type LintRuleKind = {
  id: string;                        // "<side>.<kebab-name>", the key in lint.json and the report
  side: "code" | "design";
  defaultSeverity: "error" | "warning" | "info";
  description: string;
  options?: LintRuleOptionSpec[];    // the options it takes; lint.json is validated against them (see the catalogue)
  run: (context: LintRuleContext) => LintRuleFinding[] | Promise<LintRuleFinding[]>;
};

type LintRuleContext = {
  projectRoot: string;
  contract: SystemContract;
  config: ResolvedLintConfig;        // every rule instance, the source config, thresholds
  rule: ResolvedLintRule;            // this instance: enabled, severity, options
  codegen: CodegenRunResult | null;  // the check-mode result; null without a codegen block
  sources: SourceIndex;              // parsed modules, generated files, identities, usages
  designs: LintDesignIndex;          // the linked Designs; design_validate hands in the one it checks
  tailwind: { inspector: () => Promise<{ inspect(candidate: string): TailwindUtilityInspection; suggest?(candidate: string): string[] } | null> };
};

type LintRuleFinding = {
  message: string;
  location: LintLocation | null;
  component?: string;                // slug
  severity?: "info";                 // only for notes that are not violations
  details?: Record<string, unknown>; // extras for design_validate (offending class, suggestions); never in the report
};
```

A design location's `path` is the JSON path of the element in the design file (`boards[0].children[2]`, with `.props.className` for a class finding), the same path `design_validate` issues carry.

The runner (`run-rules.ts`) stamps `rule` and `side` on each finding and gives it the instance's severity; a finding may only lower itself to `info` (for example "codegen not configured, skipped"). A rule that throws fails the run (`RULE_FAILED`, exit 2) rather than silently passing. Kinds are registered in `src/lint/rules/index.ts` (`LINT_RULE_KINDS`, catalogue order); the registry rejects malformed or duplicate ids. Each kind has tests next to it on fixture input.

### Catalogue

Code side:

| Id | Default | Checks |
| --- | --- | --- |
| `code.variants-file-stale` | error | A published component's variants file is missing, stale (`source-changed`, `body-edited`, `not-generated`) or could not be checked; codegen errors (formatter, paths). Without a `codegen` block: one `info` finding, no violations. |
| `code.variants-file-orphaned` | warning | A file in `outDir` carries this system's header but no selected component generates it. |
| `code.wrapper-missing-variants-call` | error | A bound wrapper never calls its component's variants export (directly, through an alias or namespace, or a slot of its result). |
| `code.slot-not-called` | warning | A slot the generated file exports is never invoked in any wrapper of the component. |
| `code.unknown-variant-value` | error | A JSX attribute, or a literal object passed to the variants export or a slot, gives an axis a literal value it does not have. |
| `code.required-axis-missing` | error | A usage or a variants call omits an axis without a default. |
| `code.unknown-class-token` | warning | A class string uses a token or utility the system does not define. Options: `allow`, `scope`. |
| `code.redundant-class` | warning | A class in a usage's `className` changes nothing under `twMerge` (what tv() merges with): appending it to the component's base and selected variant classes, and removing it from the className, both leave the merged classes unchanged, under every value a dynamic axis may take. |
| `code.variants-imported-outside-component` | error | A module other than the wrapper imports the variants file directly (re-exports from the wrapper are the sanctioned way). |
| `code.component-styling-restricted` | warning | Configurable: styling of component X is allowed only in X's wrapper and the files its options allow. Options: `components`. Does nothing until configured. |

Design side (run by the engine over every linked Design, and by `design_validate` and the editor on one design):

| Id | Default | Checks |
| --- | --- | --- |
| `design.unknown-class-token` | warning | The class and token checks `getDesignDiagnostics` runs on every `className` of every board: a token the system does not define or removed (`UNKNOWN_<DOMAIN>_TOKEN`), an arbitrary value where the system has tokens (`OUT_OF_SYSTEM_<DOMAIN>`), a class the system's Tailwind cannot emit (`UNKNOWN_TAILWIND_UTILITY`, only when the system CSS compiles). Without a token snapshot only the last runs. Options below. |
| `design.design-only-class-target` | error | A variant value or compound variant of a published component's current version adds classes to a path inside a design-only subtree. Mirrors codegen's `DESIGN_ONLY_CLASS_TARGET` from the design model, so it also covers components without codegen and design-only components. The finding names the component; its location is null. |
| `design.unknown-variant-value` | error | An instance in a Design records a variant value its axis does not have, or an axis the component does not have. Checked against the published version the instance uses; a version missing from the manifest is checked against the current one (the message says so). When an instance pinned to an older version is wrong there but right in the current version, the message says to migrate it. Instances of components the manifest does not know are left to the component usage checks. |

Options are data: a kind that takes options declares them as `options` on its `LintRuleKind`, one spec per option (`src/lint/rule-options.ts`): `{ key, label, description, type }` with `type` one of `boolean`, `number`, `string` (with `values`, one of them), `string-list` (with `values`, each entry one of them) or `component-map` (`{ [slug]: string[] }`, or with `entryKey` `{ [slug]: { [entryKey]: string[] } }`). The specs are the one source for two things: `getLintConfigIssues`, given the registry, checks every rule instance's `options` against them (a key no spec lists, a value of the wrong shape or outside `values` is `INVALID_LINT_CONFIG`; the dashboard's `PUT` refuses the same config), and `LINT_RULE_OPTION_SPECS` in `src/lint/rule-catalogue.ts`, derived from the kinds, drives the dashboard's form. A kind without specs takes no documented options and ignores any; the dashboard shows them read-only and keeps them on save. Checks a spec cannot express (a slug the system does not have) stay with the kind, as `info` findings. Ids are stable once shipped: they are keys in committed files.

Kinds with options:

| Kind | Option | Spec | Meaning |
| --- | --- | --- | --- |
| `code.unknown-class-token` | `allow` | `string-list` | Class globs never reported, see below. |
| | `scope` | `string`, values `wrappers`, `usages`, `all` | Which modules are checked; default `all`. |
| `code.component-styling-restricted` | `components` | `component-map`, `entryKey: "allowIn"` | Per component slug, the file globs where its styling may be used. |
| `design.unknown-class-token` | `allow` | `string-list` | Class globs never reported, see below. |
| | `codes` | `string-list`, values the 15 check codes | Report only these checks; default all: `UNKNOWN_COLOR_TOKEN`, `UNKNOWN_SPACING_TOKEN`, `UNKNOWN_FONT_TOKEN`, `UNKNOWN_TEXT_TOKEN`, `UNKNOWN_RADIUS_TOKEN`, `UNKNOWN_SHADOW_TOKEN`, `UNKNOWN_TAILWIND_TOKEN`, `OUT_OF_SYSTEM_COLOR`, `OUT_OF_SYSTEM_FONT`, `OUT_OF_SYSTEM_RADIUS`, `OUT_OF_SYSTEM_TEXT`, `OUT_OF_SYSTEM_SHADOW`, `OUT_OF_SYSTEM_BLUR`, `OUT_OF_SYSTEM_TAILWIND_TOKEN`, `UNKNOWN_TAILWIND_UTILITY`. |

Both class kinds match `allow` the same way (`compileClassAllowList` in `src/utils/class-token-diagnostics.ts`): `*` matches any run of characters and `?` one, against the class as written and against its utility without variants as Tailwind parses it, so `bg-legacy-*` allows `md:hover:bg-legacy-500` and `prose` allows `md:prose`.

```json
{
	"version": 1,
	"rules": {
		"design.unknown-class-token": {
			"options": { "allow": ["bg-legacy-*"], "codes": ["UNKNOWN_COLOR_TOKEN", "UNKNOWN_TAILWIND_UTILITY"] }
		},
		"design.unknown-variant-value": { "severity": "warning" }
	}
}
```

### Class checks

One pure module holds the per-class checks: `src/utils/class-token-diagnostics.ts` (`collectClassNameTokenIssues` with a check context; `classTokenContextFromStorage` for a stored token snapshot, `classTokenContextFromResolved` for the contract's resolved names; the cached inspector with suggestions; the code list; the allow-list matcher). `code.unknown-class-token` runs class strings through it; `src/utils/design-class-diagnostics.ts` layers the design element on top (`createDesignClassChecker`: path, element id, className), which `getDesignDiagnostics` and `design.unknown-class-token` both walk the design with.

### Code-side kinds

The kinds after the variants file pair live in `src/lint/rules/code/` and share `analysis.ts`, computed once per run: for every module, where a component's variants export is in scope (an import from the generated file, or any import that resolves to it through re-exports, barrels and `import { x } from; export { x }`), the calls of it, and the slot calls on its result (`traceCallOrigin` with a one-element path naming a contract slot). A name counts only when it resolves to an import binding at the call, so shadowing parameters and locals are not variants calls. Generated files are never checked.

Shared behaviour:

- Every finding carries the component slug when there is one and a 1-based code location from the source model. A rule that cannot decide skips. Options are checked against the kinds' option specs when `lint.json` is read (see above); what a spec cannot check becomes one `info` finding naming the problem, never a failure.
- **Shadowing.** A JSX usage counts only when its element name (`Button`, or `UI` for `<UI.Button>`) resolves at the element, through the scope tree, to the import binding. `<Button>` inside `(Button) => …` or after a local `const UI = …` is something else and is skipped.
- **Wrapper modules.** The rules check the modules that implement a component: the index's `wrappers`, except that a configured `components[slug].module` that does not import the generated file itself (a barrel) is followed through its re-exports (`export { x } from`, `export * from`, and `import { x }; export { x }`) to the importers of the generated file it reaches. The index binds usages through the barrel (the `resolveExport` chain); the rules look from the barrel down to the code. A configured module that reaches no importer is checked as it is.
- **The component's own export.** JSX checks (`unknown-variant-value`, `required-axis-missing`, `redundant-class`) apply to usages that render the component itself, not every export of its wrapper: the export named after the slug or the name in PascalCase (`Button`, `OtpField`) or the default export. A member element (`<Card.Title>`) never counts. A wrapper that exports none of those names has no recognisable main export, and every export counts.
- **Literal values.** A string, number or boolean literal (`variant="x"`, `variant={"x"}`, `size={2}`, a bare attribute as `true`) is judged; anything else (identifiers, expressions, `null`) is skipped. A literal JSX attribute followed by a `{...spread}` in source order may be overridden at runtime and is skipped like a dynamic value; a spread before it does not matter. The same holds for literal object properties followed by a spread.

Per kind:

- `code.wrapper-missing-variants-call`: every module in `wrappers` (see [The source model](#the-source-model)) must call the variants export. A module that imports the export only to pass it on (`export { buttonVariants }`) is still an importer, so it is reported with the hint to use `export { … } from` instead. A configured wrapper that does not import the export at all is reported too.
- `code.slot-not-called`: slots shape only. The slot calls of every wrapper of the component are pooled; a slot that is referenced (`styles.title`) but never invoked does not count. Nothing is reported for a component whose wrappers never call the variants export (that is the previous kind's finding). The location is the first variants call.
- `code.unknown-variant-value`: JSX attributes named like an axis, and literal-keyed properties of a literal object passed as the first argument of the variants export or a slot function. A property a later spread may override is skipped. Boolean axes accept `true` and `false`, as literals, strings or a bare attribute. Attributes that are not axes are ignored.
- `code.required-axis-missing`: axes with `required: true`. JSX: a usage with a spread is skipped. Calls: only calls of the variants export itself (slot calls take overrides, not the full set); no argument at all counts as missing, a non-literal argument (`buttonVariants(props)`) or an object with a spread or a computed key is skipped. One finding per missing axis.
- `code.unknown-class-token`: every complete class string (`classStrings`, through `className` and the configured class calls; template fragments are skipped) runs through `src/utils/class-token-diagnostics.ts`, the pipeline the design diagnostics use: theme tokens per domain from the contract (`tokens.domains`; tokens removed from the Tailwind defaults stay unavailable), arbitrary values in token domains (`bg-[#fff]`), and `context.tailwind.inspector()` for classes the token tables cannot decide (`UNKNOWN_TAILWIND_UTILITY`). Without a token snapshot only the inspector check runs; without both, one `info` finding. Options:
  - `allow: string[]`: class globs (`*` any run, `?` one character) or exact classes never reported, matched as described above (the same matcher as `design.unknown-class-token`), so `"prose"` also allows `md:prose`.
  - `scope: "wrappers" | "usages" | "all"` (default `"all"`): `wrappers` checks the wrapper modules only, `usages` the modules that render a bound component, `all` every scanned module (the app is where the system's tokens are used, bound or not).
- `code.redundant-class`: redundancy follows `twMerge` from `tailwind-merge`, what tv() merges with. `provided` is the root slot's base classes followed by the root classes of the value each axis selects, in codegen's layering order, then the root classes of every compound variant those values match, in order; a class `c` of the usage's `className` is reported when `twMerge(provided + c)` equals `twMerge(provided)` and removing that occurrence of `c` from the className leaves `twMerge(provided + className)` unchanged. Merged results are compared as class sets (Tailwind's CSS does not depend on class order). So `px-3` over a selected value's `px-6` is an override, and so is `px-3` after `p-4` in the same className; an exact repeat with nothing overriding it is redundant. A literal attribute selects its value; an absent attribute selects the axis default (or nothing without one). An axis is dynamic when its attribute is not a literal, a later spread may override it, or it is absent and the element has a spread: a class is then redundant only if it is redundant under every value the dynamic axes may take, none included (each combination is checked; above 64 combinations the element is skipped). Class literals whose enclosing expression has non-literal parts (`cn(extra, "px-3")`, `mixed` in the source model) are skipped, as is a `className` followed by a spread. A string under a condition (a branch of `cond ? "a" : "b"`, a side of `active && "a"`, a `clsx` object key) may or may not apply: each subset of such strings is a scenario, and a class is reported only if removing it changes nothing in every scenario where its own string applies (the scenarios count towards the 64 combinations). A compound variant is matched as tv() matches it: each condition by strict equality with the value the element passes (a string attribute is a string, a bare attribute `true`), the axis default when absent, an array condition by membership, and `false` matching an absent value. So with base `px-3` and a compound `{ tone: "loud", class: "px-6" }`, `px-3` on `<Button tone="loud">` restores the base padding and is not reported. Compounds on a dynamic axis are evaluated per combination like the axis values; when a dynamic value that is none of the axis values may meet a `false` condition, or a compound names a prop that is not an axis, whether it applies cannot be decided and the element is skipped.
- `code.variants-imported-outside-component`: with `components[slug].module` configured, every module with a value import of the generated file other than the component's wrapper modules (a configured barrel counts through the modules it re-exports, see above). Without it, nothing is reported for a single importer; with several, the importer named like the component (`button.tsx` or `button/index.tsx` for slug `button`, or the generated file's stem) is the component and the others are findings; when no importer or several are named like that, each importer is reported, asking for `components[slug].module`. Type-only imports and re-exports never count.
- `code.component-styling-restricted`: options `{ components: { [slug]: { allowIn: string[] } } }` with project-relative file globs. A module outside `allowIn` that calls the component's variants export or a slot function, or imports the export without calling it, gets one finding per component at its first call (or the import). The component's own wrapper is always allowed: the configured module, else the only importer, else the importer named like the component (as above). Malformed entries are `INVALID_LINT_CONFIG`; unknown slugs are noted as `info`. Without options the kind produces nothing.

## The source model

`src/lint/source/` is syntactic: `oxc-parser` parses each file (TypeScript and JSX supported, no type checker, no evaluation), and `parseSourceModule` reduces it to:

- `imports`: specifier, imported and local names (`default`, `*` for namespaces), type-only flag, and `resolved` (filled by the index).
- `exports` and `reexports` (`export { x } from`, `export * from`, `export * as ns from`). A re-export carries a type-only flag per name, so `export { type Props, Button } from "./button"` keeps `Button` a value; the statement-level `type` is true only when every name is a type.
- `jsx`: every element with its name (`Button`, `UI.Button`, `svg:path`), attributes whose values are string or primitive literals (`variant="danger"`, `variant={"danger"}`, bare attributes as `true`), `unknown` for anything else, whether a spread is present (`spread`) and where each spread starts (`spreads`, source order), so a rule can tell a literal a later spread may override from one after the spread.
- `classStrings`: every string literal under a `className` attribute or a class call (`tv`, `cn`, `clsx`, `cva`, `cx`, `twMerge`, `twJoin`; configurable), through conditionals, logical expressions, arrays, templates and nested calls. `tv`/`cva` configs are walked by their keys (`base`, `slots`, `variants`, `compoundVariants`, `compoundSlots`; conditions and defaults are not classes); `cva(base, options)` (class-variance-authority before 1.0) takes its base classes from the first argument, read as a class value like a `clsx` argument (strings, nested arrays, object keys), and walks the second as the config, while `cva({ base, … })` (1.x) is read like `tv`; `clsx`-style object keys are classes. `complete` is false for a template fragment; `mixed` is true when the enclosing expression also had non-literal parts; `conditional` is true for a string that applies only under a condition (a branch of a conditional, a side of a logical expression, a `clsx` object key; `tv` config values are not conditional).
- `calls`: every call with its callee path (`buttonVariants`, `styles.root`) and its arguments. A call on another call's result (`buttonVariants().root()`, `(await load()).title()`) is recorded too, with `callee` written as `buttonVariants().root`, `root` the inner call's root, `members` the path after the inner call, and `receiver: { call, path }` naming that inner call; `receiver` is null when the callee starts with an identifier. `calls` is in traversal order: a call on a call result comes before its receiver call, which starts at the same position. A literal object argument is `{ kind: "object", properties, keys, members, hasSpread, hasComputed }`: `properties` maps literal keys to literal values (or `unknown`), `keys` lists them in source order, `members` lists every member in order as `{ kind: "property", key }`, `{ kind: "spread" }` or `{ kind: "computed" }`, so a rule can tell a missing axis from one a spread may supply and see what a later spread can override. Other arguments are literals or `unknown`.
- `scopes`: the lexical scope tree. Scope 0 is the module; every function or arrow (parameters live there), block, `for` head, `catch` clause and class body nests under its `parent`, with the `start`/`end` positions it covers and its `bindings` in source order: `{ name, kind, position, origin }` with `kind` one of `const`, `let`, `var` (hoisted to the nearest function or module scope), `function` (hoisted, declared in the enclosing scope; a named function expression binds inside itself), `class`, `parameter` (including destructured and default parameters), `catch`, `import`, `enum`, `namespace`. `origin` is `{ call: { callee, root, members, position }, path }` when the value comes from a call, else null: `[]` for `const s = buttonVariants()`, `["root"]` for `const r = buttonVariants().root` and `const { root: r } = buttonVariants()`, `["0"]` for `const [a] = f()`; `await f()` is `f()`; a `...rest` binding has no origin.
- `callResultUses`: every member access taken directly off a call result, `{ call, path, invoked, position }`: `buttonVariants().root;` is `invoked: false`, `buttonVariants().root()` is `invoked: true` (and that call is also in `calls` with its `receiver`). Only the outermost access of a chain is recorded (`f().a.b` is one use with path `["a", "b"]`), so `buttonVariants().root()` and `buttonVariants().root;` are different modules: a rule can tell an invoked slot from a referenced function.
- `declarations`: the bindings with an origin, flattened in source order as `{ name, call, path, scope, position }` (`scope` indexes `scopes`), for rules that list every `const s = buttonVariants()` without walking the tree.
- `traceCallOrigin(module, call)` resolves a call site's receiver with the language's rule: `resolveBinding` finds the innermost scope containing the call (`scopeAt`), walks outward to the first scope declaring the name, and takes that binding (within one scope, the last declaration before the use, else the first, for hoisted functions). For `s.title()` after `const s = buttonVariants()` it returns the `buttonVariants` call and the full path `["title"]`; an inner `const s`, parameter, catch or destructured name shadows the outer binding, and a binding without an origin (a parameter, `const s = 1`) yields null. A call with a `receiver` is followed through it: `buttonVariants().root()` gives the `buttonVariants` call and `["root"]`, `s.root().x()` gives `buttonVariants` and `["root", "x"]`, `f().a().b()` gives `f` and `["a", "b"]`. Assignments after declaration (`s = other()`) are not followed.
- `codegenHeader`: the Trickroom header when the file is a generated variants file.

`buildSourceIndex` resolves relative specifiers against the scanned files (extensions, `.js` to `.ts`, index files; bare and aliased specifiers stay unresolved), finds the generated files of the system by header, and derives component identity:

- The modules with a value import of a component's generated file are its `importers`. The `wrappers` are the configured `components[slug].module` entries when set; else the only importer; else the importer named like the component (`button.tsx` or `button/index.tsx` for slug `button`, or the generated file's stem), the one `code.variants-imported-outside-component` treats as the component; else, when none or several are named like that, every importer. So a module that imports another component's variants file (a dialog rendering a button) is not taken for that component. A configured module that was not scanned is listed in `missingConfiguredWrappers`, reported by the run as a `WRAPPER_MODULE_NOT_SCANNED` warning and never counts as a wrapper, so the component is unbound rather than silently bound (or silently handed back to the importers). Re-exporting modules are `reexporters`: they borrow the styling and do not bind. Importers and re-exporters come from reverse indexes built once over the modules, so identity costs the size of the sources, not components times files.
- `bindings` map, per module, local names to component slugs by following imports through barrels (`export * from`, `export { Badge as Pill } from`) to a wrapper. Every module on the way is checked, nearest to the importer first, so a configured barrel (`components.button.module = "src/ui/index.ts"`) binds what it re-exports; any value exported by a wrapper counts as that component. `resolveExport` returns the defining module, the name there and the `chain` of modules visited.
- `usages` are the JSX elements whose name resolves to a bound component, including namespace members (`<UI.Button>`).

These feed the coverage rows (`bound`, `usedInApp`, `usages`) and the heat map (`files`). The code-side rule kinds build on the same index.

## The design index

`designs.ts` is pure: `buildLintDesignIndex({ systemId, designs })` turns designs already read into what the design rules check.

```ts
type LintDesignIndex = {
  systemId: string;
  designs: Array<{                 // linked designs, sorted by id
    id: string; name: string;
    boards: Array<{
      id: string; name: string | null;  // the board layer's name
      nodes: Array<{                    // every node, the board included, depth first
        element: string;                // element id
        path: string;                   // boards[0].children[2]
        className: string | null;
        instance: {                     // instance markers, when the node belongs to a placed component
          systemId: string; componentId: string; instanceId: string;
          version: string;              // the published version the instance uses
          templatePath: string;         // the node's path inside the component
          root: boolean;
          variantValues: Record<string, string>; // recorded on the root only
        } | null;
      }>;
    }>;
  }>;
  usages: Record<string, Array<{   // by component id: instance roots of this system's components
    design: string; board: string; element: string; path: string;
    instanceId: string; version: string; variantValues: Record<string, string>;
  }>>;
};
```

`run-lint.ts` reads every design under `.trickroom/designs` (both layouts) with `readDesignFileWithoutLock`: no lock, no journal replay, older designs migrated in memory only, so a lint run writes nothing there. A design is linked when its `systemId` is the system's id, or, for a legacy design without one, its `systemName` is the system's name, a previous name or its storage key. Designs linked to other systems or none are skipped; an unreadable design (invalid JSON, a newer version, a write in progress) is a `DESIGN_UNREADABLE` warning. A `.trickroom/designs` folder that cannot be listed (anything but absent) fails the run with a `DESIGNS_UNREADABLE` error, for the same reason as unreadable sources: a design side with no designs would pass as clean. Instances whose markers name another system are not usages. Coverage takes `usedInDesigns` and `designUsages` from `usages`; the `designs` rows count the usages and the findings located in each design and board.

## Design validation

`design-lint.ts` runs the design-side kinds on one design: `loadDesignLintSetup` reads the linked system read-only (components, `lint.json`, token snapshot) into a contract and resolved config, and `lintDesign` builds the index of that design (or of some boards) and runs the design-side kinds through the same runner, with the same Tailwind inspector loader. Unlike a lint run it never fails:

- An invalid or unreadable `lint.json` (a folder in its place, a permission problem) applies the defaults, invalid options included (they make the file invalid); this is an `INVALID_LINT_CONFIG` diagnostic. Components that cannot be read are an `INVALID_COMPONENT_MANIFEST` diagnostic and the component rules see none. A kind that throws is skipped with a `LINT_RULE_FAILED` diagnostic.
- Findings without a design location (`design.design-only-class-target`) are kept only for components the checked boards place.

Two callers:

- `design_validate` (whole file and operation-plan dry-runs) passes `lint` to `getDesignDiagnostics`, which then runs the kinds instead of its own class checks. Each finding is an issue whose `code` is the rule kind id and whose severity is the instance's; the kind's `details` ride along (`check` holds the former class code, plus `classToken`, `suggestions`, `axis`, `value`, …). `info` findings are not issues; diagnostics are warnings. The other checks (recipes, renderers, assets and icons, `DESIGN_TOKENS_NOT_STORED`, `DESIGN_SYSTEM_REVIEW_REQUIRED`) run as before. `design_apply` does not pass `lint`, so its write diagnostics keep their codes. See [MCP](mcp.md#validation-design_validate).
- The editor: `GET /api/trickroom/design/lint?id=<designId>` returns `{ designId, system, rules, findings, diagnostics }` for the saved design (`system` null when the design links none). The design inspector lists the findings on the selected layer and, with nothing selected, the design's totals, the component-level findings and the diagnostics. The query (`src/queries/design-lint.ts`, prefix `trickroom-design-lint`) refreshes on design and system file events, so it follows autosave.

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

Concurrent runs. Reading the baseline, comparing and writing are one step per report, so two runs can never both compare against the same old baseline and leave the worse result behind:

- **In one process** (the server, the MCP tool), runs that write queue up per report path: the second reads the baseline the first wrote. With a baseline of 10, a run with 5 and a run with 8 started together leave 5, whichever goes first (the run with 8 either fails against 5 or is replaced by it).
- **Across processes**, a write is a compare-and-swap: just before writing, the run reads the committed report again. When its `generatedAt` differs from the report this run compared against (or a report appeared or became unreadable), the ratchet runs again against the new baseline; the findings are not recomputed. If the run still passes, the report is written with `ratchet` comparing against the new baseline. If it now fails, nothing is written, whatever the write mode, and the run fails (exit 1) with a `BASELINE_MOVED` error naming each number that got worse; `ratchet` holds that comparison. Run lint again to compare against the new baseline. The re-read and the rename are not atomic together, so two processes writing within the same moment can still race; the window is the time of one atomic write.

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

Exit codes: 0 pass, 1 ratchet failure (including `BASELINE_MOVED`, see [Ratchet](#ratchet)), 2 error (no project, invalid config or `lint.json` including invalid rule options and a `lint.json` that cannot be read, unknown or ambiguous system, a source folder or file that cannot be read (`SOURCES_UNREADABLE`), a designs folder that cannot be listed (`DESIGNS_UNREADABLE`), a crashed rule, a refused write, or anything the engine did not foresee, reported as `RUN_FAILED`). Warnings that do not stop a run: `COMPONENT_MANIFEST_DIAGNOSTIC`, `CODEGEN_OTHER_SYSTEM`, `INVALID_BASELINE`, `SOURCE_PARSE_ERROR`, `SOURCE_ROOT_MISSING`, `SOURCES_TRUNCATED`, `WRAPPER_MODULE_NOT_SCANNED`, `DESIGN_UNREADABLE`. An error never escapes `runLint` as an exception, so `--json` output stays valid. Human output lists each side's counts, then findings grouped by rule kind with their location, then every number that got worse and every threshold broken, then one closing line.

There is no `--help`: an unknown option prints the usage line and exits 2, as `trickroom codegen` does. The unknown-command message of `trickroom` lists `lint`.

`pnpm build:lint` builds `dist/lint.js`; `pnpm build` includes it.

## MCP

The `lint` tool (`src/mcp/tools/lint.ts`, group `designValidation`) takes `check`, `system` and `response` (`"summary"` default, `"full"` adds the whole report) plus the usual `project` override, and returns `{ status: "success", project, lint }` where `lint` is the run result without the report (`status`, `mode`, `system`, `ratchet`, `baseline`, `reportPath`, `written`, `diagnostics`, `generatedAt`, `summary`) and, with `response: "full"`, the `report`. A run that cannot complete is a tool error `LINT_FAILED` with the diagnostics. It needs read-write mode in every case, like `design_export`, because the codegen check runs the project's formatter and a non-check run writes the report.

## HTTP

| Route | Behaviour |
| --- | --- |
| `GET /api/trickroom/systems/:systemHandle/lint` | `{ systemId, systemName, report, current: { contractHash } }`; `current.contractHash` is the hash of the system's contract now (null when an input cannot be read), so a report whose `contract.hash` differs is stale. 404 `{ error, code: "LINT_REPORT_NOT_FOUND" }` before the first run; 409 `LINT_REPORT_INVALID` when the file cannot be read. |
| `POST /api/trickroom/systems/:systemHandle/lint` | Runs the engine for that system with `write: "always"` and returns `{ systemId, systemName, status, report, ratchet, written, diagnostics }`; 500 `LINT_FAILED` with `diagnostics` when the run cannot complete. |
| `GET /api/trickroom/systems/:systemHandle/lint/config` | `{ systemId, systemName, path, present, revision, config, issues, text, defaults, ruleKinds }`. `config` is the stored `lint.json`, or `{ version: 1 }` when the file is absent (`present: false`), invalid or unreadable. An invalid file comes back with its `issues` and its `text`; one that cannot be read (a folder in its place) with its `issues` and `text: null`. `revision` is a `sha256:` hash of the file text, null when absent. `defaults.source` holds the include, exclude and class call lists an absent key means. `ruleKinds` is the catalogue: `{ id, side, defaultSeverity, description, options }` per shipped kind, in registry order. |
| `PUT /api/trickroom/systems/:systemHandle/lint/config` | Body `{ config, revision? }`. Validates `config` with `getLintConfigIssues` and the registry, its ids and option specs (422 `LINT_CONFIG_INVALID` with `issues`), refuses with 409 `LINT_CONFIG_CONFLICT` when `revision` is sent and the file changed since (null means "I expect no file"), writes `serializeLintConfig` text atomically into the system folder and returns the same shape as `GET`. 400 for a body without `config`. |
| `GET /api/trickroom/design/lint?id=<designId>` | The design-side kinds on one saved design (see [Design validation](#design-validation)): `{ designId, system, rules, findings, diagnostics }`; findings carry `details`. 404 for an unknown design, 422 for one that cannot be read. |

Browser side, `src/queries/system-lint.ts`: `systemLintQueryOptions(systemId, projectScope)` (key prefix `trickroom-system-lint`), `systemLintConfigQueryOptions` (prefix `trickroom-system-lint-config`), both refreshed by file events on the system folder; `runSystemLint(systemId)` and `saveSystemLintConfig(systemId, { config, revision })` for mutations, which throw `SystemLintRequestError` carrying `code`, `issues` and `diagnostics`; `invalidateSystemLint`.

## Dashboard

The lint page of the System editor (`?tab=lint`, `src/components/system-editor/SystemEditorLintPanel.tsx` and `lint/`) reads the stored report through `systemLintQueryOptions` and `lint.json` through the config query. It reshapes the report and never recomputes it. Folder totals are sums of `files[]`, deltas are `ratchet.numbers` minus `ratchet.baseline.numbers`, and coverage states are the report's booleans. Nothing re-runs a rule or re-derives a state. The views are tabs under the header and entries in the sidebar rail, where each shows what it holds: errors and warnings of both sides, components with a gap, files, designs, findings. The inspector (the right panel) shows the selected finding, file, folder, component or design.

- **Adherence.** Per side, the error, warning and info counts from `summary`, each tracked number with its delta against the baseline the run compared with, a "Regressed" mark for `ratchet.regressions` and an "Over max"/"Under min" mark for `ratchet.breaches`. Limits come from the current `lint.json` thresholds. Below that, one row per rule kind in `summary[side].rules` with its counts, the `rule.<id>` delta and its per-kind maximum; a row opens the findings of that kind. The severity shown is the one the report counted (errors, else warnings, else info); a kind without findings shows the configured severity, muted. Catalogue kinds missing from the summary are listed as disabled. The design side reads "Not available yet" while `summary.design` is null.
- **Coverage.** One row per `components[]` entry with a five-cell strip (published, generated, bound, used in app, used in designs): solid when met, an amber frame when it is a gap, dashed when the report has null. Gaps are listed as badges with what to do about them in the inspector, which also shows the usages in the app and in designs; null is never a gap. Filters: all, any gap, or the gap of one state, plus a search. Above the table, the component count per state with the coverage delta and minimum.
- **Code map.** A file tree built from `files[]`. Folders add up usages, findings and file counts, and a folder whose only child is a folder shares its row (`src/components/ui`). Each row has two square swatches, usage in cyan and findings (errors plus warnings) in red, on five discrete steps: zero, then the quartiles of the non-zero file values. Folders use their files' scale, so a busy folder reads as hot. Rows are virtualized with `@tanstack/react-virtual` against the workspace scroller. Filter by path or to files with findings, sort by name, usage or findings. A file shows its findings in the inspector; "Show in findings" opens the list filtered to that file or folder.
- **Design map.** The same tree over `designs[]`: a design row adds up its board rows, and a row with `board: null` counts towards its design without being listed as a board. Design names come from the design summaries; boards show their id. Empty state while `designs` is null.
- **Findings.** Every finding, filterable by side, severity, rule, component, file or folder, design and board, and text. The other views link into it with a filter set. A design finding has "Open in editor", a link to `buildDesignPath(design, { boardId, layerId })`, the deep link the editor channel's focus requests use.
- **Rules.** The `lint.json` editor: per kind, enabled, severity (or the default) and maximum findings, and a form for the options `LINT_RULE_OPTION_SPECS` documents (`boolean`, `number`, `string`, `string` with `values` as a choice, `string-list` for allow lists and globs, `component-map` for per-component lists, `{ [slug]: string[] }` or `{ [slug]: { [entryKey]: string[] } }`). The shape check is the one `lint.json` validation uses (`optionValueHasSpecShape`). Stored options a spec does not list, and values that do not match their spec, are shown read-only as JSON and saved unchanged. Then the side maxima and coverage minima, the `components[slug].module` overrides and `source.include`, `exclude` and `classCalls` with the defaults as placeholders. Edits stay in a draft until "Save lint.json". The draft helpers drop keys that equal the default, so the file holds only real choices. A refused save lists the engine's issues. When the file changed on disk during an edit, saving needs an explicit "Overwrite".

"Run lint" calls `runSystemLint`, shows the elapsed time while the engine runs, then the outcome: pass, or fail with each regression and breach. A failing run's report is written (the baseline inside it is kept), and the dashboard says it should not be committed as is. The header shows the report's status, when it was generated and a "Stale" badge when `current.contractHash` differs from `report.contract.hash`, which happens when components, tokens or the codegen block changed since the run. Changes to `lint.json` do not make a report stale; run lint again to see their effect. Before the first run the views show the CLI command and the run button; the Rules view works without a report.

## Limits

The source model is syntactic, so some code is out of reach. What a rule cannot see it does not report; where that can make a rule report something wrong, the entry says so.

- **Class strings** are the literals under `className` and the class calls. A module-level constant (`const field = "px-2 text-[11px]"`), `[...].filter(Boolean).join(" ")` and template fragments are not checked.
- **Arbitrary values** are reported in six token domains: color, font, text, radius, shadow and blur. Others, such as spacing (`w-[18px]`) or inset shadows (`inset-shadow-[0_0_0_1px]`), are not.
- **Slot calls** are traced through `const s = buttonVariants()`, destructuring the call (`const { root } = buttonVariants()`) and calls on call results. A slot called through a second alias (`const { root } = s`), a rest binding, a computed member (`s["root"]()`) or after a reassignment is not seen, so `code.slot-not-called` may report it.
- **Extending** the variants export (`tv({ extend: buttonVariants, … })`) is not a call of it: `code.wrapper-missing-variants-call` reports such a wrapper, and slots called on the extended function are not traced.
- **Merging**: `code.redundant-class` merges with plain `tailwind-merge`, not a project's own merge configuration, so custom utilities it does not know may be judged by their default group.
- **Instances in Designs** copy their component's classes: a class the component template uses is reported on every placed instance, and no rule checks component templates themselves.
