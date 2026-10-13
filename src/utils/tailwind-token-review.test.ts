import { describe, expect, it } from "vitest";
import {
	computeTokenReviewChanges,
	countTokenReviewChanges,
} from "./tailwind-token-review";
import type {
	TailwindConfirmedTokenState,
	TailwindProjectTokenDefinition,
} from "./tailwind-token-store";

const confirmedState = (
	definition: Partial<TailwindProjectTokenDefinition> = {},
): TailwindConfirmedTokenState => ({
	confirmedAt: "2026-06-02T16:33:49.228Z",
	tailwindBaselineVersion: "4.2.4",
	domains: {},
	customProperties: {},
	customUtilities: [],
	...definition,
});

const definition = (
	value: Partial<TailwindProjectTokenDefinition> = {},
): TailwindProjectTokenDefinition => ({
	domains: {},
	customProperties: {},
	customUtilities: [],
	...value,
});

describe("computeTokenReviewChanges", () => {
	it("reports nothing when the definition is unchanged", () => {
		const domains = {
			color: { tokens: { "brand-500": "#123456" }, removed: ["red-500"] },
		};
		const changes = computeTokenReviewChanges(
			confirmedState({ domains }),
			definition({ domains }),
		);

		expect(countTokenReviewChanges(changes)).toBe(0);
		expect(changes.confirmedAt).toBe("2026-06-02T16:33:49.228Z");
		expect(changes.confirmedTailwindBaselineVersion).toBe("4.2.4");
	});

	it("reports added, changed and removed tokens with old and new values", () => {
		const changes = computeTokenReviewChanges(
			confirmedState({
				domains: {
					color: {
						tokens: { "brand-500": "#123456", "brand-900": "#000011" },
						removed: [],
					},
				},
			}),
			definition({
				domains: {
					color: {
						tokens: { "brand-500": "#654321", "brand-100": "#abcdef" },
						removed: [],
					},
				},
			}),
		);

		expect(changes.tokens).toEqual({
			added: [{ domain: "color", name: "brand-100", value: "#abcdef" }],
			changed: [
				{
					domain: "color",
					name: "brand-500",
					previousValue: "#123456",
					value: "#654321",
				},
			],
			removed: [
				{ domain: "color", name: "brand-900", previousValue: "#000011" },
			],
		});
		expect(countTokenReviewChanges(changes)).toBe(3);
	});

	it("treats removing and restoring Tailwind defaults as project changes", () => {
		const changes = computeTokenReviewChanges(
			confirmedState({
				domains: {
					color: { tokens: { "blue-500": "#0011ff" }, removed: ["red-500"] },
				},
			}),
			definition({
				domains: {
					color: { tokens: {}, removed: ["slate-500"] },
				},
			}),
		);

		// blue-500 no longer overridden: back to the Tailwind default.
		expect(changes.tokens.changed).toEqual([
			expect.objectContaining({
				name: "blue-500",
				previousValue: "#0011ff",
				value: expect.stringMatching(/^oklch/),
			}),
		]);
		// red-500 no longer removed: the default is back.
		expect(changes.tokens.added).toEqual([
			expect.objectContaining({
				name: "red-500",
				value: expect.stringMatching(/^oklch/),
			}),
		]);
		// slate-500 newly removed.
		expect(changes.tokens.removed).toEqual([
			expect.objectContaining({
				name: "slate-500",
				previousValue: expect.stringMatching(/^oklch/),
			}),
		]);
	});

	it("reports custom property and custom utility changes", () => {
		const utility = {
			root: "text-interaction",
			kind: "functional" as const,
			consumedNamespaces: ["--db-interaction"],
			completionValues: ["sm"],
			domains: ["typography"],
		};
		const changes = computeTokenReviewChanges(
			confirmedState({
				customProperties: { "--db-a": "1rem", "--db-b": "2rem" },
				customUtilities: [utility, { ...utility, root: "gone" }],
			}),
			definition({
				customProperties: { "--db-a": "1.5rem", "--db-c": "3rem" },
				customUtilities: [
					{ ...utility, completionValues: ["sm", "lg"] },
					{ ...utility, root: "fresh" },
				],
			}),
		);

		expect(changes.customProperties).toEqual({
			added: [{ name: "--db-c", value: "3rem" }],
			changed: [{ name: "--db-a", previousValue: "1rem", value: "1.5rem" }],
			removed: [{ name: "--db-b", previousValue: "2rem" }],
		});
		expect(changes.customUtilities).toEqual({
			added: ["fresh"],
			changed: ["text-interaction"],
			removed: ["gone"],
		});
		expect(countTokenReviewChanges(changes)).toBe(6);
	});
});
