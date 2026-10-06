import type { CodegenRunResult } from "../../codegen/run-codegen";
import type { TailwindUtilityInspection } from "../../utils/tailwind-utility-inspector";
import type {
	LintSeverity,
	ResolvedLintConfig,
	ResolvedLintRule,
} from "../config";
import type { SystemContract } from "../contract";
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
			board?: string;
			/** Element id. */
			element?: string;
			/** Template path inside a component, when the finding is on one. */
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
};

export type LintTailwindInspector = {
	inspect: (candidate: string) => TailwindUtilityInspection;
};

export type LintRuleContext = {
	projectRoot: string;
	contract: SystemContract;
	config: ResolvedLintConfig;
	/** The instance being run: its options and severity. */
	rule: ResolvedLintRule;
	/** The codegen check of this run; null when the project has no codegen block. */
	codegen: CodegenRunResult | null;
	sources: SourceIndex;
	/** Design-side inputs; WP4 fills this. */
	designs: null;
	/**
	 * The compiled Tailwind design system of the linked CSS, loaded on first
	 * use and shared by every rule of the run. Null when the system has no
	 * `cssPath` or it fails to compile.
	 */
	tailwind: { inspector: () => Promise<LintTailwindInspector | null> };
};

export type LintRuleKind = {
	/** `<side>.<kebab-name>`, the key in `lint.json` and the report. */
	id: string;
	side: LintSide;
	defaultSeverity: LintSeverity;
	description: string;
	run: (
		context: LintRuleContext,
	) => LintRuleFinding[] | Promise<LintRuleFinding[]>;
};
