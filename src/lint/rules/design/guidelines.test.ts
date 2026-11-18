import { describe, expect, it } from "vitest";
import {
	CODEGEN_TEST_SYSTEM_ID,
	publishedComponent,
	templateNode,
} from "../../../codegen/test-support";
import type { Node, RecipeTemplateNode, TrickroomDesign } from "../../../types";
import { getSystemComponentMarkerProps } from "../../../utils/system-component-markers";
import { createEmptySystemComponentManifest } from "../../../utils/system-components";
import { resolveLintConfig } from "../../config";
import { buildSystemContract } from "../../contract";
import { buildLintDesignIndex } from "../../designs";
import { buildSourceIndex } from "../../source/index";
import { lintRuleRegistry } from "../index";
import type { LintRuleContext, LintRuleFinding } from "../types";
import {
	designClassRestrictedRule,
	designMissingDarkVariantRule,
	designTextPatternRule,
} from "./guidelines";

const textTemplate = (
	path: string,
	text: string,
	className?: string,
): RecipeTemplateNode => ({
	...templateNode(path, className),
	component: "text",
	name: path === "label" ? "Label" : path,
	text,
});

/** `toast`: a container with a text label; the root sets a dim title. */
const toast = publishedComponent("toast", {
	root: templateNode("root", "flex bg-pale-2 text-title-sm text-pale-dim", [
		textTemplate("label", "Saved successfully!"),
	]),
	slots: {},
	variants: { axes: {}, compoundVariants: [] },
	overrideTargets: {},
});

const markers = (instanceId: string, path: string, isRoot: boolean) =>
	getSystemComponentMarkerProps({
		systemId: CODEGEN_TEST_SYSTEM_ID,
		componentId: toast.componentId,
		instanceId,
		version: "1",
		path,
		isRoot,
		variantValues: {},
	});

const layer = (
	id: string,
	name: string,
	props: Record<string, string>,
	children: Node["children"],
	component = "container",
): Node => ({
	id,
	props: {
		"data-trickroom-name": name,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": component,
		...props,
	} as Node["props"],
	children,
});

const toastInstance = (instanceId: string, label: string): Node => ({
	id: instanceId,
	props: {
		"data-trickroom-name": "Toast",
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		className: "flex bg-pale-2 text-title-sm text-pale-dim",
		...markers(instanceId, "root", true),
	} as Node["props"],
	children: [
		{
			id: `${instanceId}-label`,
			props: {
				"data-trickroom-name": "Label",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "text",
				"data-trickroom-role": "text",
				...markers(instanceId, "label", false),
			} as Node["props"],
			children: label,
		},
	],
});

const design: TrickroomDesign = {
	name: "Settings",
	systemId: CODEGEN_TEST_SYSTEM_ID,
	boards: [
		layer(
			"board",
			"Settings",
			{
				className:
					"flex bg-pale-1 dark:bg-paledark-1 hover:bg-pale-3 text-title-lg text-penn-11 hover:underline",
			},
			[
				layer("title", "Title", {}, "Profile · Settings", "text"),
				layer("sorry", "Error", {}, "Sorry, that failed", "text"),
				layer("note", "Note: explain the flow", {}, [
					layer("note-text", "Text", {}, "Are you sure? Sorry!", "text"),
				]),
				toastInstance("inherited", "Saved successfully!"),
				toastInstance("overridden", "Loading..."),
				layer(
					"row",
					"Row",
					{ className: "bg-pale-app border-pale-6 dark:hover:bg-pale-9" },
					[],
				),
			],
		),
	],
};

const contextFor = (
	ruleId: string,
	options: Record<string, unknown>,
	designs = buildLintDesignIndex({
		systemId: CODEGEN_TEST_SYSTEM_ID,
		designs: [{ id: "design-1", design }],
		components: { [toast.componentId]: toast },
	}),
): LintRuleContext => {
	const contract = buildSystemContract({
		system: { id: CODEGEN_TEST_SYSTEM_ID, name: "Core" },
		manifest: {
			...createEmptySystemComponentManifest(),
			components: { [toast.componentId]: toast },
		},
		tokens: null,
		codegen: { status: "unconfigured" },
	});
	const config = resolveLintConfig(
		{ version: 1, rules: { [ruleId]: { options } } },
		{ ruleKinds: lintRuleRegistry.kinds, codegenOutDir: null },
	);
	const rule = config.rules.find((entry) => entry.id === ruleId);
	if (!rule) throw new Error(`no rule ${ruleId}`);
	return {
		projectRoot: "/project",
		contract,
		config,
		rule,
		codegen: null,
		sources: buildSourceIndex({ modules: [], contract, componentModules: {} }),
		designs,
		tailwind: {
			inspector: async () => null,
			mergeConfig: async () => ({ status: "stock" }),
		},
	};
};

/** `where message` lines: an element id, or the component and template path. */
const describe_ = (findings: LintRuleFinding[]) =>
	findings.map((finding) => {
		const where =
			finding.location?.kind === "design"
				? finding.location.element
				: `${finding.component}#${finding.componentLocation?.path}`;
		return `${where} ${finding.message}`;
	});

