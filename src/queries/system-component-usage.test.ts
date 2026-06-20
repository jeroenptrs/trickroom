import { describe, expect, it, vi } from "vitest";
import {
	systemComponentsUsageQueryKey,
	systemComponentUsedByQueryKey,
} from "./system-component-usage";

describe("system-component-usage queries", () => {
	it("scopes used-by query keys by project", () => {
		expect(
			systemComponentUsedByQueryKey("sys_core", "cmp_test", "loc_1"),
		).toEqual([
			"trickroom-system-component-used-by",
			"sys_core",
			"cmp_test",
			"loc_1",
		]);
	});

	it("scopes system-wide usage query keys by project", () => {
		expect(systemComponentsUsageQueryKey("sys_core", "loc_1")).toEqual([
			"trickroom-system-components-usage",
			"sys_core",
			null,
			null,
			"loc_1",
		]);
	});

	it("fetches used-by counts from the component route", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				systemId: "sys_core",
				systemName: "Core",
				componentId: "cmp_test",
				usedByCount: 2,
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const { systemComponentUsedByQueryOptions } = await import(
			"./system-component-usage"
		);
		const result = await systemComponentUsedByQueryOptions(
			"sys_core",
			"cmp_test",
		).queryFn();

		expect(result.usedByCount).toBe(2);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/systems/sys_core/components/cmp_test/used-by",
		);

		vi.unstubAllGlobals();
	});

	it("fetches system-wide component usage from the components route", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				systemId: "sys_core",
				systemName: "Core",
				instances: [],
				diagnostics: [],
				usedByCount: 0,
				scannedDesignCount: 2,
				statusCounts: {
					current: 0,
					stale: 0,
					"missing-component": 0,
					"missing-version": 0,
					"hash-mismatch": 0,
				},
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		const { systemComponentsUsageQueryOptions } = await import(
			"./system-component-usage"
		);
		const result =
			await systemComponentsUsageQueryOptions("sys_core").queryFn();

		expect(result.scannedDesignCount).toBe(2);
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/systems/sys_core/components/usage",
		);

		vi.unstubAllGlobals();
	});
});
