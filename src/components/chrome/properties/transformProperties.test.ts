import { describe, expect, it } from "vitest";
import {
	applyStyleUtility,
	clearStyleProperty,
	getStyleIntent,
	styleValueText,
} from "./styleSectionController";
import {
	applyTransformInput,
	readTransformValue,
	transformModeUtility,
} from "./transformPropertiesController";

const opts = { colorTokens: new Set<string>() };

describe("transformPropertiesController", () => {
	describe("transformModeUtility", () => {
		it("maps mode values to utility bodies", () => {
			expect(transformModeUtility("transform")).toBe("transform");
			expect(transformModeUtility("gpu")).toBe("transform-gpu");
			expect(transformModeUtility("cpu")).toBe("transform-cpu");
			expect(transformModeUtility("none")).toBe("transform-none");
		});
	});

	describe("applyTransformInput", () => {
		it("applies a translate-x value", () => {
			expect(
				applyTransformInput(
					"text-sm",
					opts,
					"transform.translate-x",
					"translate-x",
					"4",
				),
			).toBe("text-sm translate-x-4");
		});

		it("applies a negative translate-y value", () => {
			expect(
				applyTransformInput(
					"w-4",
					opts,
					"transform.translate-y",
					"translate-y",
					"-8",
				),
			).toBe("w-4 -translate-y-8");
		});

		it("applies an arbitrary translate-x value", () => {
			expect(
				applyTransformInput(
					"",
					opts,
					"transform.translate-x",
					"translate-x",
					"[13px]",
				),
			).toBe("translate-x-[13px]");
		});

		it("clears when input is empty", () => {
			expect(
				applyTransformInput(
					"translate-x-4 w-4",
					opts,
					"transform.translate-x",
					"translate-x",
					"",
				),
			).toBe("w-4");
		});

		it("applies a custom property value", () => {
			expect(
				applyTransformInput(
					"",
					opts,
					"transform.translate-x",
					"translate-x",
					"(--offset)",
				),
			).toBe("translate-x-(--offset)");
		});
	});

	describe("readTransformValue", () => {
		it("returns display string for rotate", () => {
			expect(
				readTransformValue("rotate-45 w-4", opts, "transform.rotate"),
			).toBe("45");
		});

		it("returns negative display for negative rotate", () => {
			expect(
				readTransformValue("-rotate-90 w-4", opts, "transform.rotate"),
			).toBe("-90");
		});

		it("returns empty string when unset", () => {
			expect(readTransformValue("w-4", opts, "transform.rotate")).toBe("");
		});
	});
});

describe("transform domain — styleSectionController helpers", () => {
	describe("transform-mode", () => {
		it("sets transform mode", () => {
			const next = applyStyleUtility(
				"w-4",
				opts,
				"transform.transform-mode",
				"transform",
			);
			expect(next).toBe("w-4 transform");
		});

		it("replaces transform mode", () => {
			const next = applyStyleUtility(
				"transform w-4",
				opts,
				"transform.transform-mode",
				"transform-gpu",
			);
			expect(next).toBe("transform-gpu w-4");
		});

		it("reads transform-mode values correctly", () => {
			expect(
				styleValueText(
					getStyleIntent("transform", opts, "transform.transform-mode"),
				),
			).toBe("transform");
			expect(
				styleValueText(
					getStyleIntent("transform-gpu", opts, "transform.transform-mode"),
				),
			).toBe("gpu");
			expect(
				styleValueText(
					getStyleIntent("transform-none", opts, "transform.transform-mode"),
				),
			).toBe("none");
		});
	});

	describe("axis independence", () => {
		it("translate-x and translate-y are separate slots", () => {
			const withX = applyStyleUtility(
				"w-4",
				opts,
				"transform.translate-x",
				"translate-x-4",
			);
			const withY = applyStyleUtility(
				withX,
				opts,
				"transform.translate-y",
				"translate-y-8",
			);
			expect(withY).toBe("w-4 translate-x-4 translate-y-8");
		});

		it("editing translate-x does not remove translate-y", () => {
			const next = applyStyleUtility(
				"translate-x-4 translate-y-8",
				opts,
				"transform.translate-x",
				"translate-x-2",
			);
			expect(next).toBe("translate-x-2 translate-y-8");
		});

		it("rotate and rotate-x are separate slots", () => {
			const withRotate = applyStyleUtility(
				"w-4",
				opts,
				"transform.rotate",
				"rotate-45",
			);
			const withRotateX = applyStyleUtility(
				withRotate,
				opts,
				"transform.rotate-x",
				"rotate-x-12",
			);
			expect(withRotateX).toBe("w-4 rotate-45 rotate-x-12");
		});

		it("scale and scale-x are separate slots", () => {
			const withScale = applyStyleUtility(
				"w-4",
				opts,
				"transform.scale",
				"scale-50",
			);
			const withScaleX = applyStyleUtility(
				withScale,
				opts,
				"transform.scale-x",
				"scale-x-75",
			);
			expect(withScaleX).toBe("w-4 scale-50 scale-x-75");
		});

		it("skew-x and skew-y are separate slots", () => {
			const withSkewX = applyStyleUtility(
				"w-4",
				opts,
				"transform.skew-x",
				"skew-x-6",
			);
			const withSkewY = applyStyleUtility(
				withSkewX,
				opts,
				"transform.skew-y",
				"skew-y-12",
			);
			expect(withSkewY).toBe("w-4 skew-x-6 skew-y-12");
		});
	});

	describe("exact slot replacement", () => {
		it("replaces rotate without touching translate", () => {
			const next = applyStyleUtility(
				"translate-x-4 rotate-45 w-4",
				opts,
				"transform.rotate",
				"rotate-90",
			);
			expect(next).toBe("translate-x-4 rotate-90 w-4");
		});

		it("clears rotate without affecting scale", () => {
			expect(
				clearStyleProperty("rotate-45 scale-50 w-4", opts, "transform.rotate"),
			).toBe("scale-50 w-4");
		});
	});

	describe("transform-origin", () => {
		it("sets origin", () => {
			const next = applyStyleUtility(
				"rotate-45",
				opts,
				"transform.transform-origin",
				"origin-center",
			);
			expect(next).toBe("rotate-45 origin-center");
		});

		it("reads origin value", () => {
			expect(
				styleValueText(
					getStyleIntent(
						"origin-top-right rotate-45",
						opts,
						"transform.transform-origin",
					),
				),
			).toBe("top-right");
		});
	});

	describe("unknown classes round-trip", () => {
		it("unknown classes preserved when editing transform properties", () => {
			const next = applyStyleUtility(
				"unknown-card",
				opts,
				"transform.rotate",
				"rotate-45",
			);
			expect(next).toBe("unknown-card rotate-45");
		});
	});
});
