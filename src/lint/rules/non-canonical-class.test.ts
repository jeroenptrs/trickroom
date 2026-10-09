import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	CODEGEN_TEST_SYSTEM_ID,
	publishedComponent,
} from "../../codegen/test-support";
import type { TrickroomDesign } from "../../types";
import { createClassTokenInspector } from "../../utils/class-token-diagnostics";
import { createEmptySystemComponentManifest } from "../../utils/system-components";
import { selectorSpecificity } from "../../utils/tailwind-canonical-equivalence";
import { canonicalizeTailwindCandidatesInWorker } from "../../utils/tailwind-canonicalize-client";
import { loadTailwindDesignSystem } from "../../utils/tailwind-design-system";
import { resolveLintConfig } from "../config";
import { buildSystemContract } from "../contract";
import { buildLintDesignIndex } from "../designs";
import { buildSourceIndex } from "../source/index";
import { nonCanonicalClassRule } from "./code/non-canonical-class";
import {
	buttonPayload,
	createFixtures,
	describeFindings,
} from "./code/test-support";
import { designNonCanonicalClassRule } from "./design/non-canonical-class";
import { lintRuleRegistry } from "./index";
import type { LintRuleContext, LintTailwindInspector } from "./types";

/**
 * Both non-canonical class kinds against a real compiled build of the
 * installed Tailwind (`@import "tailwindcss"`), since what is canonical is
 * Tailwind's call and changes between versions.
 */

let projectRoot = "";
let designSystem: Awaited<
	ReturnType<typeof loadTailwindDesignSystem>
>["designSystem"];
let inspector: LintTailwindInspector;

beforeAll(async () => {
	projectRoot = await mkdtemp(
		path.join(process.cwd(), ".tmp-non-canonical-class-"),
	);
	await mkdir(path.join(projectRoot, "src"), { recursive: true });
	await writeFile(
		path.join(projectRoot, "src", "index.css"),
		'@import "tailwindcss";\n',
		"utf8",
	);
	({ designSystem } = await loadTailwindDesignSystem({
		projectRoot,
		cssPath: "src/index.css",
	}));
	const system = { projectRoot, cssPath: "src/index.css" };
	inspector = {
		...createClassTokenInspector(designSystem),
		canonicalize: (candidates) =>
			canonicalizeTailwindCandidatesInWorker(system, candidates),
	};
	// The first canonicalization builds Tailwind's lookup tables in the
	// worker (seconds); pay it once here rather than in the first test.
	await inspector.canonicalize?.(["bg-white"]);
}, 30_000);

afterAll(() => rm(projectRoot, { force: true, recursive: true }));

