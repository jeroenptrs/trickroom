import { describe, expect, it } from "vitest";
import {
	normalizeCssSource,
	parseStylesheet,
	readImportTarget,
	serializeNormalized,
} from "./css-source";

describe("normalizeCssSource", () => {
	it("drops comments without turning them into whitespace", () => {
		// `&/**/:hover` is self-hover; `& :hover` is descendant hover.
		expect(normalizeCssSource("&/**/:hover { color: red }")).not.toBe(
			normalizeCssSource("& :hover { color: red }"),
		);
		expect(normalizeCssSource("&/**/:hover { color: red }")).toBe(
			normalizeCssSource("&:hover { color: red }"),
		);
	});

	it("keeps words a dropped comment separated apart", () => {
		expect(normalizeCssSource("div/**/span {}")).not.toBe(
			normalizeCssSource("divspan {}"),
		);
	});

	it("collapses whitespace, and drops it next to braces and semicolons", () => {
		expect(
			normalizeCssSource(
				"/* x */\n@theme{\n\n\t--color-a:   #123 ;\n}\n.a , .b { margin : 0 auto }",
			),
		).toBe("@theme{--color-a: #123;}.a , .b{margin : 0 auto}");
	});

	it("keeps strings verbatim, comment markers inside them included", () => {
		expect(normalizeCssSource('a { content: "a  /* b */  c" }')).toBe(
			'a{content: "a  /* b */  c"}',
		);
	});

	it("tells content edits apart", () => {
		expect(normalizeCssSource("a { color: red; }")).not.toBe(
			normalizeCssSource("a { color: blue; }"),
		);
	});
});

describe("serializeNormalized", () => {
	it("leaves comments and layout out, and keeps strings as written", () => {
		const root = parseStylesheet(
			'@utility quote {\n  /* note */\n  content:   "a  b" ;\n  &:hover { color : red !important }\n}',
		);
		const utilities: string[] = [];
		root?.walkAtRules("utility", (utility) => {
			utilities.push(serializeNormalized(utility));
		});

		expect(utilities).toEqual([
			'@utility quote{content:"a  b";&:hover{color:red!important;}}',
		]);
	});

	it("serializes statements and nested at-rules", () => {
		expect(
			serializeNormalized(
				parseStylesheet(
					'@import "./a.css"  layer( base );\n@layer theme { @theme inline { --color-x: url("a;b"); } }',
				) as NonNullable<ReturnType<typeof parseStylesheet>>,
			),
		).toBe(
			'@import "./a.css" layer( base );@layer theme{@theme inline{--color-x:url("a;b");}}',
		);
	});

	it("gives null for what postcss cannot parse", () => {
		expect(parseStylesheet("a { color: red")).toBeNull();
		expect(parseStylesheet("a { color: red; } }")).toBeNull();
		expect(parseStylesheet("a { color: red; }")).not.toBeNull();
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
