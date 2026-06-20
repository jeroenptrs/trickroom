import type { SystemComponentSummary } from "../queries/system-components";

/**
 * Component groups are free-form, slash-delimited folder paths (e.g.
 * "atoms/typography"). A single flat group like "Inputs" is just a one-segment
 * path, so existing data keeps working without migration — slashes were always
 * legal in the stored string; this module is what finally interprets them.
 */

/** Splits a `group` string into normalized, non-empty folder segments. */
export function parseGroupPath(group: string | null | undefined): string[] {
	if (!group) {
		return [];
	}
	return group
		.replaceAll("\\", "/")
		.split("/")
		.map((segment) => segment.trim())
		.filter((segment) => segment.length > 0);
}

/** Re-joins folder segments into a canonical `group` string. */
export function formatGroupPath(segments: readonly string[]): string {
	return segments.join("/");
}

export type ComponentGroupTreeNode = {
	/** Full slash path to this folder, e.g. "atoms/typography". */
	path: string;
	/** Final path segment / display label, e.g. "typography". */
	segment: string;
	/** Nested folders, sorted alphabetically by segment. */
	folders: ComponentGroupTreeNode[];
	/** Components living directly in this folder, sorted by order then name. */
	components: SystemComponentSummary[];
};

export type ComponentGroupTree = {
	/** Top-level folders. */
	folders: ComponentGroupTreeNode[];
	/** Components with no group, living at the root alongside the folders. */
	ungrouped: SystemComponentSummary[];
};

/** Flat (path, components) section, depth-first with ungrouped last. */
export type ComponentGroupSection = {
	/** Full folder path, or "" for the ungrouped root bucket. */
	path: string;
	components: SystemComponentSummary[];
};

type MutableNode = {
	path: string;
	segment: string;
	folders: Map<string, MutableNode>;
	components: SystemComponentSummary[];
};

function sortComponents(
	components: readonly SystemComponentSummary[],
): SystemComponentSummary[] {
	return [...components].sort((left, right) => {
		const orderDelta =
			(left.order ?? Number.MAX_SAFE_INTEGER) -
			(right.order ?? Number.MAX_SAFE_INTEGER);
		if (orderDelta !== 0) {
			return orderDelta;
		}
		return left.name.localeCompare(right.name);
	});
}

/**
 * Builds a folder tree from each component's parsed group path. Folders are
 * derived from the data (not stored entities), so an empty folder cannot exist
 * and renaming a folder means rewriting the `group` prefix on its members.
 */
export function buildComponentGroupTree(
	components: readonly SystemComponentSummary[],
): ComponentGroupTree {
	const rootFolders = new Map<string, MutableNode>();
	const ungrouped: SystemComponentSummary[] = [];

	for (const component of components) {
		const segments = parseGroupPath(component.group);
		if (segments.length === 0) {
			ungrouped.push(component);
			continue;
		}

		let level = rootFolders;
		let node: MutableNode | undefined;
		const pathParts: string[] = [];
		for (const segment of segments) {
			pathParts.push(segment);
			const existing = level.get(segment);
			node = existing ?? {
				path: pathParts.join("/"),
				segment,
				folders: new Map(),
				components: [],
			};
			if (!existing) {
				level.set(segment, node);
			}
			level = node.folders;
		}
		node?.components.push(component);
	}

	const finalize = (
		level: Map<string, MutableNode>,
	): ComponentGroupTreeNode[] =>
		[...level.values()]
			.sort((left, right) => left.segment.localeCompare(right.segment))
			.map((node) => ({
				path: node.path,
				segment: node.segment,
				folders: finalize(node.folders),
				components: sortComponents(node.components),
			}));

	return {
		folders: finalize(rootFolders),
		ungrouped: sortComponents(ungrouped),
	};
}

/** Every folder path in the tree (depth-first), for expand/collapse bookkeeping. */
export function collectGroupFolderPaths(tree: ComponentGroupTree): string[] {
	const paths: string[] = [];
	const walk = (nodes: readonly ComponentGroupTreeNode[]) => {
		for (const node of nodes) {
			paths.push(node.path);
			walk(node.folders);
		}
	};
	walk(tree.folders);
	return paths;
}

/**
 * Flattens the tree into ordered sections — one per folder that holds direct
 * components, depth-first, with the ungrouped bucket last. Used by search-first
 * surfaces (the command menu) that browse by label rather than by nesting.
 */
export function flattenComponentGroupSections(
	tree: ComponentGroupTree,
): ComponentGroupSection[] {
	const sections: ComponentGroupSection[] = [];
	const walk = (nodes: readonly ComponentGroupTreeNode[]) => {
		for (const node of nodes) {
			if (node.components.length > 0) {
				sections.push({ path: node.path, components: node.components });
			}
			walk(node.folders);
		}
	};
	walk(tree.folders);
	if (tree.ungrouped.length > 0) {
		sections.push({ path: "", components: tree.ungrouped });
	}
	return sections;
}
