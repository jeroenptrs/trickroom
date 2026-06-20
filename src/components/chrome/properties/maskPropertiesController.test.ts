import { describe, expect, it } from "vitest";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";
import { maskUtility } from "./maskPropertiesController";

const opts = { colorTokens: new Set(["red-500"]) };

describe("maskPropertiesController", () => {
	it("writes mask size without clobbering background utilities", () => {
		const next = applyStyleUtility(
			"bg-cover mask-alpha unknown-card",
			opts,
			"mask.mask-size",
			maskUtility("mask.mask-size", "contain"),
		);
		expect(next).toBe("bg-cover mask-alpha unknown-card mask-contain");
	});

	it("replaces only the targeted mask slot", () => {
		const next = applyStyleUtility(
			"mask-cover mask-center mask-alpha",
			opts,
			"mask.mask-position",
			maskUtility("mask.mask-position", "top"),
		);
		expect(next).toBe("mask-cover mask-top mask-alpha");
	});

	it("clears one mask property without touching unrelated classes", () => {
		expect(
			clearStyleProperty("mask-cover bg-red-500", opts, "mask.mask-size"),
		).toBe("bg-red-500");
	});

	it("reads active mask values and preserves unknown classes", () => {
		expect(
			styleValueText(getStyleIntent("mask-cover mask-center", opts, "mask.mask-size")),
		).toBe("cover");
		expect(
			styleValueText(
				getStyleIntent("mask-cover mask-center", opts, "mask.mask-position"),
			),
		).toBe("center");
		expect(
			applyStyleUtility(
				"mask-cover unknown-mask-token",
				opts,
				"mask.mask-repeat",
				maskUtility("mask.mask-repeat", "no-repeat"),
			),
		).toBe("mask-cover unknown-mask-token mask-no-repeat");
	});
});