describe("canonicalizeTailwindCandidatesInWorker", () => {
	it("writes each class the way Tailwind does, one class at a time", async () => {
		const results = await inspector.canonicalize?.([
			"[scrollbar-width:thin]",
			"bg-[#FFF]",
			"[&:has(.active)]:p-2",
			"hover:bg-[#FFF]",
			// Already canonical, unknown to Tailwind, or only equal at one root
			// font size: unchanged.
			"bg-white",
			"has-[.active]:p-2",
			"not-a-utility",
			"w-[16px]",
		]);
		expect(results?.map((result) => result.canonical)).toEqual([
			"scrollbar-thin",
			"bg-white",
			"has-[.active]:p-2",
			"hover:bg-white",
			"bg-white",
			"has-[.active]:p-2",
			"not-a-utility",
			"w-[16px]",
		]);
		// Only a form that differs is verified.
		expect(results?.slice(4).map((result) => result.verdict)).toEqual([
			undefined,
			undefined,
			undefined,
			undefined,
		]);
	});

	it("verifies forms whose selector text differs but matches the same elements as equivalent", async () => {
		const results = await inspector.canonicalize?.([
			// `.x:has(:is([data-invalid]))` and `.x:has([data-invalid])`
			"has-[[data-invalid]]:p-2",
			// `.x > *` and `:is(.x > *)`
			"[&>*]:inline",
			// `calc(1 * -1)` and `-1`
			"-z-[1]",
			// `#FFF` and `var(--color-white)`: the form names the token.
			"bg-[#FFF]",
			"rounded-[0.25rem]",
			"!grid",
		]);
		expect(
			results?.map(({ canonical, verdict }) => [canonical, verdict]),
		).toEqual([
			["has-data-invalid:p-2", { status: "equivalent" }],
			["*:inline", { status: "equivalent" }],
			["z-[-1]", { status: "equivalent" }],
			["bg-white", { status: "equivalent" }],
			["rounded-sm", { status: "equivalent" }],
			["grid!", { status: "equivalent" }],
		]);
	});

	it("marks a spacing multiple that replaces a length as dependent on the theme", async () => {
		const [result] = (await inspector.canonicalize?.(["w-[38.5rem]"])) ?? [];
		expect(result).toEqual({
			canonical: "w-154",
			verdict: { status: "theme-dependent", themeVariables: ["--spacing"] },
		});
	});

	it("rejects an `in-*` form that lowers specificity", async () => {
		const original = "[[data-panel-open]_&]:hidden";
		const [result] = (await inspector.canonicalize?.([original])) ?? [];
		expect(result?.canonical).toBe("in-data-panel-open:hidden");
		expect(result?.verdict).toEqual({
			status: "different",
			reason:
				'applies under ":where([data-panel-open]) &" where the class applies under "[data-panel-open] &" (specificity 0,2,0 becomes 0,1,0)',
		});
		// A competing `.panel .icon { display: block }` ties with the original
		// (later source order decides) but beats the canonical form outright.
		const selectorOf = (candidate: string) =>
			(designSystem.candidatesToCss([candidate])[0] ?? "").split("{")[0].trim();
		expect(selectorSpecificity(selectorOf(original))).toEqual(
			selectorSpecificity(".panel .icon"),
		);
		expect(
			selectorSpecificity(selectorOf("in-data-panel-open:hidden")),
		).toEqual([0, 1, 0]);
	});

	it("rejects a form that matches other elements (Tailwind's `aria-*` rewrite of an attribute selector)", async () => {
		const [result] =
			(await inspector.canonicalize?.([
				"max-lg:[&_[aria-label=DeltaBlue]]:!hidden",
			])) ?? [];
		expect(result).toEqual({
			canonical: "max-lg:**:aria-[aria-label=DeltaBlue]:hidden!",
			verdict: {
				status: "different",
				reason:
					'applies under "& [aria-aria-label="DeltaBlue"]" where the class applies under "& [aria-label="DeltaBlue"]"',
			},
		});
	});

	it("rejects a form a literal makes invalid where the class's `calc()` rounds", async () => {
		// `z-index: calc(1.5 * -1)` computes to -1; `z-index: -1.5` is invalid.
		const [result] = (await inspector.canonicalize?.(["-z-[1.5]"])) ?? [];
		expect(result).toEqual({
			canonical: "z-[-1.5]",
			verdict: {
				status: "different",
				reason:
					'declares "z-index: -1.5" where the class declares "z-index: calc(1.5 * -1)"',
			},
		});
	});

	it("rejects a form that registers a variable the class leaves inheriting", async () => {
		const [result] =
			(await inspector.canonicalize?.(["[transform:var(--tw-rotate-x)]"])) ??
			[];
		expect(result).toEqual({
			canonical: "transform-(--tw-rotate-x)",
			verdict: {
				status: "different",
				reason:
					"registers --tw-rotate-x (@property), which the class does not and the stylesheets do not already",
			},
		});
	});

	it("marks a token the stylesheets also set outside `@theme` as dependent on the theme", async () => {
		// Imported, under a media query, and in a `.dark` rule.
		await writeFile(
			path.join(projectRoot, "src", "overrides.css"),
			"@media (prefers-color-scheme: dark) {\n\t:root { --radius-sm: 0; }\n}\n",
			"utf8",
		);
		await writeFile(
			path.join(projectRoot, "src", "dark.css"),
			'@import "tailwindcss";\n@import "./overrides.css";\n.dark { --color-white: #000; }\n',
			"utf8",
		);
		const results = await canonicalizeTailwindCandidatesInWorker(
			{ projectRoot, cssPath: "src/dark.css" },
			["bg-[#FFF]", "rounded-[0.25rem]", "rounded-[2rem]"],
		);
		expect(results).toEqual([
			{
				canonical: "bg-white",
				verdict: {
					status: "theme-dependent",
					themeVariables: ["--color-white"],
				},
			},
			{
				canonical: "rounded-sm",
				verdict: { status: "theme-dependent", themeVariables: ["--radius-sm"] },
			},
			{ canonical: "rounded-4xl", verdict: { status: "equivalent" } },
		]);
	}, 30_000);
});

