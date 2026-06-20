import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	invalidateSystemComponents,
	systemComponentQueryKey,
	systemComponentsQueryKey,
	systemComponentsQueryOptions,
} from "./system-components";

describe("system component queries", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("scopes list and describe query keys by project", () => {
		expect(systemComponentsQueryKey("sys_core")).toEqual([
			"trickroom-system-components",
			"sys_core",
		]);
		expect(systemComponentsQueryKey("sys_core", "loc_123")).toEqual([
			"trickroom-system-components",
			"sys_core",
			"loc_123",
		]);
		expect(systemComponentQueryKey("sys_core", "cmp_1", "loc_123")).toEqual([
			"trickroom-system-component",
			"sys_core",
			"cmp_1",
			"loc_123",
		]);
	});

	it("fetches the component list through the REST route", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					systemId: "sys_core",
					systemName: "Core",
					revision: "sha256:abc",
					updatedAt: "2026-05-26T00:00:00.000Z",
					components: [],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const queryClient = new QueryClient();
		const result = await queryClient.fetchQuery(
			systemComponentsQueryOptions("sys_core"),
		);

		expect(fetchMock).toHaveBeenCalledWith("/api/trickroom/systems/sys_core/components");
		expect(result.systemName).toBe("Core");
	});

	it("invalidates list and component detail queries after mutations", async () => {
		const queryClient = new QueryClient();
		const invalidateSpy = vi
			.spyOn(queryClient, "invalidateQueries")
			.mockResolvedValue();

		await invalidateSystemComponents(queryClient, "sys_core", "loc_123", "cmp_1");

		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: ["trickroom-system-components", "sys_core", "loc_123"],
		});
		expect(invalidateSpy).toHaveBeenCalledWith({
			queryKey: ["trickroom-system-component", "sys_core", "cmp_1", "loc_123"],
		});
	});
});
