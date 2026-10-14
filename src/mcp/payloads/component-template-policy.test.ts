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
});