describe("code.non-canonical-class", () => {
	const fixtures = createFixtures();
	afterEach(fixtures.cleanup);

	const files = {
		"src/ui/cn.ts": "export const cn = (...v: unknown[]) => v.join(' ');\n",
		"src/ui/button.tsx": [
			'import { buttonVariants } from "./button.variants";',
			'import { cn } from "./cn";',
			'export const Button = (props: { className?: string; variant?: string }) => <button className={cn(buttonVariants(props), props.className, "bg-[#FFF]")} />;',
			"",
		].join("\n"),
		"src/app.tsx": [
			'import { cn } from "./ui/cn";',
			"declare const n: number;",
			"declare const extra: string;",
			"export const App = () => (",
			'\t<div className="flex [scrollbar-width:thin] p-2">',
			'\t\t<p className={cn(extra, "bg-[#FFF] text-slate-950")} />',
			// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source with a template literal
			"\t\t<p className={`[&:has(.active)]:p-2 q-${n}`} />",
			'\t\t<p className="[&:has(.active)]:p-2 bg-white has-[.active]:p-2 bg-[#FFF] bg-[#FFF]" />',
			"\t</div>",
			");",
			"",
		].join("\n"),
	};

	it("reports each class with its canonical form, at the class, skipping template fragments and canonical classes", async () => {
		const fixture = await fixtures.create({
			components: [publishedComponent("button", buttonPayload())],
			files,
		});
		const findings = await fixture.run(nonCanonicalClassRule, { inspector });
		expect(describeFindings(findings)).toEqual([
			'src/app.tsx:5:23 Class "[scrollbar-width:thin]" is written "scrollbar-thin" in Tailwind\'s canonical form. Use "scrollbar-thin", or add "[scrollbar-width:thin]" to this rule\'s allow list if it is intended.',
			'src/app.tsx:6:28 Class "bg-[#FFF]" is written "bg-white" in Tailwind\'s canonical form. Use "bg-white", or add "bg-[#FFF]" to this rule\'s allow list if it is intended.',
			'src/app.tsx:8:17 Class "[&:has(.active)]:p-2" is written "has-[.active]:p-2" in Tailwind\'s canonical form. Use "has-[.active]:p-2", or add "[&:has(.active)]:p-2" to this rule\'s allow list if it is intended.',
			'src/app.tsx:8:65 Class "bg-[#FFF]" is written "bg-white" in Tailwind\'s canonical form. Use "bg-white", or add "bg-[#FFF]" to this rule\'s allow list if it is intended.',
			'src/app.tsx:8:75 Class "bg-[#FFF]" is written "bg-white" in Tailwind\'s canonical form. Use "bg-white", or add "bg-[#FFF]" to this rule\'s allow list if it is intended.',
			'src/ui/button.tsx:3:139 Class "bg-[#FFF]" is written "bg-white" in Tailwind\'s canonical form. Use "bg-white", or add "bg-[#FFF]" to this rule\'s allow list if it is intended.',
		]);
		expect(findings.at(-1)?.component).toBe("button");
		expect(findings[0].component).toBeUndefined();
		expect(findings[0].details).toEqual({
			className: "flex [scrollbar-width:thin] p-2",
			classToken: "[scrollbar-width:thin]",
			canonical: "scrollbar-thin",
			suggestions: ["scrollbar-thin"],
		});
	});

	it("reports nothing for canonical classes", async () => {
		const fixture = await fixtures.create({
			components: [],
			files: {
				"src/app.tsx":
					'export const App = () => <div className="flex scrollbar-thin bg-white has-[.active]:p-2 hover:bg-slate-950/50" />;\n',
			},
		});
		expect(await fixture.run(nonCanonicalClassRule, { inspector })).toEqual([]);
	});

	it("skips strings an interpolation splices into a class, and checks conditional branches", async () => {
		const fixture = await fixtures.create({
			components: [],
			files: {
				"src/app.tsx": [
					"declare const on: boolean;",
					"export const App = () => (",
					"\t<div>",
					// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source with a template literal
					'\t\t<p className={`[&_.${"break-words"}]:p-2`} />',
					'\t\t<p className={on ? "break-words" : "flex-grow"} />',
					// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source with a template literal
					'\t\t<p className={`p-2 ${on ? "bg-[#FFF]" : ""}`} />',
					"\t</div>",
					");",
					"",
				].join("\n"),
			},
		});
		expect(
			(await fixture.run(nonCanonicalClassRule, { inspector })).map(
				(finding) => [
					finding.details?.classToken,
					finding.details?.canonical,
					finding.location?.kind === "code" ? finding.location.line : null,
				],
			),
		).toEqual([
			["break-words", "wrap-break-word", 5],
			["flex-grow", "grow", 5],
			["bg-[#FFF]", "bg-white", 6],
		]);
	});

	it("drops forms that compile to other CSS, and says when a form follows the theme", async () => {
		const fixture = await fixtures.create({
			components: [],
			files: {
				"src/app.tsx":
					'export const App = () => <div className="[[data-panel-open]_&]:hidden max-lg:[&_[aria-label=DeltaBlue]]:!hidden w-[38.5rem]" />;\n',
			},
		});
		const findings = await fixture.run(nonCanonicalClassRule, { inspector });
		expect(describeFindings(findings)).toEqual([
			'src/app.tsx:1:113 Class "w-[38.5rem]" is written "w-154" in Tailwind\'s canonical form, which follows the theme: it compiles to the same CSS only while `--spacing` keeps its current value. Use "w-154" if the value should follow the theme, or add "w-[38.5rem]" to this rule\'s allow list if it is intended.',
		]);
		expect(findings[0].details).toEqual({
			className:
				"[[data-panel-open]_&]:hidden max-lg:[&_[aria-label=DeltaBlue]]:!hidden w-[38.5rem]",
			classToken: "w-[38.5rem]",
			canonical: "w-154",
			suggestions: ["w-154"],
			themeDependent: true,
			themeVariables: ["--spacing"],
		});
	});

	it("honours allow globs, and notes when there is no compiled CSS", async () => {
		const fixture = await fixtures.create({
			components: [publishedComponent("button", buttonPayload())],
			files,
		});
		const allowed = await fixture.run(nonCanonicalClassRule, {
			inspector,
			options: { allow: ["[scrollbar-width:*]", "bg-[#*]"] },
		});
		expect(allowed.map((finding) => finding.details?.classToken)).toEqual([
			"[&:has(.active)]:p-2",
		]);
		expect(await fixture.run(nonCanonicalClassRule)).toEqual([
			expect.objectContaining({ severity: "info", location: null }),
		]);
	});
});

