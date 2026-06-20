import { describe, expect, it } from "vitest";
import { applyColorChange, applyColorClear } from "./colorPropertiesController";
import { interactionUtility } from "./interactionPropertiesController";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";

const opts = { colorTokens: new Set(["red-500", "blue-500"]) };

describe("interactionPropertiesController", () => {
	it("writes cursor without clobbering pointer-events", () => {
		const next = applyStyleUtility(
			"pointer-events-none unknown-card",
			opts,
			"interaction.cursor",
			interactionUtility("interaction.cursor", "pointer"),
		);
		expect(next).toBe("pointer-events-none unknown-card cursor-pointer");
	});

	it("replaces only the targeted interaction slot", () => {
		const next = applyStyleUtility(
			"cursor-pointer select-none resize",
			opts,
			"interaction.user-select",
			interactionUtility("interaction.user-select", "all"),
		);
		expect(next).toBe("cursor-pointer select-all resize");
	});

	it("clears one interaction property without touching unrelated classes", () => {
		expect(
			clearStyleProperty(
				"cursor-pointer bg-red-500",
				opts,
				"interaction.cursor",
			),
		).toBe("bg-red-500");
	});

	it("reads active interaction values and preserves unknown classes", () => {
		expect(
			styleValueText(
				getStyleIntent("cursor-wait scroll-smooth", opts, "interaction.cursor"),
			),
		).toBe("wait");
		expect(
			styleValueText(
				getStyleIntent(
					"cursor-wait scroll-smooth",
					opts,
					"interaction.scroll-behavior",
				),
			),
		).toBe("smooth");
		expect(
			applyStyleUtility(
				"scroll-smooth unknown-interaction",
				opts,
				"interaction.scroll-margin-top",
				interactionUtility("interaction.scroll-margin-top", "4"),
			),
		).toBe("scroll-smooth unknown-interaction scroll-mt-4");
	});

	it("writes accent and caret colors in separate slots from text color", () => {
		const withAccent = applyColorChange("text-red-500", opts, {
			property: "accent",
			variants: [],
			value: { kind: "token", token: "blue-500" },
		});
		expect(withAccent).toBe("text-red-500 accent-blue-500");

		const withCaret = applyColorChange(withAccent, opts, {
			property: "caret",
			variants: [],
			value: { kind: "token", token: "red-500" },
		});
		expect(withCaret).toBe("text-red-500 accent-blue-500 caret-red-500");

		expect(
			applyColorClear(withCaret, opts, { property: "accent", variants: [] }),
		).toBe("text-red-500 caret-red-500");
	});
});
