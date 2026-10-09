import type { Node, PropRecord, RecipeTemplateNode } from "../types";
import {
	type ClassLayer,
	flattenClassLayers,
	splitClassLayerTokens,
} from "./class-layers";
import {
	parseSystemComponentOverridesMarker,
	parseSystemComponentVariantValuesMarker,
	type SystemComponentInstanceOverrides,
	systemComponentIdProp,
	systemComponentInstanceProp,
	systemComponentOverridesProp,
	systemComponentPathProp,
	systemComponentRootProp,
	systemComponentSystemIdProp,
	systemComponentVariantValuesProp,
	systemComponentVersionProp,
} from "./system-component-markers";
import { resolveSystemComponentOverrideValue } from "./system-component-override-targets";
import {
	compareSystemComponentVariantAxisKeys,
	composeSystemComponentVariantClassLayers,
} from "./system-component-variant-class-layers";
import type {
	PublishedSystemComponentVersion,
	SystemComponentManifest,
	SystemComponentVariantSchema,
} from "./system-components";
import {
	createTwMerge,
	type TwMergeConfig,
	type TwMergeFunction,
} from "./tailwind-merge-config";

/**
 * How a design's component classes are merged, matching what the project's
 * code merges them with: generated `tv()` variants and the wrappers that
 * merge a `className` override.
 *
 * - `derived`: the tailwind-merge config derived from the design system, when
 *   `codegen.twMerge` generates it for the design's system.
 * - `stock`: stock tailwind-merge, which `tv()` uses without that config.
 * - `none`: no merging, when the design has no resolvable system or the
 *   derived config fails (`error` says why). Classes resolve by stylesheet
 *   order, as they did before merging existed.
 */
export type ClassMergeSettings =
	| { mode: "none"; error?: string }
	| { mode: "stock" }
	| { mode: "derived"; config: TwMergeConfig };

/** Merges one class string: later classes win over the classes they override. */
export type ClassMerge = (className: string) => string;

// Merged strings per merge function. Instances of one component repeat the
// same class strings, so a board renders from a handful of entries; the
// bound only stops an unusually varied project from growing it forever.
const MAX_CACHED_CLASS_NAMES = 10_000;

const classMerges = new WeakMap<TwMergeFunction, ClassMerge>();

/**
 * The merge for the settings, or null when classes are not merged. One per
 * tailwind-merge config object, with its results cached by input string.
 */
export const createClassMerge = (
	settings: ClassMergeSettings | null | undefined,
): ClassMerge | null => {
	if (!settings || settings.mode === "none") return null;
	const twMerge = createTwMerge(
		settings.mode === "derived" ? settings.config : null,
	);
	const existing = classMerges.get(twMerge);
	if (existing) return existing;

	const cache = new Map<string, string>();
	const merge: ClassMerge = (className) => {
		let merged = cache.get(className);
		if (merged === undefined) {
			if (cache.size >= MAX_CACHED_CLASS_NAMES) cache.clear();
			merged = twMerge(className);
			cache.set(className, merged);
		}
		return merged;
	};
	classMerges.set(twMerge, merge);
	return merge;
};

/**
 * Merges a component node's classes the way the generated code does:
 * `twMerge(variants(…), className)`, where `variants(…)` is tailwind-variants
 * merging the template, variant and compound classes. Two passes: the
 * override merges over the already merged component classes.
 */
export const mergeComponentClasses = (
	componentClassName: string,
	overrideClassName: string | undefined,
	merge: ClassMerge,
): string => {
	const merged = componentClassName.trim() ? merge(componentClassName) : "";
	if (!overrideClassName?.trim()) return merged;
	return merge(merged ? `${merged} ${overrideClassName}` : overrideClassName);
};

/**
 * Whether a design node is part of a component instance. Its classes come
 * from the component (template, variant and compound classes) and the
 * instance override, which code merges. Raw elements and slot content keep
 * their className as written.
 */
export const isComponentClassTarget = (props: PropRecord): boolean =>
	typeof props[systemComponentIdProp] === "string" &&
	typeof props[systemComponentInstanceProp] === "string" &&
	typeof props[systemComponentPathProp] === "string";

/**
 * What resolving a component node's classes reads from a component version:
 * its template (paths and classes), variants and override targets.
 */
