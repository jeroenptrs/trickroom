import { describe, expect, it } from "vitest";
import {
	areProjectTokenDefinitionsEquivalent,
	backfillConfirmedTokenState,
	computeTokenReviewChanges,
	getTokenReviewCounts,
	type TailwindTokenReviewChanges,
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

		expect(
			getTokenReviewCounts({ reviewChanges: changes, baselineDiffs: undefined })
				.total,
		).toBe(0);
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
		expect(
			getTokenReviewCounts({ reviewChanges: changes, baselineDiffs: undefined })
				.total,
		).toBe(3);
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
		expect(
			getTokenReviewCounts({ reviewChanges: changes, baselineDiffs: undefined })
				.total,
		).toBe(6);
	});
});

describe("computeTokenReviewChanges with the authored theme", () => {
	it("leaves out a confirmed override that a new Tailwind default caught up with", () => {
		// Authored the same; resolved against the defaults it is no longer an
		// override. Nothing changed.
		const authored = {
			domains: { color: { tokens: { "blue-500": "#0011ff" }, resets: [] } },
		};
		const confirmed = confirmedState({
			domains: { color: { tokens: { "blue-500": "#0011ff" }, removed: [] } },
			authored,
		});
		const current = definition({ domains: {}, authored });

		expect(areProjectTokenDefinitionsEquivalent(confirmed, current)).toBe(true);
		expect(
			getTokenReviewCounts({
				reviewChanges: computeTokenReviewChanges(confirmed, current),
				baselineDiffs: undefined,
			}).total,
		).toBe(0);
	});

	it("compares resets by pattern, not by the defaults they remove", () => {
		const confirmed = confirmedState({
			domains: { color: { tokens: {}, removed: ["red-500"] } },
			authored: { domains: { color: { tokens: {}, resets: ["--color-*"] } } },
		});
		// A new Tailwind default beneath the same reset.
		const withNewDefault = definition({
			domains: { color: { tokens: {}, removed: ["mauve-50", "red-500"] } },
			authored: { domains: { color: { tokens: {}, resets: ["--color-*"] } } },
		});
		expect(
			areProjectTokenDefinitionsEquivalent(confirmed, withNewDefault),
		).toBe(true);

		const withoutReset = definition({
			domains: {},
			authored: { domains: {} },
		});
		expect(areProjectTokenDefinitionsEquivalent(confirmed, withoutReset)).toBe(
			false,
		);
		const changes = computeTokenReviewChanges(confirmed, withoutReset);
		expect(changes.resets).toEqual({
			added: [],
			removed: [{ domain: "color", pattern: "--color-*" }],
		});
		expect(changes.tokens).toEqual({ added: [], changed: [], removed: [] });
	});

	it("reports authored tokens with the values as written", () => {
		const changes = computeTokenReviewChanges(
			confirmedState({
				authored: {
					domains: {
						color: {
							tokens: { "brand-500": "#123456", "blue-500": "#0011ff" },
							resets: [],
						},
					},
				},
			}),
			definition({
				authored: {
					domains: {
						color: {
							tokens: { "brand-500": "#654321", "brand-100": "#abcdef" },
							resets: [],
						},
					},
				},
			}),
		);

		expect(changes.tokens.added).toEqual([
			{ domain: "color", name: "brand-100", value: "#abcdef" },
		]);
		expect(changes.tokens.changed).toEqual([
			// No longer authored: back to the Tailwind default.
			expect.objectContaining({ name: "blue-500", previousValue: "#0011ff" }),
			{
				domain: "color",
				name: "brand-500",
				previousValue: "#123456",
				value: "#654321",
			},
		]);
	});

	it("falls back to the resolved tokens while one side has no authored theme", () => {
		const confirmed = confirmedState({
			domains: { color: { tokens: { "brand-500": "#123456" }, removed: [] } },
		});
		const current = definition({
			domains: { color: { tokens: { "brand-500": "#123456" }, removed: [] } },
			authored: {
				domains: { color: { tokens: { "brand-500": "#123456" }, resets: [] } },
			},
		});

		expect(areProjectTokenDefinitionsEquivalent(confirmed, current)).toBe(true);
		expect(backfillConfirmedTokenState(confirmed, current).authored).toEqual(
			current.authored,
		);
	});

	it("does not backfill a confirmed state the project has moved away from", () => {
		const confirmed = confirmedState({
			domains: { color: { tokens: { "brand-500": "#123456" }, removed: [] } },
		});
		const current = definition({
			domains: { color: { tokens: { "brand-500": "#654321" }, removed: [] } },
			authored: {
				domains: { color: { tokens: { "brand-500": "#654321" }, resets: [] } },
			},
		});

		expect(backfillConfirmedTokenState(confirmed, current)).toBe(confirmed);
	});
});

