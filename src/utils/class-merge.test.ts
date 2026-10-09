import { describe, expect, it } from "vitest";
import {
	getRenderableProps,
	MATERIALIZED_BASE_CLASS_PROP,
	resolveRegistryComponent,
} from "../libraries/registry";
import type { Node, Props } from "../types";
import { createClassLayers } from "./class-layers";
import {
	buildComponentClassTable,
	type ClassMerge,
	type ComponentClassSource,
	type ComponentClassVersion,
	classLayerTokenKey,
	collectInstanceRootMarkers,
	createClassMerge,
	findClassesRemovedByMerge,
	type InstanceRootMarkers,
	isComponentClassTarget,
	mergeComponentClasses,
	resolveRenderedComponentClassName,
	toComponentClassSource,
} from "./class-merge";
import {
	systemComponentIdProp,
	systemComponentInstanceProp,
	systemComponentOverridesProp,
	systemComponentPathProp,
	systemComponentRootProp,
	systemComponentSystemIdProp,
	systemComponentVariantValuesProp,
	systemComponentVersionProp,
} from "./system-component-markers";
import type { SystemComponentRecord } from "./system-components";
import type { TwMergeConfig } from "./tailwind-merge-config";

const stock = (): ClassMerge => {
	const merge = createClassMerge({ mode: "stock" });
	if (!merge) throw new Error("stock settings must merge");
	return merge;
};

// What deriveTwMergeConfig makes of a typography family with private
// properties, declared interchangeable in a merge group.
const DERIVED: TwMergeConfig = {
	extend: {
		theme: { color: ["royal-9"] },
		classGroups: {
			"mergeGroups.typography": ["text-label-sm", "text-title-lg"],
		},
		conflictingClassGroups: { "mergeGroups.typography": ["font-size"] },
	},
};

const separator = resolveRegistryComponent("base-ui", "separator");
const container = resolveRegistryComponent("trickroom", "container");
if (separator.status !== "known" || container.status !== "known") {
	throw new Error("registry components missing");
}
const SEPARATOR_BASE = separator.definition.baseClassName ?? "";

/** A card: root with size and tone axes and a compound, and a separator. */
const CARD: ComponentClassVersion = {
	root: {
		path: "root",
		library: "trickroom",
		component: "container",
		className: "flex items-center p-4",
		children: [
			{
				path: "rule",
				library: "base-ui",
				component: "separator",
				className: "data-[orientation=horizontal]:w-8",
			},
		],
	},
	variants: {
		axes: {
			size: {
				label: "Size",
				defaultValue: "md",
				values: {
					md: {},
					sm: { classesByPath: { root: "p-2" } },
				},
			},
			tone: {
				label: "Tone",
				defaultValue: "plain",
				values: {
					plain: {},
					loud: { classesByPath: { root: "bg-red-500 p-3" } },
				},
			},
		},
		compoundVariants: [
			{ when: { size: "sm", tone: "loud" }, classesByPath: { root: "p-1" } },
		],
	},
	overrideTargets: {
		root: {
			targetId: "root",
			label: "Card",
			path: "root",
			capabilities: ["className"],
		},
		rule: {
			targetId: "rule",
			label: "Rule",
			path: "rule",
			capabilities: ["className"],
		},
	},
};

const source = (merge: ClassMerge = stock()): ComponentClassSource => ({
	systemId: "sys_core",
	merge,
	components: { cmp_card: { "1": CARD } },
});

const nodeProps = (
	path: string,
	className: string,
	extra: Record<string, string> = {},
): Props =>
	({
		"data-trickroom-name": path,
		"data-trickroom-library": "trickroom",
		"data-trickroom-component": "container",
		"data-trickroom-role": "branch",
		className,
		[systemComponentSystemIdProp]: "sys_core",
		[systemComponentIdProp]: "cmp_card",
		[systemComponentInstanceProp]: "inst_1",
		[systemComponentVersionProp]: "1",
		[systemComponentPathProp]: path,
		...extra,
	}) as Props;

const separatorProps = (
	className: string,
	extra: Record<string, string> = {},
) =>
	nodeProps("rule", className, {
		"data-trickroom-library": "base-ui",
		"data-trickroom-component": "separator",
		"data-trickroom-role": "leaf",
		...extra,
	});

const root = (
	variantValues: Record<string, string> = {},
	overrides: Record<string, { className: string }> = {},
): InstanceRootMarkers => ({
	variantValues: JSON.stringify(variantValues),
	overrides: JSON.stringify(overrides),
});

const rawProps = (className: string): Props => ({
	"data-trickroom-name": "Frame",
	"data-trickroom-library": "trickroom",
	"data-trickroom-component": "container",
	"data-trickroom-role": "branch",
	className,
});

