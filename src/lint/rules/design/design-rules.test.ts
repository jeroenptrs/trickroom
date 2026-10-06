import { describe, expect, it } from "vitest";
import {
	CODEGEN_TEST_SYSTEM_ID,
	publishedComponent,
	templateNode,
} from "../../../codegen/test-support";
import type { Node, TrickroomDesign } from "../../../types";
import { getSystemComponentMarkerProps } from "../../../utils/system-component-markers";
import {
	createEmptySystemComponentManifest,
	type SystemComponentDraftPayload,
	type SystemComponentRecord,
} from "../../../utils/system-components";
import type { TailwindTokenStorage } from "../../../utils/tailwind-token-store";
import type { TailwindUtilityInspection } from "../../../utils/tailwind-utility-inspector";
import { resolveLintConfig } from "../../config";
import { buildSystemContract } from "../../contract";
import { buildLintDesignIndex } from "../../designs";
import { buildSourceIndex } from "../../source/index";
import { lintRuleRegistry } from "../index";
import type { LintRuleContext, LintTailwindInspector } from "../types";
import { designOnlyClassTargetRule } from "./design-only-class-target";
import {
	compileClassAllowList,
	unknownClassTokenOptionIssues,
	unknownClassTokenRule,
} from "./unknown-class-token";
import { unknownVariantValueRule } from "./unknown-variant-value";

const payload = (
	axes: Record<string, string[]>,
	extra: Partial<SystemComponentDraftPayload> = {},
): SystemComponentDraftPayload => ({
	root: templateNode("root", "flex"),
	slots: {},
	variants: {
		axes: Object.fromEntries(
			Object.entries(axes).map(([key, values]) => [
				key,
				{
					label: key,
					values: Object.fromEntries(values.map((value) => [value, {}])),
				},
			]),
		),
		compoundVariants: [],
	},
	overrideTargets: {},
	...extra,
});

/** A component with every given version published, the last one current. */
const versioned = (
	slug: string,
	versions: Array<[version: string, payload: SystemComponentDraftPayload]>,
): SystemComponentRecord => {
	const records = versions.map(([version, entry]) =>
		publishedComponent(slug, entry, {
			version,
			componentId: `cmp_${slug}`,
		}),
	);
	const last = records[records.length - 1];
	return {
		...last,
		published: {
			currentVersion: versions[versions.length - 1][0],
			versions: Object.assign(
				{},
				...records.map((record) => record.published?.versions),
			),
		},
	};
};

const button = versioned("button", [
	["1", payload({ size: ["sm", "lg"], tone: ["neutral"] })],
	["2", payload({ size: ["sm", "md", "lg"], tone: ["neutral", "danger"] })],
]);

const toast = versioned("toast", [
	[
		"1",
		payload(
			{ tone: ["info", "danger"] },
			{
				root: templateNode("root", "flex", [
					templateNode("title", "font-bold"),
					{
						...templateNode("icon", "size-4", [templateNode("glyph")]),
						designOnly: true,
					},
				]),
			},
		),
	],
]);
// Variant and compound entries on the design-only subtree.
const toastVersion = toast.published?.versions["1"];
if (toastVersion?.variants) {
	toastVersion.variants.axes.tone.values.danger = {
		classesByPath: { root: "bg-red-50", icon: "text-red-700" },
	};
	toastVersion.variants.compoundVariants = [
		{ when: { tone: "info" }, classesByPath: { glyph: "opacity-50" } },
	];
}

const instance = (
	id: string,
	component: SystemComponentRecord,
	version: string,
	variantValues: Record<string, string>,
	systemId = CODEGEN_TEST_SYSTEM_ID,
): Node => ({
	id,
	props: {
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		...getSystemComponentMarkerProps({
			systemId,
			componentId: component.componentId,
			instanceId: `inst_${id}`,
			version,
			path: "root",
			isRoot: true,
			variantValues,
		}),
	} as Node["props"],
	children: [],
});

const design: TrickroomDesign = {
	name: "Checkout",
	systemId: CODEGEN_TEST_SYSTEM_ID,
	boards: [
		{
			id: "board-a",
			props: {
				"data-trickroom-name": "Cart",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				className: "flex bg-brand-500 text-missing-500 p-[13px] nope-utility",
			},
			children: [
				instance("current-ok", button, "2", { size: "md", tone: "danger" }),
				instance("current-bad-value", button, "2", { size: "xl" }),
				instance("current-bad-axis", button, "2", { shape: "round" }),
				instance("pinned-migrate", button, "1", {
					size: "md",
					tone: "danger",
				}),
				instance("pinned-bad", button, "1", { size: "huge" }),
				instance("unknown-version", button, "9", { size: "xl" }),
				instance("other-system", button, "2", { size: "xl" }, "sys_other"),
			],
		},
		{
			id: "board-b",
			props: {
				"data-trickroom-name": "Empty",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				className: "hover:bg-legacy-300 md:text-missing-500",
			},
			children: [],
		},
	],
};

