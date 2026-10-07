import path from "node:path";
import { type LintRuleOptionSpec, lintRuleOptionIssues } from "./rule-options";

/**
 * `.trickroom/systems/<id>/lint.json`: the rule instances, identity
 * overrides, source globs and ratchet thresholds of one system. Rule kinds
 * are code (`src/lint/rules/`); this file turns them on, sets severities and
 * options. It carries its own `version` so its shape can migrate like the
 * other persisted shapes. Absent file: every shipped rule kind enabled at
 * its default severity. Documented in docs/lint.md.
 */

export const LINT_CONFIG_VERSIONS = [1] as const;
export const LINT_CONFIG_FILE_NAME = "lint.json";

export type LintSeverity = "error" | "warning" | "info";
export const LINT_SEVERITIES: readonly LintSeverity[] = [
	"error",
	"warning",
	"info",
];

export type LintRuleConfig = {
	enabled?: boolean;
	severity?: LintSeverity;
	options?: Record<string, unknown>;
};

export type LintComponentConfig = {
	/**
	 * The module(s) that are this component's bound wrapper, relative to the
	 * project root, for barrel files and renamed wrappers. Without it the
	 * module importing the generated variants file is the wrapper.
	 */
	module?: string | string[];
};

export type LintSourceConfig = {
	/** Globs relative to the project root. */
	include?: string[];
	exclude?: string[];
	/** Call names whose string arguments are class strings. */
	classCalls?: string[];
};

export type LintSideThresholds = {
	/** Maximum findings of that severity on the side. */
	errors?: number;
	warnings?: number;
};

export type LintCoverageThresholds = {
	/** Minimum number of components in that coverage state. */
	published?: number;
	generated?: number;
	bound?: number;
	usedInApp?: number;
	usedInDesigns?: number;
};

export type LintThresholds = {
	code?: LintSideThresholds;
	design?: LintSideThresholds;
	/** Maximum findings per rule kind, any severity. */
	rules?: Record<string, number>;
	coverage?: LintCoverageThresholds;
};

export type LintConfig = {
	version: (typeof LINT_CONFIG_VERSIONS)[number];
	rules?: Record<string, LintRuleConfig>;
	/** Keyed by component slug. */
	components?: Record<string, LintComponentConfig>;
	source?: LintSourceConfig;
	thresholds?: LintThresholds;
};

export const DEFAULT_CLASS_CALLS = [
	"tv",
	"cn",
	"clsx",
	"cva",
	"cx",
	"twMerge",
	"twJoin",
] as const;

export const SOURCE_EXTENSIONS = [
	"ts",
	"tsx",
	"js",
	"jsx",
	"mjs",
	"cjs",
] as const;

export const DEFAULT_SOURCE_EXCLUDE = ["**/*.d.ts"] as const;

const SOURCE_LIKE_ROOTS = new Set(["src", "app", "lib", "source", "packages"]);

const extensionGlob = `*.{${SOURCE_EXTENSIONS.join(",")}}`;

/**
 * The default include globs: the source-like root that contains the codegen
 * `outDir` (`src/components/ui` -> `src/**`, `packages/ui/src/x` ->
 * `packages/**`), the top-most segment otherwise, and `src/**` without a
 * codegen block.
 */
export const defaultSourceInclude = (
	codegenOutDir: string | null,
): string[] => {
	if (codegenOutDir === null) {
		return [`src/**/${extensionGlob}`];
	}
	const segments = codegenOutDir
		.split(/[\\/]/u)
		.filter((segment) => segment.length > 0 && segment !== ".");
	if (segments.length === 0) {
		return [`**/${extensionGlob}`];
	}
	const rootIndex = segments.findIndex((segment) =>
		SOURCE_LIKE_ROOTS.has(segment),
	);
	const root = segments.slice(0, rootIndex === -1 ? 1 : rootIndex + 1);
	return [`${root.join("/")}/**/${extensionGlob}`];
};

