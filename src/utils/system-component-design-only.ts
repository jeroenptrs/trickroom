import type { RecipeTemplateNode } from "../types";
import type { SystemComponentDraftPayload } from "./system-components";

/**
 * Design-only template nodes exist in the design but not in code. The flag is
 * inherited: a design-only node makes its whole subtree design-only.
 */

/**
 * The node without its design-only subtrees, or null when it is design-only
 * itself. Kept nodes lose an explicit `designOnly: false`, so it reads the same
 * as an absent flag, and lose `children` when every child was design-only, so
 * adding the first design-only child reads the same as having none.
 */
export function stripDesignOnlyNodes(
	node: RecipeTemplateNode,
): RecipeTemplateNode | null {
	if (node.designOnly === true) {
		return null;
	}
	const { designOnly: _designOnly, children, ...rest } = node;
	const kept = stripDesignOnlyChildren(children);
	return kept === undefined ? rest : { ...rest, children: kept };
}

/**
 * A child list without design-only subtrees. Undefined when the list was
 * absent or every child in it was design-only; an explicit empty list stays.
 */
export function stripDesignOnlyChildren(
	children: readonly RecipeTemplateNode[] | undefined,
): RecipeTemplateNode[] | undefined {
	if (!children) {
		return undefined;
	}
	const kept = children
		.map(stripDesignOnlyNodes)
		.filter((child): child is RecipeTemplateNode => child !== null);
	return kept.length === 0 && children.length > 0 ? undefined : kept;
}

/**
 * Every template path inside a design-only subtree, across the template and
 * slot default children. Default children of a slot hosted on a design-only
 * node inherit the flag, since they render inside that host.
 */
export function collectDesignOnlyPaths(
	payload: Pick<SystemComponentDraftPayload, "root" | "slots">,
): Set<string> {
	const paths = new Set<string>();
	const visit = (node: RecipeTemplateNode, inherited: boolean) => {
		const designOnly = inherited || node.designOnly === true;
		if (designOnly) {
			paths.add(node.path);
		}
		for (const child of node.children ?? []) {
			visit(child, designOnly);
		}
	};
	visit(payload.root, false);
	const hostPaths = new Set(paths);
	for (const slot of Object.values(payload.slots ?? {})) {
		for (const child of slot.defaultChildren ?? []) {
			visit(child, hostPaths.has(slot.hostPath));
		}
	}
	return paths;
}