const WIDE_RULE = {
	rule: { className: "data-[orientation=horizontal]:w-full" },
};

describe("createClassMerge", () => {
	it("does not merge without settings or in mode none", () => {
		expect(createClassMerge(null)).toBeNull();
		expect(createClassMerge(undefined)).toBeNull();
		expect(createClassMerge({ mode: "none" })).toBeNull();
		expect(createClassMerge({ mode: "none", error: "broken" })).toBeNull();
	});

	it("merges with stock tailwind-merge: the later class wins", () => {
		const merge = stock();
		expect(merge("flex hidden")).toBe("hidden");
		expect(merge("p-4 px-2 p-2")).toBe("p-2");
		expect(merge("hidden sm:flex")).toBe("hidden sm:flex");
	});

	it("keeps an !important class next to the class it overrides, so it still wins", () => {
		const merge = stock();
		expect(merge("flex !hidden")).toBe("flex !hidden");
		expect(merge("relative !absolute")).toBe("relative !absolute");
		expect(merge("flex hidden!")).toBe("flex hidden!");
		// The workarounds designs use today render as before.
		expect(merge("flex max-sm:hidden")).toBe("flex max-sm:hidden");
	});

	it("merges with the derived config, merge groups included, where stock differs", () => {
		const derived = createClassMerge({ mode: "derived", config: DERIVED });
		if (!derived) throw new Error("derived settings must merge");
		// Stock takes any text-* for a colour and keeps only the last.
		expect(stock()("text-label-sm text-royal-9")).toBe("text-royal-9");
		expect(derived("text-label-sm text-royal-9")).toBe(
			"text-label-sm text-royal-9",
		);
		expect(derived("text-label-sm text-title-lg")).toBe("text-title-lg");
		expect(derived("text-title-lg text-label-sm")).toBe("text-label-sm");
		expect(derived("text-[13px] text-title-lg")).toBe("text-title-lg");
	});

	it("returns one merge per config object", () => {
		expect(createClassMerge({ mode: "stock" })).toBe(
			createClassMerge({ mode: "stock" }),
		);
		expect(createClassMerge({ mode: "derived", config: DERIVED })).toBe(
			createClassMerge({ mode: "derived", config: DERIVED }),
		);
	});
});

describe("mergeComponentClasses", () => {
	it("merges the component classes, then the override over them", () => {
		expect(
			mergeComponentClasses("flex gap-2 p-4 p-2", undefined, stock()),
		).toBe("flex gap-2 p-2");
		expect(mergeComponentClasses("flex gap-2", "hidden", stock())).toBe(
			"gap-2 hidden",
		);
		expect(mergeComponentClasses("", "hidden", stock())).toBe("hidden");
		expect(mergeComponentClasses("", undefined, stock())).toBe("");
	});

	it("merges in two passes, like twMerge(variants(…), className)", () => {
		// x is removed by y in the component pass; the override removes y but
		// does not conflict with x. One pass over all three would keep x.
		const merge: ClassMerge = (className) =>
			({ "x y": "y", "y z": "z", "x y z": "x z" })[className] ?? className;
		expect(mergeComponentClasses("x y", "z", merge)).toBe("z");
		expect(merge("x y z")).toBe("x z");
	});
});

describe("isComponentClassTarget", () => {
	it("is true for component instance nodes only", () => {
		expect(isComponentClassTarget(nodeProps("root", "flex"))).toBe(true);
		expect(isComponentClassTarget(rawProps("flex"))).toBe(false);
	});
});

