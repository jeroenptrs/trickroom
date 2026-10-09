import { describe, expect, it } from "vitest";
import {
	compareCompiledClasses,
	EMPTY_STYLESHEET_FACTS,
	type StylesheetFacts,
	scanStylesheetFacts,
	selectorSpecificity,
	type ThemeValues,
} from "./tailwind-canonical-equivalence";

/**
 * The comparison on hand-written CSS, for the shapes real Tailwind output
 * rarely produces; `src/lint/rules/non-canonical-class.test.ts` runs it on
 * real canonical forms through the worker.
 */

const theme: ThemeValues = (name) =>
	({
		"--spacing": "0.25rem",
		"--color-white": "#fff",
		"--radius-sm": "0.25rem",
	})[name];

const rule = (selector: string, body: string) =>
	`${selector} {\n  ${body}\n}\n`;

const compare = (
	original: string | null,
	canonical: string | null,
	{
		values = theme,
		stylesheet = EMPTY_STYLESHEET_FACTS,
	}: { values?: ThemeValues; stylesheet?: StylesheetFacts } = {},
) =>
	compareCompiledClasses(
		{ candidate: "a", css: original },
		{ candidate: "b", css: canonical },
		{ theme: values, stylesheet },
	);

const registration = (name: string, body = 'syntax: "*"; inherits: false;') =>
	`@property ${name} {\n  ${body}\n}\n`;

