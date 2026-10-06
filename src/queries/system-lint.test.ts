import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	invalidateSystemLint,
	runSystemLint,
	systemLintQueryKey,
	systemLintQueryOptions,
} from "./system-lint";

describe("system lint queries", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("scopes the report query key by system and project", () => {
		expect(systemLintQueryKey("sys_core")).toEqual([
			"trickroom-system-lint",
			"sys_core",
		]);
		expect(systemLintQueryKey("sys_core", "loc_1")).toEqual([
			"trickroom-system-lint",
			"sys_core",
			"loc_1",
		]);
		expect(systemLintQueryOptions("sys_core", "loc_1").queryKey).toEqual([
			"trickroom-system-lint",
			"sys_core",
			"loc_1",
		]);
	});

	it("reads the report and runs lint through the REST route", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					systemId: "sys_core",
					systemName: "Core",
					report: { version: 1 },
				}),
			),
		);
		vi.stubGlobal("fetch", fetchMock);
		const read = await systemLintQueryOptions("sys core").queryFn?.(
			{} as never,
		);
		expect(read).toMatchObject({ systemId: "sys_core" });
		expect(fetchMock).toHaveBeenCalledWith(
			"/api/trickroom/systems/sys%20core/lint",
		);

		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ status: "pass", written: true })),
		);
		expect(await runSystemLint("sys_core")).toMatchObject({ status: "pass" });
		expect(fetchMock).toHaveBeenLastCalledWith(
			"/api/trickroom/systems/sys_core/lint",
			{ method: "POST" },
		);

		fetchMock.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					error: "No lint report",
					code: "LINT_REPORT_NOT_FOUND",
				}),
				{ status: 404 },
			),
		);
		await expect(
			systemLintQueryOptions("sys_core").queryFn?.({} as never),
		).rejects.toMatchObject({ status: 404, message: "No lint report" });
	});

	it("invalidates the scoped report query", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(systemLintQueryKey("sys_core", "loc_1"), {
			systemId: "sys_core",
		});
		await invalidateSystemLint(queryClient, "sys_core", "loc_1");
		expect(
			queryClient.getQueryState(systemLintQueryKey("sys_core", "loc_1"))
				?.isInvalidated,
		).toBe(true);
	});
});
