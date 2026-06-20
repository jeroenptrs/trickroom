/**
 * Node-side resource resolution for the export route: reads icon SVGs and asset
 * bytes straight from disk (no HTTP round-trip) and turns them into the inline
 * payloads `inlineResources` expects.
 *
 * The live `Icon` uses `parseSvgRoot`, which relies on `DOMParser` and so only
 * runs in the browser. The route runs in Node, so we parse the (already
 * sanitized) icon SVG with a small regex parser that mirrors `parseSvgRoot`:
 * root attributes (with `class` -> `className`, dropping `data-trickroom-*`)
 * plus the inner markup.
 */

import { readAsset, readAssetFile } from "../utils/asset-manifest-service";
import { readSanitizedIconSvg } from "../utils/icon-manifest-service";
import type { ParsedIcon, ResolvedResources } from "./prepare-tree";

const SVG_OPEN_TAG = /<svg\b([^>]*)>/i;
const SVG_ATTR = /([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseSvgRootNode(svgText: string): ParsedIcon | null {
	if (!svgText) {
		return null;
	}
	const open = SVG_OPEN_TAG.exec(svgText);
	if (!open) {
		return null;
	}
	const innerStart = open.index + open[0].length;
	const innerEnd = svgText.lastIndexOf("</svg>");
	if (innerEnd < innerStart) {
		return null;
	}

	const attrs: Record<string, string> = {};
	SVG_ATTR.lastIndex = 0;
	for (
		let match = SVG_ATTR.exec(open[1]);
		match !== null;
		match = SVG_ATTR.exec(open[1])
	) {
		const name = match[1];
		if (name.toLowerCase().startsWith("data-trickroom-")) {
			continue;
		}
		attrs[name === "class" ? "className" : name] = match[2] ?? match[3] ?? "";
	}

	return { attrs, innerHTML: svgText.slice(innerStart, innerEnd) };
}

/**
 * Resolve all icon/asset references for a board from disk. Missing or unreadable
 * resources map to `null`, which `inlineResources` renders as the live
 * `data-trickroom-missing-resource` fallback span.
 */
export async function resolveBoardResources({
	projectRoot,
	systemId,
	iconIds,
	assetIds,
}: {
	projectRoot: string;
	systemId: string | null;
	iconIds: Iterable<string>;
	assetIds: Iterable<string>;
}): Promise<ResolvedResources> {
	const icons = new Map<string, ParsedIcon | null>();
	const assets = new Map<string, string | null>();

	if (!systemId) {
		for (const iconId of iconIds) {
			icons.set(iconId, null);
		}
		for (const assetId of assetIds) {
			assets.set(assetId, null);
		}
		return { icons, assets };
	}

	for (const iconId of iconIds) {
		try {
			const result = await readSanitizedIconSvg(projectRoot, systemId, iconId);
			icons.set(iconId, result ? parseSvgRootNode(result.svg) : null);
		} catch {
			icons.set(iconId, null);
		}
	}

	for (const assetId of assetIds) {
		try {
			const asset = await readAsset(projectRoot, systemId, assetId);
			if (!asset) {
				assets.set(assetId, null);
				continue;
			}
			const file = await readAssetFile(projectRoot, asset);
			const base64 = Buffer.from(file.contents).toString("base64");
			assets.set(assetId, `data:${file.mimeType};base64,${base64}`);
		} catch {
			assets.set(assetId, null);
		}
	}

	return { icons, assets };
}
