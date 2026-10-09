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
	}
};

/** A value of the wrong shape for a spec. */
const wrongShape = (spec: LintRuleOptionSpec): unknown =>
	spec.type === "boolean" ? "yes" : spec.type === "component-map" ? [] : {};

describe("rule option specs", () => {
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
			"design.unknown-class-token",
			"design.non-canonical-class",
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
