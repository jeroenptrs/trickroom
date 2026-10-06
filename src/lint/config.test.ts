import { describe, expect, it } from "vitest";
import {
	DEFAULT_CLASS_CALLS,
	defaultSourceInclude,
	getLintConfigIssues,
	normalizeLintConfig,
	resolveLintConfig,
	serializeLintConfig,
} from "./config";

const kinds = [
	{ id: "code.variants-file-stale", defaultSeverity: "error" as const },
	{ id: "code.variants-file-orphaned", defaultSeverity: "warning" as const },
];
const known = new Set(kinds.map((kind) => kind.id));

describe("lint config", () => {
	it("derives the default include globs from the codegen outDir", () => {
		expect(defaultSourceInclude(null)).toEqual([
			"src/**/*.{ts,tsx,js,jsx,mjs,cjs}",
		]);
		expect(defaultSourceInclude("src/components/ui")).toEqual([
			"src/**/*.{ts,tsx,js,jsx,mjs,cjs}",
		]);
		expect(defaultSourceInclude("packages/ui/src/variants")).toEqual([
			"packages/**/*.{ts,tsx,js,jsx,mjs,cjs}",
		]);
		expect(defaultSourceInclude("design-system/variants")).toEqual([
			"design-system/**/*.{ts,tsx,js,jsx,mjs,cjs}",
		]);
		expect(defaultSourceInclude("./ui")).toEqual([
			"ui/**/*.{ts,tsx,js,jsx,mjs,cjs}",
		]);
		expect(defaultSourceInclude(".")).toEqual(["**/*.{ts,tsx,js,jsx,mjs,cjs}"]);
	});

	it("accepts a full config and rejects typos", () => {
		expect(
			getLintConfigIssues(
				{
					version: 1,
					rules: {
						"code.variants-file-stale": {
							enabled: true,
							severity: "warning",
							options: { only: ["button"] },
						},
					},
					components: {
						button: { module: "src/ui/button.tsx" },
						badge: { module: ["src/ui/index.ts"] },
					},
					source: {
						include: ["src/**/*.tsx"],
						exclude: ["**/*.test.tsx"],
						classCalls: ["cn"],
					},
					thresholds: {
						code: { errors: 0, warnings: 10 },
						rules: { "code.variants-file-orphaned": 2 },
						coverage: { bound: 3 },
					},
				},
				known,
			),
		).toEqual([]);
		expect(getLintConfigIssues(null, known)).toEqual([
			"lint.json must be a JSON object.",
		]);
		const issues = getLintConfigIssues(
			{
				version: 2,
				rules: {
					"code.nope": {},
					"code.variants-file-stale": { severity: "fatal", extra: 1 },
				},
				components: {
					button: { module: "/abs/button.tsx" },
					badge: { module: "../x.ts" },
				},
				source: { include: "src" },
				thresholds: {
					code: { errors: -1 },
					rules: { "code.nope": 1 },
					coverage: { foo: 1 },
				},
				bogus: true,
			},
			known,
		);
		expect(issues).toEqual([
			"lint.bogus is not a known key (expected one of version, rules, components, source, thresholds).",
			"version 2 is not supported; this Trickroom understands lint.json version 1.",
			'rules["code.nope"] names an unknown rule kind; this Trickroom ships "code.variants-file-stale", "code.variants-file-orphaned".',
			'rules["code.variants-file-stale"].extra is not a known key (expected one of enabled, severity, options).',
			'rules["code.variants-file-stale"].severity must be one of "error", "warning", "info"; got "fatal".',
			'components["button"].module must be relative to the project root; got "/abs/button.tsx".',
			'components["badge"].module must stay inside the project and cannot contain a ".." segment; got "../x.ts".',
			"source.include must be an array of strings.",
			"thresholds.code.errors must be a non-negative integer.",
			"thresholds.coverage.foo is not a known key (expected one of published, generated, bound, usedInApp, usedInDesigns).",
			'thresholds.rules["code.nope"] names an unknown rule kind.',
		]);
		expect(
			getLintConfigIssues(
				{ version: 1, rules: { "design.anything": {} } },
				null,
			),
		).toEqual([]);
	});

	it("resolves defaults when the file is absent", () => {
		const resolved = resolveLintConfig(null, {
			ruleKinds: kinds,
			codegenOutDir: "src/ui",
		});
		expect(resolved).toEqual({
			version: 1,
			present: false,
			rules: [
				{
					id: "code.variants-file-stale",
					enabled: true,
					severity: "error",
					options: {},
				},
				{
					id: "code.variants-file-orphaned",
					enabled: true,
					severity: "warning",
					options: {},
				},
			],
			components: {},
			source: {
				include: ["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
				exclude: ["**/*.d.ts"],
				classCalls: [...DEFAULT_CLASS_CALLS],
			},
			thresholds: {},
		});
	});

	it("applies the file over the defaults and normalises paths", () => {
		const resolved = resolveLintConfig(
			{
				version: 1,
				rules: {
					"code.variants-file-orphaned": { enabled: false },
					"code.variants-file-stale": { severity: "warning" },
				},
				components: { button: { module: "./src\\ui/button.tsx" } },
				source: { include: ["app/**/*.tsx"] },
				thresholds: { code: { errors: 0 } },
			},
			{ ruleKinds: kinds, codegenOutDir: "src/ui" },
		);
		expect(resolved.present).toBe(true);
		expect(resolved.rules).toEqual([
			{
				id: "code.variants-file-stale",
				enabled: true,
				severity: "warning",
				options: {},
			},
			{
				id: "code.variants-file-orphaned",
				enabled: false,
				severity: "warning",
				options: {},
			},
		]);
		expect(resolved.components).toEqual({
			button: { modules: ["src/ui/button.tsx"] },
		});
		expect(resolved.source).toMatchObject({
			include: ["app/**/*.tsx"],
			exclude: ["**/*.d.ts"],
		});
		expect(resolved.thresholds).toEqual({ code: { errors: 0 } });
	});

	it("normalises and serialises in a stable key order", () => {
		const normalized = normalizeLintConfig({
			version: 1,
			thresholds: { rules: { b: 1, a: 2 } },
			rules: { "code.b": { severity: "info" }, "code.a": { enabled: false } },
			source: { include: [" src/**/*.ts "] },
		});
		expect(Object.keys(normalized)).toEqual([
			"version",
			"rules",
			"source",
			"thresholds",
		]);
		expect(Object.keys(normalized.rules ?? {})).toEqual(["code.a", "code.b"]);
		expect(Object.keys(normalized.thresholds?.rules ?? {})).toEqual(["a", "b"]);
		expect(normalized.source).toEqual({ include: ["src/**/*.ts"] });
		expect(serializeLintConfig({ version: 1 })).toBe('{\n\t"version": 1\n}\n');
	});
});
