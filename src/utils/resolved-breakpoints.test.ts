import { describe, expect, it } from "vitest";
import { defaultTailwindTokensByDomain } from "./default-tailwind-tokens";
import { parseBreakpointPx, resolveBreakpoints } from "./resolved-breakpoints";

const defaultBreakpoints = defaultTailwindTokensByDomain.breakpoint;

describe("parseBreakpointPx", () => {
	it("parses px and rem values", () => {
		expect(parseBreakpointPx("1024px")).toBe(1024);
		expect(parseBreakpointPx("40rem")).toBe(640);
		expect(parseBreakpointPx("30.5rem")).toBe(488);
	});

	it("returns null for unsupported breakpoint values", () => {
		expect(parseBreakpointPx("var(--breakpoint-md)")).toBeNull();
		expect(parseBreakpointPx("clamp(40rem, 50vw, 64rem)")).toBeNull();
	});
});

describe("resolveBreakpoints", () => {
	it("returns generated Tailwind default breakpoints sorted by px", () => {
		const resolved = resolveBreakpoints();

		expect(resolved.map(({ name }) => name)).toEqual([
			"sm",
			"md",
			"lg",
			"xl",
			"2xl",
		]);
		expect(resolved).toEqual(
			resolved.map((breakpoint) => ({
				...breakpoint,
				value:
					defaultBreakpoints[
						breakpoint.name as keyof typeof defaultBreakpoints
					],
				source: "default",
			})),
		);
		expect(resolved.every(({ px }) => px !== null)).toBe(true);
	});

	it("merges system breakpoints by overriding defaults and adding custom values", () => {
		const resolved = resolveBreakpoints({
			xs: "30rem",
			md: "50rem",
			"3xl": "1800px",
		});

		expect(resolved.map(({ name }) => name)).toEqual([
			"xs",
			"sm",
			"md",
			"lg",
			"xl",
			"2xl",
			"3xl",
		]);
		expect(resolved.find(({ name }) => name === "xs")).toMatchObject({
			value: "30rem",
			px: 480,
			source: "system",
		});
		expect(resolved.find(({ name }) => name === "md")).toMatchObject({
			value: "50rem",
			px: 800,
			source: "system",
		});
	});

	it("keeps unparseable breakpoints visible after parsed values in stable order", () => {
		const resolved = resolveBreakpoints({
			tiny: "320px",
			sm: "clamp(30rem, 50vw, 40rem)",
			fluid: "var(--breakpoint-fluid)",
		});

		expect(resolved.map(({ name }) => name)).toEqual([
			"tiny",
			"md",
			"lg",
			"xl",
			"2xl",
			"sm",
			"fluid",
		]);
		expect(resolved.find(({ name }) => name === "sm")).toMatchObject({
			value: "clamp(30rem, 50vw, 40rem)",
			px: null,
			source: "system",
		});
		expect(resolved.find(({ name }) => name === "fluid")).toMatchObject({
			value: "var(--breakpoint-fluid)",
			px: null,
			source: "system",
		});
	});
});
