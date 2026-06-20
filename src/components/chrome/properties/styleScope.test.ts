import { describe, expect, it } from "vitest";
import { collectScopeChains, scopeVariants } from "./styleScope";

const BREAKPOINTS = ["sm", "md", "lg", "xl", "2xl"];

describe("collectScopeChains", () => {
	it("collects distinct variant chains, selectors before breakpoints", () => {
		expect(
			collectScopeChains(
				"md:flex hover:bg-red-500 flex p-4 hover:text-sm md:hover:underline",
				BREAKPOINTS,
			),
		).toEqual(["hover", "md", "md:hover"]);
	});

	it("returns no chains for a base-only className", () => {
		expect(collectScopeChains("flex p-4", BREAKPOINTS)).toEqual([]);
	});

	it("orders unknown chains by appearance after selectors and breakpoints", () => {
		expect(
			collectScopeChains(
				"aria-busy:opacity-50 lg:flex group-hover:underline focus:ring-2",
				BREAKPOINTS,
			),
		).toEqual(["focus", "lg", "aria-busy", "group-hover"]);
	});

	it("offers dark as a scope, after selectors and breakpoints (todo 572)", () => {
		expect(collectScopeChains("dark:bg-slate-900 flex", BREAKPOINTS)).toEqual([
			"dark",
		]);
		expect(
			collectScopeChains(
				"dark:bg-slate-900 md:flex hover:underline dark:hover:bg-slate-800",
				BREAKPOINTS,
			),
		).toEqual(["hover", "md", "dark", "dark:hover"]);
	});

	it("counts chains on unclassified custom utilities", () => {
		expect(
			collectScopeChains("hover:text-interaction-primary", BREAKPOINTS),
		).toEqual(["hover"]);
	});
});

describe("scopeVariants", () => {
	it("maps the base scope to no variants", () => {
		expect(scopeVariants("")).toEqual([]);
	});

	it("splits compound chains", () => {
		expect(scopeVariants("md:hover")).toEqual(["md", "hover"]);
	});
});
