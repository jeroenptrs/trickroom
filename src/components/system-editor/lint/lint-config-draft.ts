import type {
	LintConfig,
	LintCoverageThresholds,
	LintRuleConfig,
	LintSeverity,
	LintSourceConfig,
} from "../../../lint/config";
import type { LintRuleOptionSpec } from "../../../lint/rule-catalogue";

/**
 * Edits of a `lint.json` draft in the config editor. Each helper returns a
 * new config and keeps only what differs from the defaults (an enabled rule
 * has no `enabled` key, an empty threshold is removed), so a saved file stays
 * as small as a hand-written one. Validation is the server's: the editor
 * sends the draft and shows the engine's issues.
 */

const clone = (config: LintConfig): LintConfig => structuredClone(config);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isEmptyRecord = (value: unknown) =>
	isRecord(value) && Object.keys(value).length === 0;

/** Drops empty maps and blocks, so `{ rules: { x: {} } }` becomes `{}`. */
export const pruneLintConfig = (config: LintConfig): LintConfig => {
	const next = clone(config);
	if (next.rules) {
		for (const [id, rule] of Object.entries(next.rules)) {
			if (rule.options && isEmptyRecord(rule.options)) delete rule.options;
			if (isEmptyRecord(rule)) delete next.rules[id];
		}
		if (isEmptyRecord(next.rules)) delete next.rules;
	}
	if (next.components) {
		for (const [slug, component] of Object.entries(next.components)) {
			if (isEmptyRecord(component)) delete next.components[slug];
		}
		if (isEmptyRecord(next.components)) delete next.components;
	}
	if (next.source && isEmptyRecord(next.source)) delete next.source;
	if (next.thresholds) {
		const thresholds = next.thresholds;
		for (const key of ["code", "design", "rules", "coverage"] as const) {
			if (thresholds[key] && isEmptyRecord(thresholds[key])) {
				delete thresholds[key];
			}
		}
		if (isEmptyRecord(thresholds)) delete next.thresholds;
	}
	return next;
};

const stableStringify = (value: unknown): string => {
	if (Array.isArray(value)) {
		return `[${value.map(stableStringify).join(",")}]`;
	}
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
};

/** Same config once pruned, whatever the key order. */
export const lintConfigEquals = (left: LintConfig, right: LintConfig) =>
	stableStringify(pruneLintConfig(left)) ===
	stableStringify(pruneLintConfig(right));

const updateRule = (
	config: LintConfig,
	id: string,
	update: (rule: LintRuleConfig) => void,
) => {
	const next = clone(config);
	next.rules ??= {};
	const rule = next.rules[id] ?? {};
	update(rule);
	next.rules[id] = rule;
	return pruneLintConfig(next);
};

export const setRuleEnabled = (
	config: LintConfig,
	id: string,
	enabled: boolean,
) =>
	updateRule(config, id, (rule) => {
		if (enabled) delete rule.enabled;
		else rule.enabled = false;
	});

/** Null goes back to the kind's default severity. */
export const setRuleSeverity = (
	config: LintConfig,
	id: string,
	severity: LintSeverity | null,
) =>
	updateRule(config, id, (rule) => {
		if (severity === null) delete rule.severity;
		else rule.severity = severity;
	});

/** Undefined removes the option. Other options are kept as they are. */
export const setRuleOption = (
	config: LintConfig,
	id: string,
	key: string,
	value: unknown,
) =>
	updateRule(config, id, (rule) => {
		const options = { ...(rule.options ?? {}) };
		if (value === undefined) delete options[key];
		else options[key] = value;
		rule.options = options;
	});

/** The stored options of a rule no spec documents: shown read-only, kept. */
export const undocumentedRuleOptions = (
	config: LintConfig,
	id: string,
	specs: readonly LintRuleOptionSpec[],
) => {
	const options = config.rules?.[id]?.options ?? {};
	const documented = new Set(specs.map((spec) => spec.key));
	return Object.fromEntries(
		Object.entries(options).filter(([key]) => !documented.has(key)),
	);
};

type SideThresholdPath = `${"code" | "design"}.${"errors" | "warnings"}`;
type CoverageThresholdPath = `coverage.${keyof LintCoverageThresholds}`;

export type LintThresholdPath =
	| SideThresholdPath
	| CoverageThresholdPath
	| `rule.${string}`;

/** Undefined removes the threshold. */
export const setThreshold = (
	config: LintConfig,
	path: LintThresholdPath,
	value: number | undefined,
) => {
	const next = clone(config);
	next.thresholds ??= {};
	const [scope, ...rest] = path.split(".");
	const key = rest.join(".");
	const block = (scope === "rule" ? "rules" : scope) as keyof NonNullable<
		LintConfig["thresholds"]
	>;
	const target = { ...(next.thresholds[block] ?? {}) } as Record<
		string,
		number
	>;
	if (value === undefined) delete target[key];
	else target[key] = value;
	(next.thresholds as Record<string, unknown>)[block] = target;
	return pruneLintConfig(next);
};

