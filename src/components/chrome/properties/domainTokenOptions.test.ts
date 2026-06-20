import { describe, expect, it } from "vitest";
import {
	animationTokenOptions,
	blendModeTokenOptions,
	columnsTokenOptions,
	durationTokenOptions,
	easingTokenOptions,
	offsetTokenOptions,
	percentStopTokenOptions,
	radiusTokenOptions,
	rotateTokenOptions,
	scaleTokenOptions,
	spacingTokenOptions,
	zIndexTokenOptions,
} from "./domainTokenOptions";

describe("offsetTokenOptions", () => {
	it("resolves the spacing scale through the multiplier and appends offset keywords", () => {
		const options = offsetTokenOptions(4);
		const two = options.find((option) => option.value === "2");
		expect(two?.resolved).toBe("8px");
		expect(options.map((option) => option.value)).toEqual(
			expect.arrayContaining(["px", "1/2", "full", "auto"]),
		);
	});

	it("hides the resolved column when the multiplier is unknown", () => {
		const two = offsetTokenOptions(null).find((option) => option.value === "2");
		expect(two?.resolved).toBeUndefined();
	});
});

describe("spacingTokenOptions", () => {
	it("is the plain scale without offset keywords", () => {
		const values = spacingTokenOptions(4).map((option) => option.value);
		expect(values).toContain("px");
		expect(values).not.toContain("auto");
		expect(values).not.toContain("full");
	});
});

describe("static scales", () => {
	it("z-index offers Tailwind's steps plus auto", () => {
		expect(zIndexTokenOptions().map((option) => option.value)).toEqual([
			"0",
			"10",
			"20",
			"30",
			"40",
			"50",
			"auto",
		]);
	});

	it("rotate and scale resolve their unit columns", () => {
		expect(
			rotateTokenOptions().find((option) => option.value === "45")?.resolved,
		).toBe("45deg");
		expect(
			scaleTokenOptions().find((option) => option.value === "150")?.resolved,
		).toBe("150%");
	});

	it("durations resolve to milliseconds", () => {
		expect(
			durationTokenOptions().find((option) => option.value === "300")?.resolved,
		).toBe("300ms");
	});

	it("percent stops carry the % in the value itself", () => {
		const values = percentStopTokenOptions().map((option) => option.value);
		expect(values[0]).toBe("0%");
		expect(values).toContain("50%");
		expect(values.at(-1)).toBe("100%");
	});

	it("blend modes and columns include their keywords", () => {
		expect(blendModeTokenOptions().map((o) => o.value)).toContain("multiply");
		expect(columnsTokenOptions().map((o) => o.value)).toContain("auto");
	});
});

describe("named domain scales", () => {
	const radius = new Map([
		["sm", "0.25rem"],
		["md", "0.375rem"],
		["DEFAULT", "0.25rem"],
	]);

	it("radius drops DEFAULT and wraps with none/full", () => {
		const values = radiusTokenOptions(radius).map((option) => option.value);
		expect(values[0]).toBe("none");
		expect(values.at(-1)).toBe("full");
		expect(values).toContain("sm");
		expect(values).not.toContain("DEFAULT");
	});

	it("easing prepends linear to the synced ease tokens", () => {
		const ease = new Map([["in-out", "cubic-bezier(0.4, 0, 0.2, 1)"]]);
		const options = easingTokenOptions(ease);
		expect(options[0]?.value).toBe("linear");
		expect(options.find((option) => option.value === "in-out")?.resolved).toBe(
			"cubic-bezier(0.4, 0, 0.2, 1)",
		);
	});

	it("animation appends none to the synced animate tokens", () => {
		const animate = new Map([["spin", "spin 1s linear infinite"]]);
		const values = animationTokenOptions(animate).map((option) => option.value);
		expect(values).toEqual(["spin", "none"]);
	});
});
