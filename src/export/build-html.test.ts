import { describe, expect, it } from "vitest";
import { buildHtmlDocument } from "./build-html";
import type { RenderNode } from "./prepare-tree";

const tree: RenderNode = {
	ref: "div",
	props: { className: "p-4" },
	children: [
		{
			ref: "base-ui/dialog.popup",
			props: { className: "fixed" },
			children: [{ ref: "base-ui/dialog.title", props: {}, text: "Hi" }],
		},
	],
};

const html = buildHtmlDocument({
	title: "P — D — B",
	tree,
	usedBaseUiComponents: ["dialog.popup", "dialog.title"],
	css: ".p-4{padding:1rem}",
	epoch: 1_700_000_000,
});

describe("buildHtmlDocument", () => {
	it("inlines the compiled css and escapes the title", () => {
		expect(html).toContain("<style>.p-4{padding:1rem}</style>");
		expect(html).toContain("<title>P — D — B</title>");
		expect(html).toContain('content="1700000000"');
	});

	it("imports each used base-ui subpath once from esm.sh with ?external", () => {
		expect(html).toContain('import { Dialog } from "@base-ui/react/dialog";');
		expect(html).toContain(
			"esm.sh/@base-ui/react@1.5.0/dialog?external=react,react-dom",
		);
		// Two components share the `dialog` subpath -> a single import.
		expect(html.match(/import \{ Dialog \}/g)?.length).toBe(1);
	});

	it("registers every used component", () => {
		expect(html).toContain('"base-ui/dialog.popup": Dialog.Popup,');
		expect(html).toContain('"base-ui/dialog.title": Dialog.Title,');
	});

	it("ships a plain module runtime with an import map and no Babel", () => {
		expect(html).toContain('<script type="importmap">');
		expect(html).toContain('"react-dom/client"');
		expect(html).toContain('<script type="module">');
		expect(html).toContain("const TREE =");
		expect(html.toLowerCase()).not.toContain("babel");
	});

	it("does not hardcode fonts, and inlines provided system fonts", () => {
		expect(html).not.toContain("ibm-plex");
		const withFonts = buildHtmlDocument({
			title: "T",
			tree,
			usedBaseUiComponents: [],
			css: "",
			epoch: 1,
			fonts: {
				stylesheetLinks: ["https://fonts.example/x.css"],
				fontFaceCss: '@font-face{font-family:"X"}',
			},
		});
		expect(withFonts).toContain(
			'<link rel="stylesheet" href="https://fonts.example/x.css"',
		);
		expect(withFonts).toContain('<style>@font-face{font-family:"X"}</style>');
	});
});

describe("charts in an export", () => {
	const build = (used: ReadonlySet<"chart" | "map">) =>
		buildHtmlDocument({
			title: "t",
			tree,
			usedBaseUiComponents: [],
			usedChartComponents: used,
			css: "",
			epoch: 1,
		});

	it("embeds nothing on a board without a chart", () => {
		const output = build(new Set());
		expect(output).not.toContain("trickroom-charts");
		expect(output).not.toContain("world-atlas");
	});

	it("embeds the chart code once, behind the import map", () => {
		const output = build(new Set(["chart"]));
		expect(output).toContain(
			'import { ChartElement } from "trickroom-charts";',
		);
		expect(output).toContain(
			'"trickroom-charts":"data:text/javascript;base64,',
		);
		expect(output).toContain('"charts/chart": ChartElement');
		expect(output).not.toContain("world-atlas");
	});

	it("loads the topology only for a board with a map", () => {
		const output = build(new Set(["map"]));
		expect(output).toContain("createMapElement(");
		expect(output).toContain("world-atlas@2.0.2/countries-110m.json");
		expect(output).toContain('"charts/map": MapElement');
	});

	it("leaves React bare in the embedded code, so the page has one React", () => {
		const runtime = build(new Set(["chart"])).match(
			/data:text\/javascript;base64,([A-Za-z0-9+/=]+)/u,
		)?.[1];
		const code = Buffer.from(runtime ?? "", "base64").toString();
		expect(code).toMatch(/from\s*["']react["']/u);
		expect(code).not.toContain("esm.sh");
	});
});
