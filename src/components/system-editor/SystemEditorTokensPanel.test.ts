import { describe, expect, it } from "vitest";
import {
	buildCompleteSyncedTokens,
	canConfirmTokenReview,
} from "./SystemEditorTokensPanel";

describe("canConfirmTokenReview", () => {
	it("allows confirmation from a fresh sync result before the stored snapshot query refreshes", () => {
		expect(
			canConfirmTokenReview({
				hasStoredSnapshot: false,
				hasSyncResult: true,
				isSaving: false,
				isStoredSnapshotPending: false,
				reviewRequired: true,
			}),
		).toBe(true);
	});

	it("allows confirmation from a stored snapshot when no sync result is present", () => {
		expect(
			canConfirmTokenReview({
				hasStoredSnapshot: true,
				hasSyncResult: false,
				isSaving: false,
				isStoredSnapshotPending: false,
				reviewRequired: true,
			}),
		).toBe(true);
	});

	it("blocks confirmation while saving or when no review is pending", () => {
		expect(
			canConfirmTokenReview({
				hasStoredSnapshot: true,
				hasSyncResult: true,
				isSaving: true,
				isStoredSnapshotPending: false,
				reviewRequired: true,
			}),
		).toBe(false);
		expect(
			canConfirmTokenReview({
				hasStoredSnapshot: true,
				hasSyncResult: true,
				isSaving: false,
				isStoredSnapshotPending: false,
				reviewRequired: false,
			}),
		).toBe(false);
	});
});

describe("buildCompleteSyncedTokens", () => {
	it("omits removed Tailwind defaults from the synced token list", () => {
		const tokens = buildCompleteSyncedTokens({
			addedTokens: [{ domain: "color", name: "brand-500", value: "#123456" }],
			overriddenTokens: [
				{
					domain: "radius",
					name: "lg",
					value: "0.75rem",
					defaultValue: "0.5rem",
				},
			],
			removedTokens: [
				{
					domain: "color",
					name: "red-500",
					defaultValue: "oklch(63.7% 0.237 25.331)",
				},
				{
					domain: "radius",
					name: "xl",
					defaultValue: "0.75rem",
				},
			],
		});

		expect(tokens).toContainEqual(
			expect.objectContaining({
				domain: "color",
				name: "brand-500",
				status: "added",
			}),
		);
		expect(tokens).toContainEqual(
			expect.objectContaining({
				domain: "radius",
				name: "lg",
				status: "overridden",
			}),
		);
		expect(tokens).not.toContainEqual(
			expect.objectContaining({ domain: "color", name: "red-500" }),
		);
		expect(tokens).not.toContainEqual(
			expect.objectContaining({ domain: "radius", name: "xl" }),
		);
	});

	it("sorts length-like tokens by resolved numeric value inside each domain", () => {
		const tokens = buildCompleteSyncedTokens({
			addedTokens: [
				{ domain: "text", name: "2xs", value: "0.6875rem" },
				{ domain: "breakpoint", name: "2xs", value: "20rem" },
				{ domain: "breakpoint", name: "xs", value: "30rem" },
				{ domain: "spacing", name: "pad-4xl", value: "--spacing(16)" },
				{ domain: "spacing", name: "pad-xs", value: "--spacing(1)" },
			],
			overriddenTokens: [],
		});

		const textNames = tokens
			.filter((token) => token.domain === "text")
			.filter((token) => !token.name.endsWith("--line-height"))
			.map((token) => token.name);
		const spacingNames = tokens
			.filter((token) => token.domain === "spacing")
			.map((token) => token.name);
		const breakpointNames = tokens
			.filter((token) => token.domain === "breakpoint")
			.map((token) => token.name);

		expect(textNames.slice(0, 3)).toEqual(["2xs", "xs", "sm"]);
		expect(spacingNames.indexOf("pad-xs")).toBeLessThan(
			spacingNames.indexOf("pad-4xl"),
		);
		expect(breakpointNames.slice(0, 4)).toEqual(["2xs", "xs", "sm", "md"]);
	});
});