const CONFIG_KEYS = new Set([
	"version",
	"rules",
	"components",
	"source",
	"thresholds",
]);
const RULE_KEYS = new Set(["enabled", "severity", "options"]);
const COMPONENT_KEYS = new Set(["module"]);
const SOURCE_KEYS = new Set(["include", "exclude", "classCalls"]);
const THRESHOLD_KEYS = new Set(["code", "design", "rules", "coverage"]);
const SIDE_THRESHOLD_KEYS = new Set(["errors", "warnings"]);
const COVERAGE_THRESHOLD_KEYS = new Set([
	"published",
	"generated",
	"bound",
	"usedInApp",
	"usedInDesigns",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
	typeof value === "string" && value.trim().length > 0;

const isCount = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value >= 0;

const unknownKeyIssues = (
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	prefix: string,
) =>
	Object.keys(value)
		.filter((key) => !allowed.has(key))
		.map(
			(key) =>
				`${prefix}.${key} is not a known key (expected one of ${[...allowed].join(", ")}).`,
		);

const stringListIssues = (value: unknown, field: string): string[] => {
	if (value === undefined) {
		return [];
	}
	if (!Array.isArray(value)) {
		return [`${field} must be an array of strings.`];
	}
	return value.flatMap((entry, index) =>
		isNonEmptyString(entry)
			? []
			: [`${field}[${index}] must be a non-empty string.`],
	);
};

const relativePathIssues = (value: string, field: string): string[] => {
	if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
		return [`${field} must be relative to the project root; got "${value}".`];
	}
	if (value.split(/[\\/]/u).includes("..")) {
		return [
			`${field} must stay inside the project and cannot contain a ".." segment; got "${value}".`,
		];
	}
	return [];
};

const ruleIssues = (
	value: unknown,
	id: string,
	knownRuleIds: ReadonlySet<string> | null,
): string[] => {
	const field = `rules["${id}"]`;
	if (knownRuleIds && !knownRuleIds.has(id)) {
		return [
			`${field} names an unknown rule kind; this Trickroom ships ${[...knownRuleIds].map((known) => `"${known}"`).join(", ")}.`,
		];
	}
	if (!isRecord(value)) {
		return [`${field} must be an object with enabled, severity or options.`];
	}
	const issues = unknownKeyIssues(value, RULE_KEYS, field);
	if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
		issues.push(`${field}.enabled must be a boolean.`);
	}
	if (
		value.severity !== undefined &&
		!LINT_SEVERITIES.includes(value.severity as LintSeverity)
	) {
		issues.push(
			`${field}.severity must be one of ${LINT_SEVERITIES.map((severity) => `"${severity}"`).join(", ")}; got ${JSON.stringify(value.severity)}.`,
		);
	}
	if (value.options !== undefined && !isRecord(value.options)) {
		issues.push(`${field}.options must be an object.`);
	}
	return issues;
};

const componentIssues = (value: unknown, slug: string): string[] => {
	const field = `components["${slug}"]`;
	if (!isRecord(value)) {
		return [`${field} must be an object.`];
	}
	const issues = unknownKeyIssues(value, COMPONENT_KEYS, field);
	if (value.module !== undefined) {
		const modules = Array.isArray(value.module) ? value.module : [value.module];
		if (modules.length === 0) {
			issues.push(`${field}.module must name at least one module path.`);
		}
		modules.forEach((entry, index) => {
			const entryField = Array.isArray(value.module)
				? `${field}.module[${index}]`
				: `${field}.module`;
			if (!isNonEmptyString(entry)) {
				issues.push(`${entryField} must be a non-empty string.`);
				return;
			}
			issues.push(...relativePathIssues(entry.trim(), entryField));
		});
	}
	return issues;
};

const sourceIssues = (value: unknown): string[] => {
	if (value === undefined) {
		return [];
	}
	if (!isRecord(value)) {
		return ["source must be an object with include, exclude or classCalls."];
	}
	return [
		...unknownKeyIssues(value, SOURCE_KEYS, "source"),
		...stringListIssues(value.include, "source.include"),
		...stringListIssues(value.exclude, "source.exclude"),
		...stringListIssues(value.classCalls, "source.classCalls"),
	];
};

const countRecordIssues = (
	value: unknown,
	allowed: ReadonlySet<string> | null,
	field: string,
): string[] => {
	if (value === undefined) {
		return [];
	}
	if (!isRecord(value)) {
		return [`${field} must be an object of counts.`];
	}
	const issues = allowed ? unknownKeyIssues(value, allowed, field) : [];
	for (const [key, count] of Object.entries(value)) {
		if ((allowed === null || allowed.has(key)) && !isCount(count)) {
			issues.push(`${field}.${key} must be a non-negative integer.`);
		}
	}
	return issues;
};

