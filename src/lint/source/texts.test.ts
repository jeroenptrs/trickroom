import { describe, expect, it } from "vitest";
import { parseSourceModule } from "./parse";
import { decodeJsxEntities, normalizeJsxText } from "./texts";

const texts = (source: string) =>
	parseSourceModule("src/a.tsx", source, { classCalls: ["cn"] }).texts.map(
		(text) =>
			`${text.position.line}:${text.position.column} ${text.origin.kind === "jsx-attribute" ? `${text.origin.element}[${text.origin.attribute}]` : text.origin.element} ${JSON.stringify(text.value)}`,
	);

describe("source texts", () => {
	it("records JSX text children as React renders them, and literal children", () => {
		expect(
			texts(
				[
					"declare const on: boolean;",
					"declare const t: (key: string) => string;",
					"export const A = () => (",
					"\t<p>",
					"\t\tSaved &mdash; really",
					// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture source with a template literal
					'\t\t  done&#33; {on ? "Yes" : `No`}{on && "Busy"}{t("x")}{`a${on}`}',
					"\t\t<>In a fragment</>",
					"\t</p>",
					");",
				].join("\n"),
			),
		).toEqual([
			'5:3 p "Saved — really done! "',
			'6:22 p "Yes"',
			'6:30 p "No"',
			'6:42 p "Busy"',
			'7:5 <> "In a fragment"',
		]);
	});

	it("records string attribute values, never className, style or key", () => {
		expect(
			texts(
				[
					"declare const on: boolean;",
					'export const A = () => <Field.Input label="Name &amp; email" aria-label={on ? "Open" : "Closed"} className="p-2" key="k" title={`Hi`} disabled />;',
				].join("\n"),
			),
		).toEqual([
			'2:44 Field.Input[label] "Name & email"',
			'2:80 Field.Input[aria-label] "Open"',
			'2:89 Field.Input[aria-label] "Closed"',
			'2:130 Field.Input[title] "Hi"',
		]);
	});

	it("normalizes whitespace and decodes entities", () => {
		expect(normalizeJsxText("\n   \n  ")).toBeNull();
		expect(normalizeJsxText("  a  b  ")).toEqual({
			value: "  a  b  ",
			offset: 2,
		});
		expect(decodeJsxEntities("&rarr; &#x2192; &unknown; &lt;")).toBe(
			"→ → &unknown; <",
		);
	});
});