export type ComponentClassVersion = Pick<
	PublishedSystemComponentVersion,
	"root" | "variants" | "overrideTargets"
>;

/**
 * Per component id and version id, the class data of every published version
 * (and the draft, under `draft`, which component captures render). The
 * client resolves instance classes from it.
 */
export type ComponentClassTable = Record<
	string,
	Record<string, ComponentClassVersion>
>;

const slimTemplate = (node: RecipeTemplateNode): RecipeTemplateNode => {
	const propsClassName = node.props?.className;
	return {
		path: node.path,
		library: node.library,
		component: node.component,
		...(node.className ? { className: node.className } : {}),
		...(typeof propsClassName === "string"
			? { props: { className: propsClassName } }
			: {}),
		...(node.children ? { children: node.children.map(slimTemplate) } : {}),
	};
};

const slimVersion = (
	version: ComponentClassVersion,
): ComponentClassVersion => ({
	root: slimTemplate(version.root),
	...(version.variants ? { variants: version.variants } : {}),
	...(version.overrideTargets
		? { overrideTargets: version.overrideTargets }
		: {}),
});

/** The class data of a system's components, for `ComponentClassTable`. */
export const buildComponentClassTable = (
	manifest: Pick<SystemComponentManifest, "components">,
): ComponentClassTable => {
	const table: ComponentClassTable = {};
	for (const [componentId, record] of Object.entries(manifest.components)) {
		const versions: Record<string, ComponentClassVersion> = {};
		for (const [versionId, version] of Object.entries(
			record.published?.versions ?? {},
		)) {
			versions[versionId] = slimVersion(version);
		}
		if (record.draft) versions.draft = slimVersion(record.draft);
		table[componentId] = versions;
	}
	return table;
};

/** What resolving instance classes reads, besides the instance's own markers. */
export type ComponentClassSource = {
	/** The design's system; instances of another system are not resolved. */
	systemId: string;
	merge: ClassMerge;
	components: ComponentClassTable;
};

/**
 * The merge settings plus, when classes merge, the class data of the
 * system's components under the resolved system id: what
 * `GET /api/trickroom/tailwind/class-merge` returns.
 */
export type ComponentClassMerge = ClassMergeSettings & {
	components?: { systemId: string; table: ComponentClassTable };
	/**
	 * Why `components` is missing although classes merge: the component
	 * manifest could not be read. Absent when nothing merges (`mode: "none"`),
	 * which is intentional.
	 */
	componentsError?: string;
};

/** The source `getRenderableProps` resolves component classes with, or null. */
export const toComponentClassSource = (
	merge: ComponentClassMerge | null | undefined,
): ComponentClassSource | null => {
	const classMerge = createClassMerge(merge);
	return classMerge && merge?.components
		? {
				systemId: merge.components.systemId,
				merge: classMerge,
				components: merge.components.table,
			}
		: null;
};

/**
 * The raw variant values and overrides markers of an instance's root node,
 * which every node of the instance resolves its classes with.
 */
export type InstanceRootMarkers = {
	variantValues: string | undefined;
	overrides: string | undefined;
};

const stringProp = (props: PropRecord, key: string) => {
	const value = props[key];
	return typeof value === "string" ? value : undefined;
};

/** The instance root markers of a node, when it is an instance root. */
export const readInstanceRootMarkers = (
	props: PropRecord,
): InstanceRootMarkers | null => {
	const isRoot =
		props[systemComponentRootProp] === "true" ||
		props[systemComponentRootProp] === true;
	if (!isRoot || typeof props[systemComponentInstanceProp] !== "string") {
		return null;
	}
	return {
		variantValues: stringProp(props, systemComponentVariantValuesProp),
		overrides: stringProp(props, systemComponentOverridesProp),
	};
};

/** Every instance root's markers in a tree, by instance id. */
export const collectInstanceRootMarkers = (
	roots: readonly Node[],
): Map<string, InstanceRootMarkers> => {
	const markers = new Map<string, InstanceRootMarkers>();
	const stack = [...roots];
	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) continue;
		const root = readInstanceRootMarkers(node.props);
		const instanceId = node.props[systemComponentInstanceProp];
		if (root && typeof instanceId === "string") markers.set(instanceId, root);
		if (Array.isArray(node.children)) stack.push(...node.children);
	}
	return markers;
};

