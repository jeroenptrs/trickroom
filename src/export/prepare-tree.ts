/**
 * Pure structural transform: a design board `Node` tree -> a plain-JSON render
 * tree for the standalone exporter, plus the data the HTML builder needs
 * (used base-ui ids, the className candidate set, and icon/asset ids to inline).
 *
 * This mirrors the live renderer `SerializedElement` in
 * `src/components/stage/Artboards.tsx`: resolve the registry definition, run
 * `getRenderableProps` (which composes base + authored className and strips all
 * system-component / recipe marker props), then recurse by role. Because the
 * stored tree already has final classNames materialized, no per-instance detach
 * is needed — the output matches the editor exactly.
 *
 * Icons and assets are emitted as placeholder nodes; `inlineResources` swaps
 * them for concrete `svg` / `img` nodes once their bytes have been fetched.
 */

import {
	getRenderableProps,
	resolveRegistryComponent,
} from "../libraries/registry";
import type { Node } from "../types";
import { assetIdProp, iconIdProp } from "../utils/resource-props";
import { resolveExportDescriptor } from "./descriptors";

/** Props that are Trickroom-internal bookkeeping and should not reach the exported DOM. */
const INTERNAL_PROP_KEYS = new Set([
	"data-trickroom-name",
	"data-trickroom-library",
	"data-trickroom-component",
	"data-trickroom-role",
]);

export type RenderProps = Record<string, unknown>;

/** A node the standalone runtime can render directly (no unresolved placeholders). */
export type RenderNode = {
	/** REGISTRY id (`base-ui/<component>`) or an intrinsic tag (`div`, `img`, `svg`, `span`). */
	ref: string;
	props: RenderProps;
	/** Present for branch nodes. */
	children?: RenderNode[];
	/** Present for text-role nodes. */
	text?: string;
};

type IconPlaceholder = {
	kind: "icon";
	iconId: string;
	className: string | null;
	ariaLabel: string | null;
};

type AssetPlaceholder = {
	kind: "asset";
	assetId: string;
	className: string | null;
	alt: string;
	objectFit: string;
	objectPosition: string;
	loading: string;
	decoding: string;
};

/** An element in the intermediate tree; its children may still be placeholders. */
type PrepElement = {
	ref: string;
	props: RenderProps;
	children?: PrepNode[];
	text?: string;
};

/** Intermediate node: like RenderNode, but icons/assets are unresolved placeholders. */
export type PrepNode = PrepElement | IconPlaceholder | AssetPlaceholder;

export type PreparedBoard = {
	tree: PrepNode | null;
	/** base-ui component ids used (e.g. `dialog.popup`), for imports + REGISTRY emission. */
	usedBaseUiComponents: Set<string>;
	/** Distinct Tailwind class tokens used anywhere in the tree (the precompile candidate set). */
	classNames: Set<string>;
	iconIds: Set<string>;
	assetIds: Set<string>;
};

type Accumulator = Pick<
	PreparedBoard,
	"usedBaseUiComponents" | "classNames" | "iconIds" | "assetIds"
>;

function asString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function cleanProps(renderProps: RenderProps): RenderProps {
	const out: RenderProps = {};
	for (const [key, value] of Object.entries(renderProps)) {
		if (INTERNAL_PROP_KEYS.has(key) || value === undefined) {
			continue;
		}
		out[key] = value;
	}
	return out;
}

function collectClassNames(className: unknown, into: Set<string>): void {
	if (typeof className !== "string") {
		return;
	}
	for (const token of className.split(/\s+/)) {
		if (token) {
			into.add(token);
		}
	}
}

