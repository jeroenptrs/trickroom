import type { CodegenRunResult } from "../../codegen/run-codegen";
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

/** What a rule returns; the runner adds `rule`, `side` and the severity. */
export type LintRuleFinding = {
	message: string;
	location: LintLocation | null;
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
