import {
	getRenderedClassName,
	resolveRegistryComponent,
} from "../libraries/registry";
import type { Node, RecipeTemplateNode, TrickroomDesign } from "../types";
import { splitClassLayerTokens } from "../utils/class-layers";
import { resolveComponentNodeClasses } from "../utils/class-merge";
import {
	getSystemComponentStructuralMetadata,
	type SystemComponentInstanceOverrides,
	type SystemComponentStructuralMetadata,
} from "../utils/system-component-markers";
import { resolveSystemComponentOverrideValue } from "../utils/system-component-override-targets";
import { compareSystemComponentVariantAxisKeys } from "../utils/system-component-variant-class-layers";
import type {
	PublishedSystemComponentVersion,
	SystemComponentRecord,
} from "../utils/system-components";

/**
 * The design side of a lint run: the Designs linked to the linted system,
 * reduced to what design rules check (classes, instance markers, element
 * ids, paths), plus where each of the system's components is placed and the
 * classes the system's component definitions declare. Pure: `run-lint.ts`
 * and `design-lint.ts` read the designs and components and hand them in.
 * Documented in docs/lint.md.
 */

/** The instance markers a node of a placed component carries. */
export type LintDesignInstanceMarker = {
	systemId: string;
	componentId: string;
	instanceId: string;
	/** The published version the instance uses. */
	version: string;
	/** The node's template path inside the component. */
	templatePath: string;
	root: boolean;
	/** Selected variant values; only the root records them. */
	variantValues: Record<string, string>;
};

/**
 * Where the classes the design class rules check on a node come from:
 * - `layer`: a layer that is not part of a component instance (raw layers,
 *   slot content, recipe nodes): its stored className.
 * - `override`: a node of a component instance whose version resolves: only
 *   the className override the instance adds. The classes it inherits are
 *   checked once, on the component (`LintDesignIndex.components`).
 * - `stored`: a node of an instance whose version cannot be resolved (a
 *   version or component the manifest does not have, another system's
 *   component, no instance root among its ancestors): its stored className,
 *   as materialized.
 */
export type LintDesignClassSource = "layer" | "override" | "stored";

/**
 * What a node renders its className from, the way the canvas does
 * (`getRenderedClassName`): the classes the class rules' cascade check
 * sees next to a class (see `design.non-canonical-class`).
 */
export type LintNodeRender =
	/**
	 * Rendered as stored, with the registry Element's base classes: a layer,
	 * or an instance node whose version cannot be resolved. `known` is false
	 * for the latter and for an Element the registry does not have.
	 */
	| { kind: "classes"; className: string | null; known: boolean }
	/**
	 * An instance node whose version resolves: its component classes
	 * (template, selected values, matching compounds) and override, merged
	 * when the design's classes merge; `unmerged` is what renders when they
	 * do not (the stored className).
	 */
	| {
			kind: "component";
			component: string;
			override: string | undefined;
			baseClassName: string | undefined;
			unmerged: string | null;
	  };

export type LintDesignNode = {
	/** Element id. */
	element: string;
	/** Path of the node in the design file, e.g. `boards[0].children[2]`. */
	path: string;
	/** The stored className. */
	className: string | null;
	/** The classes the design class rules check, see `classSource`. */
	checkedClassName: string | null;
	classSource: LintDesignClassSource;
	render: LintNodeRender;
	instance: LintDesignInstanceMarker | null;
};

export type LintDesignBoard = {
	id: string;
	/** The board layer's name, when it has one. */
	name: string | null;
	/** Every node of the board, the board included, depth first. */
	nodes: LintDesignNode[];
};

export type LintDesign = {
	/** Design file id. */
	id: string;
	name: string;
	boards: LintDesignBoard[];
};

/** One placed instance (its root) of a component of the linted system. */
export type LintDesignUsage = {
	design: string;
	board: string;
	element: string;
	path: string;
	instanceId: string;
	version: string;
	variantValues: Record<string, string>;
};

/** One class string of a component definition. */
export type LintComponentClassEntry = {
	/** Template path of the node the classes style. */
	path: string;
	/** The axis and value whose classes these are; null for template and compound classes. */
	axis: string | null;
	value: string | null;
	/** Index of the compound variant whose classes these are; null otherwise. */
	compound: number | null;
	className: string;
};