const templatesByVersion = new WeakMap<
	RecipeTemplateNode,
	Map<string, RecipeTemplateNode>
>();

const getTemplateNode = (version: ComponentClassVersion, path: string) => {
	let byPath = templatesByVersion.get(version.root);
	if (!byPath) {
		const nodes = new Map<string, RecipeTemplateNode>();
		const visit = (template: RecipeTemplateNode) => {
			nodes.set(template.path, template);
			for (const child of template.children ?? []) visit(child);
		};
		visit(version.root);
		byPath = nodes;
		templatesByVersion.set(version.root, byPath);
	}
	return byPath.get(path);
};

// An instance can record a value its version does not have (the lint rule
// design.unknown-variant-value reports it): resolve as if the axis were
// unset, then fill defaults like expansion does.
const resolveKnownVariantValues = (
	variants: SystemComponentVariantSchema | undefined,
	variantValues: Record<string, string>,
): Record<string, string> => {
	const axes = variants?.axes ?? {};
	const resolved: Record<string, string> = {};
	for (const [axisKey, axis] of Object.entries(axes).sort(([left], [right]) =>
		compareSystemComponentVariantAxisKeys(left, right),
	)) {
		const selected = variantValues[axisKey];
		const value =
			selected !== undefined && Object.hasOwn(axis.values, selected)
				? selected
				: (variants?.defaultValues?.[axisKey] ?? axis.defaultValue);
		if (value !== undefined && Object.hasOwn(axis.values, value)) {
			resolved[axisKey] = value;
		}
	}
	return resolved;
};

const withoutTokens = (className: string, remove: string | undefined) => {
	const removed = new Set(splitClassLayerTokens(remove));
	return splitClassLayerTokens(className)
		.filter((token) => !removed.has(token))
		.join(" ");
};

/**
 * The classes code merges for one node of an instance: the component's
 * (template, selected variant values and matching compounds, in codegen's
 * order) and the instance's className override for the node's path.
 */
export const resolveComponentNodeClasses = ({
	version,
	path,
	variantValues,
	overrides,
	baseClassName,
}: {
	version: ComponentClassVersion;
	path: string;
	variantValues: Record<string, string>;
	overrides: SystemComponentInstanceOverrides;
	/** The registry Element's base classes, which stay out of the merge. */
	baseClassName?: string;
}): { component: string; override: string | undefined } => {
	const template = getTemplateNode(version, path);
	const layers: ClassLayer[] = composeSystemComponentVariantClassLayers({
		variants: version.variants,
		path,
		templateClassName: template?.className,
		variantValues: resolveKnownVariantValues(version.variants, variantValues),
	});
	const override = resolveSystemComponentOverrideValue(
		version,
		path,
		"className",
		overrides,
	);
	let component = flattenClassLayers(layers) ?? "";
	// A template that keeps its classes in props.className (older drafts):
	// expansion falls back to them, without the base classes it may hold.
	const propsClassName = template?.props?.className;
	if (!component && !override?.trim() && typeof propsClassName === "string") {
		component = withoutTokens(propsClassName, baseClassName);
	}
	return { component, override };
};

/**
 * The className a component node renders with: the registry base classes,
 * then the component classes and the override merged like code merges them.
 */
export const renderComponentClassName = (
	classes: { component: string; override: string | undefined },
	baseClassName: string | undefined,
	merge: ClassMerge,
): string | undefined => {
	const merged = mergeComponentClasses(
		classes.component,
		classes.override,
		merge,
	);
	const base = splitClassLayerTokens(baseClassName).join(" ");
	const className = [base, merged].filter(Boolean).join(" ");
	return className || undefined;
};

const renderedCaches = new WeakMap<
	ClassMerge,
	WeakMap<ComponentClassTable, Map<string, string | null>>
>();

const getRenderedCache = (source: ComponentClassSource) => {
	let byTable = renderedCaches.get(source.merge);
	if (!byTable) {
		byTable = new WeakMap();
		renderedCaches.set(source.merge, byTable);
	}
	let cache = byTable.get(source.components);
	if (!cache) {
		cache = new Map();
		byTable.set(source.components, cache);
	}
	return cache;
};

