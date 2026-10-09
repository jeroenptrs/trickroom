import { describe, expect, it } from "vitest";
import {
	getRenderableProps,
	MATERIALIZED_BASE_CLASS_PROP,
	resolveRegistryComponent,
} from "../libraries/registry";
import type { Props } from "../types";
import { createClassLayers } from "./class-layers";
import {
	classLayerTokenKey,
	createClassMerge,
	findClassesRemovedByMerge,
	isComponentClassTarget,
	mergeComponentClassName,
} from "./class-merge";
import {
	systemComponentIdProp,
	systemComponentInstanceProp,
	systemComponentPathProp,
	systemComponentSystemIdProp,
} from "./system-component-markers";
import type { TwMergeConfig } from "./tailwind-merge-config";

const stock = () => {
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

const componentProps = (
	className: string,
	extra: Record<string, string> = {},
): Props => ({
	"data-trickroom-name": "Button",
	"data-trickroom-library": "trickroom",
	"data-trickroom-component": "container",
	"data-trickroom-role": "branch",
	className,
	[systemComponentSystemIdProp]: "sys_core",
	[systemComponentIdProp]: "cmp_button",
	[systemComponentInstanceProp]: "inst_1",
	[systemComponentPathProp]: "root",
	...(extra as Partial<Props>),
});

const rawProps = (className: string): Props => ({
	"data-trickroom-name": "Frame",
	"data-trickroom-library": "trickroom",
	"data-trickroom-component": "container",
	"data-trickroom-role": "branch",
	className,
});

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
		// The merge group: its members are interchangeable.
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
		expect(createClassMerge({ mode: "derived", config: DERIVED })).not.toBe(
			createClassMerge({ mode: "stock" }),
		);
	});
});

describe("mergeComponentClassName", () => {
	it("merges the component's classes", () => {
		expect(
			mergeComponentClassName("flex gap-2 hidden", undefined, stock()),
		).toBe("gap-2 hidden");
		expect(mergeComponentClassName(undefined, undefined, stock())).toBe(
			undefined,
		);
	});

	it("leaves the registry Element's leading base classes out of the merge", () => {
		expect(
			mergeComponentClassName("h-px w-full w-4 h-2", "h-px w-full", stock()),
		).toBe("h-px w-full w-4 h-2");
		expect(
			mergeComponentClassName("h-px w-full p-4 p-2", "h-px w-full", stock()),
		).toBe("h-px w-full p-2");
		// Base classes that do not lead the string are merged with the rest.
		expect(mergeComponentClassName("w-4 w-full", "h-px w-full", stock())).toBe(
			"w-full",
		);
	});
});

describe("isComponentClassTarget", () => {
	it("is true for component instance nodes only", () => {
		expect(isComponentClassTarget(componentProps("flex"))).toBe(true);
		expect(isComponentClassTarget(rawProps("flex"))).toBe(false);
	});
});

describe("getRenderableProps with a class merge", () => {
	const container = resolveRegistryComponent("trickroom", "container");
	const separator = resolveRegistryComponent("base-ui", "separator");
	if (container.status !== "known" || separator.status !== "known") {
		throw new Error("registry components missing");
	}

	it("merges a component node's classes", () => {
		expect(
			getRenderableProps(
				componentProps("flex items-center hidden"),
				container.definition,
				stock(),
			).className,
		).toBe("items-center hidden");
	});

	it("keeps a raw element's className as written", () => {
		expect(
			getRenderableProps(rawProps("flex hidden"), container.definition, stock())
				.className,
		).toBe("flex hidden");
	});

	it("does not merge without a merge", () => {
		expect(
			getRenderableProps(componentProps("flex hidden"), container.definition)
				.className,
		).toBe("flex hidden");
		expect(
			getRenderableProps(
				componentProps("flex hidden"),
				container.definition,
				null,
			).className,
		).toBe("flex hidden");
	});

	it("keeps a materialized registry base ahead of the merged component classes", () => {
		const base = separator.definition.baseClassName ?? "";
		expect(base.length).toBeGreaterThan(0);
		const props = componentProps(`${base} my-2 my-4`, {
			"data-trickroom-library": "base-ui",
			"data-trickroom-component": "separator",
			"data-trickroom-role": "leaf",
			[MATERIALIZED_BASE_CLASS_PROP]: "true",
		});
		expect(
			getRenderableProps(props, separator.definition, stock()).className,
		).toBe(`${base} my-4`);
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
});
