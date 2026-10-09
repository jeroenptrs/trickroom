import { describe, expect, it } from "vitest";
import {
	CODEGEN_TEST_SYSTEM_ID,
	publishedComponent,
	templateNode,
} from "../../../codegen/test-support";
import { resolveRegistryComponent } from "../../../libraries/registry";
import type { Node, TrickroomDesign } from "../../../types";
import { expandResolvedSystemComponent } from "../../../utils/system-component-expansion.core";
import {
	type SystemComponentInstanceOverrides,
	systemComponentVersionProp,
} from "../../../utils/system-component-markers";
import {
	createEmptySystemComponentManifest,
	type SystemComponentManifest,
	type SystemComponentRecord,
} from "../../../utils/system-components";
import type { TailwindUtilityInspection } from "../../../utils/tailwind-utility-inspector";
import { resolveLintConfig } from "../../config";
import { buildSystemContract } from "../../contract";
import { lintDesign } from "../../design-lint";
import { buildLintDesignIndex, type LintDesignComponents } from "../../designs";
import { buildSourceIndex } from "../../source/index";
import { lintRuleRegistry } from "../index";
import type {
	LintRuleContext,
	LintRuleFinding,
	LintTailwindInspector,
} from "../types";
import { designNonCanonicalClassRule } from "./non-canonical-class";
import { designUnknownClassTokenRule } from "./unknown-class-token";

/**
 * The design class rules check a component's classes once, on the
 * component, and an instance only for what it adds: its className override
 * (and slot content, as plain layers). An instance whose version cannot be
 * resolved is checked by its stored className.
 */

const badge: SystemComponentRecord = publishedComponent(
	"badge",
	{
		root: templateNode("root", "flex bg-[#FFF]", [
			templateNode("label", "font-bold nope-utility"),
		]),
		slots: {},
		variants: {
			axes: {
				tone: {
					label: "Tone",
					defaultValue: "quiet",
					values: {
						quiet: {},
						loud: { classesByPath: { root: "[scrollbar-width:thin]" } },
					},
				},
			},
			compoundVariants: [
				{ when: { tone: "loud" }, classesByPath: { label: "[&:has(.x)]:p-2" } },
			],
		},
		overrideTargets: {
			"root-class": {
				targetId: "root-class",
				label: "Root",
				path: "root",
				capabilities: ["className"],
			},
		},
	},
	{ componentId: "cmp_badge" },
);

/** A Base UI Separator whose template sets a width the Element's base classes also set. */
const rule: SystemComponentRecord = publishedComponent(
	"rule",
	{
		root: {
			path: "root",
			library: "base-ui",
			component: "separator",
			className: "data-[orientation=horizontal]:w-8",
		},
		slots: {},
		variants: { axes: {}, compoundVariants: [] },
		overrideTargets: {
			"rule-class": {
				targetId: "rule-class",
				label: "Rule",
				path: "root",
				capabilities: ["className"],
			},
		},
	},
	{ componentId: "cmp_rule" },
);

const BASE_EQUAL_OVERRIDE = "data-[orientation=horizontal]:w-full";

const components: SystemComponentManifest["components"] = {
	[badge.componentId]: badge,
	[rule.componentId]: rule,
};

let ids = 0;
const place = (
	record: SystemComponentRecord,
	instanceId: string,
	options: {
		variantValues?: Record<string, string>;
		overrides?: SystemComponentInstanceOverrides;
	} = {},
): Node => {
	const version = record.published?.versions["1"];
	if (!version) throw new Error("unpublished");
	return expandResolvedSystemComponent(
		{
			systemId: CODEGEN_TEST_SYSTEM_ID,
			componentId: record.componentId,
			record,
			version,
		},
		{
			...options,
			createInstanceId: () => instanceId,
			createElementId: () => {
				ids += 1;
				return `${instanceId}-${ids}`;
			},
		},
	).root;
};

/** Every node of the tree pinned to a version the manifest does not have. */
const pinTo = (node: Node, version: string): Node => ({
	...node,
	props: { ...node.props, [systemComponentVersionProp]: version },
	children: Array.isArray(node.children)
		? node.children.map((child) => pinTo(child, version))
		: node.children,
});

const loud = { variantValues: { tone: "loud" } };
const instances = {
	plain: place(badge, "plain", loud),
	again: place(badge, "again", loud),
	overridden: place(badge, "overridden", {
		...loud,
		overrides: { "root-class": { className: "[mask-type:alpha]" } },
	}),
	separator: place(rule, "separator", {
		overrides: { "rule-class": { className: BASE_EQUAL_OVERRIDE } },
	}),
	unresolved: pinTo(place(badge, "unresolved", loud), "9"),
};

