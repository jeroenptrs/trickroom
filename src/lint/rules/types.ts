import type { CodegenRunResult } from "../../codegen/run-codegen";
import type {
	CanonicalizedClass,
	ContextCheck,
	ContextVerdict,
} from "../../utils/tailwind-canonical-equivalence";
import type { TwMergeConfig } from "../../utils/tailwind-merge-config";
import type { TailwindUtilityInspection } from "../../utils/tailwind-utility-inspector";
import type {
	LintSeverity,
	ResolvedLintConfig,
	ResolvedLintRule,
} from "../config";
import type { SystemContract } from "../contract";
import type { LintDesignIndex } from "../designs";
import type { LintRuleOptionSpec } from "../rule-options";
import type { SourceIndex } from "../source/index";

/**
 * A rule kind is shipped code; a rule instance is its `lint.json` entry
 * (enabled, severity, options). The runner builds one context per run,
 * sets `rule` to the instance and collects what `run` returns.
 */

export type LintSide = "code" | "design";

export type LintLocation =
	| {
			kind: "code";
			/** Relative to the project root, `/` separators. */
			file: string;
			/** 1-based. */
			line?: number;
			column?: number;
	  }
	| {
			kind: "design";
			/** Design file id. */
			design: string;
			/** Board id. */
			board?: string;
			/** Element id. */
			element?: string;
			/** The element's path in the design file, e.g. `boards[0].children[2].props.className`. */
			path?: string;
	  };

/**
 * Where in a published version of a system component (as `components.json`
 * defines it) a finding is. Not a `LintLocation` kind: a finding located on
 * a component has `location: null` and carries this as `componentLocation`,
 * so a report reader from before it still reads the report (it ignores the
 * field) instead of discarding the whole baseline.
 */
export type LintComponentLocation = {
	/** System component id. */
	componentId: string;
	/** The published version the classes belong to. */
	version: string;
	/**
	 * The slot whose default children the node is one of; absent for the
	 * template's own nodes.
	 */
	slot?: string;
	/** Template path of the node the classes style, e.g. `root` or `label`. */
	path?: string;
	/** The variant axis and value whose classes these are. */
	axis?: string;
	value?: string;
	/** Index of the compound variant whose classes these are, 0-based. */
	compound?: number;
};

/** What a rule returns; the runner adds `rule`, `side` and the severity. */
export type LintRuleFinding = {
	message: string;
	location: LintLocation | null;
	/** Where in a component definition, for findings located on one (`location` is null). */
	componentLocation?: LintComponentLocation;
	/** Component slug, when the finding is about one. */
	component?: string;
	/**
	 * Only for notes that are not violations (`info`), for example a check
	 * that was skipped. Violations take the instance's severity.
	 */
	severity?: Extract<LintSeverity, "info">;
	/**
	 * Machine-readable extras for entry points other than the report, such
	 * as the offending class and suggestions `design_validate` returns. The
	 * report never stores them.
	 */
	details?: Record<string, unknown>;
};

export type LintTailwindInspector = {
	inspect: (candidate: string) => TailwindUtilityInspection;
	/** Nearest valid classes for an unsupported candidate, variants kept. */
	suggest?: (candidate: string) => string[];
	/**
	 * Each class as the system's Tailwind writes it
	 * (`designSystem.canonicalizeCandidates`), in order; a class that already
	 * is canonical, or that Tailwind does not know, comes back unchanged.
	 * A form that differs carries the verdict of compiling both
	 * (`src/utils/tailwind-canonical-equivalence.ts`). Asynchronous: the
	 * server computes it in a worker
	 * (`src/utils/tailwind-canonicalize-client.ts`).
	 */
	canonicalize?: (
		candidates: readonly string[],
	) => Promise<CanonicalizedClass[]>;
	/**
	 * Each canonical form among the classes that may render next to it: the
	 * class's competing declarations keep their order in the cascade
	 * (`verifyCanonicalInContext`). In the worker too.
	 */
	verifyInContext?: (
		checks: readonly ContextCheck[],
	) => Promise<ContextVerdict[]>;
};

/** How tv() merges for the linted system (`LintRuleContext.tailwind.mergeConfig`). */
export type LintTwMergeConfig =
	| { status: "stock" }
	| { status: "derived"; config: TwMergeConfig }
	| { status: "failed"; message: string };

export type LintRuleContext = {
	projectRoot: string;
	contract: SystemContract;
	config: ResolvedLintConfig;
	/** The instance being run: its options and severity. */
	rule: ResolvedLintRule;
	/** The codegen check of this run; null when the project has no codegen block. */
	codegen: CodegenRunResult | null;
	sources: SourceIndex;
	/**
	 * The designs linked to the system and where its components are placed.
	 * `design_validate` hands in the one design (or the boards) it checks.
	 */
	designs: LintDesignIndex;
	/**
	 * The compiled Tailwind design system of the linked CSS, loaded on first
	 * use and shared by every rule of the run. Null when the system has no
	 * `cssPath` or it fails to compile.
	 */
	tailwind: {
		inspector: () => Promise<LintTailwindInspector | null>;
		/**
		 * How tv() merges for this system, shared like the inspector:
		 * `derived` with the tailwind-merge config derived from the linked CSS
		 * (`deriveTwMergeConfig`) when `codegen.twMerge` generates it for this
		 * system, `stock` otherwise, `failed` when that config cannot be
		 * derived (the CSS does not compile, the merge groups do not fit).
		 */
		mergeConfig: () => Promise<LintTwMergeConfig>;
	};
};

export type LintRuleKind = {
	/** `<side>.<kebab-name>`, the key in `lint.json` and the report. */
	id: string;
	side: LintSide;
	defaultSeverity: LintSeverity;
	description: string;
	/**
	 * The options the kind takes, the one source for validating `lint.json`
	 * (`getLintConfigIssues`: unknown keys and malformed values are
	 * `INVALID_LINT_CONFIG`) and for the dashboard's option forms. A kind
	 * without specs takes no documented options and ignores any.
	 */
	options?: readonly LintRuleOptionSpec[];
	run: (
		context: LintRuleContext,
	) => LintRuleFinding[] | Promise<LintRuleFinding[]>;
};