describe("resolveRenderedComponentClassName", () => {
	it("resolves template, selected variants and compounds in codegen order, then the override", () => {
		const props = nodeProps("root", "stored classes are ignored");
		expect(
			resolveRenderedComponentClassName(props, undefined, source(), root()),
		).toBe("flex items-center p-4");
		expect(
			resolveRenderedComponentClassName(
				props,
				undefined,
				source(),
				root({ size: "sm", tone: "loud" }),
			),
		).toBe("flex items-center bg-red-500 p-1");
		expect(
			resolveRenderedComponentClassName(
				props,
				undefined,
				source(),
				root({ size: "sm" }, { root: { className: "hidden p-6" } }),
			),
		).toBe("items-center hidden p-6");
	});

	it("merges the registry Element's base classes as the lowest layer", () => {
		const render = (overrides?: Record<string, { className: string }>) =>
			resolveRenderedComponentClassName(
				separatorProps(""),
				SEPARATOR_BASE,
				source(),
				root({}, overrides),
			);
		const VERTICAL =
			"data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch";
		// The template's w-8 replaces the base w-full; the base classes it does
		// not conflict with stay, ahead of the rest.
		expect(render()).toBe(
			`${VERTICAL} data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-8`,
		);
		// An override equal to a base class still beats the template's w-8.
		expect(render(WIDE_RULE)).toBe(
			`${VERTICAL} data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full`,
		);
		// An override replaces the base class it conflicts with, as in a
		// wrapper that merges the Element's defaults: no `!` needed.
		expect(
			render({
				rule: {
					className:
						"data-[orientation=horizontal]:w-[calc(100%+1.5rem)] data-[orientation=horizontal]:h-0.5",
				},
			}),
		).toBe(
			`${VERTICAL} data-[orientation=horizontal]:w-[calc(100%+1.5rem)] data-[orientation=horizontal]:h-0.5`,
		);
	});

	it("lets a component class replace a base class it conflicts with", () => {
		const table = {
			cmp_card: {
				"1": {
					...CARD,
					root: {
						...CARD.root,
						children: [
							{
								path: "rule",
								library: "base-ui",
								component: "separator",
								className: "data-[orientation=vertical]:self-center",
							},
						],
					},
				},
			},
		};
		expect(
			resolveRenderedComponentClassName(
				separatorProps(""),
				SEPARATOR_BASE,
				{ ...source(), components: table },
				root(),
			),
		).toBe(
			"data-[orientation=vertical]:w-px data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:self-center",
		);
	});

	it("ignores a variant value the version does not have", () => {
		expect(
			resolveRenderedComponentClassName(
				nodeProps("root", ""),
				undefined,
				source(),
				root({ size: "xl" }),
			),
		).toBe("flex items-center p-4");
	});

	it("is null when it cannot resolve, so the stored className renders", () => {
		expect(
			resolveRenderedComponentClassName(
				nodeProps("root", "flex hidden"),
				undefined,
				source(),
				null,
			),
		).toBeNull();
		expect(
			resolveRenderedComponentClassName(
				nodeProps("root", "", { [systemComponentVersionProp]: "9" }),
				undefined,
				source(),
				root(),
			),
		).toBeNull();
		expect(
			resolveRenderedComponentClassName(
				nodeProps("root", "", { [systemComponentSystemIdProp]: "sys_other" }),
				undefined,
				source(),
				root(),
			),
		).toBeNull();
	});
});

describe("getRenderableProps with component classes", () => {
	it("renders a component node's resolved, merged classes", () => {
		expect(
			getRenderableProps(
				nodeProps("root", "flex items-center p-4"),
				container.definition,
				{ source: source(), root: root({}, { root: { className: "hidden" } }) },
			).className,
		).toBe("items-center p-4 hidden");
	});

	it("keeps a raw element's className as written", () => {
		expect(
			getRenderableProps(rawProps("flex hidden"), container.definition, {
				source: source(),
				root: null,
			}).className,
		).toBe("flex hidden");
	});

	it("renders the stored className without a source or when it cannot resolve", () => {
		const props = nodeProps("root", "flex hidden");
		expect(getRenderableProps(props, container.definition).className).toBe(
			"flex hidden",
		);
		expect(
			getRenderableProps(props, container.definition, {
				source: source(),
				root: null,
			}).className,
		).toBe("flex hidden");
	});

	it("renders the separator override that materialization strips from the stored className", () => {
		// The override equals a base token, so the stored string lost it.
		const stored = separatorProps(
			`${SEPARATOR_BASE} data-[orientation=horizontal]:w-8`,
			{ [MATERIALIZED_BASE_CLASS_PROP]: "true" },
		);
		// Rendered as stored, the override is gone and the template's w-8 is last.
		expect(getRenderableProps(stored, separator.definition).className).toBe(
			`${SEPARATOR_BASE} data-[orientation=horizontal]:w-8`,
		);
		expect(
			getRenderableProps(stored, separator.definition, {
				source: source(),
				root: root({}, WIDE_RULE),
			}).className,
		).toBe(
			"data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full",
		);
	});

	it("keeps a raw element's base classes and className unmerged", () => {
		const props = {
			...rawProps("data-[orientation=horizontal]:w-8"),
			"data-trickroom-library": "base-ui",
			"data-trickroom-component": "separator",
		};
		expect(
			getRenderableProps(props, separator.definition, {
				source: source(),
				root: null,
			}).className,
		).toBe(`${SEPARATOR_BASE} data-[orientation=horizontal]:w-8`);
	});
});