/**
 * The merged className of a component node, from its component version and
 * its instance root's markers; null when it cannot be resolved (another
 * system's instance, a version the system no longer has, no root), so the
 * caller renders the stored className. Cached by component, version, path,
 * base classes and the root's raw markers.
 */
export const resolveRenderedComponentClassName = (
	props: PropRecord,
	baseClassName: string | undefined,
	source: ComponentClassSource,
	root: InstanceRootMarkers | null,
): string | undefined | null => {
	const componentId = stringProp(props, systemComponentIdProp);
	const versionId = stringProp(props, systemComponentVersionProp);
	const path = stringProp(props, systemComponentPathProp);
	if (
		!componentId ||
		!versionId ||
		!path ||
		!root ||
		stringProp(props, systemComponentSystemIdProp) !== source.systemId
	) {
		return null;
	}
	const cache = getRenderedCache(source);
	const key = [
		componentId,
		versionId,
		path,
		baseClassName ?? "",
		root.variantValues ?? "",
		root.overrides ?? "",
	].join("\u0000");
	const cached = cache.get(key);
	if (cached !== undefined) return cached ?? undefined;

	const version = source.components[componentId]?.[versionId];
	if (!version) return null;
	const rendered = renderComponentClassName(
		resolveComponentNodeClasses({
			version,
			path,
			variantValues: parseSystemComponentVariantValuesMarker(
				root.variantValues,
			),
			overrides: parseSystemComponentOverridesMarker(root.overrides),
			baseClassName,
		}),
		baseClassName,
		source.merge,
	);
	if (cache.size >= MAX_CACHED_CLASS_NAMES) cache.clear();
	cache.set(key, rendered ?? null);
	return rendered;
};

const MERGED_LAYER_SOURCES = new Set<ClassLayer["source"]>([
	"system-template",
	"system-variant",
	"system-compound-variant",
	"instance-override",
]);

/** Whether a layer holds classes code merges: a component's or its override. */
export const isMergedClassLayer = (layer: Pick<ClassLayer, "source">) =>
	MERGED_LAYER_SOURCES.has(layer.source);

/** Key of a class token in a layer stack: `${layerIndex}:${tokenIndex}`. */
export const classLayerTokenKey = (layerIndex: number, tokenIndex: number) =>
	`${layerIndex}:${tokenIndex}`;

type KeyedToken = { token: string; key: string };

// tailwind-merge only drops classes and keeps the order of the rest, and of
// two equal classes it keeps the later one, so matching from the end finds
// exactly the kept tokens.
const mergeKeyedTokens = (
	tokens: readonly KeyedToken[],
	merge: ClassMerge,
	removed: Set<string>,
): KeyedToken[] => {
	if (tokens.length === 0) return [];
	const merged = splitClassLayerTokens(
		merge(tokens.map(({ token }) => token).join(" ")),
	);
	const kept: KeyedToken[] = [];
	let mergedIndex = merged.length - 1;
	for (let index = tokens.length - 1; index >= 0; index -= 1) {
		if (mergedIndex >= 0 && merged[mergedIndex] === tokens[index].token) {
			mergedIndex -= 1;
			kept.unshift(tokens[index]);
		} else {
			removed.add(tokens[index].key);
		}
	}
	return kept;
};

/**
 * The tokens of the merged layers that merging removes, keyed by
 * `classLayerTokenKey`, merged like `mergeComponentClasses`: the component
 * layers first, then the instance override over what they kept. Other layers
 * are not merged and never listed.
 */
export const findClassesRemovedByMerge = (
	layers: readonly ClassLayer[],
	merge: ClassMerge,
): Set<string> => {
	const component: KeyedToken[] = [];
	const override: KeyedToken[] = [];
	layers.forEach((layer, layerIndex) => {
		if (!isMergedClassLayer(layer)) return;
		const into = layer.source === "instance-override" ? override : component;
		splitClassLayerTokens(layer.className).forEach((token, tokenIndex) => {
			into.push({ token, key: classLayerTokenKey(layerIndex, tokenIndex) });
		});
	});
	const removed = new Set<string>();
	const kept = mergeKeyedTokens(component, merge, removed);
	if (override.length > 0) {
		mergeKeyedTokens([...kept, ...override], merge, removed);
	}
	return removed;
};