const design: TrickroomDesign = {
	name: "Badges",
	systemId: CODEGEN_TEST_SYSTEM_ID,
	boards: [
		{
			id: "board",
			props: {
				"data-trickroom-name": "Board",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
				className: "flex",
			},
			children: Object.values(instances),
		},
	],
};

const CANONICAL: Record<string, string> = {
	"bg-[#FFF]": "bg-white",
	"[scrollbar-width:thin]": "scrollbar-thin",
	"[&:has(.x)]:p-2": "has-[.x]:p-2",
	"[mask-type:alpha]": "mask-alpha",
	// Not Tailwind's answer; it makes the class visible to the test.
	[BASE_EQUAL_OVERRIDE]: "data-horizontal:w-full",
};

const inspector: LintTailwindInspector = {
	inspect: (candidate) =>
		({ supported: !candidate.includes("nope") }) as TailwindUtilityInspection,
	canonicalize: async (candidates) =>
		candidates.map((candidate) => CANONICAL[candidate] ?? candidate),
};

const contract = buildSystemContract({
	system: { id: CODEGEN_TEST_SYSTEM_ID, name: "Core" },
	manifest: { ...createEmptySystemComponentManifest(), components },
	tokens: null,
	codegen: { status: "unconfigured" },
});

const contextFor = (
	ruleId: string,
	withComponents: LintDesignComponents | undefined = components,
): LintRuleContext => {
	const config = resolveLintConfig(
		{ version: 1 },
		{ ruleKinds: lintRuleRegistry.kinds, codegenOutDir: null },
	);
	const resolved = config.rules.find((entry) => entry.id === ruleId);
	if (!resolved) throw new Error(`no rule ${ruleId}`);
	return {
		projectRoot: "/project",
		contract,
		config,
		rule: resolved,
		codegen: null,
		sources: buildSourceIndex({ modules: [], contract, componentModules: {} }),
		designs: buildLintDesignIndex({
			systemId: CODEGEN_TEST_SYSTEM_ID,
			designs: [{ id: "design-1", design }],
			components: withComponents,
		}),
		tailwind: {
			inspector: async () => inspector,
			mergeConfig: async () => ({ status: "stock" }),
		},
	};
};

/** `where: class` per finding, with the element for design locations. */
const describe_ = (findings: readonly LintRuleFinding[]) =>
	findings.map((finding) => {
		const location = finding.location;
		const component = finding.componentLocation;
		const where = component
			? `${finding.component}@${component.version} ${component.path}${component.axis ? ` ${component.axis}=${component.value}` : ""}${component.compound === undefined ? "" : ` compound ${component.compound}`}`
			: location?.kind === "design"
				? `#${location.element}`
				: "-";
		return `${where}: ${finding.details?.classToken}`;
	});

const elementOf = (node: Node) => `#${node.id}`;
const labelOf = (node: Node) => {
	const [label] = node.children as Node[];
	return `#${label.id}`;
};

