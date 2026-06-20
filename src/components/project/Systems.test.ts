import { describe, expect, it } from "vitest";
import type { TailwindSyncResult } from "../../hooks/useTailwindSyncController";
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

	it("keeps the existing no-data fallback", () => {
		expect(getSystemMetadata({ status: "idle" }, "src/index.css")).toBe(
			"index.css · no token data",
		);
	});
});
