import { describe, expect, it } from "vitest";
import type { RecipeTemplateNode, TrickroomDesign } from "../types";
import {
	type ComponentAnchorTemplate,
	collectComponentNodePaths,
	componentTargetLocator,
	deriveComponentDetached,
	deriveDetachedWith,
	findComponentNode,
	hasPinnedVariants,
	matchesVariantConfiguration,
	normalizePinnedVariants,
	summarizeAnnotationCounts,
} from "./annotation-model";
import type { AnnotationStatus, AnnotationTarget } from "./annotations.types";

// root > (header > (title, icon), body)
const root: RecipeTemplateNode = {
	path: "root",
	library: "trickroom",
	component: "container",
	children: [
		{
			path: "header",
			library: "trickroom",
			component: "container",
			children: [
				{ path: "title", library: "trickroom", component: "text", text: "T" },
				{ path: "icon", library: "trickroom", component: "icon" },
			],
		},
		{ path: "body", library: "trickroom", component: "container" },
	],
};

const template: ComponentAnchorTemplate = {
	root,
	variants: {
		axes: {
			size: { values: { sm: {}, lg: {} } },
			tone: { values: { brand: {}, neutral: {} } },
		},
	},
};

const node = (
	nodePath: string,
	variants?: Record<string, string>,
): AnnotationTarget => ({
	kind: "componentNode",
	systemId: "sys",
	componentId: "cmp",
	nodePath,
	...(variants ? { variants } : {}),
});

describe("findComponentNode", () => {
	it("returns the node with its ancestors, root first", () => {
		const found = findComponentNode(root, "icon");
		expect(found?.node.path).toBe("icon");
		expect(found?.ancestors.map((entry) => entry.path)).toEqual([
			"root",
			"header",
		]);
	});

	it("finds the root with no ancestors", () => {
		const found = findComponentNode(root, "root");
		expect(found?.node).toBe(root);
		expect(found?.ancestors).toEqual([]);
	});

	it("returns null for a missing path", () => {
		expect(findComponentNode(root, "nope")).toBeNull();
		expect(findComponentNode(root, "")).toBeNull();
	});
});

describe("collectComponentNodePaths", () => {
	it("lists every path including the root", () => {
		expect([...collectComponentNodePaths(root)].sort()).toEqual([
			"body",
			"header",
			"icon",
			"root",
			"title",
		]);
	});

	it("handles a childless root", () => {
		const lone: RecipeTemplateNode = {
			path: "root",
			library: "trickroom",
			component: "container",
		};
		expect([...collectComponentNodePaths(lone)]).toEqual(["root"]);
	});
});

describe("hasPinnedVariants", () => {
	it("is true without a pin", () => {
		expect(hasPinnedVariants(undefined, template.variants)).toBe(true);
		expect(hasPinnedVariants({}, undefined)).toBe(true);
	});

	it("is true when every axis and value exists", () => {
		expect(
			hasPinnedVariants({ size: "lg", tone: "brand" }, template.variants),
		).toBe(true);
	});

	it("is false for an unknown axis or value", () => {
		expect(hasPinnedVariants({ shape: "round" }, template.variants)).toBe(
			false,
		);
		expect(hasPinnedVariants({ size: "xl" }, template.variants)).toBe(false);
		expect(
			hasPinnedVariants({ size: "lg", tone: "gone" }, template.variants),
		).toBe(false);
	});

	it("is false for a pin against a component without variants", () => {
		expect(hasPinnedVariants({ size: "lg" }, undefined)).toBe(false);
		expect(hasPinnedVariants({ size: "lg" }, null)).toBe(false);
	});

	it("does not match inherited properties as axes or values", () => {
		expect(hasPinnedVariants({ constructor: "x" }, template.variants)).toBe(
			false,
		);
		expect(hasPinnedVariants({ toString: "x" }, template.variants)).toBe(false);
		expect(hasPinnedVariants({ size: "constructor" }, template.variants)).toBe(
			false,
		);
		const pinned = JSON.parse('{"__proto__":"x"}') as Record<string, string>;
		expect(hasPinnedVariants(pinned, template.variants)).toBe(false);
	});
});

describe("componentTargetLocator and detached", () => {
	it("a present path is not detached", () => {
		expect(deriveComponentDetached(node("title"), template)).toBe(false);
		expect(deriveComponentDetached(node("root"), template)).toBe(false);
	});

	it("a missing path is detached", () => {
		expect(deriveComponentDetached(node("gone"), template)).toBe(true);
	});

	it("a pin to a removed value is detached; a valid pin is not", () => {
		expect(
			deriveComponentDetached(node("title", { size: "lg" }), template),
		).toBe(false);
		expect(
			deriveComponentDetached(node("title", { size: "xl" }), template),
		).toBe(true);
		expect(
			deriveComponentDetached(node("title", { shape: "round" }), template),
		).toBe(true);
	});

	it("is undefined for design targets", () => {
		expect(
			deriveComponentDetached({ kind: "design", designId: "d" }, template),
		).toBeUndefined();
	});

	it("deriveDetachedWith uses the locator's hasComponentNode", () => {
		const locator = componentTargetLocator(template);
		expect(deriveDetachedWith(node("body"), locator)).toBe(false);
		expect(deriveDetachedWith(node("gone"), locator)).toBe(true);
		expect(deriveDetachedWith(node("body", { tone: "x" }), locator)).toBe(true);
	});

	it("the component locator gives design targets sensible answers", () => {
		const locator = componentTargetLocator(template);
		expect(deriveDetachedWith({ kind: "design", designId: "d" }, locator)).toBe(
			false,
		);
		// A component has no boards or layers.
		expect(
			deriveDetachedWith(
				{ kind: "board", designId: "d", boardId: "b" },
				locator,
			),
		).toBe(true);
		expect(
			deriveDetachedWith(
				{ kind: "layer", designId: "d", boardId: "b", elementId: "e" },
				locator,
			),
		).toBe(true);
	});

	it("a locator without hasComponentNode leaves component nodes underived", () => {
		expect(
			deriveDetachedWith(node("x"), {
				boardOfLayer: () => null,
				hasBoard: () => false,
			}),
		).toBeUndefined();
	});
});

