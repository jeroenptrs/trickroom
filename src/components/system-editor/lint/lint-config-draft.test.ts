import { describe, expect, it } from "vitest";
import type { LintConfig } from "../../../lint/config";
import {
	componentModules,
	editLintConfigSession,
	isLintConfigSessionConflicted,
	isLintConfigSessionDirty,
	lintConfigEquals,
	lintConfigSessionAfterFileChange,
	lintConfigSessionAfterSave,
	optionValueMatchesSpec,
	parseCountText,
	parseListText,
	pruneLintConfig,
	readComponentMap,
	readThreshold,
	setComponentModules,
	setRuleEnabled,
	setRuleOption,
	setRuleSeverity,
	setSourceList,
	setThreshold,
	undocumentedRuleOptions,
	writeComponentMap,
} from "./lint-config-draft";

const base: LintConfig = { version: 1 };

describe("lint config draft", () => {
	it("writes only what differs from the defaults", () => {
		let config = setRuleEnabled(base, "code.variants-file-orphaned", false);
		expect(config).toEqual({
			version: 1,
			rules: { "code.variants-file-orphaned": { enabled: false } },
		});
		config = setRuleEnabled(config, "code.variants-file-orphaned", true);
		expect(config).toEqual(base);

		config = setRuleSeverity(base, "code.variants-file-stale", "warning");
		expect(config.rules?.["code.variants-file-stale"]).toEqual({
			severity: "warning",
		});
		expect(setRuleSeverity(config, "code.variants-file-stale", null)).toEqual(
			base,
		);
	});

	it("keeps undocumented options when a documented one changes", () => {
		const stored: LintConfig = {
			version: 1,
			rules: {
				"code.component-styling-restricted": {
					options: { allow: ["src/ui/**"], legacy: { keep: true } },
				},
			},
		};
		const next = setRuleOption(
			stored,
			"code.component-styling-restricted",
			"allow",
			["src/components/**"],
		);
		expect(next.rules?.["code.component-styling-restricted"]?.options).toEqual({
			allow: ["src/components/**"],
			legacy: { keep: true },
		});
		expect(
			undocumentedRuleOptions(next, "code.component-styling-restricted", [
				{
					key: "allow",
					label: "Allow",
					description: "",
					type: "string-list",
				},
			]),
		).toEqual({ legacy: { keep: true } });
		const cleared = setRuleOption(
			setRuleOption(
				next,
				"code.component-styling-restricted",
				"allow",
				undefined,
			),
			"code.component-styling-restricted",
			"legacy",
			undefined,
		);
		expect(cleared).toEqual(base);
		// The input is never mutated.
		expect(
			stored.rules?.["code.component-styling-restricted"]?.options,
		).toEqual({
			allow: ["src/ui/**"],
			legacy: { keep: true },
		});
	});

	it("sets and clears thresholds per side, kind and coverage state", () => {
		let config = setThreshold(base, "code.errors", 0);
		config = setThreshold(config, "rule.code.variants-file-stale", 2);
		config = setThreshold(config, "coverage.bound", 12);
		expect(config.thresholds).toEqual({
			code: { errors: 0 },
			rules: { "code.variants-file-stale": 2 },
			coverage: { bound: 12 },
		});
		expect(readThreshold(config, "code.errors")).toBe(0);
		expect(readThreshold(config, "rule.code.variants-file-stale")).toBe(2);
		expect(readThreshold(config, "design.errors")).toBeUndefined();
		config = setThreshold(config, "code.errors", undefined);
		config = setThreshold(config, "rule.code.variants-file-stale", undefined);
		config = setThreshold(config, "coverage.bound", undefined);
		expect(config).toEqual(base);
	});

	it("edits wrapper modules and source lists", () => {
		let config = setComponentModules(base, "button", ["src/ui/button.tsx"]);
		expect(config.components).toEqual({
			button: { module: "src/ui/button.tsx" },
		});
		config = setComponentModules(config, "button", [
			"src/ui/button.tsx",
			"src/ui/index.ts",
		]);
		expect(componentModules(config, "button")).toEqual([
			"src/ui/button.tsx",
			"src/ui/index.ts",
		]);
		expect(setComponentModules(config, "button", null)).toEqual(base);

		config = setSourceList(base, "exclude", ["**/*.d.ts", "**/*.test.tsx"]);
		expect(config.source).toEqual({ exclude: ["**/*.d.ts", "**/*.test.tsx"] });
		expect(setSourceList(config, "exclude", undefined)).toEqual(base);
	});

	it("compares configs once pruned, whatever the key order", () => {
		expect(
			lintConfigEquals(
				{ version: 1, thresholds: { code: { errors: 0, warnings: 2 } } },
				{
					version: 1,
					rules: {},
					thresholds: { code: { warnings: 2, errors: 0 }, coverage: {} },
				},
			),
		).toBe(true);
		expect(
			lintConfigEquals(base, { version: 1, source: { include: ["src/**"] } }),
		).toBe(false);
		expect(pruneLintConfig({ version: 1, components: { a: {} } })).toEqual(
			base,
		);
	});

	it("parses list and count fields", () => {
		expect(parseListText(" src/**\n\n  lib/** \n")).toEqual([
			"src/**",
			"lib/**",
		]);
		expect(parseCountText("")).toBeUndefined();
		expect(parseCountText(" 3 ")).toBe(3);
		expect(parseCountText("1.5")).toBe(1.5);
		expect(parseCountText("x")).toBeUndefined();
		expect(
			optionValueMatchesSpec(
				{ key: "only", label: "", description: "", type: "component-map" },
				{ button: ["src/**"] },
			),
		).toBe(true);
		expect(
			optionValueMatchesSpec(
				{ key: "only", label: "", description: "", type: "string-list" },
				"src/**",
			),
		).toBe(false);
	});

	it("reads and writes component maps whose entries nest under entryKey", () => {
		const spec = {
			key: "components",
			label: "",
			description: "",
			type: "component-map" as const,
			entryKey: "allowIn",
		};
		const stored = { button: { allowIn: ["src/features/**"] } };
		expect(optionValueMatchesSpec(spec, stored)).toBe(true);
		expect(optionValueMatchesSpec(spec, { button: ["src/**"] })).toBe(false);
		expect(readComponentMap(stored, spec)).toEqual({
			button: ["src/features/**"],
		});
		expect(writeComponentMap({ button: ["src/**"], card: [] }, spec)).toEqual({
			button: { allowIn: ["src/**"] },
			card: { allowIn: [] },
		});
		expect(readComponentMap({ button: ["src/**"] })).toEqual({
			button: ["src/**"],
		});
	});
});

