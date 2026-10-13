import { describe, expect, it } from "vitest";
import {
	findAtRules,
	normalizeCssSource,
	parseCss,
	readImportTarget,
	serializeCssNodes,
	stripCssComments,
} from "./css-source";

describe("stripCssComments", () => {
	it("removes comments outside strings only", () => {
		expect(stripCssComments('a { content: "/* kept */"; /* gone */ }')).toBe(
			'a { content: "/* kept */";   }',
		);
	});
});

describe("normalizeCssSource", () => {
	it("normalizes comments and whitespace outside strings", () => {
		expect(
			normalizeCssSource(
				"/* x */\n@theme{\n\n\t--color-a:   #123 ;\n}\n.a , .b { margin : 0 auto }",
			),
		).toBe("@theme{--color-a:#123;}.a,.b{margin :0 auto}");
	});

	it("keeps whitespace inside strings and before colons", () => {
		expect(normalizeCssSource('a { content: "a  b"; }')).toBe(
			'a{content:"a  b";}',
		);
		expect(normalizeCssSource("a :hover {}")).not.toBe(
			normalizeCssSource("a:hover {}"),
		);
	});

	it("tells content edits apart", () => {
		expect(normalizeCssSource("a { color: red; }")).not.toBe(
			normalizeCssSource("a { color: blue; }"),
		);
	});
});

describe("parseCss", () => {
	it("parses at-rules, rules and declarations, without comments", () => {
		const nodes = parseCss(
			'@import "./a.css" layer(base);\n@theme inline {\n  /* --color-*: initial; */\n  --color-x: url("a;b");\n}\n.a { color: red }',
		);

		expect(nodes).toEqual([
			{ type: "at-rule", name: "import", params: '"./a.css" layer(base)' },
			{
				type: "at-rule",
				name: "theme",
				params: "inline",
				nodes: [{ type: "decl", prop: "--color-x", value: 'url("a;b")' }],
			},
			{
				type: "rule",
				selector: ".a",
				nodes: [{ type: "decl", prop: "color", value: "red" }],
			},
		]);
	});

	it("finds nested at-rules and serializes them normalized", () => {
		const nodes = parseCss(
			"@layer theme { @theme { --color-*: initial; } }\n@utility tone { color: red; }",
		);

		expect(findAtRules(nodes, "theme")).toHaveLength(1);
		expect(serializeCssNodes(findAtRules(nodes, "utility"))).toBe(
			"@utility tone{color:red;}",
		);
	});
});

describe("readImportTarget", () => {
	it("reads quoted and url() imports", () => {
		expect(readImportTarget('"./a.css" layer(base)')).toBe("./a.css");
		expect(readImportTarget("'pkg'")).toBe("pkg");
		expect(readImportTarget('url("./b.css") screen')).toBe("./b.css");
		expect(readImportTarget("url(./c.css)")).toBe("./c.css");
	});
});
