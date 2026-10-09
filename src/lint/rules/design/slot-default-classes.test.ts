import { describe, expect, it } from "vitest";
import {
	CODEGEN_TEST_SYSTEM_ID,
	publishedComponent,
	templateNode,
} from "../../../codegen/test-support";
import type { Node, RecipeTemplateNode, TrickroomDesign } from "../../../types";
import { expandResolvedSystemComponent } from "../../../utils/system-component-expansion.core";
import {
	createEmptySystemComponentManifest,
	type SystemComponentDraftPayload,
	type SystemComponentRecord,
} from "../../../utils/system-components";
import type { TailwindUtilityInspection } from "../../../utils/tailwind-utility-inspector";
import { resolveLintConfig } from "../../config";
import { buildSystemContract } from "../../contract";
import { buildLintDesignIndex } from "../../designs";
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
 * A slot's default children are copied into every instance as plain
 * layers. The design class rules check them once, on the component
 * version, and skip a copy while its classes equal its default's in the
 * version its instance uses; an edited copy is the instance's own.
 */

const text = (
	nodePath: string,
	className: string,
	value: string,
): RecipeTemplateNode => ({
	path: nodePath,
	library: "trickroom",
	component: "text",
	className,
	text: value,
});

const payload = (labelClassName: string): SystemComponentDraftPayload => ({
	root: templateNode("root", "flex"),
	slots: {
		children: {
			name: "children",
			label: "Children",
			hostPath: "root",
			defaultChildren: [
				text("label", labelClassName, "Tab"),
				templateNode("box", "[mask-type:alpha]", [
					text("inner", "[scrollbar-width:thin]", "Inner"),
				]),
			],
		},
	},
	variants: { axes: {}, compoundVariants: [] },
	overrideTargets: {},
});

/** Version 1's label default has a non-canonical class; version 2 fixed it. */
const tab: SystemComponentRecord = (() => {
	const v1 = publishedComponent("tab", payload("bg-[#FFF]"), {
		componentId: "cmp_tab",
		version: "1",
	});
	const v2 = publishedComponent("tab", payload("bg-white"), {
		componentId: "cmp_tab",
		version: "2",
	});
	return {
		...v2,
		published: {
			currentVersion: "2",
			versions: { ...v1.published?.versions, ...v2.published?.versions },
		},
	};
})();

let ids = 0;
const place = (version: string, instanceId: string): Node => {
	const published = tab.published?.versions[version];
	if (!published) throw new Error("no version");
	return expandResolvedSystemComponent(
		{
			systemId: CODEGEN_TEST_SYSTEM_ID,
			componentId: tab.componentId,
			record: tab,
			version: published,
		},
		{
			createInstanceId: () => instanceId,
			createElementId: () => {
				ids += 1;
				return `${instanceId}-${ids}`;
			},
		},
	).root;
};

const childrenOf = (node: Node) => node.children as Node[];
const withProps = (node: Node, props: Partial<Node["props"]>): Node => ({
	...node,
	props: { ...node.props, ...props },
});
const withChildren = (node: Node, children: Node["children"]): Node => ({
	...node,
	children,
});

const untouchedV1 = place("1", "untouched-v1");
const untouchedV2 = place("2", "untouched-v2");
// The designer gave the label its own text and name: classes unchanged.
const renamed = (() => {
	const root = place("1", "renamed");
	const [label, box] = childrenOf(root);
	return withChildren(root, [
		withChildren(withProps(label, { "data-trickroom-name": "First" }), "One"),
		box,
	]);
})();
// The designer edited the label's classes and the box's inner text's.
const edited = (() => {
	const root = place("1", "edited");
	const [label, box] = childrenOf(root);
	const [inner] = childrenOf(box);
	return withChildren(root, [
		withProps(label, { className: "bg-[#FFF] [scrollbar-width:auto]" }),
		withChildren(box, [
			withProps(inner, { className: "[mask-type:luminance]" }),
		]),
	]);
})();
// The designer edited the box's classes; its child is untouched.
const boxEdited = (() => {
	const root = place("1", "box-edited");
	const [label, box] = childrenOf(root);
	return withChildren(root, [
		label,
		withProps(box, { className: "[mask-type:luminance]" }),
	]);
})();
// An instance moved to version 2 keeps the copies version 1 placed.
const migrated = (() => {
	const root = place("2", "migrated");
	const [, box] = childrenOf(root);
	const [oldLabel] = childrenOf(place("1", "migrated-old"));
	return withChildren(root, [oldLabel, box]);
})();
// A layer the designer added before the copies, of the label's Element.
const added = (() => {
	const root = place("1", "added");
	const [label, box] = childrenOf(root);
	const extra = withProps(label, { className: "[mask-type:alpha] p-[3px]" });
	return withChildren(root, [{ ...extra, id: "added-extra" }, label, box]);
})();

const placed = {
	untouchedV1,
	untouchedV2,
	renamed,
	edited,
	boxEdited,
	migrated,
	added,
};

const design: TrickroomDesign = {
	name: "Tabs",
	systemId: CODEGEN_TEST_SYSTEM_ID,
	boards: [
		{
			id: "board",
			props: {
				"data-trickroom-name": "Board",
				"data-trickroom-library": "trickroom",
				"data-trickroom-component": "container",
			},
			children: Object.values(placed),
		},
	],
};

const CANONICAL: Record<string, string> = {
	"bg-[#FFF]": "bg-white",
	"[scrollbar-width:thin]": "scrollbar-thin",
	"[scrollbar-width:auto]": "scrollbar-auto",
	"[mask-type:alpha]": "mask-alpha",
	"[mask-type:luminance]": "mask-luminance",
	"p-[3px]": "p-[3px]",
};

