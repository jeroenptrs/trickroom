import { describe, expect, it } from "vitest";
import { getLintConfigIssues } from "./config";
import { LINT_RULE_OPTION_SPECS } from "./rule-catalogue";
import {
	type LintRuleOptionSpec,
	lintRuleOptionIssues,
	optionValueHasSpecShape,
	optionValueIssues,
} from "./rule-options";
import { lintRuleRegistry } from "./rules/index";

/** A value of the right shape (and allowed values) for a spec. */
const validValue = (spec: LintRuleOptionSpec): unknown => {
	switch (spec.type) {
		case "boolean":
			return true;
		case "number":
			return 3;
		case "string":
			return spec.values?.[0] ?? "x";
		case "string-list":
			return [spec.values?.[0] ?? "x"];
		case "component-map":
			return {
				button:
					spec.entryKey === undefined
						? ["src/**"]
						: { [spec.entryKey]: ["src/**"] },
			};
		case "object-list":
			return [
				Object.fromEntries(
					spec.fields
						.filter((field) => field.required)
						.map((field) => [
							field.key,
							field.type === "boolean"
								? true
								: field.type === "string-list"
									? ["x"]
									: "x",
						]),
				),
			];
	}
};

/** A value of the wrong shape for a spec. */
const wrongShape = (spec: LintRuleOptionSpec): unknown =>
	spec.type === "boolean" ? "yes" : spec.type === "component-map" ? [] : {};

describe("rule option specs", () => {
	it("checks object-list entries field by field", () => {
		const patterns: LintRuleOptionSpec = {
			key: "patterns",
			label: "Patterns",
			description: "",
			type: "object-list",
			fields: [
				{ key: "pattern", label: "Pattern", type: "string", required: true },
				{ key: "regex", label: "Regex", type: "boolean" },
				{ key: "tags", label: "Tags", type: "string-list" },
				{ key: "message", label: "Message", type: "string", required: true },
			],
		};
		const valid = [{ pattern: "x", regex: true, tags: ["a"], message: "m" }];
		expect(optionValueHasSpecShape(patterns, valid)).toBe(true);
		expect(optionValueIssues(patterns, valid)).toEqual([]);
		expect(optionValueIssues(patterns, {})).toEqual([
			'options.patterns must be a list of objects with the fields "pattern", "regex", "tags", "message".',
		]);
		const invalid = [
			"x",
			{ pattern: "", regex: "yes", extra: 1, message: "m" },
			{ pattern: "y", tags: [1] },
		];
		expect(optionValueHasSpecShape(patterns, invalid)).toBe(false);
		expect(optionValueIssues(patterns, invalid)).toEqual([
			"options.patterns[0] must be an object.",
			'options.patterns[1].extra is not a field of this option; the fields are "pattern", "regex", "tags", "message".',
			"options.patterns[1].pattern must be a non-empty string.",
			"options.patterns[1].regex must be a boolean.",
			"options.patterns[2].tags must be a list of strings.",
			"options.patterns[2].message is required.",
		]);
	});

	it("checks shapes, allowed values and component-map entries", () => {
		const scope: LintRuleOptionSpec = {
			key: "scope",
			label: "Scope",
			description: "x",
			type: "string",
			values: ["a", "b"],
		};
		const codes: LintRuleOptionSpec = {
			key: "codes",
			label: "Codes",
			description: "x",
			type: "string-list",
			values: ["A", "B"],
		};
		const map: LintRuleOptionSpec = {
			key: "components",
			label: "Components",
			description: "x",
			type: "component-map",
			entryKey: "allowIn",
		};
		expect(optionValueIssues(scope, undefined)).toEqual([]);
		expect(optionValueIssues(scope, "b")).toEqual([]);
		expect(optionValueIssues(scope, "c")).toEqual([
			'options.scope must be one of "a", "b"; got "c".',
		]);
		expect(optionValueIssues(codes, ["A", "C"])).toEqual([
			'options.codes has unknown value "C"; the values are "A", "B".',
		]);
		expect(optionValueIssues(codes, "A")).toEqual([
			"options.codes must be a list of strings.",
		]);
		expect(
			optionValueHasSpecShape(map, { button: { allowIn: ["src/**"] } }),
		).toBe(true);
		expect(optionValueHasSpecShape(map, { button: ["src/**"] })).toBe(false);
		expect(lintRuleOptionIssues([scope], { scope: "a", only: 1 })).toEqual([
			'options.only is not an option of this rule kind; the options are "scope".',
		]);
	});

	it("are the catalogue's specs, for exactly the kinds that take options", () => {
		const withOptions = lintRuleRegistry.kinds.filter(
			(kind) => (kind.options?.length ?? 0) > 0,
		);
		expect(withOptions.map((kind) => kind.id)).toEqual([
			"code.unknown-class-token",
			"code.non-canonical-class",
			"code.component-styling-restricted",
			"code.text-pattern",
			"code.class-restricted",
			"code.missing-dark-variant",
			"design.unknown-class-token",
			"design.non-canonical-class",
			"design.text-pattern",
			"design.class-restricted",
			"design.missing-dark-variant",
		]);
		for (const kind of withOptions) {
			expect(LINT_RULE_OPTION_SPECS[kind.id]).toBe(kind.options);
		}
	});

	it("validate lint.json for every registered kind: valid values pass, others are config issues", () => {
		for (const kind of lintRuleRegistry.kinds) {
			const specs = kind.options ?? [];
			if (specs.length === 0) continue;
			const options = Object.fromEntries(
				specs.map((spec) => [spec.key, validValue(spec)]),
			);
			expect(
				getLintConfigIssues(
					{ version: 1, rules: { [kind.id]: { options } } },
					lintRuleRegistry,
				),
				kind.id,
			).toEqual([]);
			for (const spec of specs) {
				expect(
					getLintConfigIssues(
						{
							version: 1,
							rules: {
								[kind.id]: { options: { [spec.key]: wrongShape(spec) } },
							},
						},
						lintRuleRegistry,
					),
					`${kind.id} ${spec.key}`,
				).toEqual([
					expect.stringMatching(
						new RegExp(
							`^rules\\["${kind.id.replace(/\./gu, "\\.")}"\\]\\.options\\.${spec.key} must be `,
							"u",
						),
					),
				]);
			}
			expect(
				getLintConfigIssues(
					{ version: 1, rules: { [kind.id]: { options: { nope: 1 } } } },
					lintRuleRegistry,
				),
			).toEqual([
				expect.stringContaining(
					`rules["${kind.id}"].options.nope is not an option`,
				),
			]);
		}
	});

	it("leave options unchecked when only rule ids are known", () => {
		expect(
			getLintConfigIssues(
				{
					version: 1,
					rules: { "design.unknown-class-token": { options: { nope: 1 } } },
				},
				lintRuleRegistry.ids,
			),
		).toEqual([]);
	});
});
