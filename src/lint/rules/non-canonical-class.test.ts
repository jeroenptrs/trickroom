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

/** Specificity of a simple selector: ids, classes and attributes, elements. */
const specificity = (selector: string): [number, number, number] => {
	const counted = selector.replace(/:where\([^)]*\)/gu, "");
	return [
		(counted.match(/#[\w-]+/gu) ?? []).length,
		(counted.match(/\.[\w\\:[\]&-]+|\[[^\]]+\]|:(?!where)[\w-]+/gu) ?? [])
			.length,
		(counted.match(/(^|[\s>+~])[a-z]+/gu) ?? []).length,
	];
};

afterAll(() => rm(projectRoot, { force: true, recursive: true }));

describe("canonicalizeTailwindCandidatesInWorker", () => {
	it("writes each class the way Tailwind does, one class at a time", async () => {
		const canonical = await inspector.canonicalize?.([
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
		expect(canonical).toEqual([
			"scrollbar-thin",
			"bg-white",
			"has-[.active]:p-2",
			"hover:bg-white",
			"bg-white",
			"has-[.active]:p-2",
			"not-a-utility",
			"w-[16px]",
		]);
	});

	it("may change specificity: an `in-*` form loses to a selector the original beat", async () => {
		const original = "[[data-panel-open]_&]:hidden";
		const [canonical] = (await inspector.canonicalize?.([original])) ?? [];
		expect(canonical).toBe("in-data-panel-open:hidden");
		const selectorOf = (candidate: string) =>
			(designSystem.candidatesToCss([candidate])[0] ?? "").split("{")[0].trim();
		expect(selectorOf(original)).toBe(
			"[data-panel-open] .\\[\\[data-panel-open\\]_\\&\\]\\:hidden",
		);
		expect(selectorOf(canonical)).toBe(
			":where([data-panel-open]) .in-data-panel-open\\:hidden",
		);
		// A competing `.panel .icon { display: block }` ties with the original
		// (later source order decides) but beats the canonical form outright.
		const competing = specificity(".panel .icon");
		expect(specificity(selectorOf(original))).toEqual(competing);
		expect(specificity(selectorOf(canonical))).toEqual([0, 1, 0]);
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
							className: "[&:has(.active)]:p-2 bg-white",
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
			tailwind: { inspector: async () => loaded },
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
		]);
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
		]);
		expect(await designNonCanonicalClassRule.run(contextFor(null))).toEqual([
			expect.objectContaining({ severity: "info", location: null }),
		]);
	});
});
