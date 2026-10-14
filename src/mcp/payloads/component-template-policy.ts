import { stableStringify } from "../../services/design-revision";
import type { RecipeTemplateNode } from "../../types";
import { normalizeSystemComponentTemplateParts } from "../../utils/system-component-manifest-service";
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
 * element an operation inserts, updates, moves or deletes, and a move's
 * target parent; it does not check the rest of the design.
 *
 * A component write is compared with the template it starts from, both
 * sides in the form the manifest stores them (its own normalisers, then a
 * key-sorted serialisation), node by node across the template's root tree
 * and every slot's default children. It is refused when it:
 *
 * - adds or removes a node of a disallowed component;
 * - changes a node of a disallowed component, or a node's component from or
 *   to one: its own fields, or its variant and compound classes (each with
 *   the condition it applies under);
 * - moves a node of a disallowed component, or moves any node into or
 *   within a parent of a disallowed component. Moves are what `moveElement`
 *   would have to do to turn the old template into the new one using
 *   allowed nodes only: a node that changes parent moves; under one parent,
 *   the nodes that were there before and still are keep their relative
 *   order unless something moved, and a disallowed node only counts as
 *   moved when the disallowed nodes' order among themselves changes (any
 *   other new order is reachable by moving allowed nodes around them).
 *   Inserting or removing an allowed sibling never moves anything. A slot's
 *   default children sit at the slot's placement (`hostPath` and
 *   `insertIndex`); changing it moves them to that host.
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
	/** Canonical own fields, children left out. */
	own: string;
	/** Canonical variant and compound classes, with their conditions. */
	classes: string;
	/** Key of the parent node, or of the slot for a slot's top nodes. */
	parentKey: string;
	/** Where it is, for messages: `the template` or `slot "content"`. */
	where: string;
	path: string;
};

type TemplateIndex = {
	nodes: Map<string, IndexedNode>;
	/** Child keys in order, per parent key (node or slot). */
	children: Map<string, string[]>;
	/** Per slot key: its canonical placement (host path and insert index). */
	slots: Map<string, { placement: string; hostKey: string }>;
};

/** A compound's `when`, canonical: sorted axes, sorted value lists. */
const canonicalWhen = (when: Record<string, string | string[]>) =>
	Object.fromEntries(
		Object.entries(when).map(([axis, value]) => [
			axis,
			Array.isArray(value) ? [...value].sort() : value,
		]),
	);

/** Per template path, every class string set on it with its condition. */
const classesByPathOf = (variants: ComponentTemplateParts["variants"]) => {
	const classes = new Map<string, string[]>();
	const add = (
		byPath: Record<string, string> | undefined,
		condition: Record<string, unknown>,
	) => {
		for (const [path, className] of Object.entries(byPath ?? {})) {
			const list = classes.get(path) ?? [];
			list.push(stableStringify({ ...condition, className }));
			classes.set(path, list);
		}
	};
	for (const [axis, entry] of Object.entries(variants?.axes ?? {})) {
		for (const [value, variant] of Object.entries(entry.values)) {
			add(variant.classesByPath, { axis, value });
		}
	}
	// By condition, not by position: reordering compounds changes nothing.
	for (const compound of variants?.compoundVariants ?? []) {
		add(compound.classesByPath, { when: canonicalWhen(compound.when) });
	}
	return classes;
};

const ROOT_TREE = "root\0";
const slotKey = (name: string) => `slot\0${name}`;