describe("compareCompiledClasses", () => {
	it("rejects a canonical form that compiles to nothing", () => {
		expect(compare(rule(".a", "display: none;"), null)).toEqual({
			status: "different",
			reason: "compiles to no CSS",
		});
		expect(compare(rule(".a", "display: none;"), "")).toMatchObject({
			status: "different",
		});
	});

	it("substitutes the class and normalises whitespace, quoting and compound order", () => {
		expect(
			compare(
				rule(".a[data-x=y]:hover >  *", "display:none"),
				rule('.b:hover[data-x="y"] > *', "display: none"),
			),
		).toEqual({ status: "equivalent" });
	});

	it("unwraps `:is()` only where matching and specificity stay the same", () => {
		// A compound argument, anywhere.
		expect(
			compare(
				rule(".a:has([data-invalid])", "padding: 1px;"),
				rule(".b:has(:is([data-invalid]))", "padding: 1px;"),
			),
		).toEqual({ status: "equivalent" });
		// A complex argument in the first compound.
		expect(
			compare(
				rule(".a *[data-x]", "display: none;"),
				rule(":is(.b *)[data-x]", "display: none;"),
			),
		).toEqual({ status: "equivalent" });
		// Not after a combinator: `.p :is(.q .a)` lets `.q` sit outside `.p`.
		expect(
			compare(
				rule(".p .q .a", "display: none;"),
				rule(".p :is(.q .b)", "display: none;"),
			),
		).toMatchObject({ status: "different" });
		// Not in a relative selector: `:has(:is(.q .x))` lets `.q` sit outside.
		expect(
			compare(
				rule(".a:has(.q .x)", "display: none;"),
				rule(".b:has(:is(.q .x))", "display: none;"),
			),
		).toMatchObject({ status: "different" });
	});

	it("rejects a `:where()` the class did not have, naming the specificity", () => {
		expect(
			compare(
				rule("[data-open] .a", "display: none;"),
				rule(":where([data-open]) .b", "display: none;"),
			),
		).toEqual({
			status: "different",
			reason:
				'applies under ":where([data-open]) &" where the class applies under "[data-open] &" (specificity 0,2,0 becomes 0,1,0)',
		});
	});

	it("rejects other declarations, `!important` and at-rules", () => {
		expect(
			compare(rule(".a", "display: none;"), rule(".b", "display: block;")),
		).toMatchObject({ status: "different" });
		expect(
			compare(
				rule(".a", "display: none !important;"),
				rule(".b", "display: none;"),
			),
		).toMatchObject({ status: "different" });
		expect(
			compare(
				rule(".a", "display: none; color: red;"),
				rule(".b", "display: none;"),
			),
		).toMatchObject({ status: "different" });
		expect(
			compare(
				`@media (width < 64rem) {\n${rule(".a", "display: none;")}}`,
				`@media (width < 48rem) {\n${rule(".b", "display: none;")}}`,
			),
		).toMatchObject({ status: "different" });
	});

	it("rejects a registration only the canonical form adds, unless the stylesheets already have it", () => {
		// `[transform:var(--tw-rotate-x)]` and `transform-(--tw-rotate-x)`: the
		// registration makes `--tw-rotate-x` stop inheriting.
		const base = rule(".a", "transform: var(--tw-rotate-x);");
		const added = `${rule(".b", "transform: var(--tw-rotate-x);")}${registration("--tw-rotate-x")}`;
		expect(compare(base, added)).toEqual({
			status: "different",
			reason:
				"registers --tw-rotate-x (@property), which the class does not and the stylesheets do not already",
		});
		expect(
			compare(base, added, {
				stylesheet: scanStylesheetFacts(
					registration("--tw-rotate-x", 'inherits: false; syntax: "*";'),
				),
			}),
		).toEqual({ status: "equivalent" });
		expect(
			compare(base, added, {
				stylesheet: scanStylesheetFacts(
					registration("--tw-rotate-x", 'syntax: "*"; inherits: true;'),
				),
			}),
		).toMatchObject({ status: "different" });
		// One the class has and the form lacks or changes.
		const withContent = `${base}${registration("--tw-content", 'syntax: "*"; initial-value: "";')}`;
		const plain = rule(".b", "transform: var(--tw-rotate-x);");
		expect(compare(withContent, plain)).toMatchObject({ status: "different" });
		expect(
			compare(
				withContent,
				`${plain}${registration("--tw-content", 'syntax: "*";')}`,
			),
		).toMatchObject({ status: "different" });
	});

	it("does not unwrap an `:is()` with a pseudo-element", () => {
		// `:is(.b::before)` matches nothing.
		expect(
			compare(
				rule(".a::before", "display: none;"),
				rule(":is(.b::before)", "display: none;"),
			),
		).toMatchObject({ status: "different" });
		expect(
			compare(
				rule(".p .a::before", "display: none;"),
				rule(":is(.p .b::before)", "display: none;"),
			),
		).toMatchObject({ status: "different" });
	});

	it("leaves strings and `url()` as written and compares numbers exactly", () => {
		expect(
			compare(
				rule(".a", 'content: "calc(1 * -1)";'),
				rule(".b", 'content: "-1";'),
			),
		).toMatchObject({ status: "different" });
		expect(
			compare(
				rule(".a", "mask-image: url(#abc);"),
				rule(".b", "mask-image: url(#aabbcc);"),
			),
		).toMatchObject({ status: "different" });
		expect(
			compare(rule(".a", "opacity: 0.0000001;"), rule(".b", "opacity: 0;")),
		).toMatchObject({ status: "different" });
		// Spelling only: the same numbers, units and colours.
		expect(
			compare(
				rule(".a", "opacity: .50; color: #FFF; translate: 10PX 0"),
				rule(".b", "opacity: 0.5; color: #ffffff; translate: 10px 0"),
			),
		).toEqual({ status: "equivalent" });
		// `1e1` is a number and `10` an integer: kept apart (see round 2).
		expect(
			compare(
				rule(".a", "translate: 1e1px 0;"),
				rule(".b", "translate: 10px 0;"),
			),
		).toMatchObject({ status: "different" });
	});

	it("replaces `calc()` by its result only where the property treats both alike", () => {
		const pair = (property: string, folded: string, literal: string) =>
			compare(
				rule(".a", `${property}: ${folded};`),
				rule(".b", `${property}: ${literal};`),
			).status;
		// Integer properties: an integer result only. `z-index: -1.5` is
		// invalid where `calc(1.5 * -1)` rounds to -1 (`-z-[1.5]`, `z-[-1.5]`).
		expect(pair("z-index", "calc(1 * -1)", "-1")).toBe("equivalent");
		expect(pair("z-index", "calc(1.5 * -1)", "-1.5")).toBe("different");
		// Lengths that may be negative, and those that may not when it is not.
		expect(pair("margin-top", "calc(1px * -1)", "-1px")).toBe("equivalent");
		expect(pair("width", "calc(0.25rem * 154)", "38.5rem")).toBe("equivalent");
		expect(pair("width", "calc(1px * -1)", "-1px")).toBe("different");
		// A unitless result where a length is expected, or any other property.
		expect(pair("width", "calc(0 * 1)", "0")).toBe("different");
		expect(pair("opacity", "calc(1 / 2)", "0.5")).toBe("different");
		expect(pair("--tw-translate-x", "calc(1px * -1)", "-1px")).toBe(
			"different",
		);
		// Inside another function: not folded.
		expect(pair("margin", "max(calc(1px * 2), 0px)", "max(2px, 0px)")).toBe(
			"different",
		);
		expect(pair("width", "calc(100% - 2rem)", "calc(100% - 32px)")).toBe(
			"different",
		);
	});

	it("treats a token reference as equal and theme arithmetic as theme-dependent", () => {
		expect(
			compare(
				rule(".a", "background-color: #FFF;"),
				rule(".b", "background-color: var(--color-white);"),
			),
		).toEqual({ status: "equivalent" });
		expect(
			compare(
				rule(".a", "width: 38.5rem;"),
				rule(".b", "width: calc(var(--spacing) * 154);"),
			),
		).toEqual({ status: "theme-dependent", themeVariables: ["--spacing"] });
		// The same arithmetic on both sides needs no theme.
		expect(
			compare(
				rule(".a", "padding: calc(var(--spacing)*2);"),
				rule(".b", "padding: calc(var(--spacing) * 2);"),
			),
		).toEqual({ status: "equivalent" });
		// The same variable on both sides, inside a math function: equal only
		// for the current value (here `0px`).
		expect(
			compare(
				rule(".a", "padding: calc(var(--spacing)*2);"),
				rule(".b", "padding: calc(var(--spacing) * 3);"),
				{
					values: (name) => (name === "--spacing" ? "0px" : theme(name)),
				},
			),
		).toEqual({ status: "theme-dependent", themeVariables: ["--spacing"] });
		// A variable outside the theme is never substituted.
		expect(
			compare(rule(".a", "width: 1rem;"), rule(".b", "width: var(--unknown);")),
		).toMatchObject({ status: "different" });
	});
});

