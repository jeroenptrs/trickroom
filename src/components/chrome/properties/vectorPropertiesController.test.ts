import { describe, expect, it } from "vitest";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";
import { vectorUtility } from "./vectorPropertiesController";

const opts = { colorTokens: new Set(["blue-500", "red-500"]) };

describe("vectorPropertiesController", () => {
	it("writes stroke width without clobbering stroke color", () => {
		const next = applyStyleUtility(
			"stroke-blue-500 fill-red-500 unknown-card",
			opts,
			"vector.stroke-width",
			vectorUtility("vector.stroke-width", "2"),
		);
		expect(next).toBe("stroke-blue-500 fill-red-500 unknown-card stroke-2");
	});

	it("replaces only the targeted vector slot", () => {
		const next = applyStyleUtility(
			"stroke-2 stroke-blue-500 fill-red-500",
			opts,
			"vector.stroke-width",
			vectorUtility("vector.stroke-width", "1"),
		);
		expect(next).toBe("stroke-1 stroke-blue-500 fill-red-500");
	});

	it("clears stroke width without touching paint colors", () => {
		expect(
			clearStyleProperty("stroke-2 stroke-blue-500", opts, "vector.stroke-width"),
		).toBe("stroke-blue-500");
	});

	it("reads active vector values", () => {
		expect(
			styleValueText(getStyleIntent("stroke-2 fill-none", opts, "vector.stroke-width")),
		).toBe("2");
		expect(
			styleValueText(getStyleIntent("stroke-2 fill-none", opts, "vector.fill")),
		).toBe("none");
	});
});