/** The classes one published version of a component declares. */
export type LintComponentDefinition = {
	componentId: string;
	slug: string;
	version: string;
	/** The current published version; others are listed because instances use them. */
	current: boolean;
	/**
	 * Template classes depth first, then each axis's values (codegen's axis
	 * order), then the compound variants in order.
	 */
	classes: LintComponentClassEntry[];
	/** The registry Element's base classes per template path, where it has any. */
	baseClassNames: Record<string, string>;
};

export type LintDesignIndex = {
	systemId: string;
	/**
	 * The published component versions whose classes the design class rules
	 * check: every component's current version plus every other published
	 * version an instance in the index uses, sorted by slug and version.
	 */
	components: LintComponentDefinition[];
	/** The linked designs, sorted by id. */
	designs: LintDesign[];
	/**
	 * Instance roots of this system's components, keyed by component id, in
	 * design, board and document order. Instances of other systems are left
	 * out.
	 */
	usages: Record<string, LintDesignUsage[]>;
};

/** The system's components, as `components.json` holds them. */
export type LintDesignComponents = Readonly<
	Record<string, Pick<SystemComponentRecord, "slug" | "published">>
>;

export type LintDesignInput = {
	id: string;
	design: TrickroomDesign;
	/** Only these boards; every board when absent. Paths keep the design's indexes. */
	boardIds?: ReadonlySet<string>;
};

const nameOf = (node: Node) => {
	const name = node.props["data-trickroom-name"];
	return typeof name === "string" ? name : null;
};

const toMarker = (
	metadata: SystemComponentStructuralMetadata | null,
): LintDesignInstanceMarker | null => {
	if (!metadata) return null;
	return {
		systemId: metadata.systemId,
		componentId: metadata.componentId,
		instanceId: metadata.instanceId,
		version: metadata.version,
		templatePath: metadata.path,
		root: metadata.isRoot,
		variantValues: metadata.variantValues,
	};
};

const nonEmpty = (className: unknown) =>
	typeof className === "string" && className.trim().length > 0
		? className
		: null;

/** What resolving instance classes reads, besides the node's own markers. */
type InstanceClassContext = {
	systemId: string;
	components: LintDesignComponents;
};

/**
 * The overrides of the instance roots among a node's ancestors (the node
 * included), by instance id. A part resolves through its own root, found by
 * walking up like the canvas does (`useInstanceRootMarkers`), never through
 * a root elsewhere in the design that shares its instance id (a part moved
 * or copied out of its instance).
 */
type AncestorRoots = ReadonlyMap<
	string,
	{
		overrides: SystemComponentInstanceOverrides;
		variantValues: Record<string, string>;
	}
>;

const registryDefinition = (props: Node["props"]) => {
	const library = props["data-trickroom-library"];
	const component = props["data-trickroom-component"];
	if (typeof library !== "string" || typeof component !== "string") {
		return null;
	}
	const resolution = resolveRegistryComponent(library, component);
	return resolution.status === "known" ? resolution.definition : null;
};

const publishedVersion = (
	components: LintDesignComponents,
	componentId: string,
	version: string,
): PublishedSystemComponentVersion | undefined => {
	const versions = Object.hasOwn(components, componentId)
		? components[componentId].published?.versions
		: undefined;
	return versions && Object.hasOwn(versions, version)
		? versions[version]
		: undefined;
};

/**
 * The classes the class rules check on a node: an instance node adds only
 * its className override (the same structured source the canvas resolves
 * classes from, `resolveComponentNodeClasses`); when its version cannot be
 * resolved, the stored className, as the canvas renders it then.
 */
