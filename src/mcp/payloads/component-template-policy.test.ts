import { describe, expect, it } from "vitest";
import type { RecipeTemplateNode } from "../../types";
import type { McpPolicy } from "../governance";
import {
	assertTemplateChangesAllowed,
	type ComponentTemplateParts,
} from "./component-template-policy";

const policy = (allowed: string[] | null): McpPolicy => ({
	mode: "read-write",
	allowedDesignFileIds: null,
	allowedComponents: allowed ? new Set(allowed) : null,
	auditLog: false,
});

const node = (
	path: string,
	component: string,
	children?: RecipeTemplateNode[],
	extra: Partial<RecipeTemplateNode> = {},
): RecipeTemplateNode => ({
	path,
	library: "trickroom",
	component,
	...(children ? { children } : {}),
	...extra,
});

const parts = (
	root: RecipeTemplateNode,
	slotChildren?: RecipeTemplateNode[],
): ComponentTemplateParts => ({
	root,
	...(slotChildren
		? {
				slots: {
					content: {
						name: "content",
						hostPath: "root",
						defaultChildren: slotChildren,
					},
				},
			}
		: {}),
});

const containerOnly = policy(["trickroom/container"]);
const check =
	(
		before: ComponentTemplateParts | undefined,
		after: ComponentTemplateParts,
		which = containerOnly,
	) =>
	() =>
		assertTemplateChangesAllowed(which, before, after);