describe("component class sources", () => {
	it("builds a table of every published version and the draft", () => {
		const record = {
			componentId: "cmp_card",
			slug: "card",
			name: "Card",
			createdAt: "",
			updatedAt: "",
			draft: { root: { ...CARD.root, props: { "data-x": "1" } } },
			published: {
				currentVersion: "1",
				versions: {
					"1": {
						...CARD,
						version: "1",
						publishedAt: "",
						templateHash: "",
						variantSchemaHash: "",
					},
				},
			},
		} as unknown as SystemComponentRecord;
		const table = buildComponentClassTable({
			components: { cmp_card: record },
		});
		expect(Object.keys(table.cmp_card).sort()).toEqual(["1", "draft"]);
		expect(table.cmp_card["1"].variants).toEqual(CARD.variants);
		// Only what class resolution reads.
		expect(table.cmp_card.draft.root).not.toHaveProperty("props");
	});

	it("is null without merging or components", () => {
		expect(toComponentClassSource({ mode: "none" })).toBeNull();
		expect(toComponentClassSource({ mode: "stock" })).toBeNull();
		expect(
			toComponentClassSource({
				mode: "stock",
				components: { systemId: "sys_core", table: {} },
			}),
		).toMatchObject({ systemId: "sys_core", components: {} });
	});

	it("collects instance root markers by instance id", () => {
		const tree: Node = {
			id: "card",
			props: nodeProps("root", "", {
				[systemComponentRootProp]: "true",
				[systemComponentVariantValuesProp]: '{"size":"sm"}',
				[systemComponentOverridesProp]: "{}",
			}),
			children: [{ id: "rule", props: nodeProps("rule", ""), children: [] }],
		};
		expect(collectInstanceRootMarkers([tree])).toEqual(
			new Map([
				["inst_1", { variantValues: '{"size":"sm"}', overrides: "{}" }],
			]),
		);
	});
});

describe("findClassesRemovedByMerge", () => {
	it("lists the merged layers' tokens that merging removes", () => {
		const layers = createClassLayers([
			{ source: "registry-base", className: "block" },
			{ source: "system-template", className: "flex p-4 gap-2" },
			{
				source: "system-variant",
				className: "p-2",
				metadata: { axis: "size", value: "sm" },
			},
			{ source: "system-compound-variant", className: "gap-2" },
			{ source: "instance-override", className: "hidden !absolute" },
		]);
		expect([...findClassesRemovedByMerge(layers, stock())].sort()).toEqual(
			[
				classLayerTokenKey(0, 0), // the base block, by flex
				classLayerTokenKey(1, 0), // flex, by hidden
				classLayerTokenKey(1, 1), // p-4, by p-2
				classLayerTokenKey(1, 2), // gap-2, by the compound's gap-2
			].sort(),
		);
	});

	it("never lists tokens of layers code does not merge", () => {
		const layers = createClassLayers([
			{ source: "registry-base", className: "flex" },
			{ source: "authored", className: "flex hidden" },
			{ source: "materialized-snapshot", className: "p-2 p-4" },
		]);
		expect(findClassesRemovedByMerge(layers, stock()).size).toBe(0);
	});

	it("keeps repeated unknown classes, which tailwind-merge keeps", () => {
		const layers = createClassLayers([
			{ source: "system-template", className: "card card p-2" },
			{ source: "instance-override", className: "card p-4" },
		]);
		expect([...findClassesRemovedByMerge(layers, stock())]).toEqual([
			classLayerTokenKey(0, 2),
		]);
	});

	it("merges the override over what the component layers kept", () => {
		const merge: ClassMerge = (className) =>
			({ "x y": "y", "y z": "z", "x y z": "x z" })[className] ?? className;
		const layers = createClassLayers([
			{ source: "system-template", className: "x y" },
			{ source: "instance-override", className: "z" },
		]);
		expect([...findClassesRemovedByMerge(layers, merge)].sort()).toEqual([
			classLayerTokenKey(0, 0),
			classLayerTokenKey(0, 1),
		]);
	});

	it("strikes the Element base class an instance's override beats", () => {
		const layers = createClassLayers([
			{
				source: "registry-base",
				className:
					"data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full",
			},
			{
				source: "instance-override",
				className: "data-[orientation=horizontal]:w-[calc(100%+1.5rem)]",
			},
		]);
		expect([...findClassesRemovedByMerge(layers, stock())]).toEqual([
			classLayerTokenKey(0, 1),
		]);
	});

	it("strikes the template class the separator override beats", () => {
		const layers = createClassLayers([
			{
				source: "system-template",
				className: "data-[orientation=horizontal]:w-8",
			},
			{
				source: "instance-override",
				className: "data-[orientation=horizontal]:w-full",
			},
		]);
		expect([...findClassesRemovedByMerge(layers, stock())]).toEqual([
			classLayerTokenKey(0, 0),
		]);
	});
});
