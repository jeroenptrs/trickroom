import { describe, expect, it } from "vitest";
import { computeResolvedColorTokens } from "../../../utils/resolved-color-tokens";
import type { ColorIntent } from "../../../utils/tailwind-classname";
import { appearanceFromIntent } from "./colorSwatchAppearance";

const resolved = computeResolvedColorTokens({
	meaningfulTokens: {
		"red-500": "oklch(0.6 0.2 25)",
		"brand-primary": "#abcdef",
	},
});

function colorIntent(overrides: Partial<ColorIntent> = {}): ColorIntent {
	return {
		kind: "color",
		property: "background",
		token: null,
		arbitraryValue: null,
		keyword: null,
		resolved: true,
		...overrides,
	};
}

describe("appearanceFromIntent", () => {
	it("renders `transparent` keyword as a checkerboard", () => {
		expect(
			appearanceFromIntent(colorIntent({ keyword: "transparent" }), resolved),
		).toEqual({ kind: "transparent" });
	});

	it("renders `current` and `inherit` keywords as empty swatches", () => {
		expect(
			appearanceFromIntent(colorIntent({ keyword: "current" }), resolved),
		).toEqual({ kind: "empty" });
		expect(
			appearanceFromIntent(colorIntent({ keyword: "inherit" }), resolved),
		).toEqual({ kind: "empty" });
	});

	it("renders an arbitrary value verbatim, replacing `_` with spaces", () => {
		expect(
			appearanceFromIntent(
				colorIntent({ arbitraryValue: "[oklch(50%_0.1_0)]" }),
				resolved,
			),
		).toEqual({ kind: "color", cssValue: "oklch(50% 0.1 0)" });
	});

	it("renders an arbitrary hex value verbatim", () => {
		expect(
			appearanceFromIntent(
				colorIntent({ arbitraryValue: "[#abc]" }),
				resolved,
			),
		).toEqual({ kind: "color", cssValue: "#abc" });
	});

	it("renders a resolved token using the live CSS value", () => {
		expect(
			appearanceFromIntent(colorIntent({ token: "red-500" }), resolved),
		).toEqual({ kind: "color", cssValue: "oklch(0.6 0.2 25)" });
	});

	it("renders custom theme tokens with their stored value", () => {
		expect(
			appearanceFromIntent(colorIntent({ token: "brand-primary" }), resolved),
		).toEqual({ kind: "color", cssValue: "#abcdef" });
	});

	it("renders a stale token as a warning swatch", () => {
		expect(
			appearanceFromIntent(
				colorIntent({ token: "rose-999", resolved: false }),
				resolved,
			),
		).toEqual({ kind: "color", cssValue: "transparent", warning: true });
	});

	it("renders an intent with no token/keyword/arbitrary as empty", () => {
		expect(appearanceFromIntent(colorIntent(), resolved)).toEqual({
			kind: "empty",
		});
	});
});
