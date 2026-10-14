import type { RecipeTemplateNode } from "../../types";
import type { SystemComponentDraftPayload } from "../../utils/system-components";
import {
	isComponentAllowed,
	type McpPolicy,
	McpPolicyError,
} from "../governance";

/**
 * `allowedComponents` for component writes, with the semantics `design_apply`
 * has: the allowlist governs what a write touches, never what a designer
 * already authored and the write leaves alone. `design_apply` checks every
 * element an operation inserts, every element it updates, moves or deletes,
 * and a move's new parent; it does not check the rest of the design. A
 * component write is compared with the template before it, node by node
 * (the template's root tree and every slot's default children), and refused
 * when it:
 *
 * - adds a node of a disallowed component,
 * - changes a node of a disallowed component (its own fields, its variant or
 *   compound classes) or changes a node's component from or to one,
 * - removes a node of a disallowed component,
 * - moves a node into a parent of a disallowed component (or moves a
 *   disallowed node).
 *
 * A write that leaves every disallowed node as it was (a variants-only
 * update of other nodes, a rename) is allowed.
 */

export type ComponentTemplateParts = Pick<
	SystemComponentDraftPayload,
	"root" | "slots" | "variants"
>;

type IndexedNode = {
	library: string;
	component: string;
	/** Own fields, children left out. */
	own: string;
	/** Key of the parent node; null for a tree's top nodes. */
	parentKey: string | null;
	/** Where it is, for messages: `root` or `slot "content"`. */
	where: string;
	path: string;
	/** The node's variant and compound classes. */
	classes: string;
};

const classesByPathOf = (variants: ComponentTemplateParts["variants"]) => {
	const classes = new Map<string, string[]>();
	const add = (byPath: Record<string, string> | undefined, label: string) => {
		for (const [path, className] of Object.entries(byPath ?? {})) {
			const list = classes.get(path) ?? [];
			list.push(`${label}=${className}`);
			classes.set(path, list);
		}
	};
	for (const [axis, entry] of Object.entries(variants?.axes ?? {})) {
		for (const [value, variant] of Object.entries(entry.values)) {
			add(variant.classesByPath, `${axis}:${value}`);
		}
	}
	(variants?.compoundVariants ?? []).forEach((compound, index) => {
		add(compound.classesByPath, `compound:${index}`);
	});
	return classes;
};

/** Every node of the template and of each slot's default children, by place. */
const indexTemplate = (parts: ComponentTemplateParts | undefined) => {
	const nodes = new Map<string, IndexedNode>();
	if (!parts) return nodes;
	const classes = classesByPathOf(parts.variants);
	const visit = (
		node: RecipeTemplateNode,
		prefix: string,
		where: string,
		parentKey: string | null,
	) => {
		const key = `${prefix}${node.path}`;
		const { children, ...own } = node;
		nodes.set(key, {
			library: node.library,
			component: node.component,
			own: JSON.stringify(own),
			parentKey,
			where,
			path: node.path,
			classes: JSON.stringify(classes.get(node.path) ?? []),
		});
		for (const child of children ?? []) visit(child, prefix, where, key);
	};
	visit(parts.root, "root\0", "the template", null);
	for (const [name, slot] of Object.entries(parts.slots ?? {})) {
		for (const child of slot.defaultChildren ?? []) {
			visit(child, `slot\0${name}\0`, `slot "${name}"`, null);
		}
	}
	return nodes;
};

const refuse = (
	node: Pick<IndexedNode, "library" | "component" | "path" | "where">,
	change: string,
) => {
	const ref = `${node.library}/${node.component}`;
	throw new McpPolicyError(
		"MCP_COMPONENT_NOT_ALLOWED",
		`MCP access to component "${ref}" is not allowed by project policy: this write ${change} node "${node.path}" in ${node.where}.`,
	);
};

/**
 * Refuses (`MCP_COMPONENT_NOT_ALLOWED`) a component write whose template
 * changes touch a disallowed component; see the module comment. `before`
 * is the template the write starts from (undefined for a new component).
 */
export const assertTemplateChangesAllowed = (
	policy: McpPolicy,
	before: ComponentTemplateParts | undefined,
	after: ComponentTemplateParts | undefined,
) => {
	if (policy.allowedComponents === null) return;
	const allowed = (node: Pick<IndexedNode, "library" | "component">) =>
		isComponentAllowed(policy, node.library, node.component);
	const previous = indexTemplate(before);
	const next = indexTemplate(after);
	for (const [key, node] of next) {
		const old = previous.get(key);
		if (!old) {
			if (!allowed(node)) refuse(node, "adds");
			continue;
		}
		const changed = old.own !== node.own || old.classes !== node.classes;
		if (changed && !allowed(old)) refuse(old, "changes");
		if (changed && !allowed(node)) refuse(node, "changes");
		if (old.parentKey !== node.parentKey) {
			if (!allowed(node)) refuse(node, "moves");
			const parent = node.parentKey ? next.get(node.parentKey) : undefined;
			if (parent && !allowed(parent)) refuse(parent, "moves a node into");
		}
	}
	for (const [key, node] of previous) {
		if (!next.has(key) && !allowed(node)) refuse(node, "removes");
	}
};