const tokens = (): TailwindTokenStorage => {
	const domains = Object.fromEntries(
		[
			"color",
			"spacing",
			"breakpoint",
			"container",
			"radius",
			"font",
			"text",
			"font-weight",
			"text-shadow",
			"leading",
			"tracking",
			"shadow",
			"inset-shadow",
			"drop-shadow",
			"blur",
			"aspect",
			"ease",
			"animate",
			"perspective",
		].map((domain) => [
			domain,
			{
				tokens: {},
				overrides: [],
				baselineDiff: { added: [], overridden: [], removed: [] },
			},
		]),
	) as unknown as TailwindTokenStorage["domains"];
	domains.color = {
		tokens: { "brand-500": "#2563eb" },
		overrides: [],
		baselineDiff: {
			added: [{ name: "brand-500", value: "#2563eb", domain: "color" }],
			overridden: [],
			removed: [],
		},
	};
	return {
		version: 3,
		metadata: {
			cssPath: "src/index.css",
			syncedAt: "2026-01-01T00:00:00.000Z",
			tailwindBaselineVersion: "test",
			reviewRequired: false,
		},
		domains,
		customProperties: {},
		customUtilities: [],
	} as unknown as TailwindTokenStorage;
};

const inspector: LintTailwindInspector = {
	inspect: (candidate) =>
		({
			supported: !["nope", "legacy", "missing"].some((part) =>
				candidate.includes(part),
			),
		}) as TailwindUtilityInspection,
	suggest: (candidate) => (candidate === "nope-utility" ? ["flex"] : []),
};