const thresholdIssues = (
	value: unknown,
	knownRuleIds: ReadonlySet<string> | null,
): string[] => {
	if (value === undefined) {
		return [];
	}
	if (!isRecord(value)) {
		return ["thresholds must be an object."];
	}
	const issues = [
		...unknownKeyIssues(value, THRESHOLD_KEYS, "thresholds"),
		...countRecordIssues(value.code, SIDE_THRESHOLD_KEYS, "thresholds.code"),
		...countRecordIssues(
			value.design,
			SIDE_THRESHOLD_KEYS,
			"thresholds.design",
		),
		...countRecordIssues(value.rules, null, "thresholds.rules"),
		...countRecordIssues(
			value.coverage,
			COVERAGE_THRESHOLD_KEYS,
			"thresholds.coverage",
		),
	];
	if (knownRuleIds && isRecord(value.rules)) {
		for (const id of Object.keys(value.rules)) {
			if (!knownRuleIds.has(id)) {
				issues.push(`thresholds.rules["${id}"] names an unknown rule kind.`);
			}
		}
	}
	return issues;
};

/**
 * What a config is checked against: the shipped rule kind ids, or the
 * registry itself, which adds each kind's option specs.
 */
export type LintKnownRules =
	| ReadonlySet<string>
	| {
			ids: ReadonlySet<string>;
			get: (id: string) => { options?: readonly LintRuleOptionSpec[] } | null;
	  };

const ruleIdsOf = (known: LintKnownRules | null) =>
	known === null ? null : "ids" in known ? known.ids : known;

/**
 * Every reason a lint config is invalid, each naming the offending field;
 * empty when valid. `known` (the registry) catches typos in rule ids and,
 * when it is the registry, checks each instance's `options` against its
 * kind's option specs (a kind without specs takes no documented options and
 * ignores any); pass null to validate the shape alone.
 */
export const getLintConfigIssues = (
	value: unknown,
	known: LintKnownRules | null,
): string[] => {
	const knownRuleIds = ruleIdsOf(known);
	if (!isRecord(value)) {
		return ["lint.json must be a JSON object."];
	}
	const issues = unknownKeyIssues(value, CONFIG_KEYS, "lint");
	const supported = LINT_CONFIG_VERSIONS.join(", ");
	if (value.version === undefined) {
		issues.push(
			`version is required; this Trickroom understands lint.json version ${supported}.`,
		);
	} else if (
		!LINT_CONFIG_VERSIONS.includes(
			value.version as (typeof LINT_CONFIG_VERSIONS)[number],
		)
	) {
		issues.push(
			`version ${JSON.stringify(value.version)} is not supported; this Trickroom understands lint.json version ${supported}.`,
		);
	}
	if (value.rules !== undefined) {
		if (!isRecord(value.rules)) {
			issues.push("rules must be an object keyed by rule kind id.");
		} else {
			for (const [id, rule] of Object.entries(value.rules)) {
				const ruleProblems = ruleIssues(rule, id, knownRuleIds);
				issues.push(...ruleProblems);
				const specs =
					known !== null && "ids" in known ? known.get(id)?.options : undefined;
				if (
					ruleProblems.length === 0 &&
					specs !== undefined &&
					isRecord(rule) &&
					rule.options !== undefined
				) {
					issues.push(
						...lintRuleOptionIssues(
							specs,
							rule.options as Record<string, unknown>,
						).map((issue) => `rules["${id}"].${issue}`),
					);
				}
			}
		}
	}
	if (value.components !== undefined) {
		if (!isRecord(value.components)) {
			issues.push("components must be an object keyed by component slug.");
		} else {
			for (const [slug, component] of Object.entries(value.components)) {
				issues.push(...componentIssues(component, slug));
			}
		}
	}
	issues.push(...sourceIssues(value.source));
	issues.push(...thresholdIssues(value.thresholds, knownRuleIds));
	return issues;
};

const sortedEntries = <T>(record: Record<string, T>) =>
	Object.entries(record).sort(([left], [right]) => left.localeCompare(right));

const trimList = (list: string[] | undefined) =>
	list === undefined ? {} : { value: list.map((entry) => entry.trim()) };

/**
 * Trimmed copy in the documented key order with sorted maps, keeping only
 * the keys that were set: defaults are applied by `resolveLintConfig`, never
 * written back.
 */