describe("lint config edit session", () => {
	const absent = { revision: null, config: base };

	it("keeps a null starting revision when another writer creates the file", () => {
		// Editing before lint.json exists.
		let session = editLintConfigSession(
			null,
			absent,
			setThreshold(base, "code.errors", 0),
		);
		expect(session.revision).toBeNull();

		// Someone else writes the file; the query refreshes.
		const external = {
			revision: "sha256:external",
			config: {
				version: 1,
				thresholds: { code: { warnings: 3 } },
			} as LintConfig,
		};
		expect(lintConfigSessionAfterFileChange(session, external.revision)).toBe(
			session,
		);
		expect(isLintConfigSessionConflicted(session, external.revision)).toBe(
			true,
		);

		// Editing another field must not adopt the external revision.
		session = editLintConfigSession(
			session,
			external,
			setThreshold(session.config, "code.warnings", 5),
		);
		expect(session.revision).toBeNull();
		expect(session.base).toEqual(base);
		expect(isLintConfigSessionConflicted(session, external.revision)).toBe(
			true,
		);
	});

	it("lets a clean session follow the file and ends it there", () => {
		const session = editLintConfigSession(
			null,
			absent,
			setThreshold(base, "code.errors", 0),
		);
		const reverted = editLintConfigSession(session, absent, base);
		expect(isLintConfigSessionDirty(reverted)).toBe(false);
		expect(lintConfigSessionAfterFileChange(reverted, "sha256:new")).toBeNull();
		expect(lintConfigSessionAfterFileChange(null, "sha256:new")).toBeNull();
	});
});

describe("lint config edit session after a save", () => {
	const absent = { revision: null, config: base };

	it("keeps edits made while the save was in flight", () => {
		const submitted = setThreshold(base, "code.errors", 0);
		let session = editLintConfigSession(null, absent, submitted);
		// An edit lands between the click and the response.
		session = editLintConfigSession(
			session,
			absent,
			setThreshold(session.config, "code.warnings", 4),
		);
		const saved = { revision: "sha256:saved", config: submitted };
		const after = lintConfigSessionAfterSave(session, submitted, saved);
		expect(after).toEqual({
			revision: "sha256:saved",
			base: submitted,
			config: { version: 1, thresholds: { code: { errors: 0, warnings: 4 } } },
		});
		expect(isLintConfigSessionDirty(after)).toBe(true);
		expect(isLintConfigSessionConflicted(after, saved.revision)).toBe(false);
	});

	it("ends the session when nothing changed after the snapshot", () => {
		const submitted = setThreshold(base, "code.errors", 0);
		const session = editLintConfigSession(null, absent, submitted);
		const saved = { revision: "sha256:saved", config: submitted };
		expect(lintConfigSessionAfterSave(session, submitted, saved)).toBeNull();
		// An edit that was undone again before the response is no edit.
		const undone = editLintConfigSession(
			editLintConfigSession(
				session,
				absent,
				setThreshold(submitted, "code.warnings", 1),
			),
			absent,
			submitted,
		);
		expect(lintConfigSessionAfterSave(undone, submitted, saved)).toBeNull();
		expect(lintConfigSessionAfterSave(null, submitted, saved)).toBeNull();
	});
});
