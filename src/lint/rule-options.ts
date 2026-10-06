/**
 * Rule kind options as data: the spec a kind declares (`LintRuleKind.options`)
 * is the one description of its `lint.json` options. `getLintConfigIssues`
 * validates stored options against it, the catalogue hands it to the
 * dashboard's config editor (`LINT_RULE_OPTION_SPECS`), and the editor
 * checks stored values with the same shape test. Pure, so the browser can
 * import it.
 */

export type LintRuleOptionSpec = {
	key: string;
	label: string;
	description: string;
} & (
	| { type: "boolean" }
	| { type: "number" }
	/** With `values`, one of them (the editor renders a choice). */
	| { type: "string"; placeholder?: string; values?: readonly string[] }
	/** Allow lists, globs, slugs: one entry per line. With `values`, each entry is one of them. */
	| { type: "string-list"; placeholder?: string; values?: readonly string[] }
	/**
	 * Per-component lists keyed by component slug: `{ [slug]: string[] }`,
	 * or with `entryKey`, `{ [slug]: { [entryKey]: string[] } }`.
	 */
	| { type: "component-map"; placeholder?: string; entryKey?: string }
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isStringList = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((entry) => typeof entry === "string");

/** The list a component-map value holds for one slug, or undefined when malformed. */
export const componentMapEntryList = (
	spec: Extract<LintRuleOptionSpec, { type: "component-map" }>,
	entry: unknown,
): string[] | undefined => {
	const list =
		spec.entryKey === undefined
			? entry
			: isRecord(entry)
				? entry[spec.entryKey]
				: undefined;
	return isStringList(list) ? list : undefined;
};

/** Whether a stored value has the shape its spec describes; undefined is unset. */
export const optionValueHasSpecShape = (
	spec: LintRuleOptionSpec,
	value: unknown,
): boolean => {
	if (value === undefined) return true;
	switch (spec.type) {
		case "boolean":
			return typeof value === "boolean";
		case "number":
			return typeof value === "number" && Number.isFinite(value);
		case "string":
			return typeof value === "string";
		case "string-list":
			return isStringList(value);
		case "component-map":
			return (
				isRecord(value) &&
				Object.values(value).every(
					(entry) => componentMapEntryList(spec, entry) !== undefined,
				)
			);
	}
};

const quoted = (values: readonly string[]) =>
	values.map((value) => `"${value}"`).join(", ");

const describeShape = (spec: LintRuleOptionSpec) => {
	switch (spec.type) {
		case "boolean":
			return "a boolean";
		case "number":
			return "a number";
		case "string":
			return spec.values ? `one of ${quoted(spec.values)}` : "a string";
		case "string-list":
			return "a list of strings";
		case "component-map":
			return spec.entryKey === undefined
				? "an object mapping component slugs to lists of strings"
				: `an object mapping component slugs to { ${spec.entryKey}: [...] }`;
	}
};

/** Problems with one option value, each naming `options.<key>`; empty when valid. */
export const optionValueIssues = (
	spec: LintRuleOptionSpec,
	value: unknown,
): string[] => {
	const field = `options.${spec.key}`;
	if (!optionValueHasSpecShape(spec, value)) {
		return [`${field} must be ${describeShape(spec)}.`];
	}
	if (value === undefined) return [];
	if (spec.type === "string" && spec.values) {
		return spec.values.includes(value as string)
			? []
			: [`${field} must be one of ${quoted(spec.values)}; got "${value}".`];
	}
	if (spec.type === "string-list" && spec.values) {
		const allowed = spec.values;
		return (value as string[])
			.filter((entry) => !allowed.includes(entry))
			.map(
				(entry) =>
					`${field} has unknown value "${entry}"; the values are ${quoted(allowed)}.`,
			);
	}
	return [];
};

/**
 * Problems with a rule instance's `options` against its kind's specs: keys
 * no spec documents, and values that do not match their spec.
 */
export const lintRuleOptionIssues = (
	specs: readonly LintRuleOptionSpec[],
	options: Record<string, unknown>,
): string[] => {
	const byKey = new Map(specs.map((spec) => [spec.key, spec]));
	const issues: string[] = [];
	for (const key of Object.keys(options)) {
		if (!byKey.has(key)) {
			issues.push(
				`options.${key} is not an option of this rule kind; the options are ${quoted(specs.map((spec) => spec.key))}.`,
			);
		}
	}
	for (const spec of specs) {
		issues.push(...optionValueIssues(spec, options[spec.key]));
	}
	return issues;
};
