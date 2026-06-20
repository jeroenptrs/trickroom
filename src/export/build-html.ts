/**
 * Assembles a self-contained, live-interactive HTML document for one board.
 *
 * The body renders a JSON `RenderNode` tree with `React.createElement` (no JSX),
 * so no in-browser transpiler is needed — a plain `<script type="module">`
 * suffices. Base UI components load from esm.sh via an import map (single React
 * instance); the system's fonts and the precompiled Tailwind CSS are inlined.
 */

import { baseUiImportUrl, reactImportMapEntries } from "./cdn";
import {
	baseUiAccessExpression,
	baseUiImportSpecifier,
	resolveExportDescriptor,
} from "./descriptors";
import type { ExportFontResult } from "./fonts";
import type { RenderNode } from "./prepare-tree";

export type BuildHtmlInput = {
	/** Document <title>, e.g. "Project — Design — Board". */
	title: string;
	/** The prepared, resource-inlined render tree for the board. */
	tree: RenderNode;
	/** base-ui component ids used in the tree (e.g. `dialog.popup`). */
	usedBaseUiComponents: Iterable<string>;
	/** Precompiled Tailwind CSS (preflight + theme vars + utilities). */
	css: string;
	/** Export timestamp (unix seconds). */
	epoch: number;
	/** Resolved system fonts: remote stylesheet links + inlined `@font-face`. */
	fonts?: ExportFontResult;
};

/** Escape a string for use as HTML text / attribute content. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Serialize to JSON safe to embed inside a <script> (neutralize `</script>`). */
function jsonForScript(value: unknown): string {
	return JSON.stringify(value).replace(/</g, "\\u003c");
}

type BaseUiUsage = {
	/** `import { Name } from "@base-ui/react/<subpath>";` lines, one per subpath. */
	imports: string[];
	/** Import-map entries for each used base-ui subpath. */
	importMap: Record<string, string>;
	/** `"base-ui/<id>": Name.Member,` REGISTRY object entries. */
	registryEntries: string[];
};

function collectBaseUiUsage(
	usedBaseUiComponents: Iterable<string>,
): BaseUiUsage {
	const imports: string[] = [];
	const importMap: Record<string, string> = {};
	const registryEntries: string[] = [];
	const seenSubpaths = new Set<string>();

	for (const component of usedBaseUiComponents) {
		const descriptor = resolveExportDescriptor("base-ui", component);
		if (!descriptor || descriptor.kind !== "base-ui") {
			continue;
		}
		const specifier = baseUiImportSpecifier(descriptor.subpath);
		if (!seenSubpaths.has(descriptor.subpath)) {
			seenSubpaths.add(descriptor.subpath);
			importMap[specifier] = baseUiImportUrl(descriptor.subpath);
			imports.push(`import { ${descriptor.importName} } from "${specifier}";`);
		}
		registryEntries.push(
			`\t${jsonForScript(`base-ui/${component}`)}: ${baseUiAccessExpression(descriptor)},`,
		);
	}

	return { imports, importMap, registryEntries };
}

const RUNTIME_RENDERER = `
function render(node) {
	const type = REGISTRY[node.ref] ?? node.ref;
	const props = node.props ?? {};
	if (node.text !== undefined) return createElement(type, props, node.text);
	if (node.children) return createElement(type, props, ...node.children.map(render));
	return createElement(type, props);
}

createRoot(document.getElementById("root")).render(render(TREE));
`;

export function buildHtmlDocument({
	title,
	tree,
	usedBaseUiComponents,
	css,
	epoch,
	fonts = { stylesheetLinks: [], fontFaceCss: "" },
}: BuildHtmlInput): string {
	const usage = collectBaseUiUsage(usedBaseUiComponents);
	const importMap = { ...reactImportMapEntries(), ...usage.importMap };
	const fontLinks = fonts.stylesheetLinks
		.map((href) => `<link rel="stylesheet" href="${href}" crossorigin />`)
		.join("\n\t\t");
	const fontFaceStyle = fonts.fontFaceCss
		? `<style>${fonts.fontFaceCss}</style>`
		: "";

	const moduleScript = [
		`import { createElement } from "react";`,
		`import { createRoot } from "react-dom/client";`,
		...usage.imports,
		"",
		`const REGISTRY = {`,
		...usage.registryEntries,
		`};`,
		"",
		`const TREE = ${jsonForScript(tree)};`,
		RUNTIME_RENDERER,
	].join("\n");

	return `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>${escapeHtml(title)}</title>
		<meta name="generator" content="Trickroom" />
		<meta name="trickroom-exported-at" content="${epoch}" />
		${fontLinks}
		${fontFaceStyle}
		<style>${css}</style>
		<script type="importmap">
${jsonForScript({ imports: importMap })}
		</script>
	</head>
	<body>
		<div id="root"></div>
		<script type="module">
${moduleScript}
		</script>
	</body>
</html>
`;
}
