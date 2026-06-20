import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getStoredTailwindTokens,
	saveAndConfirmTailwindTokens,
	storedTailwindTokensQueryKey,
	storedTailwindTokensQueryOptions,
	syncTailwindTokens,
} from "./tailwind-sync-tokens";

afterEach(() => {
	vi.restoreAllMocks();
});

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

describe("syncTailwindTokens", () => {
	it("posts a system name payload and returns the presentation-rich sync response", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jsonResponse(200, {
				status: "updated",
				systemName: "core",
				cssPath: "src/index.css",
				tailwindBaselineVersion: "4.2.4",
				syncedAt: "2026-05-03T12:00:00.000Z",
				reviewRequired: true,
				tokens: [{ name: "brand-500", value: "#123456", domain: "color" }],
				baselineDiff: {
					added: [{ name: "brand-500", value: "#123456", domain: "color" }],
					overridden: [],
					unchanged: [],
					removed: [],
					missingDefaultTokenNames: [],
				},
			}),
		);

		const result = await syncTailwindTokens({ systemName: "core" });

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/tailwind/sync-tokens",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ systemName: "core" }),
			}),
		);
		expect(result).toMatchObject({
			status: "updated",
			systemName: "core",
			cssPath: "src/index.css",
			tailwindBaselineVersion: "4.2.4",
			syncedAt: "2026-05-03T12:00:00.000Z",
			reviewRequired: true,
		});
		// Sync response keeps presentation-only fields like `unchanged` and
		// `missingDefaultTokenNames` even though the canonical stored snapshot
		// trims them out.
		expect(result.baselineDiff).toMatchObject({
			added: [{ name: "brand-500", value: "#123456", domain: "color" }],
			unchanged: [],
			missingDefaultTokenNames: [],
		});
	});

	it("posts a css path payload", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jsonResponse(200, {
				status: "ok",
				systemName: "core",
				cssPath: "src/index.css",
				tailwindBaselineVersion: "4.2.4",
				syncedAt: "2026-05-03T12:00:00.000Z",
				reviewRequired: false,
				tokens: [],
				baselineDiff: {
					added: [],
					overridden: [],
					unchanged: [],
					removed: [],
					missingDefaultTokenNames: [],
				},
			}),
		);

		await syncTailwindTokens({ cssPath: "src/index.css" });

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/tailwind/sync-tokens",
			expect.objectContaining({
				body: JSON.stringify({ cssPath: "src/index.css" }),
			}),
		);
	});
});

describe("getStoredTailwindTokens", () => {
	it("reads the canonical stored snapshot via GET", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jsonResponse(200, {
				ok: true,
				systemName: "core",
				cssPath: "src/index.css",
				syncedAt: "2026-05-03T12:00:00.000Z",
				tailwindBaselineVersion: "4.2.4",
				reviewRequired: false,
				domains: {
					color: {
						tokens: { "brand-500": "#123456" },
						overrides: ["--color-*"],
						baselineDiff: {
							added: [],
							overridden: [],
							removed: [],
						},
					},
				},
			}),
		);

		const stored = await getStoredTailwindTokens("core");

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/tailwind/systems/core/tokens",
		);
		expect(stored).toEqual({
			ok: true,
			systemName: "core",
			cssPath: "src/index.css",
			syncedAt: "2026-05-03T12:00:00.000Z",
			tailwindBaselineVersion: "4.2.4",
			reviewRequired: false,
			domains: {
				color: {
					tokens: { "brand-500": "#123456" },
					overrides: ["--color-*"],
					baselineDiff: {
						added: [],
						overridden: [],
						removed: [],
					},
				},
			},
		});
	});

	it("URL-encodes system names with special characters", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(jsonResponse(404, { error: "missing" }));

		await getStoredTailwindTokens("Marketing & Web");

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/tailwind/systems/Marketing%20%26%20Web/tokens",
		);
	});

	it("returns null when the snapshot is not yet stored (404)", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jsonResponse(404, { error: 'No tokens stored for system "core"' }),
		);

		const stored = await getStoredTailwindTokens("core");

		expect(stored).toBeNull();
	});

	it("rethrows non-404 HTTP errors", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jsonResponse(500, { error: "boom" }),
		);

		await expect(getStoredTailwindTokens("core")).rejects.toMatchObject({
			status: 500,
			message: "boom",
		});
	});
});

describe("saveAndConfirmTailwindTokens", () => {
	it("POSTs the override payload and returns the stored snapshot", async () => {
		const storedSnapshot = {
			ok: true,
			systemName: "core",
			cssPath: "src/index.css",
			syncedAt: "2026-05-03T12:00:00.000Z",
			tailwindBaselineVersion: "4.2.4",
			reviewRequired: false,
			domains: {
				color: {
					tokens: { "brand-500": "#123456" },
					overrides: ["--color-*"],
					baselineDiff: {
						added: [],
						overridden: [],
						removed: [],
					},
				},
			},
		};
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(jsonResponse(200, storedSnapshot));

		const result = await saveAndConfirmTailwindTokens({
			systemName: "core",
			domains: { color: { overrides: ["--color-*"] } },
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/tailwind/systems/core/tokens",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					domains: { color: { overrides: ["--color-*"] } },
				}),
			}),
		);
		expect(result).toEqual(storedSnapshot);
		// The save-and-confirm semantics surface a cleared review flag.
		expect(result.reviewRequired).toBe(false);
	});

	it("POSTs granular overrides with red family and token declarations", async () => {
		const storedSnapshot = {
			ok: true,
			systemName: "core",
			cssPath: "src/index.css",
			syncedAt: "2026-05-03T12:00:00.000Z",
			tailwindBaselineVersion: "4.2.4",
			reviewRequired: false,
			domains: {
				color: {
					tokens: { "brand-500": "#123456" },
					overrides: ["--color-red-*", "--color-red-50"],
					baselineDiff: {
						added: [],
						overridden: [],
						removed: [],
					},
				},
			},
		};
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(jsonResponse(200, storedSnapshot));

		const result = await saveAndConfirmTailwindTokens({
			systemName: "core",
			domains: { color: { overrides: ["--color-red-50", "--color-red-*"] } },
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/tailwind/systems/core/tokens",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					domains: { color: { overrides: ["--color-red-50", "--color-red-*"] } },
				}),
			}),
		);
		expect(result).toEqual(storedSnapshot);
		expect(result.domains.color.overrides).toEqual([
			"--color-red-*",
			"--color-red-50",
		]);
	});

	it("propagates HTTP errors instead of swallowing them", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jsonResponse(400, { error: "Invalid override pattern" }),
		);

		await expect(
			saveAndConfirmTailwindTokens({
				systemName: "core",
				domains: { color: { overrides: ["--bad-*"] } },
			}),
		).rejects.toMatchObject({
			status: 400,
			message: "Invalid override pattern",
		});
	});
});

describe("storedTailwindTokensQueryKey/Options", () => {
	it("namespaces the cache key by system name", () => {
		expect(storedTailwindTokensQueryKey("core")).toEqual([
			"trickroom-tailwind-tokens",
			"core",
		]);
	});

	it("builds query options that share the cache key", () => {
		const options = storedTailwindTokensQueryOptions("core");
		expect(options.queryKey).toEqual(storedTailwindTokensQueryKey("core"));
		expect(typeof options.queryFn).toBe("function");
	});
});
