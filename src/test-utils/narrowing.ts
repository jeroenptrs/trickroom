/**
 * Test-only narrowing helpers. Each one throws with a readable message when a
 * fixture does not have the expected shape, so a test fails at the broken
 * assumption instead of on a later `undefined` access.
 */
import {
	type RegistryResolution,
	resolveRegistryComponent,
} from "../libraries/registry";
import type { Node } from "../types";

export type KnownRegistryResolution = Extract<
	RegistryResolution,
	{ status: "known" }
>;

export function assertKnownResolution(
	resolution: RegistryResolution,
): asserts resolution is KnownRegistryResolution {
	if (resolution.status !== "known") {
		throw new Error(
			`Expected ${resolution.library}/${resolution.component} to resolve, got ${resolution.status}`,
		);
	}
}

export function knownRegistryDefinition(
	library: string,
	component: string,
): KnownRegistryResolution["definition"] {
	const resolution = resolveRegistryComponent(library, component);
	assertKnownResolution(resolution);
	return resolution.definition;
}

/** The child nodes of an element node; throws for text nodes. */
export function elementChildren(node: Node | null | undefined): Node[] {
	if (!node) {
		throw new Error("Expected an element node, got undefined");
	}
	if (typeof node.children === "string") {
		throw new Error(`Expected ${node.id} to have child nodes, got text`);
	}
	return node.children;
}

/** The node at `path` (child indexes) below `root`. */
export function elementNodeAt(
	root: Node | null | undefined,
	...path: number[]
): Node {
	let node: Node | null | undefined = root;
	for (const index of path) {
		node = elementChildren(node)[index];
	}
	if (!node) {
		throw new Error(`Expected a node at [${path.join(", ")}]`);
	}
	return node;
}
