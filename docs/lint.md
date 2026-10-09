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
| `system-file.ts` | `writeSystemFileAtomic`: the temp-file-and-rename writer both lint files use, refusing anything but a direct child of `.trickroom/systems` (`resolveWritableSystemDir`). |
| `current-contract.ts` | `readCurrentContractHash`: the contract hash a run would check against now, for the dashboard's stale flag. |
| `rule-catalogue.ts` | The rule kinds as plain data for the browser, with `LINT_RULE_OPTION_SPECS`, the documented options per kind. |
| `report.ts` | `LintReport` and `LintFinding`: stable ordering, validation, reader, atomic writer, and `withLintReportLock`, the cross-process lock on the report (`withFileLock` from `src/services/design-file-lock.ts`). |
| `ratchet.ts` | Tracked numbers, comparison with the baseline and the thresholds. |
| `rules/` | The rule kind interface (`types.ts`), the registry (`registry.ts`), the shipped kinds (`index.ts`, `code/`, `design/`), the ledger of every kind id ever shipped (`ledger.ts`). |
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
    kinds?: string[];                       // every rule kind id its writers knew (ledger, registry, earlier kinds), enabled or not; only grows; absent in baselines from before it was recorded, see Ratchet
  };
};

type LintRatchetResult = {
  status: "pass" | "fail";
  baseline: { generatedAt: string; numbers: Record<string, number>; kinds?: string[] } | null; // what this run compared against, adopted kinds folded in
  regressions: Array<{ metric: string; baseline: number; current: number }>;
  breaches: Array<{ metric: string; kind: "max" | "min"; limit: number; current: number }>;
  adopted: Array<{                          // kinds taken into the baseline, see Ratchet; read as [] from older reports
    metric: string; current: number;
    reason: "new-kind" | "explicit";        // a kind the baseline predates, or one named with --adopt; read as "new-kind" from older reports
    baseline?: number;                      // explicit only: the baseline's number it replaced
  }>;
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
    | null;                                 // null also for a finding located on a component
  componentLocation?: {                     // a published component version, see Component classes
    componentId: string; version: string;
    slot?: string;                          // the slot whose default children the node is one of; absent for the template's own nodes
    path?: string;                          // template path of the node: "root", "label"
    axis?: string; value?: string;          // the variant value the classes belong to
    compound?: number;                      // or the compound variant, 0-based
  };
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
		"adopted": [],
		"numbers": { "code.errors": 0, "code.warnings": 299, "coverage.published": 16, "coverage.usedInDesigns": 5, "design.warnings": 238, "…": 0 }
	},
	"ratchetBaseline": {
		"generatedAt": "2026-10-06T20:48:08.434Z",
		"numbers": { "code.errors": 0, "code.warnings": 299, "coverage.published": 16, "coverage.usedInDesigns": 5, "design.warnings": 238, "…": 0 },
		"kinds": ["code.component-styling-restricted", "code.non-canonical-class", "…", "design.unknown-variant-value"]
	}
}
```

Ordering, so the committed file diffs cleanly: findings by side, rule, location (none, then code, then design locations; file, line, column; design, board, element, path), component location (component id, version, path, slot, axis, value, compound), severity, component, message; components by slug; files by file; designs by design then board (the `board: null` row first); regressions, breaches and adoptions by metric; baseline kinds by id; every map by key.

`ratchetBaseline.kinds` and `ratchet.adopted` were added without a version bump: both are optional on read, so a report written before them still reads (no kinds, nothing adopted), and a Trickroom from before them reads a newer report and ignores both. The same holds for an adoption's `reason` and `baseline`, added later: an adoption without a reason reads as `new-kind` (the only kind of adoption there was), and an older Trickroom ignores both fields. A version bump would have made that older Trickroom take every newer report as unusable and start a new baseline. `files` lists only files that have a role, a usage or a finding; `summary.code.scanned` counts the rest. `designs` lists every board of every linked design, clean or not, and one `board: null` row per design for what is on no board (always zero today: usages and design findings sit on a board), so a design without boards is still listed; `summary.design.scanned` counts the linked designs read. `writeLintReport` writes through a temp file and a rename, and only into a folder that resolves (symlinks followed) to a direct child of `.trickroom/systems`.

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

**What stays out of the contract.** The compiled Tailwind design system (the utility inspector that answers "is `text-brand-500` a real utility here") is heavy to load and not serialisable, so it is not part of the contract. The rule context provides it lazily: `context.tailwind.inspector()` compiles the system's `cssPath` on first use, once per run, and returns null when there is no CSS or it fails to compile. Its `canonicalize` is Tailwind's `designSystem.canonicalizeCandidates`, one class at a time, computed in a worker thread (see `code.non-canonical-class`). Token names per domain are in the contract, so token-membership checks need no inspector.

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
  tailwind: {
    inspector: () => Promise<{ inspect(candidate: string): TailwindUtilityInspection; suggest?(candidate: string): string[]; canonicalize?(candidates: readonly string[]): Promise<CanonicalizedClass[]> } | null>;
    mergeConfig: () => Promise<{ status: "stock" } | { status: "derived"; config: TwMergeConfig } | { status: "failed"; message: string }>; // derived from the system CSS with codegen.twMerge; failed when it cannot be derived
  };
};

// What canonicalize returns per class (src/utils/tailwind-canonical-equivalence.ts): the canonical form, and
// when it differs from the class the verdict of compiling both (see code.non-canonical-class).
type CanonicalizedClass = {
  canonical: string;
  verdict?: { status: "equivalent" } | { status: "theme-dependent"; themeVariables: string[] } | { status: "different"; reason: string };
};

type LintRuleFinding = {
  message: string;
  location: LintLocation | null;
  componentLocation?: LintComponentLocation; // with location null, for a finding on a component definition
  component?: string;                // slug
  severity?: "info";                 // only for notes that are not violations
  details?: Record<string, unknown>; // extras for design_validate (offending class, suggestions); never in the report
};
```

A design location's `path` is the JSON path of the element in the design file (`boards[0].children[2]`, with `.props.className` for a class finding), the same path `design_validate` issues carry. A finding located on a component has `location: null` and a `componentLocation`: a published version of a system component and, for its classes, the template path and the variant value or compound variant they come from; template classes have neither (see [Component classes](#component-classes)). It is a separate, optional field rather than a `location` kind so that reports stay readable both ways: a report without it reads as before, and a Trickroom from before it reads a newer report, ignores the field and keeps the baseline. A new `location` kind would make that older reader reject the whole report as `INVALID_BASELINE` and start a new baseline, enforcing nothing.

The runner (`run-rules.ts`) stamps `rule` and `side` on each finding and gives it the instance's severity; a finding may only lower itself to `info` (for example "codegen not configured, skipped"). A rule that throws fails the run (`RULE_FAILED`, exit 2) rather than silently passing. Kinds are registered in `src/lint/rules/index.ts` (`LINT_RULE_KINDS`, catalogue order); the registry rejects malformed or duplicate ids. Each kind has tests next to it on fixture input.

### Catalogue

Code side:

| Id | Default | Checks |
| --- | --- | --- |
| `code.variants-file-stale` | error | A published component's variants file, or the tailwind-merge config with `codegen.twMerge`, is missing, stale (`source-changed`, `body-edited`, `not-generated`) or could not be checked; codegen errors (formatter, paths). Without a `codegen` block: one `info` finding, no violations. |
| `code.variants-file-orphaned` | warning | A file in `outDir` carries this system's header but no selected component generates it. |
| `code.wrapper-missing-variants-call` | error | A bound wrapper never calls its component's variants export (directly, through an alias or namespace, or a slot of its result). |
| `code.slot-not-called` | warning | A slot the generated file exports is never invoked in any wrapper of the component. |
| `code.unknown-variant-value` | error | A JSX attribute, or a literal object passed to the variants export or a slot, gives an axis a literal value it does not have. |
| `code.required-axis-missing` | error | A usage or a variants call omits an axis without a default. |
| `code.unknown-class-token` | warning | A class string uses a token or utility the system does not define. Options: `allow`, `scope`. |
| `code.redundant-class` | warning | A class in a usage's `className` changes nothing under `twMerge` (what tv() merges with), with the derived config when `codegen.twMerge` is on: appending it to the component's base and selected variant classes, and removing it from the className, both leave the merged classes unchanged, under every value a dynamic axis may take. When the derived config cannot be derived, one `info` finding instead. |
| `code.non-canonical-class` | warning | A class Tailwind writes differently, by Tailwind's own canonicalization against the system's CSS (`bg-[#FFF]` is `bg-white`, `[scrollbar-width:thin]` is `scrollbar-thin`, `[&:has(.x)]:p-2` is `has-[.x]:p-2`), when compiling both gives the same CSS; the message names the canonical class, and says when it equals the class only under the current theme (`w-[38.5rem]` is `w-154` while `--spacing` is `0.25rem`). Option: `allow`. Without compiled CSS: one `info` finding. |
| `code.variants-imported-outside-component` | error | A module other than the wrapper imports the variants file directly (re-exports from the wrapper are the sanctioned way). |
| `code.component-styling-restricted` | warning | Configurable: styling of component X is allowed only in X's wrapper and the files its options allow. Options: `components`. Does nothing until configured. |