describe("design class rules on components and instances", () => {
	it("reports the classes of a component once, on the component, and only what instances add", async () => {
		const findings = await designNonCanonicalClassRule.run(
			contextFor(designNonCanonicalClassRule.id),
		);
		expect(describe_(findings)).toEqual([
			// The template, the variant value and the compound variant, once.
			"badge@1 root: bg-[#FFF]",
			"badge@1 root tone=loud: [scrollbar-width:thin]",
			"badge@1 label compound 0: [&:has(.x)]:p-2",
			// The instance's override.
			`${elementOf(instances.overridden)}: [mask-type:alpha]`,
			// An override equal to an Element base class, which the stored
			// className leaves out.
			`${elementOf(instances.separator)}: ${BASE_EQUAL_OVERRIDE}`,
			// A version the manifest does not have: the stored className.
			`${elementOf(instances.unresolved)}: bg-[#FFF]`,
			`${elementOf(instances.unresolved)}: [scrollbar-width:thin]`,
			`${labelOf(instances.unresolved)}: [&:has(.x)]:p-2`,
		]);
		// Located on the component outside `location`, which stays null so
		// report readers from before component locations keep the report.
		expect(findings[0]).toMatchObject({
			component: "badge",
			location: null,
			componentLocation: {
				componentId: "cmp_badge",
				version: "1",
				path: "root",
			},
		});
		expect(findings[1].componentLocation).toEqual({
			componentId: "cmp_badge",
			version: "1",
			path: "root",
			axis: "tone",
			value: "loud",
		});
		expect(findings[3]).toMatchObject({
			location: {
				kind: "design",
				design: "design-1",
				board: "board",
				element: instances.overridden.id,
				path: "boards[0].children[2].props.className",
			},
			details: { classToken: "[mask-type:alpha]", canonical: "mask-alpha" },
		});
		expect(findings[3].component).toBeUndefined();
	});

	it("does not repeat inherited classes on instances", async () => {
		const findings = await designNonCanonicalClassRule.run(
			contextFor(designNonCanonicalClassRule.id),
		);
		const onInstance = (node: Node) =>
			findings.filter(
				(finding) =>
					finding.location?.kind === "design" &&
					finding.location.path?.startsWith(
						`boards[0].children[${Object.values(instances).indexOf(node)}]`,
					),
			);
		// Their stored classNames hold the inherited classes.
		expect(instances.plain.props.className).toContain("bg-[#FFF]");
		expect(onInstance(instances.plain)).toEqual([]);
		expect(onInstance(instances.again)).toEqual([]);
		expect(describe_(onInstance(instances.overridden))).toEqual([
			`${elementOf(instances.overridden)}: [mask-type:alpha]`,
		]);
	});

	it("sees an override class the stored className drops as an Element base class", async () => {
		// Materialization writes the Element's base classes, then the
		// component's and the override's without the ones equal to a base
		// class: the override is not in the stored className as authored.
		const base = resolveRegistryComponent("base-ui", "separator");
		if (base.status !== "known") throw new Error("no separator");
		const baseTokens = String(base.definition.baseClassName).split(" ");
		expect(baseTokens).toContain(BASE_EQUAL_OVERRIDE);
		expect(instances.separator.props.className).toBe(
			[...baseTokens, "data-[orientation=horizontal]:w-8"].join(" "),
		);
		const index = contextFor(designNonCanonicalClassRule.id).designs;
		const node = index.designs[0].boards[0].nodes.find(
			(entry) => entry.element === instances.separator.id,
		);
		expect(node).toMatchObject({
			classSource: "override",
			checkedClassName: BASE_EQUAL_OVERRIDE,
		});
	});

	it("resolves a part only through an instance root among its ancestors", async () => {
		// A part moved out of its instance still carries the instance id; the
		// root elsewhere on the board is not its ancestor, so it is checked
		// by its stored className, as the canvas renders it.
		const owner = place(badge, "moved", loud);
		const [label] = owner.children as Node[];
		const orphan: Node = {
			...label,
			id: "orphan",
			props: { ...label.props, className: "font-bold [mask-type:alpha]" },
		};
		const moved: TrickroomDesign = {
			...design,
			boards: [{ ...design.boards[0], children: [owner, orphan] }],
		};
		const context = contextFor(designNonCanonicalClassRule.id);
		context.designs = buildLintDesignIndex({
			systemId: CODEGEN_TEST_SYSTEM_ID,
			designs: [{ id: "design-1", design: moved }],
			components,
		});
		const nodes = context.designs.designs[0].boards[0].nodes;
		expect(
			nodes
				.filter((entry) => entry.instance?.templatePath === "label")
				.map((entry) => [
					entry.element,
					entry.classSource,
					entry.checkedClassName,
				]),
		).toEqual([
			[label.id, "override", null],
			["orphan", "stored", "font-bold [mask-type:alpha]"],
		]);
		const findings = await designNonCanonicalClassRule.run(context);
		expect(
			describe_(findings).filter((entry) => entry.startsWith("#")),
		).toEqual(["#orphan: [mask-type:alpha]"]);
	});

	it("checks every instance node by its stored className without the components", async () => {
		const findings = await designNonCanonicalClassRule.run(
			contextFor(designNonCanonicalClassRule.id, {}),
		);
		expect(
			findings.every((finding) => finding.location?.kind === "design"),
		).toBe(true);
		const index = contextFor(designNonCanonicalClassRule.id, {}).designs;
		expect(index.components).toEqual([]);
		expect(
			new Set(
				index.designs[0].boards[0].nodes
					.filter((entry) => entry.instance)
					.map((entry) => entry.classSource),
			),
		).toEqual(new Set(["stored"]));
		// Every loud badge repeats its template and variant classes.
		expect(
			findings.filter(
				(finding) => finding.details?.classToken === "[scrollbar-width:thin]",
			),
		).toHaveLength(4);
	});

	it("runs the token checks on the component the same way", async () => {
		const findings = await designUnknownClassTokenRule.run(
			contextFor(designUnknownClassTokenRule.id),
		);
		expect(describe_(findings)).toEqual([
			"badge@1 label: nope-utility",
			`${labelOf(instances.unresolved)}: nope-utility`,
		]);
		expect(findings[0].component).toBe("badge");
	});
});