describe("round 2: numbers and `calc()` the browser reads otherwise", () => {
	const pair = (property: string, original: string, canonical: string) =>
		compare(
			rule(".a", `${property}: ${original};`),
			rule(".b", `${property}: ${canonical};`),
		).status;

	it("keeps CSS's integer flag: `1.0` is a number, `1` an integer", () => {
		// `order-[1.0]` and `col-start-[1.0]` are invalid in the browser.
		expect(pair("order", "1.0", "1")).toBe("different");
		expect(pair("grid-column-start", "1.0", "1")).toBe("different");
		expect(pair("order", "1e0", "1")).toBe("different");
		// Spellings of the same number, and a whole `calc()` for an integer.
		expect(pair("opacity", ".50", "0.5")).toBe("equivalent");
		expect(pair("order", "calc(1 * -1)", "-1")).toBe("equivalent");
		expect(pair("order", "calc(1 * -1)", "-1.0")).toBe("different");
	});

	it("does not fold `+` or `-` without whitespace on both sides", () => {
		expect(pair("margin-top", "calc(1px+ 1px)", "2px")).toBe("different");
		expect(pair("margin-top", "calc(1px +1px)", "2px")).toBe("different");
		expect(pair("margin-top", "calc(1px + 1px)", "2px")).toBe("equivalent");
		expect(pair("margin-top", "calc(3px*2)", "6px")).toBe("equivalent");
	});

	it("does not fold past safe magnitudes or precision, or any division", () => {
		// Chromium: `0px`, not `1px`.
		expect(
			pair(
				"margin-top",
				"calc(10000000000000000px + 1px - 10000000000000000px)",
				"1px",
			),
		).toBe("different");
		expect(pair("margin-top", "calc(0.0000001px * 10)", "0.000001px")).toBe(
			"different",
		);
		expect(pair("margin-top", "calc(4px / 2)", "2px")).toBe("different");
	});

	it("keeps the sign of zero", () => {
		expect(pair("width", "calc(1px/-0)", "calc(1px/0)")).toBe("different");
		expect(pair("margin-top", "calc(1px * -0)", "0px")).toBe("different");
	});
});

