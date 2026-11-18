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
	/**
	 * A list of objects with the fields `fields` describes, such as banned
	 * text patterns with their message. Keys outside `fields` are invalid.
	 */
	| { type: "object-list"; fields: readonly LintRuleOptionField[] }
);

/** One field of an `object-list` entry. */
export type LintRuleOptionField = {
	key: string;
	label: string;
	description?: string;
	type: "string" | "boolean" | "string-list";
	/** The entry must set it (a string must not be empty). */
	required?: boolean;
	placeholder?: string;
};

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

const fieldValueHasShape = (
	field: LintRuleOptionField,
	value: unknown,
	partial = false,
) => {
	if (value === undefined) return partial || field.required !== true;
	if (partial && field.type === "string") return typeof value === "string";
	switch (field.type) {
		case "string":
			return (
				typeof value === "string" &&
				(field.required !== true || value.trim().length > 0)
			);
		case "boolean":
			return typeof value === "boolean";
		case "string-list":
			return isStringList(value);
	}
};

/** Problems with one entry of an object-list value, each naming `options.<key>[index]`. */
const objectListEntryIssues = (
	spec: Extract<LintRuleOptionSpec, { type: "object-list" }>,
	entry: unknown,
	index: number,
): string[] => {
	const field = `options.${spec.key}[${index}]`;
	if (!isRecord(entry)) return [`${field} must be an object.`];
	const issues: string[] = [];
	const known = new Set(spec.fields.map((entryField) => entryField.key));
	for (const key of Object.keys(entry)) {
		if (!known.has(key)) {
			issues.push(
				`${field}.${key} is not a field of this option; the fields are ${quoted([...known])}.`,
			);
		}
	}
	for (const entryField of spec.fields) {
		const value = entry[entryField.key];
		if (fieldValueHasShape(entryField, value)) continue;
		issues.push(
			value === undefined
				? `${field}.${entryField.key} is required.`
				: `${field}.${entryField.key} must be ${
						entryField.type === "string"
							? entryField.required
								? "a non-empty string"
								: "a string"
							: entryField.type === "boolean"
								? "a boolean"
								: "a list of strings"
					}.`,
		);
	}
	return issues;
};

/**
 * Whether an object-list value can be edited field by field: a list of
 * objects with known fields of the right types, required ones possibly
 * missing (an entry being filled in). The dashboard's form uses it; saving
 * still needs `optionValueHasSpecShape`.
 */
export const objectListIsEditable = (
	spec: Extract<LintRuleOptionSpec, { type: "object-list" }>,
	value: unknown,
): boolean =>
	value === undefined ||
	(Array.isArray(value) &&
		value.every(
			(entry) =>
				isRecord(entry) &&
				Object.keys(entry).every((key) =>
					spec.fields.some((field) => field.key === key),
				) &&
				spec.fields.every((field) =>
					fieldValueHasShape(field, entry[field.key], true),
				),
		));

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
		case "object-list":
			return (
				Array.isArray(value) &&
				value.every(
					(entry, index) =>
						objectListEntryIssues(spec, entry, index).length === 0,
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
		case "object-list":
			return `a list of objects with the fields ${quoted(spec.fields.map((field) => field.key))}`;
	}
};

/** Problems with one option value, each naming `options.<key>`; empty when valid. */
export const optionValueIssues = (
	spec: LintRuleOptionSpec,
	value: unknown,
): string[] => {
	const field = `options.${spec.key}`;
	if (spec.type === "object-list" && Array.isArray(value)) {
		return value.flatMap((entry, index) =>
			objectListEntryIssues(spec, entry, index),
		);
	}
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