describe("component definitions in the design index", () => {
	const twoVersions: SystemComponentRecord = (() => {
		const v1 = publishedComponent(
			"chip",
			{
				root: templateNode("root", "p-1"),
				slots: {},
				variants: { axes: {}, compoundVariants: [] },
				overrideTargets: {},
			},
			{ componentId: "cmp_chip", version: "1" },
		);
		const v2 = publishedComponent(
			"chip",
			{
				root: templateNode("root", "p-2"),
				slots: {},
				variants: { axes: {}, compoundVariants: [] },
				overrideTargets: {},
			},
			{ componentId: "cmp_chip", version: "2" },
		);
		return {
			...v2,
			published: {
				currentVersion: "2",
				versions: {
					...v1.published?.versions,
					...v2.published?.versions,
				},
			},
		};
	})();
	const draftOnly: SystemComponentRecord = {
		...publishedComponent("draft", {
			root: templateNode("root", "bg-[#FFF]"),
		}),
		published: undefined,
	};

	const chipIn = (version: string): TrickroomDesign => {
		const version1 = twoVersions.published?.versions[version];
		if (!version1) throw new Error("no version");
		return {
			name: "Chips",
			systemId: CODEGEN_TEST_SYSTEM_ID,
			boards: [
				expandResolvedSystemComponent(
					{
						systemId: CODEGEN_TEST_SYSTEM_ID,
						componentId: twoVersions.componentId,
						record: twoVersions,
						version: version1,
					},
					{ createInstanceId: () => "chip", createElementId: () => "chip" },
				).root,
			],
		};
	};

	it("lists the current version of each published component and the versions instances use", () => {
		const index = (designs: TrickroomDesign[]) =>
			buildLintDesignIndex({
				systemId: CODEGEN_TEST_SYSTEM_ID,
				designs: designs.map((entry, position) => ({
					id: `d${position}`,
					design: entry,
				})),
				components: {
					[twoVersions.componentId]: twoVersions,
					[draftOnly.componentId]: draftOnly,
				},
			}).components.map(
				(definition) =>
					`${definition.slug}@${definition.version}${definition.current ? " current" : ""}: ${definition.classes.map((entry) => entry.className).join(", ")}`,
			);
		// Drafts are never linted.
		expect(index([])).toEqual(["chip@2 current: p-2"]);
		expect(index([chipIn("1")])).toEqual([
			"chip@1: p-1",
			"chip@2 current: p-2",
		]);
	});

	it("keeps component findings in design validation only for the versions the design places", async () => {
		const manifest = {
			...createEmptySystemComponentManifest(),
			components: { [twoVersions.componentId]: twoVersions },
		};
		const validationContract = buildSystemContract({
			system: { id: CODEGEN_TEST_SYSTEM_ID, name: "Core" },
			manifest,
			tokens: null,
			codegen: { status: "unconfigured" },
		});
		const config = resolveLintConfig(
			{ version: 1 },
			{ ruleKinds: lintRuleRegistry.kinds, codegenOutDir: null },
		);
		const run = async (placed: TrickroomDesign) =>
			(
				await lintDesign({
					projectRoot: "/project",
					setup: {
						system: {} as never,
						contract: validationContract,
						components: manifest.components,
						config,
						tokens: null,
						diagnostics: [],
						inspector: async () => ({
							inspect: () => ({ supported: true }) as TailwindUtilityInspection,
							// Both versions' paddings are "non-canonical" here.
							canonicalize: async (candidates) =>
								candidates.map((candidate) => `${candidate}-x`),
						}),
						mergeConfig: async () => ({ status: "stock" }),
					},
					designId: "d",
					design: placed,
				})
			).findings
				.filter((finding) => finding.componentLocation)
				.map(
					(finding) =>
						`${finding.rule} ${finding.component}@${finding.componentLocation?.version}`,
				);
		expect(await run(chipIn("1"))).toEqual([
			"design.non-canonical-class chip@1",
		]);
		expect(await run(chipIn("2"))).toEqual([
			"design.non-canonical-class chip@2",
		]);
	});
});
