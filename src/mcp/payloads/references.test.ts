import { describe, expect, it } from "vitest";
import {
	getDefaultProps,
	resolveRegistryComponent,
} from "../../libraries/registry";
import type { Node as DesignNode } from "../../types";
import { type ValidationIssue, validateElementReferences } from "./references";

const createDefaultNode = (
	library: string,
	component: string,
	children: DesignNode["children"] = [],
): DesignNode => {
	const resolution = resolveRegistryComponent(library, component);
	if (resolution.status !== "known") {
		throw new Error(`Unknown registry component ${library}/${component}`);
	}
	return {
		id: `${component}-id`,
		props: getDefaultProps(library, component, resolution.definition),
		children,
	};
};

const validate = (node: DesignNode) => {
	const issues: ValidationIssue[] = [];
	validateElementReferences(node, "boards[0]", new Map(), issues, new Map());
	return issues;
};

describe("validateElementReferences", () => {
	it("accepts registry default props written on new instances", () => {
		for (const [component, prop] of [
			["menu.separator", "orientation"],
			["menu.trigger", "type"],
			["combobox.trigger", "type"],
			["drawer.trigger", "type"],
		] as const) {
			const node = createDefaultNode("base-ui", component);
			expect(node.props[prop]).toBeDefined();
			expect(validate(node)).toEqual([]);
		}
	});

	it("still rejects props the registry does not declare", () => {
		const node = createDefaultNode("base-ui", "menu.separator");
		node.props.type = "button";
		expect(validate(node)).toEqual([
			expect.objectContaining({
				code: "UNSUPPORTED_PROP",
				path: "boards[0].props.type",
			}),
		]);
	});
});