Design side (run by the engine over every linked Design, and by `design_validate` and the editor on one design):

| Id | Default | Checks |
| --- | --- | --- |
| `design.unknown-class-token` | warning | The class and token checks `getDesignDiagnostics` runs, on the classes of the system's components and on every `className` of every board, an instance contributing only its override (see [Component classes](#component-classes)): a token the system does not define or removed (`UNKNOWN_<DOMAIN>_TOKEN`), an arbitrary value where the system has tokens (`OUT_OF_SYSTEM_<DOMAIN>`), a class the system's Tailwind cannot emit (`UNKNOWN_TAILWIND_UTILITY`, only when the system CSS compiles). Without a token snapshot only the last runs. Options below. |
| `design.non-canonical-class` | warning | The same check as `code.non-canonical-class`, on the same classes as `design.unknown-class-token`; `design_validate` returns the canonical class as the finding's `suggestions`. Option: `allow`. |
| `design.design-only-class-target` | error | A variant value or compound variant of a published component's current version adds classes to a path inside a design-only subtree. Mirrors codegen's `DESIGN_ONLY_CLASS_TARGET` from the design model, so it also covers components without codegen and design-only components. The finding names the component; its location is null. |
| `design.unknown-variant-value` | error | An instance in a Design records a variant value its axis does not have, or an axis the component does not have. Checked against the published version the instance uses; a version missing from the manifest is checked against the current one (the message says so). When an instance pinned to an older version is wrong there but right in the current version, the message says to migrate it. Instances of components the manifest does not know are left to the component usage checks. |

Options are data: a kind that takes options declares them as `options` on its `LintRuleKind`, one spec per option (`src/lint/rule-options.ts`): `{ key, label, description, type }` with `type` one of `boolean`, `number`, `string` (with `values`, one of them), `string-list` (with `values`, each entry one of them) or `component-map` (`{ [slug]: string[] }`, or with `entryKey` `{ [slug]: { [entryKey]: string[] } }`). The specs are the one source for two things: `getLintConfigIssues`, given the registry, checks every rule instance's `options` against them (a key no spec lists, a value of the wrong shape or outside `values` is `INVALID_LINT_CONFIG`; the dashboard's `PUT` refuses the same config), and `LINT_RULE_OPTION_SPECS` in `src/lint/rule-catalogue.ts`, derived from the kinds, drives the dashboard's form. A kind without specs takes no documented options and ignores any; the dashboard shows them read-only and keeps them on save. Checks a spec cannot express (a slug the system does not have) stay with the kind, as `info` findings. Ids are stable once shipped: they are keys in committed files.

Kinds with options:

| Kind | Option | Spec | Meaning |
| --- | --- | --- | --- |
| `code.unknown-class-token` | `allow` | `string-list` | Class globs never reported, see below. |
| | `scope` | `string`, values `wrappers`, `usages`, `all` | Which modules are checked; default `all`. |
| `code.non-canonical-class` | `allow` | `string-list` | Class globs never reported, see below. |
| `code.component-styling-restricted` | `components` | `component-map`, `entryKey: "allowIn"` | Per component slug, the file globs where its styling may be used. |
| `design.unknown-class-token` | `allow` | `string-list` | Class globs never reported, see below. |
| | `codes` | `string-list`, values the 15 check codes | Report only these checks; default all: `UNKNOWN_COLOR_TOKEN`, `UNKNOWN_SPACING_TOKEN`, `UNKNOWN_FONT_TOKEN`, `UNKNOWN_TEXT_TOKEN`, `UNKNOWN_RADIUS_TOKEN`, `UNKNOWN_SHADOW_TOKEN`, `UNKNOWN_TAILWIND_TOKEN`, `OUT_OF_SYSTEM_COLOR`, `OUT_OF_SYSTEM_FONT`, `OUT_OF_SYSTEM_RADIUS`, `OUT_OF_SYSTEM_TEXT`, `OUT_OF_SYSTEM_SHADOW`, `OUT_OF_SYSTEM_BLUR`, `OUT_OF_SYSTEM_TAILWIND_TOKEN`, `UNKNOWN_TAILWIND_UTILITY`. |
| `design.non-canonical-class` | `allow` | `string-list` | Class globs never reported, see below. |

The class kinds match `allow` the same way (`compileClassAllowList` in `src/utils/class-token-diagnostics.ts`): `*` matches any run of characters and `?` one, against the class as written and against its utility without variants as Tailwind parses it, so `bg-legacy-*` allows `md:hover:bg-legacy-500` and `prose` allows `md:prose`.

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

### Component classes

The design class kinds (`design.unknown-class-token`, `design.non-canonical-class`) check a component's classes once, where they are defined, and an instance only for what it adds. Both take their class strings from `collectLintClassTargets` (`src/lint/rules/design/class-targets.ts`) over the design index:

