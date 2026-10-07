import type { LintFinding, LintReport } from "../../../lint/report";

/**
 * Hand-written lint reports for the dashboard tests, against the shape in
 * docs/lint.md: `codeOnlyLintReport` has the design parts null (before WP4),
 * `fullLintReport` fills them. The run failed: `code.errors` went from 1 to
 * 2 and `coverage.bound` is under its minimum of 3.
 */

const codeFindings: LintFinding[] = [
	{
		rule: "code.unknown-variant-value",
		severity: "error",
		side: "code",
		component: "button",
		message: 'Button is given variant="huge"; the size axis has sm, md, lg.',
		location: {
			kind: "code",
			file: "src/pages/home.tsx",
			line: 12,
			column: 7,
		},
	},
	{
		rule: "code.variants-file-orphaned",
		severity: "warning",
		side: "code",
		message:
			"src/components/ui/chip.variants.ts carries this system's header but no component generates it.",
		location: { kind: "code", file: "src/components/ui/chip.variants.ts" },
	},
	{
		rule: "code.variants-file-stale",
		severity: "error",
		side: "code",
		component: "badge",
		message:
			'Component "badge" is stale: the file body was edited or reformatted. Run "trickroom codegen" to regenerate.',
		location: {
			kind: "code",
			file: "src/components/ui/badge.variants.ts",
			line: 1,
			column: 1,
		},
	},
];

const designFindings: LintFinding[] = [
	{
		rule: "design.unknown-class-token",
		severity: "warning",
		side: "design",
		component: "card",
		message:
			'Class "bg-brand-950" uses a color token the system does not define.',
		location: {
			kind: "design",
			design: "dsg_home",
			board: "brd_footer",
			element: "el_card_1",
		},
	},
	{
		rule: "design.unknown-variant-value",
		severity: "error",
		side: "design",
		component: "button",
		message:
			'The instance passes tone="neon"; the tone axis has neutral, brand.',
		location: {
			kind: "design",
			design: "dsg_home",
			board: "brd_hero",
			element: "el_cta",
		},
	},
];

const counts = (errors: number, warnings: number, info: number) => ({
	errors,
	warnings,
	info,
});