function prepareNode(node: Node, acc: Accumulator): PrepNode | null {
	const props = node.props;
	const library = asString(props["data-trickroom-library"]);
	const component = asString(props["data-trickroom-component"]);
	if (!library || !component) {
		return null;
	}

	const resolution = resolveRegistryComponent(library, component);
	const descriptor = resolveExportDescriptor(library, component);
	// Unknown to the registry or to the export map -> render nothing, matching
	// the live renderer returning null for unknown components.
	if (resolution.status !== "known" || !descriptor) {
		return null;
	}

	const renderProps = getRenderableProps(props, resolution.definition);
	collectClassNames(renderProps.className, acc.classNames);
	const className = asString(renderProps.className);
	const role = asString(props["data-trickroom-role"]);

	if (descriptor.kind === "icon") {
		const iconId = asString(props[iconIdProp])?.trim() ?? "";
		if (iconId) {
			acc.iconIds.add(iconId);
		}
		return {
			kind: "icon",
			iconId,
			className,
			ariaLabel: asString(renderProps["aria-label"]),
		};
	}

	if (descriptor.kind === "intrinsic" && descriptor.tag === "img") {
		const assetId = asString(props[assetIdProp])?.trim() ?? "";
		if (assetId) {
			acc.assetIds.add(assetId);
		}
		return {
			kind: "asset",
			assetId,
			className,
			alt: asString(renderProps.alt) ?? "",
			objectFit: asString(renderProps.objectFit) ?? "cover",
			objectPosition: asString(renderProps.objectPosition) ?? "center",
			loading: asString(renderProps.loading) ?? "lazy",
			decoding: asString(renderProps.decoding) ?? "async",
		};
	}

	const ref =
		descriptor.kind === "intrinsic" ? descriptor.tag : `base-ui/${component}`;
	if (descriptor.kind === "base-ui") {
		acc.usedBaseUiComponents.add(component);
	}

	const cleaned = cleanProps(renderProps);

	if (role === "text") {
		return {
			ref,
			props: cleaned,
			text: typeof node.children === "string" ? node.children : "",
		};
	}

	if (role === "leaf") {
		return { ref, props: cleaned };
	}

	const children = Array.isArray(node.children)
		? node.children
				.map((child) => prepareNode(child, acc))
				.filter((child): child is PrepNode => child !== null)
		: [];
	return { ref, props: cleaned, children };
}

export function prepareRenderTree(board: Node): PreparedBoard {
	const acc: Accumulator = {
		usedBaseUiComponents: new Set(),
		classNames: new Set(),
		iconIds: new Set(),
		assetIds: new Set(),
	};
	const tree = prepareNode(board, acc);
	return { tree, ...acc };
}

/** A parsed inline SVG: root attributes plus inner markup. */
export type ParsedIcon = { attrs: Record<string, unknown>; innerHTML: string };

export type ResolvedResources = {
	/** iconId -> parsed inline SVG, or `null` when the icon is missing. */
	icons: Map<string, ParsedIcon | null>;
	/** assetId -> `data:` URI, or `null` when the asset is missing. */
	assets: Map<string, string | null>;
};

/**
 * Replace icon/asset placeholders with concrete `svg`/`img` nodes (or the
 * `span[data-trickroom-missing-resource]` fallback), mirroring the live `Icon`
 * and `Asset` components. The result contains no placeholders and is fully
 * JSON-serializable for embedding into the exported HTML.
 */
export function inlineResources(
	node: PrepNode,
	resources: ResolvedResources,
): RenderNode {
	if ("kind" in node) {
		if (node.kind === "icon") {
			const parsed = node.iconId
				? (resources.icons.get(node.iconId) ?? null)
				: null;
			const ariaLabel = node.ariaLabel || node.iconId || "Icon";
			if (!parsed) {
				return {
					ref: "span",
					props: {
						...(node.className ? { className: node.className } : {}),
						"data-trickroom-missing-resource": "icon",
						role: "img",
						"aria-label": ariaLabel,
					},
				};
			}
			return {
				ref: "svg",
				props: {
					...parsed.attrs,
					className: node.className ?? parsed.attrs.className,
					role: "img",
					"aria-label": ariaLabel,
					dangerouslySetInnerHTML: { __html: parsed.innerHTML },
				},
			};
		}

		const src = node.assetId
			? (resources.assets.get(node.assetId) ?? null)
			: null;
		if (!src) {
			return {
				ref: "span",
				props: {
					...(node.className ? { className: node.className } : {}),
					"data-trickroom-missing-resource": "asset",
					role: "img",
					"aria-label": node.alt || "Missing asset",
				},
			};
		}
		return {
			ref: "img",
			props: {
				...(node.className ? { className: node.className } : {}),
				src,
				alt: node.alt,
				loading: node.loading,
				decoding: node.decoding,
				style: {
					objectFit: node.objectFit,
					objectPosition: node.objectPosition,
				},
			},
		};
	}

	const out: RenderNode = { ref: node.ref, props: node.props };
	if (node.text !== undefined) {
		out.text = node.text;
	}
	if (node.children) {
		out.children = node.children.map((child) =>
			inlineResources(child, resources),
		);
	}
	return out;
}