const contextFor = (
	ruleId: string,
	options: Record<string, unknown> = {},
): LintRuleContext => {
	const contract = buildSystemContract({
		system: { id: CODEGEN_TEST_SYSTEM_ID, name: "Core" },
		manifest: {
			...createEmptySystemComponentManifest(),
			components: {
				[button.componentId]: button,
				[toast.componentId]: toast,
			},
		},
		tokens: tokens(),
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
		designs: buildLintDesignIndex({
			systemId: CODEGEN_TEST_SYSTEM_ID,
			designs: [{ id: "design-1", design }],
		}),
		tailwind: { inspector: async () => inspector },
	};
};

describe("design.unknown-variant-value", () => {
	it("checks instances against the version they use", async () => {
		const findings = await unknownVariantValueRule.run(
			contextFor(unknownVariantValueRule.id),
		);
		const byElement = Object.fromEntries(
			findings.map((finding) => [
				finding.location?.kind === "design" ? finding.location.element : "",
				finding,
			]),
		);
		expect(Object.keys(byElement).sort()).toEqual([
			"current-bad-axis",
			"current-bad-value",
			"pinned-bad",
			"pinned-migrate",
			"unknown-version",
		]);
		expect(byElement["current-bad-value"]).toEqual({
			message:
				'Instance of "button" sets "size" to "xl", which version 2 does not have. Pick one of "sm", "md", "lg".',
			location: {
				kind: "design",
				design: "design-1",
				board: "board-a",
				element: "current-bad-value",
				path: "boards[0].children[1]",
			},
			component: "button",
			details: { axis: "size", value: "xl", version: "2" },
		});
		expect(byElement["current-bad-axis"].message).toBe(
			'Instance of "button" sets variant axis "shape" (to "round"), which version 2 does not have. Remove it; the axes are "size", "tone".',
		);
		expect(byElement["pinned-bad"].message).toBe(
			'Instance of "button" (pinned to version 1; current is 2) sets "size" to "huge", which version 1 does not have. Pick one of "sm", "lg".',
		);
		expect(byElement["unknown-version"].message).toContain(
			'Its version "9" is not in the manifest, so it was checked against the current version 2.',
		);
	});

	it("says to migrate when the pinned version lacks a value the current one has", async () => {
		const findings = (
			await unknownVariantValueRule.run(contextFor(unknownVariantValueRule.id))
		).filter(
			(finding) =>
				finding.location?.kind === "design" &&
				finding.location.element === "pinned-migrate",
		);
		expect(findings.map((finding) => finding.message)).toEqual([
			'Instance of "button" (pinned to version 1; current is 2) sets "size" to "md", which version 1 does not have. Migrate the instance to version 2, which has it.',
			'Instance of "button" (pinned to version 1; current is 2) sets "tone" to "danger", which version 1 does not have. Migrate the instance to version 2, which has it.',
		]);
		expect(findings[0].details).toEqual({
			axis: "size",
			value: "md",
			version: "1",
			currentVersion: "2",
		});
	});
});

describe("design.design-only-class-target", () => {
	it("reports variant and compound entries inside a design-only subtree", async () => {
		const findings = await designOnlyClassTargetRule.run(
			contextFor(designOnlyClassTargetRule.id),
		);
		expect(findings).toEqual([
			{
				message:
					'Variant "tone=danger" of component "toast" (version 1) has classes for path "icon", which is inside a design-only subtree and does not exist in code. Remove the entry, retarget it, or clear design-only on the node, then publish.',
				location: null,
				component: "toast",
				details: { targetPath: "icon" },
			},
			{
				message: expect.stringContaining(
					'Compound variant 1 of component "toast" (version 1) has classes for path "glyph"',
				),
				location: null,
				component: "toast",
				details: { targetPath: "glyph" },
			},
		]);
	});
});

describe("design.unknown-class-token", () => {
	const run = async (options: Record<string, unknown> = {}) =>
		unknownClassTokenRule.run(contextFor(unknownClassTokenRule.id, options));

	it("runs the design class checks over every board", async () => {
		const findings = await run();
		expect(
			findings.map((finding) => [
				finding.location?.kind === "design" ? finding.location.board : null,
				finding.details?.check,
				finding.details?.classToken,
			]),
		).toEqual([
			["board-a", "UNKNOWN_COLOR_TOKEN", "text-missing-500"],
			["board-a", "UNKNOWN_TAILWIND_UTILITY", "nope-utility"],
			["board-b", "UNKNOWN_COLOR_TOKEN", "hover:bg-legacy-300"],
			["board-b", "UNKNOWN_COLOR_TOKEN", "md:text-missing-500"],
		]);
		expect(findings[1]).toEqual({
			message:
				'Class "nope-utility" is not recognized as a supported Tailwind utility. Did you mean "flex"?',
			location: {
				kind: "design",
				design: "design-1",
				board: "board-a",
				element: "board-a",
				path: "boards[0].props.className",
			},
			details: {
				check: "UNKNOWN_TAILWIND_UTILITY",
				className: "flex bg-brand-500 text-missing-500 p-[13px] nope-utility",
				classToken: "nope-utility",
				domain: "tailwind",
				suggestions: ["flex"],
			},
		});
	});

	it("honours allow globs and the codes subset", async () => {
		expect(
			(await run({ allow: ["bg-legacy-*", "nope-utility"] })).map(
				(finding) => finding.details?.classToken,
			),
		).toEqual(["text-missing-500", "md:text-missing-500"]);
		expect(
			(await run({ codes: ["UNKNOWN_TAILWIND_UTILITY"] })).map(
				(finding) => finding.details?.classToken,
			),
		).toEqual(["nope-utility"]);
	});

	it("validates its options", () => {
		expect(unknownClassTokenOptionIssues({})).toEqual([]);
		expect(
			unknownClassTokenOptionIssues({
				allow: "bg-*",
				codes: ["UNKNOWN_COLOR_TOKEN", "NOPE"],
				only: [],
			}),
		).toEqual([
			"options.only is not an option; use allow or codes.",
			"options.allow must be a list of non-empty strings.",
			'options.codes has unknown code "NOPE"; the codes are UNKNOWN_COLOR_TOKEN, UNKNOWN_SPACING_TOKEN, UNKNOWN_FONT_TOKEN, UNKNOWN_TEXT_TOKEN, UNKNOWN_RADIUS_TOKEN, UNKNOWN_SHADOW_TOKEN, UNKNOWN_TAILWIND_TOKEN, OUT_OF_SYSTEM_COLOR, OUT_OF_SYSTEM_FONT, OUT_OF_SYSTEM_RADIUS, OUT_OF_SYSTEM_TEXT, OUT_OF_SYSTEM_SHADOW, OUT_OF_SYSTEM_BLUR, OUT_OF_SYSTEM_TAILWIND_TOKEN, UNKNOWN_TAILWIND_UTILITY.',
		]);
	});

	it("matches allow patterns on the whole class or the utility without variants", () => {
		const allowed = compileClassAllowList(["bg-legacy-*", "p-[13px]", "!m-1"]);
		expect(allowed("bg-legacy-1")).toBe(true);
		expect(allowed("md:hover:bg-legacy-1/50")).toBe(true);
		expect(allowed("p-[13px]")).toBe(true);
		expect(allowed("lg:!m-1")).toBe(true);
		expect(allowed("m-1")).toBe(false);
		expect(allowed("bg-brand-1")).toBe(false);
	});
});