export const readThreshold = (
	config: LintConfig,
	path: LintThresholdPath,
): number | undefined => {
	const [scope, ...rest] = path.split(".");
	const key = rest.join(".");
	const block = scope === "rule" ? "rules" : scope;
	const values = (config.thresholds as Record<string, unknown> | undefined)?.[
		block
	];
	const value = isRecord(values) ? values[key] : undefined;
	return typeof value === "number" ? value : undefined;
};

/** Modules of one component; an empty list removes the override. */
export const setComponentModules = (
	config: LintConfig,
	slug: string,
	modules: string[] | null,
) => {
	const next = clone(config);
	next.components ??= {};
	if (modules === null) {
		delete next.components[slug];
	} else {
		next.components[slug] = {
			module: modules.length === 1 ? (modules[0] ?? "") : modules,
		};
	}
	return pruneLintConfig(next);
};

export const componentModules = (
	config: LintConfig,
	slug: string,
): string[] => {
	const module = config.components?.[slug]?.module;
	if (module === undefined) return [];
	return Array.isArray(module) ? module : [module];
};

/** Undefined goes back to the default list. */
export const setSourceList = (
	config: LintConfig,
	key: keyof LintSourceConfig,
	list: string[] | undefined,
) => {
	const next = clone(config);
	next.source = { ...(next.source ?? {}) };
	if (list === undefined) delete next.source[key];
	else next.source[key] = list;
	return pruneLintConfig(next);
};

/** One entry per line; blank lines dropped, entries trimmed. */
export const parseListText = (text: string) =>
	text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

export const formatListText = (list: readonly string[] | undefined) =>
	(list ?? []).join("\n");

/** A count field: empty clears it; anything else is sent for the server to check. */
export const parseCountText = (text: string): number | undefined => {
	const trimmed = text.trim();
	if (trimmed.length === 0) return undefined;
	const value = Number(trimmed);
	return Number.isNaN(value) ? undefined : value;
};

/** `{ [slug]: string[] }` option values, read defensively. */
export const readComponentMap = (value: unknown): Record<string, string[]> =>
	isRecord(value)
		? Object.fromEntries(
				Object.entries(value).map(([slug, entries]) => [
					slug,
					Array.isArray(entries)
						? entries.filter(
								(entry): entry is string => typeof entry === "string",
							)
						: [],
				]),
			)
		: {};

/** Whether a stored option value has the shape its spec edits. */
export const optionValueMatchesSpec = (
	spec: LintRuleOptionSpec,
	value: unknown,
) => {
	if (value === undefined) return true;
	switch (spec.type) {
		case "boolean":
			return typeof value === "boolean";
		case "number":
			return typeof value === "number";
		case "string":
			return typeof value === "string";
		case "string-list":
			return (
				Array.isArray(value) &&
				value.every((entry) => typeof entry === "string")
			);
		case "component-map":
			return (
				isRecord(value) &&
				Object.values(value).every(
					(entries) =>
						Array.isArray(entries) &&
						entries.every((entry) => typeof entry === "string"),
				)
			);
	}
};

/**
 * An edit of `lint.json` in the editor: the file revision it started from
 * (null when there was no file), the config at that revision, and the
 * edited config. The revision is kept as it was, null included, until the
 * user saves or discards, so a file written by someone else in between is
 * a conflict rather than a silent new base.
 */
export type LintConfigEditSession = {
	revision: string | null;
	base: LintConfig;
	config: LintConfig;
};

export type LintConfigFileState = {
	revision: string | null;
	config: LintConfig;
};

/** Applies an edit; the first edit starts from the file as loaded. */
export const editLintConfigSession = (
	session: LintConfigEditSession | null,
	file: LintConfigFileState,
	next: LintConfig,
): LintConfigEditSession =>
	session
		? { ...session, config: next }
		: { revision: file.revision, base: file.config, config: next };

export const isLintConfigSessionDirty = (
	session: LintConfigEditSession | null,
): session is LintConfigEditSession =>
	session !== null && !lintConfigEquals(session.config, session.base);

/** The file moved on under unsaved edits. */
export const isLintConfigSessionConflicted = (
	session: LintConfigEditSession | null,
	fileRevision: string | null,
) => isLintConfigSessionDirty(session) && session.revision !== fileRevision;

/** A clean session follows the file; a dirty one waits for the user. */
export const lintConfigSessionAfterFileChange = (
	session: LintConfigEditSession | null,
	fileRevision: string | null,
) =>
	session &&
	session.revision !== fileRevision &&
	!isLintConfigSessionDirty(session)
		? null
		: session;