describe("custom utilities", () => {
	const utility = {
		root: "bg-app",
		kind: "static" as const,
		consumedNamespaces: [],
		completionValues: [],
		domains: ["color"],
	};

	it("changes with the authored definition", () => {
		const confirmed = confirmedState({
			customUtilities: [
				{
					...utility,
					definition: "@utility bg-app { background-color: #123456; }",
				},
			],
		});
		const current = definition({
			customUtilities: [
				{
					...utility,
					definition: "@utility bg-app { background-color: #654321; }",
				},
			],
		});

		expect(areProjectTokenDefinitionsEquivalent(confirmed, current)).toBe(
			false,
		);
		expect(
			computeTokenReviewChanges(confirmed, current).customUtilities,
		).toEqual({ added: [], changed: ["bg-app"], removed: [] });
	});

	it("ignores completion values and inferred domains once definitions are recorded", () => {
		const functional = {
			root: "bg-tone",
			kind: "functional" as const,
			consumedNamespaces: ["--color"],
			definition:
				"@utility bg-tone-* { background-color: --value(--color-*); }",
		};
		expect(
			areProjectTokenDefinitionsEquivalent(
				confirmedState({
					customUtilities: [
						{
							...functional,
							completionValues: ["red-500"],
							domains: ["color"],
						},
					],
				}),
				definition({
					customUtilities: [
						{
							...functional,
							completionValues: ["mauve-50", "red-500"],
							domains: [],
						},
					],
				}),
			),
		).toBe(true);
	});

	it("compares what was recorded while one side has no definition", () => {
		const confirmed = confirmedState({ customUtilities: [utility] });

		expect(
			areProjectTokenDefinitionsEquivalent(
				confirmed,
				definition({
					customUtilities: [
						{
							...utility,
							definition: "@utility bg-app { background-color: #123456; }",
						},
					],
				}),
			),
		).toBe(true);
	});
});

describe("getTokenReviewCounts", () => {
	const empty = { added: [], changed: [], removed: [] };
	const reviewChanges: TailwindTokenReviewChanges = {
		confirmedAt: "2026-06-02T16:33:49.228Z",
		confirmedTailwindBaselineVersion: "4.2.4",
		tokens: empty,
		resets: { added: [{ domain: "color", pattern: "--color-*" }], removed: [] },
		customProperties: {
			...empty,
			added: [{ name: "--db-x", value: "1rem" }],
		},
		customUtilities: { ...empty, changed: ["bg-app"] },
	};

	it("counts custom-only changes the same on every surface", () => {
		expect(
			getTokenReviewCounts({ reviewChanges, baselineDiffs: undefined }),
		).toEqual({
			added: 1,
			changed: 1,
			removed: 1,
			total: 3,
			sinceLastReview: true,
		});
	});

	it("counts the theme diff across all domains before the first review", () => {
		expect(
			getTokenReviewCounts({
				reviewChanges: null,
				baselineDiffs: {
					color: { added: [1, 2], overridden: [], removed: [1] },
					radius: { added: [], overridden: [1], removed: [1, 2] },
				},
			}),
		).toEqual({
			added: 2,
			changed: 1,
			removed: 3,
			total: 6,
			sinceLastReview: false,
		});
	});
});
