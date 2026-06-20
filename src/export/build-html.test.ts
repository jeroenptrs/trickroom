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
