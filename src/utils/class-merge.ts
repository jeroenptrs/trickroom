import type { PropRecord } from "../types";
import { type ClassLayer, splitClassLayerTokens } from "./class-layers";
import {
	systemComponentIdProp,
	systemComponentInstanceProp,
	systemComponentPathProp,
} from "./system-component-markers";
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
 * Whether a design node is part of a component instance. Its stored
 * className is the component's template, variant and compound classes plus
 * the instance override, in codegen's layering order, which code merges.
 * Raw elements and slot content keep their className as written.
 */
export const isComponentClassTarget = (props: PropRecord): boolean =>
	typeof props[systemComponentIdProp] === "string" &&
	typeof props[systemComponentInstanceProp] === "string" &&
	typeof props[systemComponentPathProp] === "string";

/**
 * Merges a component node's className. The registry Element's base classes
 * lead the string and are not part of the component's classes, so they stay
 * as they are; the rest is merged.
 */
export const mergeComponentClassName = (
	className: string | undefined,
	baseClassName: string | undefined,
	merge: ClassMerge,
): string | undefined => {
	if (!className) return className;
	// The common case, and the hot one: no base, so the whole string merges
	// and the cache answers without splitting it.
	if (!baseClassName) return merge(className) || undefined;
	const tokens = splitClassLayerTokens(className);
	if (tokens.length === 0) return className;
	const baseTokens = splitClassLayerTokens(baseClassName);
	const baseLeads =
		baseTokens.length > 0 &&
		baseTokens.every((token, index) => tokens[index] === token);
	const head = baseLeads ? baseTokens : [];
	const tail = tokens.slice(head.length);
	if (tail.length === 0) return className;
	const merged = merge(tail.join(" "));
	return head.length > 0 ? `${head.join(" ")} ${merged}`.trim() : merged;
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

/**
 * The tokens of the merged layers (component and instance override layers,
 * in order) that merging removes, keyed by `classLayerTokenKey`. Other
 * layers are not merged and never listed.
 */
export const findClassesRemovedByMerge = (
	layers: readonly ClassLayer[],
	merge: ClassMerge,
): Set<string> => {
	const tokens: { token: string; key: string }[] = [];
	layers.forEach((layer, layerIndex) => {
		if (!isMergedClassLayer(layer)) return;
		splitClassLayerTokens(layer.className).forEach((token, tokenIndex) => {
			tokens.push({ token, key: classLayerTokenKey(layerIndex, tokenIndex) });
		});
	});
	const removed = new Set<string>();
	if (tokens.length === 0) return removed;

	// tailwind-merge only drops classes and keeps the order of the rest, and
	// of two equal classes it keeps the later one, so matching from the end
	// finds exactly the kept tokens.
	const kept = splitClassLayerTokens(
		merge(tokens.map(({ token }) => token).join(" ")),
	);
	let keptIndex = kept.length - 1;
	for (let index = tokens.length - 1; index >= 0; index -= 1) {
		if (keptIndex >= 0 && kept[keptIndex] === tokens[index].token) {
			keptIndex -= 1;
		} else {
			removed.add(tokens[index].key);
		}
	}
	return removed;
};