export const normalizeLintConfig = (config: LintConfig): LintConfig => {
	const normalized: LintConfig = { version: config.version };
	if (config.rules) {
		normalized.rules = Object.fromEntries(
			sortedEntries(config.rules).map(([id, rule]) => [
				id,
				{
					...(rule.enabled === undefined ? {} : { enabled: rule.enabled }),
					...(rule.severity === undefined ? {} : { severity: rule.severity }),
					...(rule.options === undefined
						? {}
						: { options: { ...rule.options } }),
				},
			]),
		);
	}
	if (config.components) {
		normalized.components = Object.fromEntries(
			sortedEntries(config.components).map(([slug, component]) => [
				slug,
				component.module === undefined
					? {}
					: {
							module: Array.isArray(component.module)
								? component.module.map((entry) => entry.trim())
								: component.module.trim(),
						},
			]),
		);
	}
	if (config.source) {
		const include = trimList(config.source.include);
		const exclude = trimList(config.source.exclude);
		const classCalls = trimList(config.source.classCalls);
		normalized.source = {
			...("value" in include ? { include: include.value } : {}),
			...("value" in exclude ? { exclude: exclude.value } : {}),
			...("value" in classCalls ? { classCalls: classCalls.value } : {}),
		};
	}
	if (config.thresholds) {
		const { code, design, rules, coverage } = config.thresholds;
		normalized.thresholds = {
			...(code ? { code: { ...code } } : {}),
			...(design ? { design: { ...design } } : {}),
			...(rules ? { rules: Object.fromEntries(sortedEntries(rules)) } : {}),
			...(coverage ? { coverage: { ...coverage } } : {}),
		};
	}
	return normalized;
};

/** The file text of a config, as the server and the dashboard write it. */
export const serializeLintConfig = (config: LintConfig): string =>
	`${JSON.stringify(normalizeLintConfig(config), null, "\t")}\n`;

export type ResolvedLintRule = {
	id: string;
	enabled: boolean;
	severity: LintSeverity;
	options: Record<string, unknown>;
};

export type ResolvedLintConfig = {
	version: (typeof LINT_CONFIG_VERSIONS)[number];
	/** False when no lint.json exists and every value is a default. */
	present: boolean;
	/** In registry order, one entry per shipped rule kind. */
	rules: ResolvedLintRule[];
	/** Keyed by slug; `modules` are project-relative with `/` separators. */
	components: Record<string, { modules: string[] }>;
	source: { include: string[]; exclude: string[]; classCalls: string[] };
	thresholds: LintThresholds;
};

export type LintRuleKindDefaults = {
	id: string;
	defaultSeverity: LintSeverity;
};

const toPosix = (value: string) => value.split("\\").join("/");

/**
 * The config with defaults applied: every shipped rule kind present (enabled
 * at its default severity unless the file says otherwise), the default
 * include globs derived from the codegen `outDir`, and empty maps elsewhere.
 */
export const resolveLintConfig = (
	config: LintConfig | null,
	options: {
		ruleKinds: readonly LintRuleKindDefaults[];
		codegenOutDir: string | null;
	},
): ResolvedLintConfig => {
	const normalized = config ? normalizeLintConfig(config) : null;
	return {
		version: normalized?.version ?? LINT_CONFIG_VERSIONS[0],
		present: normalized !== null,
		rules: options.ruleKinds.map((kind) => {
			const configured = normalized?.rules?.[kind.id];
			return {
				id: kind.id,
				enabled: configured?.enabled ?? true,
				severity: configured?.severity ?? kind.defaultSeverity,
				options: configured?.options ?? {},
			};
		}),
		components: Object.fromEntries(
			Object.entries(normalized?.components ?? {}).map(([slug, component]) => [
				slug,
				{
					modules:
						component.module === undefined
							? []
							: (Array.isArray(component.module)
									? component.module
									: [component.module]
								).map((entry) => toPosix(path.posix.normalize(entry))),
				},
			]),
		),
		source: {
			include:
				normalized?.source?.include ??
				defaultSourceInclude(options.codegenOutDir),
			exclude: normalized?.source?.exclude ?? [...DEFAULT_SOURCE_EXCLUDE],
			classCalls: normalized?.source?.classCalls ?? [...DEFAULT_CLASS_CALLS],
		},
		thresholds: normalized?.thresholds ?? {},
	};
};
