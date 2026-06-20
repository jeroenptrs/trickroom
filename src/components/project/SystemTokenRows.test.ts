import { describe, expect, it } from "vitest";
import { isColorLikeValue } from "./SystemTokenRows";

describe("isColorLikeValue", () => {
	it("recognizes color keywords and hex values by full match", () => {
		expect(isColorLikeValue("#f00")).toBe(true);
		expect(isColorLikeValue("#ff0000")).toBe(true);
		expect(isColorLikeValue("transparent")).toBe(true);
		expect(isColorLikeValue("currentColor")).toBe(true);
		expect(isColorLikeValue("#ff0000 extra")).toBe(false);
	});

	it("recognizes functional CSS color values", () => {
		expect(isColorLikeValue("rgb(255,0,0)")).toBe(true);
		expect(isColorLikeValue("rgba(255, 0, 0, 0.5)")).toBe(true);
		expect(isColorLikeValue("hsl(120 100% 50%)")).toBe(true);
		expect(isColorLikeValue("hsla(120, 100%, 50%, 0.5)")).toBe(true);
		expect(isColorLikeValue("hwb(90 10% 10%)")).toBe(true);
		expect(isColorLikeValue("lab(50% 40 30)")).toBe(true);
		expect(isColorLikeValue("lch(50% 40 30)")).toBe(true);
		expect(isColorLikeValue("oklab(0.6 0.1 0.2)")).toBe(true);
		expect(isColorLikeValue("oklch(0.6 0.1 20)")).toBe(true);
		expect(isColorLikeValue("color(display-p3 1 0 0)")).toBe(true);
		expect(isColorLikeValue("color-mix(in oklab, red, white)")).toBe(true);
		expect(isColorLikeValue("var(--brand-color)")).toBe(true);
	});

	it("rejects incomplete functional color prefixes", () => {
		expect(isColorLikeValue("rgb(")).toBe(false);
		expect(isColorLikeValue("var(--")).toBe(false);
	});
});