describe("matchesVariantConfiguration", () => {
	it("an unpinned annotation shows in every configuration", () => {
		expect(matchesVariantConfiguration(undefined, {})).toBe(true);
		expect(matchesVariantConfiguration(undefined, { size: "sm" })).toBe(true);
	});

	it("requires every pinned key to match exactly", () => {
		expect(
			matchesVariantConfiguration(
				{ size: "lg", tone: "brand" },
				{ size: "lg", tone: "brand" },
			),
		).toBe(true);
		expect(
			matchesVariantConfiguration(
				{ size: "lg", tone: "brand" },
				{ size: "lg", tone: "neutral" },
			),
		).toBe(false);
	});

	it("ignores extra keys in view", () => {
		expect(
			matchesVariantConfiguration(
				{ size: "lg" },
				{ size: "lg", tone: "brand", shape: "round" },
			),
		).toBe(true);
	});

	it("fails when a pinned key is missing from view", () => {
		expect(matchesVariantConfiguration({ size: "lg" }, {})).toBe(false);
		expect(matchesVariantConfiguration({ size: "lg" }, { tone: "brand" })).toBe(
			false,
		);
		expect(
			matchesVariantConfiguration({ size: "lg" }, { size: undefined }),
		).toBe(false);
	});

	it("does not take a pinned __proto__ key from the prototype", () => {
		const pinned = JSON.parse('{"__proto__":"x"}') as Record<string, string>;
		expect(matchesVariantConfiguration(pinned, {})).toBe(false);
		const inView = JSON.parse('{"__proto__":"x"}') as Record<string, string>;
		expect(matchesVariantConfiguration(pinned, inView)).toBe(true);
	});

	it("an inherited key like constructor does not count as in view", () => {
		expect(matchesVariantConfiguration({ constructor: "x" }, {})).toBe(false);
	});
});

describe("normalizePinnedVariants", () => {
	it("returns null for nothing or an empty pin", () => {
		expect(normalizePinnedVariants(undefined)).toBeNull();
		expect(normalizePinnedVariants(null)).toBeNull();
		expect(normalizePinnedVariants({})).toBeNull();
	});

	it("drops empty values and axes, and returns null when nothing is left", () => {
		expect(normalizePinnedVariants({ size: "" })).toBeNull();
		expect(normalizePinnedVariants({ "": "lg" })).toBeNull();
		expect(normalizePinnedVariants({ size: "lg", tone: "" })).toEqual({
			size: "lg",
		});
	});

	it("sorts keys", () => {
		const result = normalizePinnedVariants({ tone: "brand", size: "lg" });
		expect(Object.keys(result ?? {})).toEqual(["size", "tone"]);
	});

	it("keeps a __proto__ key as an own property", () => {
		const pinned = JSON.parse('{"__proto__":"x","size":"lg"}') as Record<
			string,
			string
		>;
		const result = normalizePinnedVariants(pinned);
		expect(result && Object.hasOwn(result, "__proto__")).toBe(true);
		expect(result && Object.getPrototypeOf(result)).toBe(Object.prototype);
	});
});

describe("summarizeAnnotationCounts with a component template", () => {
	const item = (
		target: AnnotationTarget,
		status: AnnotationStatus = "open",
	) => ({ target, status });

	it("counts component nodes per template path, detached included", () => {
		const summary = summarizeAnnotationCounts(
			[
				item(node("title")),
				item(node("title"), "addressed"),
				item(node("body"), "needs_input"),
				item(node("gone")),
				item(node("title", { size: "xl" })),
				item(node("title"), "resolved"),
			],
			null,
			template,
		);
		expect(summary.total.live).toBe(5);
		expect(summary.total.byStatus.resolved).toBe(1);
		expect(summary.total.detached).toBe(2);
		expect(summary.layers.title?.live).toBe(3);
		expect(summary.layers.title?.detached).toBe(1);
		expect(summary.layers.title?.agentWork).toBe(2);
		expect(summary.layers.title?.humanWork).toBe(1);
		expect(summary.layers.body?.humanWork).toBe(1);
		expect(summary.layers.gone?.detached).toBe(1);
		expect(summary.boards).toEqual({});
		expect(summary.design.live).toBe(0);
	});

	it("does not derive detached without a template", () => {
		const summary = summarizeAnnotationCounts([item(node("gone"))]);
		expect(summary.total.detached).toBe(0);
		expect(summary.layers.gone?.live).toBe(1);
	});

	it("a design wins over a component template when both are passed", () => {
		const design: TrickroomDesign = { name: "D", boards: [] };
		const summary = summarizeAnnotationCounts(
			[item(node("title"))],
			design,
			template,
		);
		// The design locator has no component node lookup.
		expect(summary.total.detached).toBe(0);
	});

	it("keys layers safely for __proto__ paths", () => {
		const summary = summarizeAnnotationCounts(
			[item(node("__proto__"))],
			null,
			template,
		);
		expect(summary.layers.__proto__?.live).toBe(1);
		expect(summary.layers.__proto__?.detached).toBe(1);
	});
});
