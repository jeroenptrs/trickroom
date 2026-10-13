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
	const baselineDiff = {
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
	};
	return {
		status: reviewRequired ? "updated" : "success",
		data: {
			status: "ok",
			systemId: "Core",
			systemName: "Core",
			cssPath: "src/index.css",
			tailwindBaselineVersion: "4.2.4",
			tokens: [],
			baselineDiff,
			syncedAt: "2026-05-23T12:00:00.000Z",
			reviewRequired,
			baselineDiffs: {
				color: baselineDiff,
			} as unknown as TailwindTokenDomainDiffs,
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
		).toBe("+12 ~0 -4");
	});

	it("shows the diff after a system is synced", () => {
		expect(
			getSystemMetadata(
				syncResult({ reviewRequired: false, added: 3, removed: 2 }),
				"src/index.css",
			),
		).toBe("index.css · +3 / -2");
	});

	it("counts every change since the last review, custom-only ones included", () => {
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
			tokens: { added: [], changed: [], removed: [] },
			resets: {
				added: [{ domain: "color", pattern: "--color-*" }],
				removed: [],
			},
			customProperties: { added: [], changed: [], removed: [] },
			customUtilities: { added: [], changed: ["bg-penn-app"], removed: [] },
			stylesheets: null,
		};

		expect(getSystemMetadata(result, "src/index.css")).toBe(
			"+0 ~1 -1 since last review",
		);
	});

	it("names stylesheet changes without a token-level change", () => {
		const result = syncResult({
			reviewRequired: true,
			added: 216,
			removed: 288,
		});
		if (!result.data) {
			throw new Error("expected sync data");
		}
		const empty = { added: [], changed: [], removed: [] };
		result.data.reviewChanges = {
			confirmedAt: "2026-06-02T16:33:49.228Z",
			confirmedTailwindBaselineVersion: "4.3.3",
			tokens: empty,
			resets: { added: [], removed: [] },
			customProperties: empty,
			customUtilities: empty,
			stylesheets: { ...empty, changed: ["src/theme.css"] },
		};

		expect(getSystemMetadata(result, "src/index.css")).toBe(
			"1 stylesheet changed since last review",
		);
	});

	it("keeps the existing no-data fallback", () => {
		expect(getSystemMetadata({ status: "idle" }, "src/index.css")).toBe(
			"index.css · no token data",
		);
	});
});
