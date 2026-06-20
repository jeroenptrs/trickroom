/**
 * Shared, Node-side export core used by both the HTTP route and the MCP tool.
 * Turns a design's board `Node`s into self-contained, live-interactive HTML
 * documents (one per board): prepare the tree, inline icons/assets from disk,
 * precompile the system's Tailwind, and assemble the document.
 */

import path from "node:path";
import type { Node, TrickroomConfig } from "../types";
import {
	compileBaselineTailwindCss,
	compileTailwindCss,
	resolveConfiguredTailwindSystemTarget,
	TailwindSystemResolutionError,
} from "../utils/tailwind-design-system";
import { serializeTailwindThemeDomains } from "../utils/tailwind-theme-css";
import { readDomainTokens } from "../utils/tailwind-token-store";
import { buildHtmlDocument } from "./build-html";
import { makeHtmlFilename } from "./filenames";
import { buildExportFontCss, inlineCssFontUrls } from "./fonts";
import {
	inlineResources,
	prepareRenderTree,
	type RenderNode,
} from "./prepare-tree";
import { resolveBoardResources } from "./resources";

const EMPTY_TREE: RenderNode = { ref: "div", props: {} };

function boardName(node: Node): string {
	const name = node.props["data-trickroom-name"];
	return typeof name === "string" && name.trim().length > 0 ? name : "Untitled";
}

export type ExportedBoardFile = {
	/** Human board name. */
	name: string;
	/** `<project> — <design> — <board> — <epoch>.html`. */
	filename: string;
	/** The complete, self-contained HTML document. */
	html: string;
};

export type ExportDesignResult = {
	/** Shared unix-seconds timestamp stamped on every file (and the zip). */
	epoch: number;
	/** The resolved system id, or `null` when none was linked/resolvable. */
	systemId: string | null;
	files: ExportedBoardFile[];
};

export type ExportDesignBoardsInput = {
	projectRoot: string;
	config: TrickroomConfig;
	/** Board root nodes to export, in order. */
	boards: readonly Node[];
	/** The design's linked system id (resolved best-effort; falls back to baseline). */
	systemId: string | null;
	projectName: string;
	designName: string;
	/** Override the timestamp (defaults to now); useful for deterministic tests. */
	epoch?: number;
};

export async function exportDesignBoards({
	projectRoot,
	config,
	boards,
	systemId,
	projectName,
	designName,
	epoch = Math.floor(Date.now() / 1000),
}: ExportDesignBoardsInput): Promise<ExportDesignResult> {
	// Resolve the linked system best-effort; an unresolvable/absent system falls
	// back to baseline Tailwind with no inlined resources.
	let resolved: {
		systemId: string;
		systemName: string;
		cssPath: string;
	} | null = null;
	if (systemId) {
		try {
			resolved = await resolveConfiguredTailwindSystemTarget(
				projectRoot,
				config,
				{
					systemId,
				},
			);
		} catch (error) {
			if (!(error instanceof TailwindSystemResolutionError)) {
				throw error;
			}
		}
	}

	const stored = resolved
		? await readDomainTokens(projectRoot, resolved.systemId)
		: null;
	const themeOverrides = stored
		? serializeTailwindThemeDomains(stored.domains, stored.customProperties)
		: "";
	// Fonts come from the system's font manifest (inlined), not a hardcoded CDN.
	const fonts = await buildExportFontCss(
		projectRoot,
		resolved?.systemId ?? null,
	);
	// Directory of the system's CSS, to resolve relative @font-face url()s.
	const cssDir = resolved
		? path.dirname(path.resolve(projectRoot, resolved.cssPath))
		: null;

	const files: ExportedBoardFile[] = [];
	for (const board of boards) {
		const name = boardName(board);
		const prepared = prepareRenderTree(board);
		const resources = await resolveBoardResources({
			projectRoot,
			systemId: resolved?.systemId ?? null,
			iconIds: prepared.iconIds,
			assetIds: prepared.assetIds,
		});
		const tree = prepared.tree
			? inlineResources(prepared.tree, resources)
			: EMPTY_TREE;
		const candidates = [...prepared.classNames];
		const compiledCss = resolved
			? await compileTailwindCss({
					projectRoot,
					cssPath: resolved.cssPath,
					candidates,
					themeOverrides,
				})
			: await compileBaselineTailwindCss({ projectRoot, candidates });
		// Bundle any local fonts referenced by @font-face url()s in the system CSS.
		const css = cssDir
			? await inlineCssFontUrls(compiledCss, cssDir, projectRoot)
			: compiledCss;

		files.push({
			name,
			filename: makeHtmlFilename(projectName, designName, name, epoch),
			html: buildHtmlDocument({
				title: `${projectName} — ${designName} — ${name}`,
				tree,
				usedBaseUiComponents: prepared.usedBaseUiComponents,
				css,
				epoch,
				fonts,
			}),
		});
	}

	return { epoch, systemId: resolved?.systemId ?? null, files };
}