const checkedClasses = (
	node: Node,
	className: string | null,
	instance: LintDesignInstanceMarker | null,
	context: InstanceClassContext,
	roots: AncestorRoots,
): Pick<LintDesignNode, "checkedClassName" | "classSource" | "render"> => {
	const definition = registryDefinition(node.props);
	const asStored = (known: boolean): LintNodeRender => ({
		kind: "classes",
		className: definition
			? nonEmpty(getRenderedClassName(node.props, definition))
			: className,
		known: known && definition !== null,
	});
	if (!instance) {
		return {
			checkedClassName: className,
			classSource: "layer",
			render: asStored(true),
		};
	}
	const version =
		instance.systemId === context.systemId
			? publishedVersion(
					context.components,
					instance.componentId,
					instance.version,
				)
			: undefined;
	const root = roots.get(instance.instanceId);
	if (!version || !root) {
		return {
			checkedClassName: className,
			classSource: "stored",
			render: asStored(false),
		};
	}
	const resolved = resolveComponentNodeClasses({
		version,
		path: instance.templatePath,
		variantValues: root.variantValues,
		overrides: root.overrides,
		baseClassName: definition?.baseClassName,
	});
	return {
		checkedClassName: nonEmpty(
			resolveSystemComponentOverrideValue(
				version,
				instance.templatePath,
				"className",
				root.overrides,
			),
		),
		classSource: "override",
		render: definition
			? {
					kind: "component",
					component: resolved.component,
					override: resolved.override,
					baseClassName: definition.baseClassName,
					unmerged: nonEmpty(getRenderedClassName(node.props, definition)),
				}
			: { kind: "classes", className, known: false },
	};
};

const walkBoard = (
	board: Node,
	boardPath: string,
	context: InstanceClassContext,
): LintDesignNode[] => {
	const nodes: LintDesignNode[] = [];
	const visit = (node: Node, nodePath: string, ancestors: AncestorRoots) => {
		const className = nonEmpty(node.props.className);
		const metadata = getSystemComponentStructuralMetadata(node.props);
		const instance = toMarker(metadata);
		const roots = metadata?.isRoot
			? new Map(ancestors).set(metadata.instanceId, {
					overrides: metadata.overrides,
					variantValues: metadata.variantValues,
				})
			: ancestors;
		nodes.push({
			element: node.id,
			path: nodePath,
			className,
			...checkedClasses(node, className, instance, context, roots),
			instance,
		});
		if (Array.isArray(node.children)) {
			for (const [index, child] of node.children.entries()) {
				visit(child, `${nodePath}.children[${index}]`, roots);
			}
		}
	};
	visit(board, boardPath, new Map());
	return nodes;
};

const compareIds = (left: { id: string }, right: { id: string }) =>
	left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

const compareStrings = (left: string, right: string) =>
	left < right ? -1 : left > right ? 1 : 0;

// A template that keeps its classes in props.className (older drafts):
// instances fall back to them, without the registry base classes.
const templateClassName = (template: RecipeTemplateNode) => {
	const className = nonEmpty(template.className);
	if (className !== null) return className;
	const propsClassName = nonEmpty(template.props?.className);
	if (propsClassName === null) return null;
	const resolution = resolveRegistryComponent(
		template.library,
		template.component,
	);
	const base = new Set(
		splitClassLayerTokens(
			resolution.status === "known"
				? resolution.definition.baseClassName
				: undefined,
		),
	);
	return nonEmpty(
		splitClassLayerTokens(propsClassName)
			.filter((token) => !base.has(token))
			.join(" "),
	);
};

/** The registry base classes of each template node that has them. */
const templateBaseClassNames = (
	version: PublishedSystemComponentVersion,
): Record<string, string> => {
	const bases: Record<string, string> = {};
	const visit = (template: RecipeTemplateNode) => {
		const resolution = resolveRegistryComponent(
			template.library,
			template.component,
		);
		const base =
			resolution.status === "known"
				? nonEmpty(resolution.definition.baseClassName)
				: null;
		if (base !== null) bases[template.path] = base;
		for (const child of template.children ?? []) visit(child);
	};
	visit(version.root);
	return bases;
};