const PATTERNS = [
	{ pattern: "·", message: "No middle dots as separators." },
	{ pattern: "^Sorry", regex: true, message: "Do not apologise." },
	{ pattern: "Are you sure", message: "Say what happens." },
	{ pattern: "Loading\\.\\.\\.", regex: true, message: "Use a skeleton." },
	{
		pattern: "\\bsuccessfully\\b",
		regex: true,
		flags: "i",
		message: "Cut it.",
	},
	{ pattern: "!$", regex: true, message: "No exclamation marks." },
];

describe("design.text-pattern", () => {
	it("checks design text and component text once, skipping inherited text and skipped layers", async () => {
		const findings = await designTextPatternRule.run(
			contextFor(designTextPatternRule.id, {
				patterns: PATTERNS,
				skipLayers: ["note*"],
			}),
		);
		expect(describe_(findings)).toEqual([
			'toast#label Cut it. Found "successfully" in "Saved successfully!".',
			'toast#label No exclamation marks. Found "!" in "Saved successfully!".',
			'title No middle dots as separators. Found "·" in "Profile · Settings".',
			'sorry Do not apologise. Found "Sorry" in "Sorry, that failed".',
			'overridden-label Use a skeleton. Found "Loading..." in "Loading...".',
		]);
		const onNode = findings.find(
			(finding) => finding.location?.kind === "design",
		);
		expect(onNode?.location).toEqual({
			kind: "design",
			design: "design-1",
			board: "board",
			element: "title",
			path: "boards[0].children[0].children",
		});
		expect(findings[0]).toMatchObject({
			location: null,
			component: "toast",
			componentLocation: {
				componentId: toast.componentId,
				version: "1",
				path: "label",
			},
		});
	});

	it("does nothing without patterns, and notes a pattern it cannot compile", async () => {
		expect(
			await designTextPatternRule.run(contextFor(designTextPatternRule.id, {})),
		).toEqual([]);
		const findings = await designTextPatternRule.run(
			contextFor(designTextPatternRule.id, {
				patterns: [
					{ pattern: "(", regex: true, message: "x" },
					{ pattern: "a", flags: "q", message: "x" },
				],
			}),
		);
		expect(findings).toHaveLength(1);
		expect(findings[0].severity).toBe("info");
		expect(findings[0].message).toContain(
			"patterns[0].pattern is not a valid regular expression",
		);
		expect(findings[0].message).toContain(
			"patterns[1].flags has unknown flag q",
		);
	});
});

describe("design.class-restricted", () => {
	it("reports forbidden classes, with when, on the component once and on layers", async () => {
		const findings = await designClassRestrictedRule.run(
			contextFor(designClassRestrictedRule.id, {
				restrictions: [
					{
						classes: ["text-pale-dim", "text-penn-11"],
						when: ["text-title-*"],
						message: "Titles never dim.",
					},
					{
						classes: ["hover:underline"],
						message: "Rows use a hover background.",
						allowIn: ["src/link.tsx"],
					},
				],
			}),
		);
		expect(describe_(findings)).toEqual([
			'toast#root Class "text-pale-dim" next to "text-title-sm": Titles never dim.',
			'board Class "text-penn-11" next to "text-title-lg": Titles never dim.',
			'board Class "hover:underline": Rows use a hover background.',
		]);
	});

	it("does nothing until configured", async () => {
		expect(
			await designClassRestrictedRule.run(
				contextFor(designClassRestrictedRule.id, {}),
			),
		).toEqual([]);
	});
});

describe("design.missing-dark-variant", () => {
	it("reports colour classes without a dark twin for the same property and variants", async () => {
		const findings = await designMissingDarkVariantRule.run(
			contextFor(designMissingDarkVariantRule.id, {
				colors: ["pale-*", "penn-*"],
				allow: ["bg-pale-app", "text-pale-dim"],
			}),
		);
		expect(describe_(findings)).toEqual([
			'toast#root Class "bg-pale-2" has no dark counterpart for the same property in this class string. Add a dark:bg-* class, or exempt the class in this rule\'s allow list if it switches itself in CSS.',
			'board Class "hover:bg-pale-3" has no dark counterpart for the same property in this class string. Add a dark:hover:bg-* class, or exempt the class in this rule\'s allow list if it switches itself in CSS.',
			'board Class "text-penn-11" has no dark counterpart for the same property in this class string. Add a dark:text-* class, or exempt the class in this rule\'s allow list if it switches itself in CSS.',
			'row Class "border-pale-6" has no dark counterpart for the same property in this class string. Add a dark:border-* class, or exempt the class in this rule\'s allow list if it switches itself in CSS.',
		]);
	});

	it("does nothing until colours are configured", async () => {
		expect(
			await designMissingDarkVariantRule.run(
				contextFor(designMissingDarkVariantRule.id, { allow: ["x"] }),
			),
		).toEqual([]);
	});
});
