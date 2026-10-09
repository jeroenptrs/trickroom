import { describe, expect, it } from "vitest";
import {
	compareCompiledClasses,
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
	classes: [string, string] = ["a", "b"],
) =>
	compareCompiledClasses(
		{ candidate: classes[0], css: original },
		{ candidate: classes[1], css: canonical },
		theme,
	);

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

	it("ignores `@property --tw-*` registrations only the canonical form adds", () => {
		const registration = (
			name: string,
			body = 'syntax: "*"; inherits: false;',
		) => `@property ${name} {\n  ${body}\n}\n`;
		const base = rule(".a", "transform: skewX(-20deg);");
		const same = rule(".b", "transform: skewX(-20deg);");
		expect(compare(base, `${same}${registration("--tw-skew-x")}`)).toEqual({
			status: "equivalent",
		});
		// One the class has and the form lacks or changes, or another name.
		const withContent = `${base}${registration("--tw-content", 'syntax: "*"; initial-value: "";')}`;
		expect(compare(withContent, same)).toMatchObject({ status: "different" });
		expect(
			compare(
				withContent,
				`${same}${registration("--tw-content", 'syntax: "*";')}`,
			),
		).toMatchObject({ status: "different" });
		expect(compare(base, `${same}${registration("--brand-x")}`)).toMatchObject({
			status: "different",
		});
	});

	it("evaluates `calc()` over plain numbers and one unit", () => {
		expect(
			compare(rule(".a", "z-index: calc(1 * -1);"), rule(".b", "z-index: -1;")),
		).toEqual({ status: "equivalent" });
		expect(
			compare(
				rule(".a", "width: calc(100% - 2rem);"),
				rule(".b", "width: calc(100% - 32px);"),
			),
		).toMatchObject({ status: "different" });
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
		// A variable outside the theme is never substituted.
		expect(
			compare(rule(".a", "width: 1rem;"), rule(".b", "width: var(--unknown);")),
		).toMatchObject({ status: "different" });
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