describe("round 2: only unconditional registrations justify an added one", () => {
	const base = rule(".a", "transform: var(--tw-rotate-x);");
	const added = `${rule(".b", "transform: var(--tw-rotate-x);")}${registration("--tw-rotate-x")}`;
	const withSheet = (css: string) =>
		compare(base, added, { stylesheet: scanStylesheetFacts(css) }).status;

	it("accepts one at the top level or inside `@layer` only", () => {
		expect(withSheet(registration("--tw-rotate-x"))).toBe("equivalent");
		expect(
			withSheet(`@layer properties {\n${registration("--tw-rotate-x")}}\n`),
		).toBe("equivalent");
		expect(
			withSheet(
				`@import "tailwindcss" source("../src");\n@import "./a.css" layer(base);\n${registration("--tw-rotate-x")}`,
			),
		).toBe("equivalent");
	});

	it("rejects one under a condition, or next to one", () => {
		expect(
			withSheet(`@media (width < 0px) {\n${registration("--tw-rotate-x")}}\n`),
		).toBe("different");
		expect(
			withSheet(
				`@supports (display: grid) {\n${registration("--tw-rotate-x")}}\n`,
			),
		).toBe("different");
		expect(
			withSheet(
				`${registration("--tw-rotate-x")}@media (width < 0px) {\n${registration("--tw-rotate-x")}}\n`,
			),
		).toBe("different");
	});

	it("rejects every registration once an import may be conditional", () => {
		for (const condition of [
			"(width < 0px)",
			"supports(display: grid)",
			"layer(base) screen",
			"reference",
			"theme(static)",
		]) {
			expect(
				withSheet(
					`@import "./a.css" ${condition};\n${registration("--tw-rotate-x")}`,
				),
				condition,
			).toBe("different");
		}
	});
});

describe("theme variables the stylesheets set outside `@theme`", () => {
	it("makes an equality through them theme-dependent", () => {
		const stylesheet = scanStylesheetFacts(
			'@import "tailwindcss";\n@theme { --color-white: #fff; }\n.dark { --color-white: #000; }\n',
		);
		expect(
			compare(
				rule(".a", "background-color: #FFF;"),
				rule(".b", "background-color: var(--color-white);"),
				{ stylesheet },
			),
		).toEqual({
			status: "theme-dependent",
			themeVariables: ["--color-white"],
		});
		// Unreadable stylesheets: no variable can be relied on.
		expect(
			compare(
				rule(".a", "background-color: #FFF;"),
				rule(".b", "background-color: var(--color-white);"),
				{ stylesheet: scanStylesheetFacts(".dark { --x: 1;") },
			),
		).toMatchObject({ status: "theme-dependent" });
	});
});

describe("scanStylesheetFacts", () => {
	it("collects custom properties set outside `@theme`, in any rule or at-rule", () => {
		const facts = scanStylesheetFacts(
			[
				'@import "./theme.css" layer(theme);',
				"@theme { --color-white: #fff; --radius-sm: 0.25rem; }",
				"@theme inline { --font-sans: var(--brand-font); }",
				"/* .x { --in-comment: 1; } */",
				"@layer base { :root { --brand-font: Inter; } }",
				"@media (prefers-color-scheme: dark) { :root { --color-white: #000; } }",
				"@supports (color: oklch(0 0 0)) { .x { --color-black: oklch(0 0 0); } }",
				'.y { background: url("a;b{c}.svg"); --radius-lg: 1rem; }',
				"@utility card { --spacing: 2px; }",
			].join("\n"),
		);
		expect(facts.complete).toBe(true);
		expect([...facts.contextVariables].sort()).toEqual([
			"--brand-font",
			"--color-black",
			"--color-white",
			"--radius-lg",
			"--spacing",
		]);
	});

	it("collects `@property` registrations, null for a name registered two ways", () => {
		const facts = scanStylesheetFacts(
			[
				registration("--a"),
				registration("--a", 'inherits: false; syntax: "*";'),
				registration("--b"),
				registration("--b", 'syntax: "<length>"; inherits: false;'),
			].join(""),
		);
		expect(facts.registrations.get("--a")).toEqual(expect.any(String));
		expect(facts.registrations.get("--b")).toBeNull();
	});

	it("marks text it cannot read as incomplete", () => {
		expect(scanStylesheetFacts(".x { --a: 1;").complete).toBe(false);
		expect(scanStylesheetFacts(".x { --a: 1; } }").complete).toBe(false);
		expect(scanStylesheetFacts("/* open").complete).toBe(false);
	});
});

describe("selectorSpecificity", () => {
	it("counts `:where()` as nothing and `:is()`, `:not()`, `:has()` as their most specific argument", () => {
		expect(selectorSpecificity("[data-open] .a")).toEqual([0, 2, 0]);
		expect(selectorSpecificity(":where([data-open]) .a")).toEqual([0, 1, 0]);
		expect(selectorSpecificity(":is(#x, .y) .a")).toEqual([1, 1, 0]);
		expect(selectorSpecificity(".a:not(.b.c)")).toEqual([0, 3, 0]);
		expect(selectorSpecificity(".a:has(> #x)")).toEqual([1, 1, 0]);
		expect(selectorSpecificity("div::before")).toEqual([0, 0, 2]);
		expect(selectorSpecificity("* > *")).toEqual([0, 0, 0]);
	});
});