describe("assertTemplateChangesAllowed", () => {
	it("allows everything without an allowlist", () => {
		expect(
			check(undefined, parts(node("root", "text")), policy(null)),
		).not.toThrow();
	});

	it("allows a template identical to before, disallowed nodes included", () => {
		const template = parts(node("root", "container", [node("label", "text")]));
		expect(check(template, structuredClone(template))).not.toThrow();
	});

	it("refuses a node whose component changes to a disallowed one", () => {
		expect(
			check(
				parts(node("root", "container", [node("box", "container")])),
				parts(node("root", "container", [node("box", "text")])),
			),
		).toThrow(/trickroom\/text/);
	});

	it("refuses a node whose component changes away from a disallowed one", () => {
		expect(
			check(
				parts(node("root", "container", [node("box", "text")])),
				parts(node("root", "container", [node("box", "container")])),
			),
		).toThrow(/changes node "box"/);
	});

	it("refuses moving a node into a disallowed parent", () => {
		expect(
			check(
				parts(
					node("root", "container", [
						node("wrap", "text-host", []),
						node("box", "container"),
					]),
				),
				parts(
					node("root", "container", [
						node("wrap", "text-host", [node("box", "container")]),
					]),
				),
				policy(["trickroom/container"]),
			),
		).toThrow(/moves a node into node "wrap"/);
	});

	it("allows reordering allowed siblings around a disallowed one", () => {
		expect(
			check(
				parts(
					node("root", "container", [
						node("a", "container"),
						node("label", "text"),
						node("b", "container"),
					]),
				),
				parts(
					node("root", "container", [
						node("b", "container"),
						node("label", "text"),
						node("a", "container"),
					]),
				),
			),
		).not.toThrow();
	});

	it("checks slot default children like the template, removal included", () => {
		const root = node("root", "container");
		expect(check(parts(root), parts(root, [node("x", "text")]))).toThrow(
			/slot "content"/,
		);
		expect(check(parts(root, [node("x", "text")]), parts(root))).toThrow(
			/removes node "x" in slot "content"/,
		);
		expect(
			check(parts(root, [node("x", "text")]), parts(root, [node("x", "text")])),
		).not.toThrow();
	});

	describe("moves within a parent (review round 3)", () => {
		const row = (...children: RecipeTemplateNode[]) =>
			parts(node("root", "container", children));

		it("refuses swapping two disallowed siblings", () => {
			expect(
				check(
					row(node("t1", "text"), node("t2", "text")),
					row(node("t2", "text"), node("t1", "text")),
				),
			).toThrow(/moves node "t2"/);
		});

		it("allows moving an allowed sibling past a disallowed one", () => {
			expect(
				check(
					row(node("a", "container"), node("label", "text")),
					row(node("label", "text"), node("a", "container")),
				),
			).not.toThrow();
		});

		it("does not count a shift from inserting or removing an allowed sibling", () => {
			const before = row(node("label", "text"), node("t2", "text"));
			const inserted = row(
				node("new", "container"),
				node("label", "text"),
				node("t2", "text"),
			);
			expect(check(before, inserted)).not.toThrow();
			expect(check(inserted, before)).not.toThrow();
		});

		it("refuses reordering allowed children inside a disallowed parent", () => {
			const host = (...children: RecipeTemplateNode[]) =>
				parts(node("root", "container", [node("list", "text", children)]));
			expect(
				check(
					host(node("a", "container"), node("b", "container")),
					host(node("b", "container"), node("a", "container")),
				),
			).toThrow(/reorders the children of node "list"/);
		});
	});

	describe("slot placement (review round 3)", () => {
		const withSlot = (
			hostPath: string,
			children: RecipeTemplateNode[],
			insertIndex?: number,
		): ComponentTemplateParts => ({
			root: node("root", "container", [node("inner", "container")]),
			slots: {
				content: {
					name: "content",
					hostPath,
					...(insertIndex !== undefined ? { insertIndex } : {}),
					defaultChildren: children,
				},
			},
		});

		it("refuses moving a slot's disallowed default child with its host", () => {
			expect(
				check(
					withSlot("root", [node("x", "text")]),
					withSlot("inner", [node("x", "text")]),
				),
			).toThrow(/moves node "x" in slot "content"/);
			expect(
				check(
					withSlot("root", [node("x", "text")], 0),
					withSlot("root", [node("x", "text")], 1),
				),
			).toThrow(/moves node "x"/);
		});

		it("allows moving a slot of allowed default children to an allowed host", () => {
			expect(
				check(
					withSlot("root", [node("x", "container")]),
					withSlot("inner", [node("x", "container")]),
				),
			).not.toThrow();
		});
	});

	describe("compound conditions (review round 3)", () => {
		const withCompound = (
			compounds: { when: Record<string, string | string[]>; label: string }[],
		): ComponentTemplateParts => ({
			root: node("root", "container", [node("label", "text")]),
			variants: {
				axes: {
					tone: {
						label: "Tone",
						values: { plain: {}, brand: {} },
					},
					size: { label: "Size", values: { sm: {}, lg: {} } },
				},
				compoundVariants: compounds.map(({ when, label }) => ({
					when,
					classesByPath: { label },
				})),
			},
		});

		it("refuses moving a disallowed node's compound class to another condition", () => {
			expect(
				check(
					withCompound([{ when: { tone: "plain" }, label: "font-bold" }]),
					withCompound([{ when: { tone: "brand" }, label: "font-bold" }]),
				),
			).toThrow(/changes node "label"/);
		});

		it("allows reordering compounds and their condition values", () => {
			expect(
				check(
					withCompound([
						{ when: { tone: ["plain", "brand"], size: "sm" }, label: "a" },
						{ when: { tone: "brand" }, label: "b" },
					]),
					withCompound([
						{ when: { tone: "brand" }, label: "b" },
						{ when: { size: "sm", tone: ["brand", "plain"] }, label: "a" },
					]),
				),
			).not.toThrow();
		});
	});

	describe("canonical comparison (review round 3)", () => {
		it("ignores key order and what the manifest normalises", () => {
			const stored = parts(
				node("root", "container", [
					{
						path: "label",
						library: "trickroom",
						component: "text",
						name: "Label",
						text: "Hi",
						props: { as: "span" },
					},
				]),
			);
			const sent = parts(
				node("root", "container", [
					{
						props: { as: "span" },
						text: "Hi",
						name: " Label ",
						component: "text",
						library: "trickroom",
						path: "label",
					},
				]),
			);
			expect(check(stored, sent)).not.toThrow();
		});
	});
});
