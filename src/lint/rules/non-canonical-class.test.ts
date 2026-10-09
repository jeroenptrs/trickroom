import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	CODEGEN_TEST_SYSTEM_ID,
	publishedComponent,
} from "../../codegen/test-support";
import type { TrickroomDesign } from "../../types";
import { createClassTokenInspector } from "../../utils/class-token-diagnostics";
import {
	createEmptySystemComponentManifest,
	type SystemComponentManifest,
} from "../../utils/system-components";
import { selectorSpecificity } from "../../utils/tailwind-canonical-equivalence";
import {
	canonicalizeTailwindCandidatesInWorker,
	verifyCanonicalClassesInContextInWorker,
} from "../../utils/tailwind-canonicalize-client";
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
		verifyInContext: (checks) =>
			verifyCanonicalClassesInContextInWorker(system, checks),
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

	it("rejects an integer for a number its property does not accept", async () => {
		// `order: 1.0` and `grid-column-start: 1.0` are invalid; `1` is not.
		const results = await inspector.canonicalize?.([
			"order-[1.0]",
			"col-start-[1.0]",
		]);
		expect(results).toEqual([
			{
				canonical: "order-1",
				verdict: {
					status: "different",
					reason: 'declares "order: 1" where the class declares "order: 1.0"',
				},
			},
			{
				canonical: "col-start-1",
				verdict: {
					status: "different",
					reason:
						'declares "grid-column-start: 1" where the class declares "grid-column-start: 1.0"',
				},
			},
		]);
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

	it("checks a canonical form among the classes next to it", async () => {
		const check = (classes: string, candidate: string, canonical: string) =>
			verifyCanonicalClassesInContextInWorker(
				{ projectRoot, cssPath: "src/index.css" },
				[{ classes: classes.split(" "), candidate, canonical }],
			).then(([verdict]) => verdict);
		// Tailwind emits `bg-white` after `bg-red-500` but `bg-[#FFF]` before
		// it, and `mt-[0.25rem]` after `mt-2` but `mt-1` before it.
		expect(
			await check("bg-[#FFF] bg-red-500", "bg-[#FFF]", "bg-white"),
		).toEqual({
			status: "changed",
			reason:
				'next to "bg-red-500", "bg-red-500" wins over the class but not over "bg-white"',
		});
		expect(await check("mt-[0.25rem] mt-2", "mt-[0.25rem]", "mt-1")).toEqual({
			status: "changed",
			reason: 'next to "mt-2", the class wins over "mt-2" but "mt-1" does not',
		});
		// No competitor, or competitors whose order does not change.
		expect(await check("bg-[#FFF] p-2 flex", "bg-[#FFF]", "bg-white")).toEqual({
			status: "unchanged",
			competitors: 0,
		});
		expect(
			await check("w-[38.5rem] md:w-auto", "w-[38.5rem]", "w-154"),
		).toEqual({ status: "unchanged", competitors: 1 });
		// `all` resets every property but custom properties, `direction` and
		// `unicode-bidi`: a competitor of `background-color`, not of `direction`.
		expect(
			await check("[&:focus]:[all:unset] bg-[#FFF]", "bg-[#FFF]", "bg-white"),
		).toEqual({ status: "unchanged", competitors: 1 });
		expect(
			await check(
				"[&:focus]:[all:unset] [direction:rtl]",
				"[direction:rtl]",
				"[direction:rtl]",
			),
		).toEqual({ status: "unchanged", competitors: 0 });
		// The canonical form already there: removing the class changes nothing.
		expect(
			await check("bg-[#FFF] bg-red-500 bg-white", "bg-[#FFF]", "bg-white"),
		).toEqual({ status: "unchanged", competitors: 1 });
	});
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
			'src/app.tsx:6:28 Class "bg-[#FFF]" is written "bg-white" in Tailwind\'s canonical form. Not every class that renders with it is known here, so check that none of them competes with it before replacing it: Tailwind may order "bg-white" differently against them. Use "bg-white", or add "bg-[#FFF]" to this rule\'s allow list if it is intended.',
			'src/app.tsx:8:17 Class "[&:has(.active)]:p-2" is written "has-[.active]:p-2" in Tailwind\'s canonical form. Use "has-[.active]:p-2", or add "[&:has(.active)]:p-2" to this rule\'s allow list if it is intended.',
			'src/app.tsx:8:65 Class "bg-[#FFF]" is written "bg-white" in Tailwind\'s canonical form. Use "bg-white", or add "bg-[#FFF]" to this rule\'s allow list if it is intended.',
			'src/app.tsx:8:75 Class "bg-[#FFF]" is written "bg-white" in Tailwind\'s canonical form. Use "bg-white", or add "bg-[#FFF]" to this rule\'s allow list if it is intended.',
			'src/ui/button.tsx:3:139 Class "bg-[#FFF]" is written "bg-white" in Tailwind\'s canonical form. Not every class that renders with it is known here, so check that none of them competes with it before replacing it: Tailwind may order "bg-white" differently against them. Use "bg-white", or add "bg-[#FFF]" to this rule\'s allow list if it is intended.',
		]);
		// Next to non-literal parts (`cn(extra, …)`), the context is incomplete.
		expect(
			findings.map((finding) => finding.details?.contextDependent ?? false),
		).toEqual([false, true, false, false, false, true]);
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

	it("settles each finding among the classes that render with it", async () => {
		const fixture = await fixtures.create({
			components: [],
			files: {
				"src/app.tsx": [
					'import { cn } from "./cn";',
					"declare const extra: string;",
					"declare const on: boolean;",
					"declare const rest: Record<string, string>;",
					"export const App = () => (",
					"\t<div>",
					// Competitors that win or lose differently: not reported.
					'\t\t<p className="bg-[#FFF] bg-red-500" />',
					'\t\t<p className={cn("mt-[0.25rem]", on && "mt-2")} />',
					// No competitor: reported, the context is complete.
					'\t\t<p className="bg-[#FFF] p-2" />',
					// Incomplete contexts: reported, context-dependent.
					'\t\t<p className={cn(extra, "bg-[#FFF] p-2")} />',
					'\t\t<p className="bg-[#FFF]" {...rest} />',
					'\t\t<Card className="bg-[#FFF]" />',
					"\t</div>",
					");",
					"",
				].join("\n"),
				"src/cn.ts": "export const cn = (...v: unknown[]) => v.join(' ');\n",
			},
		});
		const findings = await fixture.run(nonCanonicalClassRule, { inspector });
		expect(
			findings.map((finding) => [
				finding.location?.kind === "code" ? finding.location.line : null,
				finding.details?.contextDependent ?? false,
			]),
		).toEqual([
			[9, false],
			[10, true],
			[11, true],
			[12, true],
		]);
		expect(findings[1].message).toContain(
			"Not every class that renders with it is known here, so check that none of them competes with it before replacing it",
		);
	});

	it("verifies each branch combination, never a union of branches", async () => {
		const many = Array.from({ length: 7 }, (_, index) => `on && "p-${index}"`);
		const fixture = await fixtures.create({
			components: [],
			files: {
				"src/app.tsx": [
					'import { cn } from "./cn";',
					"declare const on: boolean;",
					"export const App = () => (",
					"\t<div>",
					// When `on`, `bg-white` would turn the red background white;
					// the other branch's `bg-white` is not there to stand in.
					'\t\t<p className={on ? "bg-[#FFF] bg-red-500" : "bg-white"} />',
					// The other branch competes in no combination: reported.
					'\t\t<p className={on ? "bg-[#FFF]" : "bg-red-500"} />',
					// More combinations than the cap: what is always there only.
					`\t\t<p className={cn("bg-[#FFF]", ${many.join(", ")})} />`,
					"\t</div>",
					");",
					"",
				].join("\n"),
				"src/cn.ts": "export const cn = (...v: unknown[]) => v.join(' ');\n",
			},
		});
		const findings = await fixture.run(nonCanonicalClassRule, { inspector });
		expect(
			findings.map((finding) => [
				finding.location?.kind === "code" ? finding.location.line : null,
				finding.details?.classToken,
				finding.details?.contextDependent ?? false,
			]),
		).toEqual([
			[6, "bg-[#FFF]", false],
			[7, "bg-[#FFF]", true],
		]);
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
					// Equivalent alone, not next to these: Tailwind emits `bg-white`
					// after `bg-red-500` and `mt-1` before `mt-2`.
					{
						id: "layer-red",
						props: {
							"data-trickroom-name": "Red",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "container",
							className: "bg-[#FFF] bg-red-500",
						},
						children: [],
					},
					{
						id: "layer-margin",
						props: {
							"data-trickroom-name": "Margin",
							"data-trickroom-library": "trickroom",
							"data-trickroom-component": "container",
							className: "mt-[0.25rem] mt-2",
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
		components: SystemComponentManifest["components"] = {},
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
				components,
			}),
			tailwind: {
				inspector: async () => loaded,
				mergeConfig: async () => ({ status: "stock" }),
			},
		};
	};

	it("verifies a component's classes in every variant configuration it can render", async () => {
		// With `small`, tv's merge keeps `has-[[data-x]]:p-4` next to
		// `has-data-x:p-2` (other modifier) but drops `has-data-x:p-4` for it:
		// 16px would become 8px.
		const box = publishedComponent(
			"box",
			{
				root: {
					path: "root",
					library: "trickroom",
					component: "container",
					className: "has-[[data-x]]:p-4",
				},
				slots: {},
				variants: {
					axes: {
						size: {
							label: "Size",
							values: {
								small: { classesByPath: { root: "has-data-x:p-2" } },
								large: { classesByPath: { root: "has-data-x:p-4" } },
							},
						},
					},
					compoundVariants: [],
				},
				overrideTargets: {},
			},
			{ componentId: "cmp_box" },
		);
		// The same template without the axis: nothing competes, reported.
		const plain = publishedComponent(
			"plain",
			{
				root: {
					path: "root",
					library: "trickroom",
					component: "container",
					className: "has-[[data-x]]:p-4",
				},
				slots: {},
				variants: { axes: {}, compoundVariants: [] },
				overrideTargets: {},
			},
			{ componentId: "cmp_plain" },
		);
		const findings = await designNonCanonicalClassRule.run(
			contextFor(
				inspector,
				{},
				{ [box.componentId]: box, [plain.componentId]: plain },
			),
		);
		expect(
			findings
				.filter((finding) => finding.component !== undefined)
				.map((finding) => [
					finding.component,
					finding.details?.classToken,
					finding.details?.contextDependent ?? false,
				]),
		).toEqual([["plain", "has-[[data-x]]:p-4", false]]);
	});

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
		// Every layer's classes are known: verified in context, so no
		// finding is context-dependent, and the board's `bg-[#FFF]` (next to
		// `flex` and `scrollbar-*`, no competitor) is reported.
		expect(
			findings.map((finding) => finding.details?.contextDependent ?? false),
		).toEqual([false, false, false, false]);
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