describe("design.non-canonical-class", () => {
	const design: TrickroomDesign = {
		name: "Canonical",
		systemId: CODEGEN_TEST_SYSTEM_ID,
		boards: [
			{
				id: "board-a",
				props: {
					"data-trickroom-name": "Board",
					"data-trickroom-library": "trickroom",
					"data-trickroom-component": "container",
					className: "flex [scrollbar-width:thin] bg-[#FFF]",
				},
				children: [
					{
						id: "layer-1",
						props: {
							"data-trickroom-name": "Layer",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "container",
							className:
								"[&:has(.active)]:p-2 bg-white [[data-panel-open]_&]:hidden max-lg:[&_[aria-label=DeltaBlue]]:!hidden max-w-[26rem]",
						},
						children: [],
					},
				],
			},
		],
	};

	const contextFor = (
		loaded: LintTailwindInspector | null,
		options: Record<string, unknown> = {},
	): LintRuleContext => {
		const contract = buildSystemContract({
			system: { id: CODEGEN_TEST_SYSTEM_ID, name: "Core" },
			manifest: createEmptySystemComponentManifest(),
			tokens: null,
			codegen: { status: "unconfigured" },
		});
		const config = resolveLintConfig(
			{
				version: 1,
				rules: { [designNonCanonicalClassRule.id]: { options } },
			},
			{ ruleKinds: lintRuleRegistry.kinds, codegenOutDir: null },
		);
		const rule = config.rules.find(
			(entry) => entry.id === designNonCanonicalClassRule.id,
		);
		if (!rule) throw new Error("rule not resolved");
		return {
			projectRoot: "/project",
			contract,
			config,
			rule,
			codegen: null,
			sources: buildSourceIndex({
				modules: [],
				contract,
				componentModules: {},
			}),
			designs: buildLintDesignIndex({
				systemId: CODEGEN_TEST_SYSTEM_ID,
				designs: [{ id: "design-1", design }],
			}),
			tailwind: {
				inspector: async () => loaded,
				mergeConfig: async () => ({ status: "stock" }),
			},
		};
	};

	it("reports each class of each layer with its canonical form as the suggestion", async () => {
		const findings = await designNonCanonicalClassRule.run(
			contextFor(inspector),
		);
		expect(
			findings.map((finding) => [
				finding.location?.kind === "design" ? finding.location.path : null,
				finding.message,
				finding.details?.suggestions,
			]),
		).toEqual([
			[
				"boards[0].props.className",
				'Class "[scrollbar-width:thin]" is written "scrollbar-thin" in Tailwind\'s canonical form.',
				["scrollbar-thin"],
			],
			[
				"boards[0].props.className",
				'Class "bg-[#FFF]" is written "bg-white" in Tailwind\'s canonical form.',
				["bg-white"],
			],
			[
				"boards[0].children[0].props.className",
				'Class "[&:has(.active)]:p-2" is written "has-[.active]:p-2" in Tailwind\'s canonical form.',
				["has-[.active]:p-2"],
			],
			// The `in-*` and `aria-*` forms compile to other CSS: not reported.
			[
				"boards[0].children[0].props.className",
				'Class "max-w-[26rem]" is written "max-w-104" in Tailwind\'s canonical form, which follows the theme: it compiles to the same CSS only while `--spacing` keeps its current value.',
				["max-w-104"],
			],
		]);
		expect(findings[3].details).toMatchObject({
			themeDependent: true,
			themeVariables: ["--spacing"],
		});
		expect(findings[2].location).toEqual({
			kind: "design",
			design: "design-1",
			board: "board-a",
			element: "layer-1",
			path: "boards[0].children[0].props.className",
		});
	});

	it("honours allow globs, and notes when there is no compiled CSS", async () => {
		const allowed = await designNonCanonicalClassRule.run(
			contextFor(inspector, { allow: ["bg-*", "*:p-2"] }),
		);
		expect(allowed.map((finding) => finding.details?.classToken)).toEqual([
			"[scrollbar-width:thin]",
			"max-w-[26rem]",
		]);
		expect(await designNonCanonicalClassRule.run(contextFor(null))).toEqual([
			expect.objectContaining({ severity: "info", location: null }),
		]);
	});
});