/** Every class string a published version declares, see `LintComponentDefinition`. */
const componentClassEntries = (
	version: PublishedSystemComponentVersion,
): LintComponentClassEntry[] => {
	const entries: LintComponentClassEntry[] = [];
	const add = (
		path: string,
		className: unknown,
		source: Pick<LintComponentClassEntry, "axis" | "value" | "compound">,
	) => {
		const value = nonEmpty(className);
		if (value !== null) entries.push({ path, ...source, className: value });
	};
	const visit = (template: RecipeTemplateNode) => {
		add(template.path, templateClassName(template), {
			axis: null,
			value: null,
			compound: null,
		});
		for (const child of template.children ?? []) visit(child);
	};
	visit(version.root);
	const axes = Object.entries(version.variants?.axes ?? {}).sort(
		([left], [right]) => compareSystemComponentVariantAxisKeys(left, right),
	);
	for (const [axis, definition] of axes) {
		for (const [value, entry] of Object.entries(definition.values)) {
			for (const [path, className] of Object.entries(
				entry.classesByPath ?? {},
			)) {
				add(path, className, { axis, value, compound: null });
			}
		}
	}
	for (const [compound, entry] of (
		version.variants?.compoundVariants ?? []
	).entries()) {
		for (const [path, className] of Object.entries(entry.classesByPath)) {
			add(path, className, { axis: null, value: null, compound });
		}
	}
	return entries;
};

const buildComponentDefinitions = (
	components: LintDesignComponents,
	usages: Readonly<Record<string, readonly LintDesignUsage[]>>,
): LintComponentDefinition[] => {
	const definitions: LintComponentDefinition[] = [];
	for (const [componentId, record] of Object.entries(components)) {
		const published = record.published;
		if (!published) continue;
		const versions = new Set([published.currentVersion]);
		for (const usage of usages[componentId] ?? []) versions.add(usage.version);
		for (const versionId of versions) {
			const version = publishedVersion(components, componentId, versionId);
			if (!version) continue;
			definitions.push({
				componentId,
				slug: record.slug,
				version: versionId,
				current: versionId === published.currentVersion,
				classes: componentClassEntries(version),
				baseClassNames: templateBaseClassNames(version),
			});
		}
	}
	return definitions.sort(
		(left, right) =>
			compareStrings(left.slug, right.slug) ||
			compareStrings(left.componentId, right.componentId) ||
			compareStrings(left.version, right.version),
	);
};

/**
 * The index over designs already known to link the system. `components` is
 * the system's component manifest; without it no instance resolves, so
 * every instance node is checked by its stored className.
 */
export function buildLintDesignIndex({
	systemId,
	designs,
	components = {},
}: {
	systemId: string;
	designs: readonly LintDesignInput[];
	components?: LintDesignComponents;
}): LintDesignIndex {
	const indexed: LintDesign[] = [];
	const usages: Record<string, LintDesignUsage[]> = {};
	for (const input of [...designs].sort(compareIds)) {
		const boards: LintDesignBoard[] = [];
		const context: InstanceClassContext = { systemId, components };
		for (const [index, board] of input.design.boards.entries()) {
			if (input.boardIds && !input.boardIds.has(board.id)) continue;
			const nodes = walkBoard(board, `boards[${index}]`, context);
			boards.push({ id: board.id, name: nameOf(board), nodes });
			for (const node of nodes) {
				const instance = node.instance;
				if (!instance?.root || instance.systemId !== systemId) continue;
				const list = usages[instance.componentId] ?? [];
				list.push({
					design: input.id,
					board: board.id,
					element: node.element,
					path: node.path,
					instanceId: instance.instanceId,
					version: instance.version,
					variantValues: instance.variantValues,
				});
				usages[instance.componentId] = list;
			}
		}
		indexed.push({ id: input.id, name: input.design.name, boards });
	}
	return {
		systemId,
		components: buildComponentDefinitions(components, usages),
		designs: indexed,
		usages: Object.fromEntries(
			Object.entries(usages).sort(([left], [right]) =>
				left < right ? -1 : left > right ? 1 : 0,
			),
		),
	};
}

/** An index with no designs, for runs that have none to check. */
export const emptyLintDesignIndex = (systemId: string): LintDesignIndex => ({
	systemId,
	components: [],
	designs: [],
	usages: {},
});

/** How many instances of each component (by id) the index places. */
export const countDesignUsages = (
	index: LintDesignIndex,
): Record<string, number> =>
	Object.fromEntries(
		Object.entries(index.usages).map(([componentId, list]) => [
			componentId,
			list.length,
		]),
	);