const indexTemplate = (raw: ComponentTemplateParts | undefined) => {
	const index: TemplateIndex = {
		nodes: new Map(),
		children: new Map(),
		slots: new Map(),
	};
	if (!raw) return index;
	const parts = normalizeSystemComponentTemplateParts(raw);
	const classes = classesByPathOf(parts.variants);
	const visit = (
		node: RecipeTemplateNode,
		prefix: string,
		where: string,
		parentKey: string,
	) => {
		const key = `${prefix}${node.path}`;
		const { children, ...own } = node;
		index.nodes.set(key, {
			library: node.library,
			component: node.component,
			own: stableStringify(own),
			classes: stableStringify([...(classes.get(node.path) ?? [])].sort()),
			parentKey,
			where,
			path: node.path,
		});
		const siblings = index.children.get(parentKey) ?? [];
		siblings.push(key);
		index.children.set(parentKey, siblings);
		for (const child of children ?? []) visit(child, prefix, where, key);
	};
	visit(parts.root, ROOT_TREE, "the template", ROOT_TREE);
	for (const [name, slot] of Object.entries(parts.slots ?? {})) {
		const key = slotKey(name);
		index.slots.set(key, {
			placement: stableStringify({
				hostPath: slot.hostPath,
				insertIndex: slot.insertIndex,
			}),
			hostKey: `${ROOT_TREE}${slot.hostPath}`,
		});
		for (const child of slot.defaultChildren ?? []) {
			visit(child, `${key}\0`, `slot "${name}"`, key);
		}
	}
	return index;
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

	// Added, changed, and moved to another parent.
	for (const [key, node] of next.nodes) {
		const old = previous.nodes.get(key);
		if (!old) {
			if (!allowed(node)) refuse(node, "adds");
			continue;
		}
		const changed = old.own !== node.own || old.classes !== node.classes;
		if (changed && !allowed(old)) refuse(old, "changes");
		if (changed && !allowed(node)) refuse(node, "changes");
		if (old.parentKey !== node.parentKey) {
			if (!allowed(node)) refuse(node, "moves");
			const parent = next.nodes.get(node.parentKey);
			if (parent && !allowed(parent)) refuse(parent, "moves a node into");
		}
	}
	// Removed.
	for (const [key, node] of previous.nodes) {
		if (!next.nodes.has(key) && !allowed(node)) refuse(node, "removes");
	}

	// Moved within a parent: the order of the nodes that stay under it.
	for (const [parentKey, childrenAfter] of next.children) {
		const childrenBefore = previous.children.get(parentKey);
		if (!childrenBefore) continue;
		const stays = (key: string, from: TemplateIndex, to: TemplateIndex) =>
			from.nodes.get(key)?.parentKey === parentKey &&
			to.nodes.get(key)?.parentKey === parentKey;
		const keptBefore = childrenBefore.filter((key) =>
			stays(key, previous, next),
		);
		const keptAfter = childrenAfter.filter((key) => stays(key, next, previous));
		if (stableStringify(keptBefore) === stableStringify(keptAfter)) continue;
		const parent = next.nodes.get(parentKey);
		if (parent && !allowed(parent)) refuse(parent, "reorders the children of");
		const disallowed = (keys: string[], index: TemplateIndex) =>
			keys.filter((key) => {
				const entry = index.nodes.get(key);
				return entry !== undefined && !allowed(entry);
			});
		const fixedBefore = disallowed(keptBefore, previous);
		const fixedAfter = disallowed(keptAfter, next);
		const moved = fixedAfter.find(
			(key, position) => fixedBefore[position] !== key,
		);
		if (moved) refuse(next.nodes.get(moved) as IndexedNode, "moves");
	}

	// A slot placed elsewhere moves its default children to the new host.
	for (const [key, slot] of next.slots) {
		const old = previous.slots.get(key);
		if (!old || old.placement === slot.placement) continue;
		const host = next.nodes.get(slot.hostKey);
		const moving = (next.children.get(key) ?? []).filter((child) =>
			previous.nodes.has(child),
		);
		if (moving.length === 0) continue;
		for (const child of moving) {
			const entry = next.nodes.get(child) as IndexedNode;
			if (!allowed(entry)) refuse(entry, "moves");
		}
		if (host && !allowed(host)) refuse(host, "moves a node into");
	}
};
