import { describe, expect, it } from "vitest";
import type { TailwindSyncResult } from "../../hooks/useTailwindSyncController";
import type { TailwindTokenDomainDiffs } from "../../utils/tailwind-token-domains";
import { getSystemMetadata } from "./Systems";

function syncResult({
	reviewRequired,
	added,
	removed,
}: {
	reviewRequired: boolean;
	added: number;
	removed: number;
}): TailwindSyncResult {
	return {
		status: reviewRequired ? "updated" : "success",
		data: {
			status: "ok",
			systemId: "Core",
			systemName: "Core",
			cssPath: "src/index.css",
			tailwindBaselineVersion: "4.2.4",
			tokens: [],
			baselineDiff: {
				added: Array.from({ length: added }, (_, index) => ({
					name: `brand-${index}`,
					value: "#000",
					domain: "color" as const,
				})),
				overridden: [],
				unchanged: [],
				removed: Array.from({ length: removed }, (_, index) => ({
					name: `red-${index}`,
					defaultValue: "#fff",
					domain: "color" as const,
				})),
				missingDefaultTokenNames: [],
			},
			syncedAt: "2026-05-23T12:00:00.000Z",
			reviewRequired,
			baselineDiffs: {} as TailwindTokenDomainDiffs,
			changes: "none",
			reviewChanges: null,
		},
	};
}

describe("getSystemMetadata", () => {
	it("shows diff without the path while a system is in review", () => {
		expect(
			getSystemMetadata(
				syncResult({ reviewRequired: true, added: 12, removed: 4 }),
				"src/index.css",
			),
		).toBe("+12 / -4");
	});

	it("shows the diff after a system is synced", () => {
		expect(
			getSystemMetadata(
				syncResult({ reviewRequired: false, added: 3, removed: 2 }),
				"src/index.css",
			),
		).toBe("index.css · +3 / -2");
	});

	it("shows the changes since the last review while a system is in review", () => {
		const result = syncResult({
			reviewRequired: true,
			added: 216,
			removed: 288,
		});
		if (!result.data) {
			throw new Error("expected sync data");
		}
		result.data.reviewChanges = {
			confirmedAt: "2026-06-02T16:33:49.228Z",
			confirmedTailwindBaselineVersion: "4.2.4",
			tokens: {
				added: [{ domain: "color", name: "brand-100", value: "#abcdef" }],
				changed: [],
				removed: [],
			},
			customProperties: { added: [], changed: [], removed: [] },
			customUtilities: { added: [], changed: [], removed: [] },
		};

		expect(getSystemMetadata(result, "src/index.css")).toBe(
			"+1 ~0 -0 since last review",
		);
	});

	it("keeps the existing no-data fallback", () => {
		expect(getSystemMetadata({ status: "idle" }, "src/index.css")).toBe(
			"index.css · no token data",
		);
	});
});