- **Component definitions.** Every published component's current version, plus every other published version an instance in the checked designs uses (instances pinned to it render its classes). Drafts are never linted, as in the contract. Per version: each template node's classes (depth first; a template that keeps its classes in `props.className`, as older drafts did, is read without the registry Element's base classes, as instances read it), then each slot's default children (slots in the version's order, each default depth first, read the same way), then every variant value's classes per path (axes in codegen's order), then every compound variant's classes per path. A finding is located on the component: `location` is null and `componentLocation` is `{ componentId, version, slot?, path, axis?, value?, compound? }`, with the component's slug as the finding's `component`; a slot default child's has the slot's name as `slot` and the default's template path as `path`. A class used by a hundred instances is one finding, on the place to fix it.
- **Instances.** A node of a component instance whose version resolves contributes only its className override (`resolveSystemComponentOverrideValue` for the node's template path, from the instance root's overrides marker), read from the same structured source the canvas, export and detach resolve classes from (see [Canvas Class Merging](tailwind-design-systems.md#canvas-class-merging)), not from its stored `className`. The stored string is what materialization wrote: the Element's base classes, then the component's and the override's classes without those equal to a base class, so an override such as a Separator's `data-[orientation=horizontal]:w-full` is checked now and was not before. The finding is located on the node, as before (`<node path>.props.className`).
- **Slot default children.** Placing an instance copies its slots' default children into the design as plain layers, without markers; migrating an instance keeps them as they are. A layer in a slot is a copy while its classes still equal its default's in the version the instance uses, and such a copy is skipped: its classes are the definition's, checked once on that version. Only a slot host whose markers name the same version as its instance root has copies: with inconsistent markers (a part of another version under the root, same instance id) its layers are checked as layers. The copies of a slot host's children are found in order: first each layer (never a part of an instance) whose Element and classes equal a default's, paired with the next such default; then each other layer with an unpaired default of its Element between its neighbours' pairs, so a layer the designer added or a default they removed does not shift the others. A copy's children are paired with its default's children the same way, edited or not. The test is on classes only: a copy whose text, name or icon changed keeps its default's classes, and the class rules check nothing else. Classes are compared token by token, in order, with the default's `className` (or, when it has none, its `props.className`), as placement copies it.
- **Edited copies, slot content, raw layers and recipe nodes** carry no instance markers and are checked by their stored `className`, as before: a copy whose classes the designer edited is the instance's own content, every class of it, and so is a copy of a default that the version the instance uses no longer has (an instance migrated to a version whose default changed, keeping the old copy).
- **Fallback.** An instance node whose version cannot be resolved, the same cases in which the canvas renders the stored `className` (a component or version the manifest does not have, an instance of another system, no root of its instance among its ancestors: a part resolves through its own root, found by walking up like the canvas does, never through a root elsewhere in the design with the same instance id), is checked by its stored `className`, as before: inherited classes included, once per node. Its slots' copies are layers like any other then. A run whose component manifest cannot be read fails anyway; `design_validate` then sees no components, so every instance falls back.

The registry Element's base classes are library-owned and checked on neither the component nor the instance.

### Code-side kinds

The kinds after the variants file pair live in `src/lint/rules/code/` and share `analysis.ts`, computed once per run: for every module, where a component's variants export is in scope (an import from the generated file, or any import that resolves to it through re-exports, barrels and `import { x } from; export { x }`), the calls of it, and the slot calls on its result (`traceCallOrigin` with a one-element path naming a contract slot). A name counts only when it resolves to an import binding at the call, so shadowing parameters and locals are not variants calls. Generated files are never checked.

Shared behaviour:

- Every finding carries the component slug when there is one and a 1-based code location from the source model. A rule that cannot decide skips. Options are checked against the kinds' option specs when `lint.json` is read (see above); what a spec cannot check becomes one `info` finding naming the problem, never a failure.
- **Shadowing.** A JSX usage counts only when its element name (`Button`, or `UI` for `<UI.Button>`) resolves at the element, through the scope tree, to the import binding. `<Button>` inside `(Button) => …` or after a local `const UI = …` is something else and is skipped. The index applies this to `usages` (see [The source model](#the-source-model)), so coverage and the heat map count the same usages the rules check.
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
- `code.redundant-class`: redundancy follows `twMerge` from `tailwind-merge`, what tv() merges with, extended with the config derived from the system's Tailwind CSS (`context.tailwind.mergeConfig()`) when `codegen.twMerge` generates it for the linted system, see [Codegen](codegen.md#the-tailwind-merge-config). Turning `codegen.twMerge` on assumes the project's `tv` module passes it on (`createTV({ twMergeConfig })`): the rule then merges the way the app does, so `text-label-sm` next to the base's `text-royal-9` is a repeat, not a colour that replaces it. The project's merge groups (`codegen.twMerge.mergeGroups`, see [Merge Groups](codegen.md#merge-groups)) are part of that config, so `text-label-sm` over a base `text-title-lg` in the same group is an override, not an addition. Without `codegen.twMerge`, or for another system than the codegen block's, stock `tailwind-merge` decides. When `codegen.twMerge` applies but its config cannot be derived (the CSS does not compile, or the merge groups do not fit the design system; the codegen check reports that too), the rule checks nothing and reports one `info` finding with the reason: stock `tailwind-merge` would report classes the app's merge keeps, so it skips the check, like the canvas renders without merging then. `provided` is the root slot's base classes followed by the root classes of the value each axis selects, in codegen's layering order, then the root classes of every compound variant those values match, in order; a class `c` of the usage's `className` is reported when `twMerge(provided + c)` equals `twMerge(provided)` and removing that occurrence of `c` from the className leaves `twMerge(provided + className)` unchanged. Merged results are compared as class sets (Tailwind's CSS does not depend on class order). So `px-3` over a selected value's `px-6` is an override, and so is `px-3` after `p-4` in the same className; an exact repeat with nothing overriding it is redundant. A literal attribute selects its value; an absent attribute selects the axis default (or nothing without one). An axis is dynamic when its attribute is not a literal, a later spread may override it, or it is absent and the element has a spread: a class is then redundant only if it is redundant under every value the dynamic axes may take, none included (each combination is checked; above 64 combinations the element is skipped). Class literals whose enclosing expression has non-literal parts (`cn(extra, "px-3")`, `mixed` in the source model) are skipped, as is a `className` followed by a spread. A string under a condition (a branch of `cond ? "a" : "b"`, a side of `active && "a"`, a `clsx` object key) may or may not apply: each subset of such strings is a scenario, and a class is reported only if removing it changes nothing in every scenario where its own string applies (the scenarios count towards the 64 combinations). A compound variant is matched as tv() matches it: each condition by strict equality with the value the element passes (a string attribute is a string, a bare attribute `true`), the axis default when absent, an array condition by membership, and `false` matching an absent value. So with base `px-3` and a compound `{ tone: "loud", class: "px-6" }`, `px-3` on `<Button tone="loud">` restores the base padding and is not reported. Compounds on a dynamic axis are evaluated per combination like the axis values; when a dynamic value that is none of the axis values may meet a `false` condition, or a compound names a prop that is not an axis, whether it applies cannot be decided and the element is skipped.
- `code.non-canonical-class`: every complete class string (the strings `code.unknown-class-token` reads, generated files excluded) is split into classes as Tailwind tokenises them. The distinct classes of the run go, in one batch, through `canonicalize` on the inspector: the system's compiled Tailwind `designSystem.canonicalizeCandidates([class])` per class (`canonicalizeTailwindCandidate` in `src/utils/tailwind-utility-inspector.ts`). A class whose canonical form differs is reported with that form: `[scrollbar-width:thin]` is `scrollbar-thin` (a utility since Tailwind 4.3), `bg-[#FFF]` is `bg-white`, `[&:has(.x)]:p-2` is `has-[.x]:p-2`, `data-[highlighted]:p-2` is `data-highlighted:p-2`, `!grid` is `grid!`, `max-w-[26rem]` is `max-w-104` (with `--spacing: 0.25rem`). The finding's `details` carry `classToken`, `canonical` and `suggestions: [canonical]`.
  - **Every suggestion is verified.** Tailwind's canonical form is not always the same CSS: `[[data-panel-open]_&]:hidden` compiles to `[data-panel-open] .x` (specificity 0,2,0) and its canonical `in-data-panel-open:hidden` to `:where([data-panel-open]) .x` (0,1,0), and Tailwind 4.3.3 writes `max-lg:[&_[aria-label=X]]:!hidden` as `max-lg:**:aria-[aria-label=X]:hidden!`, which compiles to `[aria-aria-label="X"]` and matches nothing. So the worker compiles the class and its canonical form on the same system (`candidatesToCss`) and compares them (`src/utils/tailwind-canonical-equivalence.ts`) rule by rule. When in doubt the verdict is not equivalent: a missed suggestion costs nothing, a wrong one breaks a design.
    - **Rules**: at-rules, declarations and `!important` in order, and selectors with the class as a placeholder. Differences that cannot change what matches or its specificity are normalised away: whitespace, attribute quoting, the order of simple selectors in a compound and of the arguments of `:is()`, `:where()`, `:not()` and `:has()`, a redundant `*`, and a one-argument `:is(X)` without a pseudo-element, unwrapped where that is sound (a compound `X` anywhere, so `:has(:is([data-invalid]))` is `:has([data-invalid])`; a complex `X` in the first compound of a selector that is not relative, so `:is(.x > *)` is `.x > *`; never `:is(.a::before)`, which matches nothing). Specificity counts `:where()` as nothing and `:is()`, `:not()` and `:has()` as their most specific argument.
    - **`@property`**: a registration only the canonical form emits is a difference, unless the stylesheets already register that name identically and unconditionally (at the top level or inside `@layer` only, with no other registration of the name under a condition, and no `@import` carrying anything but `layer` or `source(…)`, since a conditional import's registrations cannot be told apart in the loaded text): registering a variable changes how it inherits (`transform-(--tw-rotate-x)` registers `--tw-rotate-x` with `inherits: false`, so a child's `[transform:var(--tw-rotate-x)]` no longer sees its parent's value). One the class emits and the form lacks or registers differently is a difference too.
    - **Values** are compared as CSS tokens: whitespace, hex colour case and length, and number spelling are normalised, numbers exactly (`.50` is `0.5`, `0.0000001` is not `0`) and with CSS's type flag and the sign of zero (`1.0` and `1e0` are numbers, `1` an integer, so `order-[1.0]`, which is invalid, is not `order-1`; `-0` is not `0`); strings and `url()` stay as written. A top-level `calc()` over numbers of one unit counts as its result only where the property treats both alike: integer properties (`z-index`, `order`) when the result is an integer (`-z-[1]`, `calc(1 * -1)`, is `z-[-1]`; `-z-[1.5]` is not `z-[-1.5]`, since `calc(1.5 * -1)` rounds to `-1` and `-1.5` is invalid), lengths that may be negative (margins, insets, `translate`), and lengths that may not (sizes, paddings, gaps, radii) when the result is not negative. Only when the browser's arithmetic cannot differ: `+` and `-` with whitespace on both sides (`calc(1px+ 1px)` is invalid), no division, no `-0`, and every operand and step within a million and six decimals (in Chromium `calc(1e16px + 1px - 1e16px)` is `0px`). Elsewhere, custom properties included, a `calc()` must match as written.
    - **Theme variables** are read from `@theme`, and the system's stylesheets (every one it loaded, imports included) are scanned for the custom properties they also set outside `@theme`, in any rule or at-rule (`.dark { --color-white: #000 }`, `@media (…) { :root { … } }`, `@utility`), and for `@property` registrations, under any condition. A theme variable outside a math function that is set nowhere else and not registered is replaced by its value. An equality that needs any other substitution holds only under the current theme, and one through a registered variable that does not inherit (`inherits: false`, so an element does not see `:root`'s value) or starts from another `initial-value` is a difference.

    The verdict is one of three:
    - **Equivalent**: the same CSS, reading theme variables as above, since naming the token is the point (`bg-white` for `bg-[#FFF]` is `var(--color-white)`). Reported, if it also holds in context (below).
    - **Theme-dependent**: equal only through a theme variable inside `calc()`, `min()`, `max()` or `clamp()` (`w-154` is `calc(var(--spacing) * 154)`, which is `w-[38.5rem]` while `--spacing` is `0.25rem`; the same variable on both sides counts too), or through one the stylesheets also set outside `@theme` (`bg-white` for `bg-[#FFF]` when `.dark` sets `--color-white`). Reported, and the message says the canonical form follows the theme and names the variables; `details` add `themeDependent: true` and `themeVariables`. Replace it when the value should follow the theme, otherwise add the class to `allow`. When the stylesheets cannot be read, every equality through a theme variable is theme-dependent.
    - **Different**: another selector or specificity, other declarations or at-rules, or no CSS at all. **Not reported**: the class as written is the one that does what it says, and Tailwind's form would change the design. An `info` finding was the alternative, but it would ask for nothing (there is no better class to write) while showing up in every `design_validate` of the design, and an `info` is not tracked by the ratchet either, so it would not even keep count. So does whatever the comparison cannot prove equal.
  - **In context.** Equivalent on its own is not equivalent on an element: Tailwind emits a canonical form at its own place among the utilities, so it can win where the class lost, or lose where it won (`bg-[#FFF] bg-red-500` is red, `bg-white bg-red-500` white; `mt-[0.25rem] mt-2` is 4px, `mt-1 mt-2` 8px). So each finding that passes the standalone check is settled among the classes that render on the same element (`settleInContext` in `src/lint/rules/canonical-classes.ts`, `verifyCanonicalInContext` in the worker):
    - **Scenarios, not unions.** A context that merges alternatives cannot prove anything: in `on ? "bg-[#FFF] bg-red-500" : "bg-white"`, the other branch's `bg-white` is never there when the red one renders, and with variant values `small: has-data-x:p-2` and `large: has-data-x:p-4` on a template's `has-[[data-x]]:p-4`, merging all values hides that `small` keeps both of the template's and its own padding but only its own once the template uses `has-data-x:p-4` (16px becomes 8px). So a finding is checked in each combination of classes that can render with it, and must pass in every one:
      - **Design nodes**: one, the node's classes as the canvas renders them (`getRenderedClassName`): a layer's className with its registry Element's base classes; an instance node's component classes (template, selected values, matching compounds) and override, merged the way the project's code merges them (stock tailwind-merge, or the derived config with `codegen.twMerge`), as stored when classes do not merge.
      - **Component definitions**: each variant configuration the component can render, every value of every axis and no value for an axis without a default, with the compounds the configuration matches, rendered as an instance with that configuration would be. The finding's own class string is replaced in the version itself, so the replacement is compared exactly where it applies.
      - **Code**: each combination of the class string's parts that can apply with the literal (one `className` attribute or one class call). An unconditional part always applies; a conditional one may or may not; a part on the other side of a choice the literal sits under (`cond ? a : b`, `a || b`, `a && b`) never does, and two parts on different sides of one choice never apply together. The source model records the choices each string sits under (`branch`, every conditional and logical expression numbered on its own, since `a && b || c` starts both at `a`) and the expression it belongs to (`expression`). For the `className` of a bound component, each set of root classes it may apply (`providedCombinations`, as `code.redundant-class` uses: literal axis attributes, every value or none for a dynamic axis, the compounds those values match).
      - Above 64 combinations (`MAX_CONTEXT_SCENARIOS`), only what is always there is checked (the configuration without values, the unconditional parts and the literal) and the finding is context-dependent.
    - **In each scenario.** The classes with the replacement must be the classes without it, the class and its canonical form counted as one: merging drops or keeps nothing else. Where classes may be merged on the way though the scenario is not (tv() merges a usage's className, a `cn()` may), either may be what renders, so the merged classes must pass too, the comparison of competitors included: merged, a class the merge drops is neither a competitor nor already on the element (in `cn("bg-white bg-blend-hard-light bg-[#FFF]")` the merge drops `bg-white`, so it cannot stand in for `bg-[#FFF]`). Then the competitors are compared (below). The canonical form counts as already on the element only when it is in the same scenario, and renders there.
    - **Competitors.** The other classes in the scenario that declare a property the class declares, by family: a shorthand with its longhands, logical with physical sides (`margin` with `margin-top` and `margin-inline`), `all` with every property but custom properties, `direction` and `unicode-bidi`, custom properties by name. Families are wide on purpose, and conditions are ignored: a competitor under a different media query or state still counts. Without competitors the standalone verdict stands. With them, each competitor, the class and the replacement are ordered as Tailwind emits them (`getClassOrder`, the order the build writes), and every pair of competing declarations, the class's and a competitor's, must keep its winner: `!important`, then specificity, then that order. Pairs that set the same property to the same value are skipped, since either winner gives the same result. If the canonical form is already on the element, replacing the class only removes it; that changes something only where the class beat a competitor the canonical form loses to. Any other change, in any scenario, and the finding is not reported.
    - **Incomplete contexts** are checked with what is known, and if that passes, reported with `contextDependent: true` in `details` and a message asking to check the competing classes. On the code side: a class string next to non-literal parts (`cn(extra, "…")`, `mixed`), a class call whose result goes elsewhere, a `className` a later spread may replace, the `className` of a component that is not a bound one or whose configurations cannot be decided, or any string when the merge config cannot be derived. On the design side: an instance node whose version cannot be resolved, and an Element the registry does not have. On both, more than 64 combinations, and a scenario where the class still renders after the replacement because another string of the element holds it too (which of the two wins is not checked). Such a finding stays a **warning**: that the class is not canonical, and that its canonical form compiles to the same CSS, is proven; only replacing it on that element is not, and the message says what to check. As an `info` it would leave the ratchet: most code strings sit in a `cn()` with a variable part, so the kind would stop being counted on the code side.
    - **What is guaranteed.** A finding without `themeDependent` or `contextDependent` names a canonical form that compiles to the same CSS and, in every combination of classes that can render on the element (every branch combination, every variant configuration), wins and loses exactly where the class does, merged the same way. Rules from outside the element's own class list are not part of the context: an ancestor's descendant variant (`[&_p]:mt-4`), a `group-*` or `peer-*` from another element, the project's own CSS. A canonical form whose variant changes its place relative to those can still change the result; review such a replacement where other elements' classes target this one.
  - Classes are judged one at a time with Tailwind's default options: no `rem` (so `w-[16px]` stays, it equals `w-4` only at a 16px root font size) and no `collapse` (`mt-2 mb-2` to `my-2` is about the class list, not a class). The verdict depends on the class alone, so a literal next to non-literal parts (`cn(extra, "bg-[#FFF]")`, `mixed`) and a conditional one (`on ? "a" : "b"`) are checked. Strings that are not whole classes are skipped (`complete: false`): template fragments, and strings an interpolation splices into a class (`` `[&_.${"break-words"}]:p-2` ``, see [The source model](#the-source-model)).
  - A class Tailwind does not know comes back unchanged and is left to `code.unknown-class-token`. The two kinds can meet on one class: an arbitrary value equal to a theme token (`rounded-[2rem]`) is `OUT_OF_SYSTEM_RADIUS` there and `rounded-4xl` here, which names the token to use.
  - Canonicalization runs in a worker thread (`src/utils/tailwind-canonicalize-worker.ts`, bundled as `dist/tailwind-canonicalize-worker.js`; the client is `tailwind-canonicalize-client.ts`), because the first canonicalization on a compiled system builds Tailwind's lookup tables: seconds of synchronous work that would stall every request of the server. The worker's cache (`tailwind-canonicalize-cache.ts`) is bounded: at most four warm systems, keyed by the text of every stylesheet they read, so systems that read the same text share one, and per entry stylesheet (at most 32) the stamps of the files it read and the content it loaded as. Every hit refreshes recency in both; a changed stamp loads again, and only content no warm system has builds again. Warm systems are the only compiled systems the worker keeps. Each worker the client starts owns the requests sent to it: when it fails or exits, those are rejected once and the next request starts a new worker, which later events of the old one do not touch. Every entry point uses it, the CLI included.
  - Without compiled CSS (no `cssPath`, or it fails to compile) the kind reports one `info` finding without a location. It reaches the report of a lint run (`trickroom lint`, the `lint` tool, the dashboard); single-design validation (`design_validate`, the editor) drops findings without a design location unless they name a placed component, so it does not show there. The design side reports it only when it has classes to check: linked designs or published components.
  - The default severity is `warning`, as for the other class kinds: the class works, so it is not an error, but a warning is tracked by the ratchet and an `info` is not. `design.non-canonical-class` runs the same check, with the same option, on the classes of the system's components and the linked Designs (see [Component classes](#component-classes)). Option `allow: string[]`, matched as for `code.unknown-class-token`.
- `code.variants-imported-outside-component`: with `components[slug].module` configured, every module with a value import of the generated file other than the component's wrapper modules (a configured barrel counts through the modules it re-exports, see above). Without it, nothing is reported for a single importer; with several, the importer named like the component (`button.tsx` or `button/index.tsx` for slug `button`, or the generated file's stem) is the component and the others are findings; when no importer or several are named like that, each importer is reported, asking for `components[slug].module`. Type-only imports and re-exports never count.
- `code.component-styling-restricted`: options `{ components: { [slug]: { allowIn: string[] } } }` with project-relative file globs. A module outside `allowIn` that calls the component's variants export or a slot function, or imports the export without calling it, gets one finding per component at its first call (or the import). The component's own wrapper is always allowed: the configured module, else the only importer, else the importer named like the component (as above). Malformed entries are `INVALID_LINT_CONFIG`; unknown slugs are noted as `info`. Without options the kind produces nothing.

## The source model

`src/lint/source/` is syntactic: `oxc-parser` parses each file (TypeScript and JSX supported, no type checker, no evaluation), and `parseSourceModule` reduces it to:

- `imports`: specifier, imported and local names (`default`, `*` for namespaces), type-only flag, and `resolved` (filled by the index).
- `exports` and `reexports` (`export { x } from`, `export * from`, `export * as ns from`). A re-export carries a type-only flag per name, so `export { type Props, Button } from "./button"` keeps `Button` a value; the statement-level `type` is true only when every name is a type.
- `jsx`: every element with its name (`Button`, `UI.Button`, `svg:path`), attributes whose values are string or primitive literals (`variant="danger"`, `variant={"danger"}`, bare attributes as `true`), `unknown` for anything else, whether a spread is present (`spread`) and where each spread starts (`spreads`, source order), so a rule can tell a literal a later spread may override from one after the spread.
- `classStrings`: every string literal under a `className` attribute or a class call (`tv`, `cn`, `clsx`, `cva`, `cx`, `twMerge`, `twJoin`; configurable), through conditionals, logical expressions, arrays, templates and nested calls. `tv`/`cva` configs are walked by their keys (`base`, `slots`, `variants`, `compoundVariants`, `compoundSlots`; conditions and defaults are not classes); `cva` is read by arity and shape: with two arguments (class-variance-authority before 1.0, `cva(base, options)`) the first is always the base, read as a class value like a `clsx` argument (strings, nested arrays, object keys, so `cva({ "p-2": active }, options)` is a base), and the second is walked as the config; with one argument, an object with a config key (`base`, `slots`, `variants`, `compoundVariants`, `compoundSlots`, `defaultVariants`, `extend`) is the config and read like `tv` (`cva({ base, … })`, 1.x), and anything else, an object without config keys included, is the base; `clsx`-style object keys are classes. `complete` is false for a template fragment and for a string inside an interpolation that whitespace, or the template's start or end, does not delimit on both sides (`` `[&_.${"x"}]:p-2` ``: `x` is part of a selector; `` `p-2 ${on ? "a" : ""}` ``: `a` is a class); `mixed` is true when the enclosing expression also had non-literal parts; `conditional` is true for a string that applies only under a condition (a branch of a conditional, a side of a logical expression, a `clsx` object key; `tv` config values are not conditional).
- `calls`: every call with its callee path (`buttonVariants`, `styles.root`) and its arguments. A call on another call's result (`buttonVariants().root()`, `(await load()).title()`) is recorded too, with `callee` written as `buttonVariants().root`, `root` the inner call's root, `members` the path after the inner call, and `receiver: { call, path }` naming that inner call; `receiver` is null when the callee starts with an identifier. `calls` is in traversal order: a call on a call result comes before its receiver call, which starts at the same position. A literal object argument is `{ kind: "object", properties, keys, members, hasSpread, hasComputed }`: `properties` maps literal keys to literal values (or `unknown`), `keys` lists them in source order, `members` lists every member in order as `{ kind: "property", key }`, `{ kind: "spread" }` or `{ kind: "computed" }`, so a rule can tell a missing axis from one a spread may supply and see what a later spread can override. Other arguments are literals or `unknown`.
- `scopes`: the lexical scope tree. Scope 0 is the module; every function or arrow (parameters live there), block, `for` head, `catch` clause and class body nests under its `parent`, with the `start`/`end` positions it covers and its `bindings` in source order: `{ name, kind, position, origin }` with `kind` one of `const`, `let`, `var` (hoisted to the nearest function or module scope), `function` (hoisted, declared in the enclosing scope; a named function expression binds inside itself), `class`, `parameter` (including destructured and default parameters), `catch`, `import`, `enum`, `namespace`. `origin` is `{ call: { callee, root, members, position }, path }` when the value comes from a call, else null: `[]` for `const s = buttonVariants()`, `["root"]` for `const r = buttonVariants().root` and `const { root: r } = buttonVariants()`, `["0"]` for `const [a] = f()`; `await f()` is `f()`; a `...rest` binding has no origin.
- `callResultUses`: every member access taken directly off a call result, `{ call, path, invoked, position }`: `buttonVariants().root;` is `invoked: false`, `buttonVariants().root()` is `invoked: true` (and that call is also in `calls` with its `receiver`). Only the outermost access of a chain is recorded (`f().a.b` is one use with path `["a", "b"]`), so `buttonVariants().root()` and `buttonVariants().root;` are different modules: a rule can tell an invoked slot from a referenced function.
- `declarations`: the bindings with an origin, flattened in source order as `{ name, call, path, scope, position }` (`scope` indexes `scopes`), for rules that list every `const s = buttonVariants()` without walking the tree.
- `traceCallOrigin(module, call)` resolves a call site's receiver with the language's rule: `resolveBinding` finds the innermost scope containing the call (`scopeAt`), walks outward to the first scope declaring the name, and takes that binding (within one scope, the last declaration before the use, else the first, for hoisted functions). For `s.title()` after `const s = buttonVariants()` it returns the `buttonVariants` call and the full path `["title"]`; an inner `const s`, parameter, catch or destructured name shadows the outer binding, and a binding without an origin (a parameter, `const s = 1`) yields null. A call with a `receiver` is followed through it: `buttonVariants().root()` gives the `buttonVariants` call and `["root"]`, `s.root().x()` gives `buttonVariants` and `["root", "x"]`, `f().a().b()` gives `f` and `["a", "b"]`. Assignments after declaration (`s = other()`) are not followed.
- `codegenHeader`: the Trickroom header when the file is a generated variants file.

`buildSourceIndex` resolves relative specifiers against the scanned files (extensions, `.js` to `.ts`, index files; bare and aliased specifiers stay unresolved), finds the generated files of the system by header, and derives component identity:

- The modules with a value import of a component's generated file are its `importers`. The `wrappers` are the configured `components[slug].module` entries when set; else the only importer; else the importer named like the component (`button.tsx` or `button/index.tsx` for slug `button`, or the generated file's stem), the one `code.variants-imported-outside-component` treats as the component; else, when none or several are named like that, every importer. So a module that imports another component's variants file (a dialog rendering a button) is not taken for that component. A configured module that was not scanned is listed in `missingConfiguredWrappers`, reported by the run as a `WRAPPER_MODULE_NOT_SCANNED` warning and never counts as a wrapper, so the component is unbound rather than silently bound (or silently handed back to the importers). Re-exporting modules are `reexporters`: they borrow the styling and do not bind. Importers and re-exporters come from reverse indexes built once over the modules, so identity costs the size of the sources, not components times files.
- `bindings` map, per module, local names to component slugs by following imports through barrels (`export * from`, `export { Badge as Pill } from`) to a wrapper. Every module on the way is checked, nearest to the importer first, so a configured barrel (`components.button.module = "src/ui/index.ts"`) binds what it re-exports; any value exported by a wrapper counts as that component. `resolveExport` returns the defining module, the name there and the `chain` of modules visited.
- `usages` are the JSX elements whose name resolves to a bound component, including namespace members (`<UI.Button>`), and whose element name (`Button`, or `UI`) resolves at the element, through the scope tree, to the import binding. `<Button />` inside `function App(Button) { … }` or after a local `const UI = …` is not a usage.

These feed the coverage rows (`bound`, `usedInApp`, `usages`) and the heat map (`files`). The code-side rule kinds build on the same index and the same `usages`, so a shadowed name never counts as a usage in one place and not in another.

## The design index

`designs.ts` is pure: `buildLintDesignIndex({ systemId, designs })` turns designs already read into what the design rules check.

```ts
type LintDesignIndex = {
  systemId: string;
  components: Array<{              // the component versions the class kinds check, by slug and version
    componentId: string; slug: string; version: string;
    current: boolean;              // the current published version; others are used by instances
    classes: Array<{               // template, then variant values, then compound variants
      path: string; axis: string | null; value: string | null; compound: number | null;
      className: string;
    }>;
  }>;
  designs: Array<{                 // linked designs, sorted by id
    id: string; name: string;
    boards: Array<{
      id: string; name: string | null;  // the board layer's name
      nodes: Array<{                    // every node, the board included, depth first
        element: string;                // element id
        path: string;                   // boards[0].children[2]
        className: string | null;       // as stored
        checkedClassName: string | null; // what the class kinds check
        classSource: "layer" | "override" | "stored"; // its className; an instance's override; the stored fallback
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

`buildLintDesignIndex` also takes the system's component manifest (`components`), which `run-lint.ts` and `design-lint.ts` hand in: it resolves each instance node to the classes it adds and lists the component versions to check (see [Component classes](#component-classes)). Without it every instance node falls back to its stored `className` and no component is listed.

`run-lint.ts` reads every design under `.trickroom/designs` (both layouts) with `readDesignFileWithoutLock`: no lock, no journal replay, older designs migrated in memory only, so a lint run writes nothing there. A design is linked when its `systemId` is the system's id, or, for a legacy design without one, its `systemName` is the system's name, a previous name or its storage key. Designs linked to other systems or none are skipped; an unreadable design (invalid JSON, a newer version, a write in progress) is a `DESIGN_UNREADABLE` warning. A `.trickroom/designs` folder that cannot be listed (anything but absent) fails the run with a `DESIGNS_UNREADABLE` error, for the same reason as unreadable sources: a design side with no designs would pass as clean. Instances whose markers name another system are not usages. Coverage takes `usedInDesigns` and `designUsages` from `usages`; the `designs` rows count the usages and the findings located in each design and board.

## Design validation

`design-lint.ts` runs the design-side kinds on one design: `loadDesignLintSetup` reads the linked system read-only (components, `lint.json`, token snapshot) into a contract and resolved config, and `lintDesign` builds the index of that design (or of some boards) and runs the design-side kinds through the same runner, with the same Tailwind inspector loader. Unlike a lint run it never fails:

- An invalid or unreadable `lint.json` (a folder in its place, a permission problem) applies the defaults, invalid options included (they make the file invalid); this is an `INVALID_LINT_CONFIG` diagnostic. Components that cannot be read are an `INVALID_COMPONENT_MANIFEST` diagnostic and the component rules see none. A kind that throws is skipped with a `LINT_RULE_FAILED` diagnostic.
- Findings without a design location (`design.design-only-class-target`) are kept only for components the checked boards place, and findings located on a component definition only for the versions the checked boards place. An instance's inherited classes are reported there, once, rather than on the instance.

Two callers:

- `design_validate` (whole file and operation-plan dry-runs) passes `lint` to `getDesignDiagnostics`, which then runs the kinds instead of its own class checks. Each finding is an issue whose `code` is the rule kind id and whose severity is the instance's; the kind's `details` ride along (`check` holds the former class code, plus `classToken`, `suggestions`, `axis`, `value`, …). A finding located on a component definition has no `path` or `elementId`; it carries `component` (the slug) and `componentLocation`: `{ componentId, version, path, axis?, value?, compound? }`. `info` findings are not issues; diagnostics are warnings. The other checks (recipes, renderers, assets and icons, `DESIGN_TOKENS_NOT_STORED`, `DESIGN_SYSTEM_REVIEW_REQUIRED`) run as before. `design_apply` does not pass `lint`, so its write diagnostics keep their codes. See [MCP](mcp.md#validation-design_validate).
- The editor: `GET /api/trickroom/design/lint?id=<designId>` returns `{ designId, system, rules, findings, diagnostics }` for the saved design (`system` null when the design links none). The design inspector lists the findings on the selected layer and, with nothing selected, the design's totals, the component-level findings (with the component, version, template path and variant for those located on a component) and the diagnostics. The query (`src/queries/design-lint.ts`, prefix `trickroom-design-lint`) refreshes on design and system file events, so it follows autosave.

## Ratchet

A run compares its tracked numbers with the committed report's `ratchetBaseline.numbers` and with the thresholds in `lint.json`. It fails when any tracked number got worse, or any threshold is broken.

Tracked numbers:

| Metric | Direction |
| --- | --- |
| `code.errors`, `code.warnings`, `design.errors`, `design.warnings` | lower is better |
| `rule.<kind id>`: errors plus warnings of that kind | lower is better |
| `coverage.published`, `coverage.generated`, `coverage.bound`, `coverage.usedInApp`, `coverage.usedInDesigns`: components in that state | higher is better |

`info` findings are not tracked. A number missing on either side counts as 0, so switching a kind off never fails a run; a null coverage state counts as 0. Thresholds are maxima for errors, warnings and per-kind counts, minima for coverage.

### New rule kinds

A Trickroom release that ships a new rule kind would fail every project's next run on that kind's existing findings, and since a failing run writes nothing, the project could not even record a new baseline. Instead, a kind the baseline **predates** is **adopted**: it is not compared, its count enters the next baseline as it is, and from then on it ratchets like any other kind.

- **Predates.** Every baseline lists in `ratchetBaseline.kinds` every rule kind id its writers knew, enabled in `lint.json` or not: the ledger of ids Trickroom has ever shipped, the running registry, and the previous baseline's `kinds`. The list only grows. A kind that ran in this run and is not in that list is new. Whether the baseline has a number for it does not matter.
- **Removed, downgraded, restored.** A run on a Trickroom without a kind (one that removed it, or an older release it was downgraded to) keeps the kind in `kinds` but writes no number for it. When the kind comes back it is compared as usual against 0, like a kind switched back on, and never adopted again.
- **Switched off and on again.** A kind switched off is still listed (it shipped), so switching it back on is compared as usual: its findings count against a missing number, 0, and fail the run. Switching a kind off, adding violations and switching it back on cannot launder them. Adoption is only for kinds the baseline could not have known.
- **Baselines without `kinds`**, written before it was recorded: every run writes a `rule.<id>` number for each kind it ran, 0 included, so a kind without a number in such a baseline is taken as new. That also adopts a kind that was switched off when the old baseline was written and is on now, once: the next passing run writes `kinds` and the strict rule applies from there.
- **Older writers.** A Trickroom without `kinds` support drops the list (and `adopted`) when it writes a report, and its baseline is then read as one without `kinds`, with the gap above: a kind switched off at that point is adopted when it is switched back on. The strict guarantee holds only while every Trickroom that writes the report understands `kinds`; nothing enforces that.
- **Aggregates.** `code.errors`, `code.warnings`, `design.errors` and `design.warnings` are compared with the adopted kinds' errors and warnings left out, so the kinds the baseline knew still ratchet exactly as before. In `ratchet.baseline` the adopted kinds are folded in: their `rule.<id>` number is this run's and their counts are added to the aggregates, so the regressions, the CLI and the dashboard's deltas all compare against the same numbers. `ratchetBaseline` (the committed baseline) is never changed by a comparison.
- **Thresholds** stay absolute. A `lint.json` maximum on `code.warnings` counts the new kind's warnings too, and a run that breaks it fails as before.
- **Kind ids are permanent.** Adoption is decided by id, so renaming a kind would make the new id new, adopted with whatever findings it has, and its aggregate would even show an improvement. `src/lint/rules/ledger.ts` lists every id Trickroom has ever shipped, and `ledger.test.ts` fails when a registered kind is missing from it or a listed id leaves the registry without being marked `retired`, so a rename or a removal cannot happen silently. Retired ids stay in the ledger, and every written `kinds` includes the whole ledger, so they are never new again. A real rename would need an explicit alias that maps the old `rule.<id>` number onto the new id; there is none yet.
- **Reported.** `ratchet.adopted` lists `{ metric: "rule.<id>", current, reason: "new-kind" }` for every adopted kind, 0 counts included, sorted by metric; empty on a first run and once the baseline lists the kind. `--check` passes when adoption is all that happened but writes nothing, so it adopts the same kinds again next time; a run without `--check` writes the baseline with them and with the current `kinds`. A failing run keeps the previous baseline, so the kinds are adopted on the next passing one.

Two blocks of the report carry the ratchet, with different jobs:

- `ratchet` is **this run's comparison**: the baseline it compared against (with that baseline's numbers), the regressions, the breaches and this run's numbers. It is what the dashboard shows as the delta against the committed baseline. On a passing improvement from one error to zero, `ratchet.baseline.numbers["code.errors"]` is still 1 and `ratchet.numbers["code.errors"]` is 0.
- `ratchetBaseline` is **the forward-looking baseline**: what the next run compares against.

Outcome and the baseline:

- **First run** (no committed report): passes with `ratchet.baseline: null`, and its numbers become the baseline.
- **Pass**: the report is written with `ratchetBaseline` set to this run's numbers and the known rule kinds (see [New rule kinds](#new-rule-kinds)).
- **Fail**: `trickroom lint` and the `lint` tool write nothing, so the committed baseline stands. The dashboard's `POST` runs with `write: "always"`: the failing report is written (so the UI can show it) but its `ratchetBaseline` is carried over from the previous report. The next run still ratchets against the last passing numbers; a failing report never lowers the bar. The working tree then shows a modified `lint-report.json` with `status: "fail"` that should not be committed as-is.
- `--check` never writes, whatever the outcome.
- An unreadable committed report (invalid JSON, unsupported version, a folder or a permission problem in its place) is reported as `INVALID_BASELINE` and the run starts a new baseline.

**When an upgrade widens a rule's scope.** A Trickroom release can make an existing kind check more than it did, so the same project gets more findings. For example, the design class kinds started checking component templates (see [Component classes](#component-classes)) and reported classes no rule had looked at. Unlike a new kind, a wider kind is not adopted on its own: its id is in the baseline, so the run fails on the rise and writes nothing. Accept the rise with `trickroom lint --adopt <kind id>` for each widened kind (see [Adopting a kind explicitly](#adopting-a-kind-explicitly)): the rest of the baseline stays, so any other regression still fails the run. Review the findings first, then commit the report on its own with a message naming the upgrade and the counts it changed.

Concurrent runs. Reading the baseline, comparing and writing are one step per report, so two runs can never both compare against the same old baseline and leave the worse result behind:

- **In one process** (the server, the MCP tool), runs that write queue up per report path: the second reads the baseline the first wrote. With a baseline of 10, a run with 5 and a run with 8 started together leave 5, whichever goes first (the run with 8 either fails against 5 or is replaced by it).
- **Across processes**, a write is a compare-and-swap under a lock file. Before re-reading the committed report the run creates `lint-report.json.lock` in the system folder with an exclusive create (`open` with `wx`), holding its pid, host and time, and keeps it until the report has been renamed into place, then removes it. Inside the lock it reads the report again; when its `generatedAt` differs from the report this run compared against (or a report appeared or became unreadable), the ratchet runs again against the new baseline; the findings are not recomputed. If the run still passes, the report is written with `ratchet` comparing against the new baseline. If it now fails, nothing is written, whatever the write mode, and the run fails (exit 1) with a `BASELINE_MOVED` error naming each number that got worse; `ratchet` holds that comparison. Run lint again to compare against the new baseline.
- **The lock.** A run waits up to 5 seconds for it, retrying every few milliseconds, then fails with `REPORT_LOCKED` (exit 2, nothing written). Each acquisition writes its pid, host, time and a fresh token into the lock. Only the owner ever empties the lock slot: its release removes the lock after checking that it still holds its own token (an owner whose lock was replaced removes nothing), and a run that creates the lock but cannot write its contents (a full disk) removes what it created before failing.
- **Reclaiming an abandoned lock.** A lock whose holder has exited is abandoned and reclaimed at once: `process.kill(pid, 0)` failing with `ESRCH` means the holder is gone. A live holder's lock is never reclaimed, however long it holds it. This assumes every run on a report runs on one host: a lock from another host (a project on a shared network drive), or one without a readable pid (a run that crashed while creating it), cannot be checked that way and is reclaimed only once it is older than 30 seconds. A lock whose pid was reused by an unrelated process stays until that process exits or the file is deleted by hand, which the `REPORT_LOCKED` message suggests. Reclaiming replaces the lock rather than removing it, and one reclaimer at a time: the reclaimer first takes a second, short-lived lock, `lint-report.json.reclaim`, with the same exclusive create. Holding it, it reads the main lock again and, only if it still holds exactly the abandoned contents it judged, renames its own lock (written to a temp sibling, `lint-report.json.lock.<pid>.<random>.tmp`) over the lock path, an atomic replace; then it releases the reclaim lock. If the main lock changed, or another process holds the reclaim lock, it goes back to waiting. So of two reclaimers of the same abandoned lock, the second finds the first one's live lock and waits for it. The reclaim lock is held for milliseconds; one whose owner is dead, or that is unreadable and older than 10 seconds (a reclaimer that crashed inside that section), is removed. A live owner's never is.
- **Fencing.** Right before renaming the report into place, the run reads the lock again: when the token is not its own or the lock is gone, it writes nothing and fails with `REPORT_LOCKED`. So a run whose lock was replaced writes nothing, even in the residual case: removing an abandoned reclaim lock is a check and an unlink, so two reclaimers can share the section only if one crashes inside it and two further reclaimers then remove its reclaim lock within the same few milliseconds; the one whose replace comes first then loses its lock, and its fencing check stops its write unless the second replace falls between that check and its report rename. Same-host pid liveness is assumed throughout.
- **Files.** The report itself is written to a temp file and renamed, so a crash never leaves it half-written; at worst a `.tmp` file and the lock stay behind. The lock is created only in a system folder the report may be written to, the project file watcher ignores it, its temp siblings and the reclaim lock like the report's `.tmp` files, and none is a JSON file, so Biome skips them. Add `.trickroom/systems/*/lint-report.json.lock*` and `.trickroom/systems/*/lint-report.json.reclaim` to `.gitignore` if you do not want an abandoned one in `git status`. `--check` takes no lock.

`LintRatchetResult`, returned by every entry point and stored as the report's `ratchet`: `{ status, baseline: { generatedAt, numbers, kinds? } | null, regressions: [{ metric, baseline, current }], breaches: [{ metric, kind: "max" | "min", limit, current }], adopted: [{ metric, current, reason, baseline? }], numbers }`.

### Adopting a kind explicitly

Adoption of new kinds covers a kind the baseline could not have known. Two other changes raise a known kind's count on purpose, and the ratchet fails them like any regression:

- switching on a kind that was off (or never enabled) when the project already has findings of it;
- a Trickroom upgrade that widens what an existing kind checks (see "When an upgrade widens a rule's scope" above).

`trickroom lint --adopt <kind id>` accepts such a rise. The option is repeatable, one kind per flag; there is no `--adopt all`, so every accepted kind is named in the command. A run that adopts:

- **Takes the kind's count as its baseline**: its `rule.<id>` number in the baseline compared against is this run's, and the side aggregate of the severity the kind has now (`errors` or `warnings`; a kind's findings share one severity) rises by what the kind rose, its count minus the baseline's number. A kind whose count fell lowers no aggregate. Every other number compares as before, so the run fails when anything else got worse and then writes nothing, adoption included.
- **Records it**: `ratchet.adopted` lists `{ metric: "rule.<id>", current, reason: "explicit", baseline }` for each named kind, `baseline` being the number it replaced (0 when the baseline had none). A passing run writes the report, so the adoption, its numbers and the new `ratchetBaseline` show in the report's git diff, with this run's `generatedAt`. The next run has nothing to adopt and lists nothing.
- **Must write.** `--adopt` with `--check` is an error (`INVALID_ADOPT`, exit 2): an adoption that is not written would have to be repeated on every later run.
- **Must name a kind that runs.** An id that is not in the ledger (`src/lint/rules/ledger.ts`) or the registry is `INVALID_ADOPT`, as is a known kind that does not run (switched off in `lint.json`, retired, or missing from this Trickroom): there is no count to adopt. Both are checked before the baseline is touched.

A named kind the baseline predates is adopted as a new kind (`reason: "new-kind"`), as it would be without the flag. On a first run there is no baseline and nothing is adopted. Thresholds stay absolute, as for new kinds. `--adopt` accepts a count, not a severity change: a kind moved from warning to error in `lint.json` with `--adopt` still raises `<side>.errors` by its whole previous count, since the baseline does not record which severity its number had.

Review the findings before adopting: only a rise the change explains belongs in the baseline. Commit the written report on its own, with a message naming the kind and why its count rose.

## CLI

```sh
trickroom lint [project] [--check] [--json] [--system <id|name>] [--adopt <rule kind id>]...
```

| Flag | Meaning |
| --- | --- |
| `--check` | Compare and report, write nothing. For CI and pre-commit. |
| `--json` | Print the `LintRunResult` alone on stdout: `status`, `mode`, `system`, `report`, `ratchet`, `baseline` (`absent`, `invalid`, `present`), `reportPath`, `written`, `diagnostics`. |
| `--system` | Select a system by id, name or storage key. |
| `--adopt` | Accept a rule kind's current count as its baseline (see [Adopting a kind explicitly](#adopting-a-kind-explicitly)). Repeatable, one kind id per flag; `all` is refused. Not with `--check`. |

Exit codes: 0 pass, 1 ratchet failure (including `BASELINE_MOVED`, see [Ratchet](#ratchet)), 2 error (a report lock held by another run for 5 seconds, `REPORT_LOCKED`; no project, invalid config or `lint.json` including invalid rule options and a `lint.json` that cannot be read, unknown or ambiguous system, `--adopt` with `--check` or naming a kind that is unknown or does not run (`INVALID_ADOPT`), a source folder or file that cannot be read (`SOURCES_UNREADABLE`), a designs folder that cannot be listed (`DESIGNS_UNREADABLE`), a crashed rule, a refused write, or anything the engine did not foresee, reported as `RUN_FAILED`). Warnings that do not stop a run: `COMPONENT_MANIFEST_DIAGNOSTIC`, `CODEGEN_OTHER_SYSTEM`, `INVALID_BASELINE`, `SOURCE_PARSE_ERROR`, `SOURCE_ROOT_MISSING`, `SOURCES_TRUNCATED`, `WRAPPER_MODULE_NOT_SCANNED`, `DESIGN_UNREADABLE`. An error never escapes `runLint` as an exception, so `--json` output stays valid. Human output lists each side's counts, then findings grouped by rule kind with their location, then every rule kind adopted into the baseline (`adopted: rule.<id> <count> (new rule kind)`, see [New rule kinds](#new-rule-kinds), or `adopted: rule.<id> <baseline> -> <count> (--adopt)`), every number that got worse and every threshold broken, then one closing line. A passing run that adopted kinds says how many in the closing line, new kinds and kinds named with `--adopt` apart; with `--check`, that new kinds are adopted once lint runs without it.

There is no `--help`: an unknown option prints the usage line and exits 2, as `trickroom codegen` does. The unknown-command message of `trickroom` lists `lint`.

`pnpm build:lint` builds `dist/lint.js` and `pnpm build:tailwind-worker` the canonicalization worker it starts, `dist/tailwind-canonicalize-worker.js`; `pnpm build` includes both.

## MCP

The `lint` tool (`src/mcp/tools/lint.ts`, group `designValidation`) takes `check`, `adopt` (rule kind ids, as `--adopt`; not with `check`), `system` and `response` (`"summary"` default, `"full"` adds the whole report) plus the usual `project` override, and returns `{ status: "success", project, lint }` where `lint` is the run result without the report (`status`, `mode`, `system`, `ratchet`, `baseline`, `reportPath`, `written`, `diagnostics`, `generatedAt`, `summary`) and, with `response: "full"`, the `report`. A run that cannot complete is a tool error `LINT_FAILED` with the diagnostics. It needs read-write mode in every case, like `design_export`, because the codegen check runs the project's formatter and a non-check run writes the report.

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

- **Adherence.** The ratchet outcome with each regression and breach, and the kinds in `ratchet.adopted` with their counts, a named kind with the number it replaced. Per side, the error, warning and info counts from `summary`, each tracked number with its delta against the baseline the run compared with (adopted kinds folded in, so they show no delta), a "Regressed" mark for `ratchet.regressions` and an "Over max"/"Under min" mark for `ratchet.breaches`. Limits come from the current `lint.json` thresholds. Below that, one row per rule kind in `summary[side].rules` with its counts, the `rule.<id>` delta and its per-kind maximum; a row opens the findings of that kind. The severity shown is the one the report counted (errors, else warnings, else info); a kind without findings shows the configured severity, muted. Catalogue kinds missing from the summary are listed as disabled. The design side reads "Not available yet" while `summary.design` is null.
- **Coverage.** One row per `components[]` entry with a five-cell strip (published, generated, bound, used in app, used in designs): solid when met, an amber frame when it is a gap, dashed when the report has null. Gaps are listed as badges with what to do about them in the inspector, which also shows the usages in the app and in designs; null is never a gap. Filters: all, any gap, or the gap of one state, plus a search. Rows are virtualized like the findings list (`useVirtualRows` against the workspace scroller, each row measured since its gap badges may wrap), so a system with thousands of components renders a screenful. Above the table, the component count per state with the coverage delta and minimum.
- **Code map.** A file tree built from `files[]`. Folders add up usages, findings and file counts, and a folder whose only child is a folder shares its row (`src/components/ui`). Each row has two square swatches, usage in cyan and findings (errors plus warnings) in red, on five discrete steps: zero, then the quartiles of the non-zero file values. Folders use their files' scale, so a busy folder reads as hot. Rows are virtualized with `@tanstack/react-virtual` against the workspace scroller. Filter by path or to files with findings, sort by name, usage or findings. A file shows its findings in the inspector; "Show in findings" opens the list filtered to that file or folder.
- **Design map.** The same tree over `designs[]`: a design row adds up its board rows, and a row with `board: null` counts towards its design without being listed as a board. Design names come from the design summaries; boards show their id. Empty state while `designs` is null.
- **Findings.** Every finding, filterable by side, severity, rule, component, file or folder, design and board, and text. The other views link into it with a filter set. A design finding has "Open in editor", a link to `buildDesignPath(design, { boardId, layerId })`, the deep link the editor channel's focus requests use. A finding located on a component shows its version, template path and the template, slot default, variant value or compound variant the classes come from, with "All of this component" (the component filter: its definition findings and the findings on its instances, which carry the same slug) and "Go to component". "Go to component" is also on such findings in the lists of the file, component and design inspectors. It follows `/system/<system>?component=<componentId>&version=<version>&path=<path>` (`buildSystemComponentPath`, `src/utils/system-deep-link.ts`), the route that opens a component in the System editor, and the editor follows that URL when it changes inside the page. The tab is in the URL too (`?tab=lint`; a tab click replaces the current entry), so Back from the component returns to the tab the link was followed from. The component list and the editor's back button navigate the same way (a push), so every view change shares one guard: a change that leaves the component holding unsaved edits, for another component or for the list, asks first (Save, Discard changes or Cancel). Cancel undoes the blocked push (or replaces the URL with the last applied one when it was Back or a replace), and a save that finishes after Cancel or after a newer navigation does not open the old destination. Edits kept while another tab was open (Back to Lint, then Components) reopen their component instead of the list, so only a confirmed change drops a draft. The editor shows a component's draft, not a published version, so `path` is selected in the draft's Layers only when the draft is made over `version` (its `baseVersion`, else the current version); for a finding on an older version the component opens without a selection.
- **Rules.** The `lint.json` editor: per kind, enabled, severity (or the default) and maximum findings, and a form for the options `LINT_RULE_OPTION_SPECS` documents (`boolean`, `number`, `string`, `string` with `values` as a choice, `string-list` for allow lists and globs, `component-map` for per-component lists, `{ [slug]: string[] }` or `{ [slug]: { [entryKey]: string[] } }`). The shape check is the one `lint.json` validation uses (`optionValueHasSpecShape`). Stored options a spec does not list, and values that do not match their spec, are shown read-only as JSON and saved unchanged. Then the side maxima and coverage minima, the `components[slug].module` overrides and `source.include`, `exclude` and `classCalls` with the defaults as placeholders. Edits stay in a draft until "Save lint.json". The draft helpers drop keys that equal the default, so the file holds only real choices. A refused save lists the engine's issues. When the file changed on disk during an edit, saving needs an explicit "Overwrite".

"Run lint" calls `runSystemLint`, shows the elapsed time while the engine runs, then the outcome: pass, or fail with each regression and breach. A failing run's report is written (the baseline inside it is kept), and the dashboard says it should not be committed as is. The header shows the report's status, when it was generated and a "Stale" badge when `current.contractHash` differs from `report.contract.hash`, which happens when components, tokens or the codegen block changed since the run. Changes to `lint.json` do not make a report stale; run lint again to see their effect. Before the first run the views show the CLI command and the run button; the Rules view works without a report.

## Limits

The source model is syntactic, so some code is out of reach. What a rule cannot see it does not report; where that can make a rule report something wrong, the entry says so.

- **Class strings** are the literals under `className` and the class calls. A module-level constant (`const field = "px-2 text-[11px]"`), `[...].filter(Boolean).join(" ")` and template fragments are not checked.
- **Arbitrary values** are reported in six token domains: color, font, text, radius, shadow and blur. Others, such as spacing (`w-[18px]`) or inset shadows (`inset-shadow-[0_0_0_1px]`), are not.
- **Slot calls** are traced through `const s = buttonVariants()`, destructuring the call (`const { root } = buttonVariants()`) and calls on call results. A slot called through a second alias (`const { root } = s`), a rest binding, a computed member (`s["root"]()`) or after a reassignment is not seen, so `code.slot-not-called` may report it.
- **Extending** the variants export (`tv({ extend: buttonVariants, … })`) is not a call of it: `code.wrapper-missing-variants-call` reports such a wrapper, and slots called on the extended function are not traced.
- **Merging**: `code.redundant-class` merges with the derived tailwind-merge config when `codegen.twMerge` is on, and with stock `tailwind-merge` otherwise, never with a project's own hand-written merge configuration. When the derived config cannot be derived it checks nothing and reports one `info` finding. With `codegen.twMerge` on but a `tv` that does not use the generated config, findings may not match the runtime.
- **Cost of canonical forms.** The first canonicalization on a compiled system builds Tailwind's lookup tables: about 3 s for this repository's system, in the worker, so the server keeps answering while it runs. A lint run, `design_validate` or an editor refresh that needs it still waits that long, once per compiled system (and per distinct stylesheet text) until its CSS changes; every later class takes milliseconds. Verifying a canonical form compiles the class and the form once per distinct class, cached with the canonical form, plus one scan of the stylesheets' text per compiled system: about 35 ms for the 64 distinct suggestions of a 2,600-finding project once the tables are built, and 3 to 8 ms for the scan of its 32 KB of CSS. The check in context compiles each class of a context once and compares the order only when there are competitors; results are cached per set of classes and pair. On that project, 2,373 findings came down to 110 distinct checks, and the run took about 0.4 s (4%) longer than without them.
- **Canonical forms** come from the Tailwind the project installs and the system's theme. A Tailwind upgrade can make classes non-canonical (4.3 added `scrollbar-*`, so `[scrollbar-width:thin]` is reported from then on), and a canonical form can tie a class to the theme: `max-w-104` follows `--spacing` where `max-w-[26rem]` did not (such findings say so, and carry `themeDependent`), as can a token the stylesheets also set outside `@theme`, such as in `.dark { … }`.
- **Component classes** are reported per published version: a class that an older version in use and the current version share is one finding on each, until the instances are migrated. Fixing a slot default child's classes in a new version does not fix the copies placed earlier: an instance migrated to that version keeps its old copies, which then no longer match the default and are reported on the instance. Copies are recognized by Element and classes, not by a marker: a layer a designer adds to a slot with exactly a default's Element and classes, where that default's copy is missing, is taken for the copy. An instance whose version does not resolve repeats its component's classes (see [Component classes](#component-classes)).