export const codeOnlyLintReport: LintReport = {
	version: 1,
	generatedAt: "2026-10-06T09:00:00.000Z",
	system: { id: "core", name: "Core System" },
	contract: { hash: "sha256:contract-at-run", components: 4 },
	config: { present: true },
	status: "fail",
	summary: {
		code: {
			findings: counts(2, 1, 0),
			rules: {
				"code.unknown-variant-value": counts(1, 0, 0),
				"code.variants-file-orphaned": counts(0, 1, 0),
				"code.variants-file-stale": counts(1, 0, 0),
			},
			scanned: 240,
		},
		design: null,
	},
	findings: codeFindings,
	components: [
		{
			slug: "badge",
			componentId: "cmp_badge",
			name: "Badge",
			published: true,
			generated: false,
			bound: false,
			usedInApp: false,
			usedInDesigns: null,
			wrappers: [],
			usages: 0,
		},
		{
			slug: "button",
			componentId: "cmp_button",
			name: "Button",
			published: true,
			generated: true,
			bound: true,
			usedInApp: true,
			usedInDesigns: null,
			wrappers: ["src/components/ui/button.tsx"],
			usages: 5,
		},
		{
			slug: "card",
			componentId: "cmp_card",
			name: "Card",
			published: true,
			generated: true,
			bound: true,
			usedInApp: false,
			usedInDesigns: null,
			wrappers: ["src/components/ui/card.tsx", "src/components/ui/index.ts"],
			usages: 0,
		},
		{
			slug: "dialog",
			componentId: "cmp_dialog",
			name: "Dialog",
			published: false,
			generated: false,
			bound: false,
			usedInApp: false,
			usedInDesigns: null,
			wrappers: [],
			usages: 0,
		},
	],
	files: [
		{
			file: "src/app.tsx",
			role: null,
			component: null,
			usages: 3,
			findings: counts(0, 0, 0),
		},
		{
			file: "src/components/ui/badge.variants.ts",
			role: "generated",
			component: "badge",
			usages: 0,
			findings: counts(1, 0, 0),
		},
		{
			file: "src/components/ui/button.tsx",
			role: "wrapper",
			component: "button",
			usages: 0,
			findings: counts(0, 0, 0),
		},
		{
			file: "src/components/ui/button.variants.ts",
			role: "generated",
			component: "button",
			usages: 0,
			findings: counts(0, 0, 0),
		},
		{
			file: "src/components/ui/card.tsx",
			role: "wrapper",
			component: "card",
			usages: 0,
			findings: counts(0, 0, 0),
		},
		{
			file: "src/components/ui/chip.variants.ts",
			role: null,
			component: null,
			usages: 0,
			findings: counts(0, 1, 0),
		},
		{
			file: "src/pages/home.tsx",
			role: null,
			component: null,
			usages: 2,
			findings: counts(1, 0, 0),
		},
	],
	designs: null,
	ratchet: {
		status: "fail",
		baseline: {
			generatedAt: "2026-10-05T09:00:00.000Z",
			numbers: {
				"code.errors": 1,
				"code.warnings": 1,
				"coverage.bound": 2,
				"coverage.generated": 2,
				"coverage.published": 3,
				"coverage.usedInApp": 1,
				"rule.code.unknown-variant-value": 0,
				"rule.code.variants-file-orphaned": 1,
				"rule.code.variants-file-stale": 1,
			},
		},
		regressions: [{ metric: "code.errors", baseline: 1, current: 2 }],
		breaches: [{ metric: "coverage.bound", kind: "min", limit: 3, current: 2 }],
		numbers: {
			"code.errors": 2,
			"code.warnings": 1,
			"coverage.bound": 2,
			"coverage.generated": 2,
			"coverage.published": 3,
			"coverage.usedInApp": 1,
			"rule.code.unknown-variant-value": 1,
			"rule.code.variants-file-orphaned": 1,
			"rule.code.variants-file-stale": 1,
		},
	},
	ratchetBaseline: {
		generatedAt: "2026-10-05T09:00:00.000Z",
		numbers: {
			"code.errors": 1,
			"code.warnings": 1,
			"coverage.bound": 2,
		},
	},
};

export const fullLintReport: LintReport = {
	...codeOnlyLintReport,
	summary: {
		code: codeOnlyLintReport.summary.code,
		design: {
			findings: counts(1, 1, 0),
			rules: {
				"design.unknown-class-token": counts(0, 1, 0),
				"design.unknown-variant-value": counts(1, 0, 0),
			},
			scanned: 3,
		},
	},
	findings: [...codeFindings, ...designFindings],
	components: codeOnlyLintReport.components.map((component) => ({
		...component,
		usedInDesigns: component.slug === "button" || component.slug === "card",
		designUsages:
			component.slug === "button" ? 3 : component.slug === "card" ? 1 : 0,
	})),
	designs: [
		{ design: "dsg_home", board: null, usages: 0, findings: counts(0, 0, 0) },
		{
			design: "dsg_home",
			board: "brd_footer",
			usages: 1,
			findings: counts(0, 1, 0),
		},
		{
			design: "dsg_home",
			board: "brd_hero",
			usages: 3,
			findings: counts(1, 0, 0),
		},
		{
			design: "dsg_settings",
			board: "brd_main",
			usages: 2,
			findings: counts(0, 0, 0),
		},
	],
	ratchet: {
		...codeOnlyLintReport.ratchet,
		numbers: {
			...codeOnlyLintReport.ratchet.numbers,
			"design.errors": 1,
			"design.warnings": 1,
			"coverage.usedInDesigns": 2,
		},
	},
};
