import { describe, expect, it } from "vitest";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";
import { typographyUtility } from "./typographyPropertiesController";

const opts = { colorTokens: new Set(["red-500"]) };

describe("typographyPropertiesController", () => {
	it("writes font size without clobbering text color", () => {
		const next = applyStyleUtility(
			"text-red-500 text-center unknown-card",
			opts,
			"typography.font-size",
			typographyUtility("typography.font-size", "sm"),
		);
		expect(next).toBe("text-red-500 text-center unknown-card text-sm");
	});

	it("replaces only the targeted typography slot", () => {
		const next = applyStyleUtility(
			"text-sm font-medium text-center",
			opts,
			"typography.font-weight",
			typographyUtility("typography.font-weight", "bold"),
		);
		expect(next).toBe("text-sm font-bold text-center");
	});

	it("clears one typography property without touching unrelated classes", () => {
		expect(
			clearStyleProperty(
				"text-sm font-bold text-red-500",
				opts,
				"typography.font-size",
			),
		).toBe("font-bold text-red-500");
	});

	it("reads active typography values", () => {
		expect(
			styleValueText(
				getStyleIntent("text-sm text-center", opts, "typography.font-size"),
			),
		).toBe("sm");
		expect(
			styleValueText(
				getStyleIntent("text-sm text-center", opts, "typography.text-align"),
			),
		).toBe("center");
		expect(
			getStyleIntent("text-sm", opts, "typography.text-align"),
		).toBeUndefined();
	});
});
