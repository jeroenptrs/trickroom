import { describe, expect, it } from "vitest";
import {
	buildPropertyModel,
	serialize,
	setColor,
	setSpacing,
	UTILITY_DOMAINS,
} from "./index";

const opts = { colorTokens: new Set(["red-500", "blue-500"]) };

describe("UTILITY_DOMAINS registry", () => {
	it("runs custom-functional first (DS utilities win ambiguous prefixes), then color before spacing", () => {
		expect(UTILITY_DOMAINS.map((d) => d.kind)).toEqual([
			"custom-functional",
			"color",
			"spacing",
			"style",
		]);
	});

	it("does not claim built-in classes when no custom roots are configured", () => {
		// custom-functional returns null without roots, so built-ins classify
		// exactly as before the reorder.
		const model = buildPropertyModel("bg-red-500 text-sm p-4", opts);
		expect(serialize(model)).toBe("bg-red-500 text-sm p-4");
	});
});

describe("unknown class preservation", () => {
	it("round-trips arbitrary and non-domain classes through parse and serialize", () => {
		const inputs = [
			"flex rounded [mask:linear-gradient(red,blue)]",
			"data-[state=open]:p-4 custom-thing",
			"text-sm font-bold",
		];
		for (const input of inputs) {
			const model = buildPropertyModel(input, opts);
			expect(serialize(model)).toBe(input);
		}
	});

	it("keeps unknown classes unchanged when editing color", () => {
		const input = "[mask:linear-gradient(red,blue)] flex bg-red-500";
		const model = buildPropertyModel(input, opts);
		const next = setColor(
			model,
			{
				property: "background",
				value: { kind: "token", token: "blue-500" },
			},
			opts,
		);
		expect(serialize(next)).toBe(
			"[mask:linear-gradient(red,blue)] flex bg-blue-500",
		);
	});

	it("keeps unknown classes unchanged when editing spacing", () => {
		const input = "rounded [mask:linear-gradient(red,blue)] p-4";
		const model = buildPropertyModel(input, opts);
		const next = setSpacing(
			model,
			{
				property: "padding",
				value: { kind: "scale", value: "6" },
			},
			opts,
		);
		expect(serialize(next)).toBe(
			"rounded [mask:linear-gradient(red,blue)] p-6",
		);
	});
});
