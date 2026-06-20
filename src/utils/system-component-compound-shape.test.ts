import { describe, expect, it } from "vitest";
import {
	classifyCompoundWhenShape,
	describeCompoundWhen,
	findDuplicateCompoundWhenSignatures,
	isAdvancedCompoundWhen,
	listAuthoredCompounds,
} from "./system-component-compound-shape";
import { compoundWhenSignature } from "./system-component-compound-signature";

const axes = {
	tone: {
		label: "Tone",
		values: {
			brand: { label: "Brand" },
			neutral: { label: "Neutral" },
		},
	},
	size: {
		label: "Size",
		values: {
			lg: { label: "Large" },
			sm: { label: "Small" },
		},
	},
};

describe("classifyCompoundWhenShape", () => {
	it("classifies a two-axis single-value compound as normal", () => {
		expect(classifyCompoundWhenShape({ tone: "brand", size: "lg" }, axes)).toEqual(
			{
				kind: "normal",
				reasons: [],
				validSingleValueConditionCount: 2,
			},
		);
	});

	it("classifies partial two-of-N compounds as normal", () => {
		expect(
			classifyCompoundWhenShape({ tone: "brand", size: "sm" }, axes).kind,
		).toBe("normal");
	});

	it("flags empty when as advanced", () => {
		const result = classifyCompoundWhenShape({}, axes);
		expect(result.kind).toBe("advanced");
		expect(result.reasons).toContain("empty_when");
		expect(result.reasons).toContain("insufficient_conditions");
	});

	it("flags array-valued when as advanced", () => {
		const result = classifyCompoundWhenShape(
			{ tone: ["brand", "neutral"], size: "lg" },
			axes,
		);
		expect(result.kind).toBe("advanced");
		expect(result.reasons).toContain("array_value");
	});

	it("flags one-axis compounds as advanced", () => {
		const result = classifyCompoundWhenShape({ tone: "brand" }, axes);
		expect(result.kind).toBe("advanced");
		expect(result.reasons).toContain("insufficient_conditions");
		expect(result.validSingleValueConditionCount).toBe(1);
	});

	it("flags unknown axis and value references as advanced", () => {
		const unknownAxis = classifyCompoundWhenShape(
			{ tone: "brand", color: "red" },
			axes,
		);
		expect(unknownAxis.kind).toBe("advanced");
		expect(unknownAxis.reasons).toContain("unknown_axis");

		const unknownValue = classifyCompoundWhenShape(
			{ tone: "brand", size: "xl" },
			axes,
		);
		expect(unknownValue.kind).toBe("advanced");
		expect(unknownValue.reasons).toContain("unknown_value");
	});

	it("exposes isAdvancedCompoundWhen as a predicate", () => {
		expect(isAdvancedCompoundWhen({ tone: "brand", size: "lg" }, axes)).toBe(
			false,
		);
		expect(isAdvancedCompoundWhen({ tone: "brand" }, axes)).toBe(true);
	});
});

describe("describeCompoundWhen", () => {
	it("builds a human label from axis and value labels", () => {
		expect(
			describeCompoundWhen({ tone: "brand", size: "lg" }, axes),
		).toBe("Tone: Brand · Size: Large");
	});
});

describe("listAuthoredCompounds", () => {
	it("lists only compounds with non-empty classesByPath", () => {
		const entries = listAuthoredCompounds({
			axes,
			compoundVariants: [
				{ when: { tone: "brand", size: "lg" }, classesByPath: { root: "ring-2" } },
				{ when: { tone: "neutral", size: "sm" }, classesByPath: {} },
				{
					when: { tone: ["brand", "neutral"], size: "lg" },
					classesByPath: { root: "ring-4" },
				},
			],
		});

		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({
			isAdvanced: false,
			label: "Tone: Brand · Size: Large",
		});
		expect(entries[1]).toMatchObject({
			isAdvanced: true,
			advancedDiagnostic: expect.stringContaining("array value"),
		});
	});
});

describe("findDuplicateCompoundWhenSignatures", () => {
	it("returns normalized signatures that appear more than once", () => {
		const compounds = [
			{ when: { tone: "brand", size: "lg" } },
			{ when: { size: "lg", tone: "brand" } },
			{ when: { tone: "neutral", size: "sm" } },
		];
		const duplicates = findDuplicateCompoundWhenSignatures(compounds);
		expect(duplicates).toEqual([
			compoundWhenSignature({ tone: "brand", size: "lg" }),
		]);
	});
});