// Scrollbar classes stand in for unknown utilities in the token checks.
const inspector: LintTailwindInspector = {
	inspect: (candidate) =>
		({
			supported: !candidate.includes("scrollbar"),
		}) as TailwindUtilityInspection,
	canonicalize: async (candidates) =>
		candidates.map((candidate) => ({
			canonical: CANONICAL[candidate] ?? candidate,
			verdict: { status: "equivalent" },
		})),
};

const components = { [tab.componentId]: tab };
const contract = buildSystemContract({
	system: { id: CODEGEN_TEST_SYSTEM_ID, name: "Core" },
	manifest: { ...createEmptySystemComponentManifest(), components },
	tokens: null,
	codegen: { status: "unconfigured" },
});

const contextFor = (ruleId: string): LintRuleContext => {
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
			components,
		}),
		tailwind: {
			inspector: async () => inspector,
			mergeConfig: async () => ({ status: "stock" }),
		},
	};
};

const describe_ = (findings: readonly LintRuleFinding[]) =>
	findings.map((finding) => {
		const component = finding.componentLocation;
		const location = finding.location;
		const where = component
			? `tab@${component.version} ${component.slot}/${component.path}`
			: location?.kind === "design"
				? `#${location.element}`
				: "-";
		return `${where}: ${finding.details?.classToken}`;
	});

describe("design class rules on slot default children", () => {
	it("reports a default child once on each version in use, and a copy only once edited", async () => {
		const findings = await designNonCanonicalClassRule.run(
			contextFor(designNonCanonicalClassRule.id),
		);
		const [editedLabel, editedBox] = childrenOf(edited);
		const [editedInner] = childrenOf(editedBox);
		const [migratedLabel] = childrenOf(migrated);
		expect(describe_(findings)).toEqual([
			// Version 1, in use by five instances, and the current version 2.
			"tab@1 children/label: bg-[#FFF]",
			"tab@1 children/box: [mask-type:alpha]",
			"tab@1 children/inner: [scrollbar-width:thin]",
			"tab@2 children/box: [mask-type:alpha]",
			"tab@2 children/inner: [scrollbar-width:thin]",
			// Edited copies: the instance's own classes, every one of them.
			`#${editedLabel.id}: bg-[#FFF]`,
			`#${editedLabel.id}: [scrollbar-width:auto]`,
			`#${editedInner.id}: [mask-type:luminance]`,
			`#${childrenOf(boxEdited)[1].id}: [mask-type:luminance]`,
			// A copy of version 1's label in a version 2 instance differs
			// from version 2's default.
			`#${migratedLabel.id}: bg-[#FFF]`,
			// A layer the designer added is not a copy; the copies after it
			// still are.
			"#added-extra: [mask-type:alpha]",
		]);
		expect(findings[0]).toMatchObject({
			component: "tab",
			location: null,
			componentLocation: {
				componentId: "cmp_tab",
				version: "1",
				slot: "children",
				path: "label",
			},
		});
	});

	it("marks unedited copies in the design index, edited ones as layers", () => {
		const index = buildLintDesignIndex({
			systemId: CODEGEN_TEST_SYSTEM_ID,
			designs: [{ id: "design-1", design }],
			components,
		});
		const sources = new Map(
			index.designs[0].boards[0].nodes.map((node) => [
				node.element,
				node.classSource,
			]),
		);
		const sourcesOf = (root: Node) => {
			const [label, box] = childrenOf(root);
			const [inner] = childrenOf(box);
			return [label, box, inner].map((node) => sources.get(node.id));
		};
		expect(sourcesOf(untouchedV1)).toEqual([
			"slot-default",
			"slot-default",
			"slot-default",
		]);
		expect(sourcesOf(renamed)).toEqual([
			"slot-default",
			"slot-default",
			"slot-default",
		]);
		// The box is unedited though its child was.
		expect(sourcesOf(edited)).toEqual(["layer", "slot-default", "layer"]);
		// An edited copy's children are still paired with its default's.
		expect(sourcesOf(boxEdited)).toEqual([
			"slot-default",
			"layer",
			"slot-default",
		]);
		expect(sources.get(untouchedV1.id)).toBe("override");
		expect(sources.get("added-extra")).toBe("layer");
	});

	it("checks the copies by their stored classes when the instance's version does not resolve", async () => {
		const index = buildLintDesignIndex({
			systemId: CODEGEN_TEST_SYSTEM_ID,
			designs: [{ id: "design-1", design }],
		});
		const [label] = childrenOf(untouchedV1);
		const node = index.designs[0].boards[0].nodes.find(
			(entry) => entry.element === label.id,
		);
		expect(node).toMatchObject({
			classSource: "layer",
			checkedClassName: "bg-[#FFF]",
		});
	});

	it("runs the token checks on slot defaults the same way", async () => {
		const findings = await designUnknownClassTokenRule.run(
			contextFor(designUnknownClassTokenRule.id),
		);
		const located = findings.map((finding) =>
			finding.componentLocation
				? `tab@${finding.componentLocation.version} ${finding.componentLocation.slot}/${finding.componentLocation.path}`
				: `#${finding.location?.kind === "design" ? finding.location.element : "-"}`,
		);
		const [editedLabel] = childrenOf(edited);
		expect(located).toEqual([
			"tab@1 children/inner",
			"tab@2 children/inner",
			`#${editedLabel.id}`,
		]);
	});
});
